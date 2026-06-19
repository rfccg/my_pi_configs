import { readFileSync } from "node:fs";
import path from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type AutoCompactSettings = {
	enabled?: boolean;
	autoThreshold?: number;
};

const DEFAULT_AUTO_THRESHOLD = 0.7;

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
			onComplete: () => {
				compacting = false;
				previousPercent = null;
				if (ctx.hasUI) ctx.ui.notify("Auto-compaction completed", "info");
			},
			onError: (error) => {
				compacting = false;
				if (ctx.hasUI) ctx.ui.notify(`Auto-compaction failed: ${error.message}`, "error");
			},
		});
	});
}
