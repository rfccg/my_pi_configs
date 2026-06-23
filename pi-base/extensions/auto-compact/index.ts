import { readFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type AutoCompactSettings = {
	enabled?: boolean;
	autoThreshold?: number;
};

const DEFAULT_AUTO_THRESHOLD = 0.7;
const AUTO_COMPACT_CUSTOM_INSTRUCTIONS = [
	"Preserve the user's current goal, in-progress workflow, unfinished implementation steps, files changed or inspected, tests run, and next actions.",
	"If a task was underway when compaction started, make the summary explicit enough for the agent to continue that same task without asking the user to restate it.",
].join("\n");
const AUTO_COMPACT_RESUME_PROMPT = [
	"Auto-compaction completed.",
	"If there was an unfinished task or tool workflow before compaction, continue it from the compacted context.",
	"If the prior task was already complete, do not start new work; briefly acknowledge completion.",
	"Do not ask me to restate the task unless essential context is missing from the compacted conversation.",
].join("\n");

function normalizeThreshold(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AUTO_THRESHOLD;
	if (value <= 0 || value >= 1) return DEFAULT_AUTO_THRESHOLD;
	return value;
}

function readSettingsFile(file: string): { compaction?: AutoCompactSettings } {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as { compaction?: AutoCompactSettings };
	} catch {
		return {};
	}
}

function getSettings(ctx: ExtensionContext): Required<AutoCompactSettings> {
	const globalSettings = readSettingsFile(path.join(getAgentDir(), "settings.json"));
	const projectSettings = ctx.isProjectTrusted()
		? readSettingsFile(path.join(ctx.cwd, ".pi", "settings.json"))
		: {};
	const compaction = {
		...(globalSettings.compaction ?? {}),
		...(projectSettings.compaction ?? {}),
	};
	return {
		enabled: compaction.enabled !== false,
		autoThreshold: normalizeThreshold(compaction.autoThreshold),
	};
}

function usageRatio(usage: ReturnType<ExtensionContext["getContextUsage"]>): number | null {
	if (!usage || typeof usage.percent !== "number" || !Number.isFinite(usage.percent)) return null;
	return usage.percent / 100;
}

export default function autoCompactExtension(pi: ExtensionAPI) {
	let previousPercent: number | null = null;
	let compacting = false;

	pi.on("turn_end", (_event, ctx) => {
		const settings = getSettings(ctx);
		if (!settings.enabled || compacting) return;

		const usage = ctx.getContextUsage();
		const percent = usageRatio(usage);
		if (percent === null) return;

		const crossed =
			(previousPercent === null && percent > settings.autoThreshold) ||
			(previousPercent !== null && previousPercent <= settings.autoThreshold && percent > settings.autoThreshold);
		previousPercent = percent;
		if (!crossed) return;

		compacting = true;
		if (ctx.hasUI) ctx.ui.notify("Auto-compaction started", "info");
		ctx.compact({
			customInstructions: AUTO_COMPACT_CUSTOM_INSTRUCTIONS,
			onComplete: () => {
				compacting = false;
				previousPercent = usageRatio(ctx.getContextUsage()) ?? settings.autoThreshold + Number.EPSILON;
				if (ctx.hasUI) ctx.ui.notify("Auto-compaction completed; resuming prior task", "info");
				pi.sendUserMessage(AUTO_COMPACT_RESUME_PROMPT, { deliverAs: "followUp", triggerTurn: true });
			},
			onError: (error) => {
				compacting = false;
				if (ctx.hasUI) ctx.ui.notify(`Auto-compaction failed: ${error.message}`, "error");
			},
		});
	});
}
