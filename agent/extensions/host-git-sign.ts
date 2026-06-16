import { spawn } from "node:child_process";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type HostGitSignedCommitParams = {
	message: string;
	paths?: string[];
	all?: boolean;
	allowEmpty?: boolean;
};

function isInside(root: string, target: string): boolean {
	const relative = path.relative(root, target);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateRelativePath(cwd: string, inputPath: string): string {
	if (!inputPath || inputPath.includes("\0")) throw new Error(`Invalid path: ${JSON.stringify(inputPath)}`);
	if (path.isAbsolute(inputPath)) throw new Error(`Absolute paths are not allowed: ${inputPath}`);

	const resolved = path.resolve(cwd, inputPath);
	if (!isInside(cwd, resolved)) throw new Error(`Path escapes the workspace: ${inputPath}`);

	const normalized = path.relative(cwd, resolved) || ".";
	if (normalized === ".git" || normalized.startsWith(`.git${path.sep}`)) {
		throw new Error(`Refusing to stage git internals: ${inputPath}`);
	}
	return normalized;
}

function runGit(cwd: string, args: string[]): Promise<{ exitCode: number; output: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn("git", args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let output = "";
		proc.stdout.on("data", (data) => {
			output += data.toString();
		});
		proc.stderr.on("data", (data) => {
			output += data.toString();
		});
		proc.on("error", reject);
		proc.on("close", (code) => resolve({ exitCode: code ?? 1, output }));
	});
}

function truncateOutput(output: string): string {
	const maxLength = 12_000;
	return output.length > maxLength ? `${output.slice(0, maxLength)}\n[output truncated]` : output;
}

async function getUnsafeLocalGitConfig(cwd: string): Promise<string | null> {
	const unsafeConfig = await runGit(cwd, [
		"config",
		"--local",
		"--get-regexp",
		"^(filter\\.|gpg\\.|core\\.fsmonitor$|include\\.|includeif\\.)",
	]);
	if (unsafeConfig.exitCode === 1 && !unsafeConfig.output.trim()) return null;
	if (unsafeConfig.exitCode !== 0) return "Unable to inspect repository-local git config.";
	const unsafeKeys = unsafeConfig.output
		.split("\n")
		.map((line) => line.trim().split(/\s+/, 1)[0])
		.filter(Boolean);
	return unsafeKeys.length > 0 ? unsafeKeys.join("\n") : null;
}

const SAFE_GIT_CONFIG_ARGS = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "host_git_signed_commit",
		label: "Host Git Signed Commit",
		description:
			"Create a signed git commit by running a narrow git workflow on the host, outside Gondolin, without exposing signing keys to the agent.",
		promptSnippet: "Create signed git commits on the host without exposing signing keys",
		promptGuidelines: [
			"Use host_git_signed_commit only when the user asks to create a signed git commit from the current workspace changes.",
			"Do not use host_git_signed_commit to inspect secrets or run arbitrary git commands; it only stages selected paths and runs git commit -S on the host.",
		],
		parameters: Type.Object({
			message: Type.String({ description: "Commit message to pass as a single git commit -m argument" }),
			paths: Type.Optional(
				Type.Array(Type.String(), {
					description: "Specific workspace-relative paths to stage before committing. Omit when all=true.",
				}),
			),
			all: Type.Optional(Type.Boolean({ description: "Stage all tracked/untracked workspace changes with git add -A" })),
			allowEmpty: Type.Optional(Type.Boolean({ description: "Allow creating an empty signed commit" })),
		}),
		async execute(_toolCallId, params: HostGitSignedCommitParams, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const message = params.message.trim();
			if (!message) {
				return { content: [{ type: "text", text: "Commit message must not be empty." }], isError: true };
			}

			const paths = params.paths ?? [];
			if (params.all && paths.length > 0) {
				return { content: [{ type: "text", text: "Use either all=true or paths, not both." }], isError: true };
			}
			if (!params.all && paths.length === 0 && !params.allowEmpty) {
				return {
					content: [{ type: "text", text: "Provide paths to stage, set all=true, or set allowEmpty=true." }],
					isError: true,
				};
			}

			const insideWorkTree = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
			if (insideWorkTree.exitCode !== 0 || !insideWorkTree.output.includes("true")) {
				return {
					content: [{ type: "text", text: `Not inside a git work tree.\n${truncateOutput(insideWorkTree.output)}` }],
					isError: true,
				};
			}

			const unsafeConfig = await getUnsafeLocalGitConfig(cwd);
			if (unsafeConfig) {
				return {
					content: [
						{
							type: "text",
							text: `Refusing host signed commit because repository-local git config contains unsafe executable settings:\n${truncateOutput(unsafeConfig)}`,
						},
					],
					isError: true,
				};
			}

			if (params.all) {
				const add = await runGit(cwd, [...SAFE_GIT_CONFIG_ARGS, "add", "-A"]);
				if (add.exitCode !== 0) {
					return { content: [{ type: "text", text: `git add -A failed.\n${truncateOutput(add.output)}` }], isError: true };
				}
			} else if (paths.length > 0) {
				let normalizedPaths: string[];
				try {
					normalizedPaths = paths.map((p) => validateRelativePath(cwd, p));
				} catch (error) {
					return { content: [{ type: "text", text: String(error instanceof Error ? error.message : error) }], isError: true };
				}
				const add = await runGit(cwd, ["--literal-pathspecs", ...SAFE_GIT_CONFIG_ARGS, "add", "--", ...normalizedPaths]);
				if (add.exitCode !== 0) {
					return { content: [{ type: "text", text: `git add failed.\n${truncateOutput(add.output)}` }], isError: true };
				}
			}

			const commitArgs = [...SAFE_GIT_CONFIG_ARGS, "commit", "-S", "-m", message];
			if (params.allowEmpty) commitArgs.push("--allow-empty");
			const commit = await runGit(cwd, commitArgs);
			if (commit.exitCode !== 0) {
				return {
					content: [{ type: "text", text: `Signed commit failed.\n${truncateOutput(commit.output)}` }],
					isError: true,
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Signed commit created on the host.\n${truncateOutput(commit.output)}`,
					},
				],
			};
		},
	});
}
