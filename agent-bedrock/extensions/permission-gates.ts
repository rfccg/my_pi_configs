import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const rmCommandPattern = /(?:^|[\s;&|()])(?:sudo\s+)?(?:command\s+)?(?:\/[^\s;&|()]+\/)?rm\b/;

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
}
