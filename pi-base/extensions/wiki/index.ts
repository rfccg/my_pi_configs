import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type WikiConfig = {
	root: string;
	requireConfirmation: boolean;
	summaryMaxChars: number;
	detailsMaxChars: number;
};

type ParsedNote = {
	id: string;
	title: string;
	created: string;
	updated: string;
	tags: string[];
	source: string;
	related: string[];
	summary: string;
	details: string;
};

type AddParams = {
	title: string;
	content: string;
	tags?: string[];
	source?: string;
	related?: string[];
};

type UpdateParams = {
	id: string;
	title?: string;
	content?: string;
	tags?: string[];
	source?: string;
	related?: string[];
};

type SearchParams = {
	query: string;
	limit?: number;
};

type IdParams = {
	id: string;
};

const EXTENSION_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PI_ROOT = path.resolve(EXTENSION_ROOT, "../../..");
const DEFAULT_CONFIG: WikiConfig = {
	root: path.join(PI_ROOT, "wiki"),
	requireConfirmation: true,
	summaryMaxChars: 280,
	detailsMaxChars: 5000,
};
const NOTE_ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*(?:-\d+)?$/;

function text(content: string, isError = false) {
	return { content: [{ type: "text" as const, text: content }], isError };
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function slugify(value: string): string {
	const slug = value
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return slug || "note";
}

function createNoteId(title: string, date = today()): string {
	// YYYY-MM-DD-slug
	return `${date}-${slugify(title)}`;
}

function notesDir(root: string): string {
	return path.join(root, "notes");
}

function indexPath(root: string): string {
	return path.join(root, "index.json");
}

function assertValidNoteId(id: string): void {
	if (!NOTE_ID_RE.test(id) || id.includes("/") || id.includes("\\") || id.includes("..")) {
		throw new Error(`Invalid wiki note id: ${id}`);
	}
}

function notePath(root: string, id: string): string {
	assertValidNoteId(id);
	const dir = path.resolve(notesDir(root));
	const resolved = path.resolve(dir, `${id}.md`);
	if (!resolved.startsWith(`${dir}${path.sep}`)) throw new Error(`Invalid wiki note id: ${id}`);
	return resolved;
}

async function ensureWikiDirs(root: string): Promise<void> {
	await mkdir(notesDir(root), { recursive: true });
}

function frontmatterArray(values: string[] | undefined): string {
	return `[${(values ?? []).map((value) => JSON.stringify(value)).join(", ")}]`;
}

function renderNote(note: ParsedNote): string {
	return `---
id: ${note.id}
title: ${JSON.stringify(note.title)}
created: ${note.created}
updated: ${note.updated}
tags: ${frontmatterArray(note.tags)}
source: ${JSON.stringify(note.source)}
related: ${frontmatterArray(note.related)}
---

## Summary
${note.summary.trim()}

## Details
${note.details.trim()}
`;
}

function parseArray(value: string | undefined): string[] {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.map(String) : [];
	} catch {
		return value
			.replace(/^\[|\]$/g, "")
			.split(",")
			.map((part) => part.trim().replace(/^['"]|['"]$/g, ""))
			.filter(Boolean);
	}
}

function parseScalar(value: string | undefined): string {
	if (!value) return "";
	try {
		return String(JSON.parse(value));
	} catch {
		return value.trim();
	}
}

function parseNote(markdown: string): ParsedNote {
	const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!frontmatterMatch) throw new Error("Note is missing frontmatter");
	const fields = new Map<string, string>();
	for (const line of frontmatterMatch[1].split("\n")) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (match) fields.set(match[1], match[2]);
	}
	const body = markdown.slice(frontmatterMatch[0].length);
	const summary = body.match(/## Summary\n([\s\S]*?)(?:\n## Details\n|$)/)?.[1]?.trim() ?? "";
	const details = body.match(/## Details\n([\s\S]*)$/)?.[1]?.trim() ?? "";
	return {
		id: parseScalar(fields.get("id")),
		title: parseScalar(fields.get("title")),
		created: parseScalar(fields.get("created")),
		updated: parseScalar(fields.get("updated")),
		tags: parseArray(fields.get("tags")),
		source: parseScalar(fields.get("source")) || "user",
		related: parseArray(fields.get("related")),
		summary,
		details,
	};
}

function splitContent(content: string): { summary: string; details: string } {
	const summary = content.match(/## Summary\n([\s\S]*?)(?:\n## Details\n|$)/)?.[1]?.trim();
	const details = content.match(/## Details\n([\s\S]*)$/)?.[1]?.trim();
	if (summary !== undefined || details !== undefined) {
		return { summary: summary ?? "", details: details ?? "" };
	}
	const [first, ...rest] = content.trim().split(/\n\s*\n/);
	return { summary: (first ?? "").trim(), details: rest.join("\n\n").trim() || (first ?? "").trim() };
}

function enforceLimits(config: WikiConfig, summary: string, details: string): void {
	if (summary.length > config.summaryMaxChars) {
		throw new Error(`Summary exceeds ${config.summaryMaxChars} characters. Split or compress the note.`);
	}
	if (details.length > config.detailsMaxChars) {
		throw new Error(
			`Details exceed ${config.detailsMaxChars} characters. Create ordered linked notes instead of one large note.`,
		);
	}
}

async function uniqueId(root: string, title: string): Promise<string> {
	const base = createNoteId(title);
	let candidate = base;
	let suffix = 2;
	while (existsSync(notePath(root, candidate))) {
		candidate = `${base}-${suffix++}`;
	}
	return candidate;
}

async function readNote(root: string, id: string): Promise<ParsedNote> {
	return parseNote(await readFile(notePath(root, id), "utf8"));
}

async function rebuildIndex(root: string): Promise<{ count: number; index: unknown }> {
	await ensureWikiDirs(root);
	const notes: Array<{ id: string; title: string; tags: string[]; summary: string; updated: string; path: string }> = [];
	for (const entry of await readdir(notesDir(root))) {
		if (!entry.endsWith(".md")) continue;
		const note = parseNote(await readFile(path.join(notesDir(root), entry), "utf8"));
		notes.push({
			id: note.id,
			title: note.title,
			tags: note.tags,
			summary: note.summary,
			updated: note.updated,
			path: `notes/${entry}`,
		});
	}
	notes.sort((a, b) => a.id.localeCompare(b.id));
	const index = { generated: true, generatedAt: new Date().toISOString(), notes };
	await writeFile(indexPath(root), `${JSON.stringify(index, null, 2)}\n`, "utf8");
	return { count: notes.length, index };
}

async function loadIndex(root: string): Promise<{ notes: Array<Record<string, unknown>> }> {
	if (!existsSync(indexPath(root))) await rebuildIndex(root);
	return JSON.parse(await readFile(indexPath(root), "utf8"));
}

function searchIndex(index: { notes: Array<Record<string, unknown>> }, query: string, limit = 5) {
	// Never return full note bodies from search; compact index fields only.
	const tokens = query
		.toLowerCase()
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);
	const scored = index.notes
		.map((note) => {
			const tags = Array.isArray(note.tags) ? note.tags.map(String) : [];
			const haystack = [note.id, note.title, tags.join(" "), note.summary].join(" ").toLowerCase();
			const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
			return { note, score };
		})
		.filter(({ score }) => score > 0 || tokens.length === 0)
		.sort((a, b) => b.score - a.score || String(b.note.updated ?? "").localeCompare(String(a.note.updated ?? "")));
	return scored.slice(0, Math.max(1, Math.min(limit, 20))).map(({ note }) => ({
		id: String(note.id ?? ""),
		title: String(note.title ?? ""),
		tags: Array.isArray(note.tags) ? note.tags.map(String) : [],
		summary: String(note.summary ?? ""),
		updated: String(note.updated ?? ""),
	}));
}

async function confirmWrite(ctx: ExtensionContext, message: string, required: boolean): Promise<void> {
	if (!required) return;
	if (!ctx.hasUI) throw new Error("Wiki write requires confirmation, but no UI is available.");
	const allowed = await ctx.ui.confirm("Confirm wiki write", message);
	if (!allowed) throw new Error("Wiki write blocked by user.");
}

function resolveConfiguredRoot(agentDir: string, configuredRoot: unknown): string {
	if (typeof configuredRoot !== "string" || !configuredRoot.trim()) return DEFAULT_CONFIG.root;
	const expanded = configuredRoot.startsWith("~/")
		? path.join(process.env.HOME ?? PI_ROOT, configuredRoot.slice(2))
		: configuredRoot;
	return path.isAbsolute(expanded) ? expanded : path.resolve(agentDir, expanded);
}

function getConfig(): WikiConfig {
	const agentDir = getAgentDir();
	try {
		const settings = JSON.parse(readFileSync(path.join(agentDir, "settings.json"), "utf8")) as { wiki?: Record<string, unknown> };
		const wiki = settings.wiki ?? {};
		return {
			root: resolveConfiguredRoot(agentDir, wiki.root),
			requireConfirmation:
				typeof wiki.requireConfirmation === "boolean" ? wiki.requireConfirmation : DEFAULT_CONFIG.requireConfirmation,
			summaryMaxChars:
				typeof wiki.summaryMaxChars === "number" ? wiki.summaryMaxChars : DEFAULT_CONFIG.summaryMaxChars,
			detailsMaxChars:
				typeof wiki.detailsMaxChars === "number" ? wiki.detailsMaxChars : DEFAULT_CONFIG.detailsMaxChars,
		};
	} catch {
		return DEFAULT_CONFIG;
	}
}

async function addNote(config: WikiConfig, params: AddParams): Promise<ParsedNote> {
	const { summary, details } = splitContent(params.content);
	enforceLimits(config, summary, details);
	await ensureWikiDirs(config.root);
	const now = today();
	const note: ParsedNote = {
		id: await uniqueId(config.root, params.title),
		title: params.title,
		created: now,
		updated: now,
		tags: params.tags ?? [],
		source: params.source ?? "user",
		related: params.related ?? [],
		summary,
		details,
	};
	await writeFile(notePath(config.root, note.id), renderNote(note), "utf8");
	await rebuildIndex(config.root);
	return note;
}

async function updateNote(config: WikiConfig, params: UpdateParams): Promise<ParsedNote> {
	const existing = await readNote(config.root, params.id);
	const content = params.content ? splitContent(params.content) : { summary: existing.summary, details: existing.details };
	enforceLimits(config, content.summary, content.details);
	const note: ParsedNote = {
		...existing,
		title: params.title ?? existing.title,
		updated: today(),
		tags: params.tags ?? existing.tags,
		source: params.source ?? existing.source,
		related: params.related ?? existing.related,
		summary: content.summary,
		details: content.details,
	};
	await writeFile(notePath(config.root, note.id), renderNote(note), "utf8");
	await rebuildIndex(config.root);
	return note;
}

function formatJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

export default function (pi: ExtensionAPI) {
	let autoRemember = false;

	pi.registerTool({
		name: "wiki_search",
		label: "Wiki Search",
		description: "Search compact LLM wiki memory index. Returns metadata only, never full note bodies.",
		promptSnippet: "Search compact durable wiki memory without loading full notes",
		promptGuidelines: [
			"Use wiki_search when prior durable context may help.",
			"Call wiki_read only after search identifies a relevant note.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Search query" }),
			limit: Type.Optional(Type.Number({ description: "Maximum compact results to return" })),
		}),
		async execute(_id, params: SearchParams) {
			const config = getConfig();
			const index = await loadIndex(config.root);
			return text(formatJson(searchIndex(index, params.query, params.limit ?? 5)));
		},
	});

	pi.registerTool({
		name: "wiki_read",
		label: "Wiki Read",
		description: "Read a full wiki note by id after wiki_search finds a relevant note.",
		parameters: Type.Object({ id: Type.String({ description: "Wiki note id" }) }),
		async execute(_id, params: IdParams) {
			const note = await readFile(notePath(getConfig().root, params.id), "utf8");
			return text(note);
		},
	});

	pi.registerTool({
		name: "wiki_add",
		label: "Wiki Add",
		description: "Add an already-summarized compact wiki note.",
		parameters: Type.Object({
			title: Type.String(),
			content: Type.String({ description: "Already summarized note content, preferably with ## Summary and ## Details" }),
			tags: Type.Optional(Type.Array(Type.String())),
			source: Type.Optional(Type.String()),
			related: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, params: AddParams, _signal, _onUpdate, ctx) {
			const config = getConfig();
			await confirmWrite(ctx, `Add wiki note: ${params.title}`, config.requireConfirmation && !autoRemember);
			const note = await addNote(config, params);
			return text(formatJson({ id: note.id, path: `notes/${note.id}.md` }));
		},
	});

	pi.registerTool({
		name: "wiki_update",
		label: "Wiki Update",
		description: "Update a compact wiki note. Uses the same confirmation rule as wiki_add.",
		parameters: Type.Object({
			id: Type.String(),
			title: Type.Optional(Type.String()),
			content: Type.Optional(Type.String()),
			tags: Type.Optional(Type.Array(Type.String())),
			source: Type.Optional(Type.String()),
			related: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, params: UpdateParams, _signal, _onUpdate, ctx) {
			const config = getConfig();
			await confirmWrite(ctx, `Update wiki note: ${params.id}`, config.requireConfirmation && !autoRemember);
			const note = await updateNote(config, params);
			return text(formatJson({ id: note.id, path: `notes/${note.id}.md` }));
		},
	});

	pi.registerTool({
		name: "wiki_delete",
		label: "Wiki Delete",
		description: "Delete a wiki note. Always requires confirmation.",
		parameters: Type.Object({ id: Type.String({ description: "Wiki note id to delete" }) }),
		async execute(_id, params: IdParams, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) return text("Wiki delete always requires confirmation, but no UI is available.", true);
			const allowed = await ctx.ui.confirm("Confirm wiki delete", `Delete wiki note ${params.id}?`);
			if (!allowed) return text("Wiki delete blocked by user.", true);
			const config = getConfig();
			await rm(notePath(config.root, params.id), { force: true });
			await rebuildIndex(config.root);
			return text(`Deleted ${params.id}`);
		},
	});

	pi.registerTool({
		name: "wiki_rebuild_index",
		label: "Wiki Rebuild Index",
		description: "Regenerate the disposable wiki index from markdown notes.",
		parameters: Type.Object({}),
		async execute() {
			const result = await rebuildIndex(getConfig().root);
			return text(`Rebuilt wiki index with ${result.count} notes.`);
		},
	});

	pi.registerCommand("wiki", {
		description: "Search, read, and maintain compact LLM wiki memory",
		handler: async (args, ctx) => {
			const [subcommand = "status", ...rest] = args.trim().split(/\s+/);
			const tail = args.trim().slice(subcommand.length).trim();
			const config = getConfig();
			try {
				switch (subcommand) {
					case "search": {
						const index = await loadIndex(config.root);
						ctx.ui.notify(formatJson(searchIndex(index, tail, 10)), "info");
						break;
					}
					case "read": {
						ctx.ui.notify(await readFile(notePath(config.root, rest[0]), "utf8"), "info");
						break;
					}
					case "rebuild": {
						const result = await rebuildIndex(config.root);
						ctx.ui.notify(`Rebuilt wiki index with ${result.count} notes.`, "info");
						break;
					}
					case "status": {
						const index = existsSync(indexPath(config.root)) ? await loadIndex(config.root) : { notes: [] };
						ctx.ui.notify(
							[
								`Wiki root: ${config.root}`,
								`Require confirmation: ${config.requireConfirmation}`,
								`Auto-remember this session: ${autoRemember}`,
								`Summary max chars: ${config.summaryMaxChars}`,
								`Details max chars: ${config.detailsMaxChars}`,
								`Indexed notes: ${index.notes.length}`,
							].join("\n"),
							"info",
						);
						break;
					}
					case "auto-remember": {
						const value = rest[0] ?? "status";
						if (value === "on") autoRemember = true;
						else if (value === "off") autoRemember = false;
						else if (value !== "status") throw new Error("Usage: /wiki auto-remember on|off|status");
						ctx.ui.notify(`Auto-remember this session: ${autoRemember}`, "info");
						break;
					}
					case "add": {
						const params = JSON.parse(tail) as AddParams;
						await confirmWrite(ctx, `Add wiki note: ${params.title}`, config.requireConfirmation && !autoRemember);
						const note = await addNote(config, params);
						ctx.ui.notify(`Added ${note.id}`, "info");
						break;
					}
					case "update": {
						const params = JSON.parse(tail) as UpdateParams;
						await confirmWrite(ctx, `Update wiki note: ${params.id}`, config.requireConfirmation && !autoRemember);
						const note = await updateNote(config, params);
						ctx.ui.notify(`Updated ${note.id}`, "info");
						break;
					}
					default:
						throw new Error(
							'Usage: /wiki search <query> | read <id> | rebuild | status | auto-remember on|off|status | add {"title":"...","content":"..."} | update {"id":"..."}',
						);
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
