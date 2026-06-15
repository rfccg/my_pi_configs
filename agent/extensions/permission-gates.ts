import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

const rmCommandPattern = /(?:^|[\s;&|()])(?:sudo\s+)?(?:command\s+)?(?:\/[^\s;&|()]+\/)?rm\b/;
const alwaysAllowedReadRoots = ["/mypath"];

async function canonical(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return resolve(path);
	}
}

function isInside(root: string, target: string): boolean {
	return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function skillRootFromCommand(command: unknown): string | undefined {
	const skillCommand = command as { source?: string; sourceInfo?: { path?: string } };
	if (skillCommand.source !== "skill" || !skillCommand.sourceInfo?.path) return undefined;

	return dirname(skillCommand.sourceInfo.path);
}

async function isAllowedReadTarget(pi: ExtensionAPI, target: string): Promise<boolean> {
	for (const rootPath of alwaysAllowedReadRoots) {
		if (isInside(await canonical(rootPath), target)) return true;
	}

	for (const command of pi.getCommands()) {
		const skillRoot = skillRootFromCommand(command);
		if (skillRoot && isInside(await canonical(skillRoot), target)) return true;
	}

	return false;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = String(event.input.command ?? "");
		if (!rmCommandPattern.test(command)) return undefined;

		if (!ctx.hasUI) {
			return { block: true, reason: "rm command blocked: no UI available for confirmation" };
		}

		const allowed = await ctx.ui.confirm("Confirm rm command", `Allow this rm command to run?\n\n${command}`);
		if (!allowed) return { block: true, reason: "rm command blocked by user" };

		return undefined;
	});

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "read") return undefined;

		const requestedPath = String(event.input.path ?? "");
		const cwd = await canonical(ctx.cwd);
		const target = await canonical(resolve(ctx.cwd, requestedPath));

		if (isInside(cwd, target) || (await isAllowedReadTarget(pi, target))) return undefined;

		if (!ctx.hasUI) {
			return { block: true, reason: "Read outside working directory blocked: no UI available for confirmation" };
		}

		const allowed = await ctx.ui.confirm(
			"Confirm outside read",
			`Allow reading a file outside the current pi folder?\n\nWorking folder:\n${cwd}\n\nRequested file:\n${target}`,
		);
		if (!allowed) return { block: true, reason: "Read outside working directory blocked by user" };

		return undefined;
	});
}
