const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const EXT_PATH = "pi-base/extensions/auto-compact/index.ts";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

test("auto-compact extension exists and uses ratio threshold", () => {
  assert.ok(fs.existsSync(EXT_PATH), "auto-compact extension should exist");
  const source = fs.readFileSync(EXT_PATH, "utf8");
  assert.match(source, /autoThreshold/);
  assert.match(source, /0\.7/);
  assert.match(source, /getContextUsage/);
  assert.match(source, /usage\.percent/);
  assert.match(source, /return usage\.percent \/ 100/);
  assert.match(source, /ctx\.compact/);
  assert.match(source, /AUTO_COMPACT_CUSTOM_INSTRUCTIONS/);
  assert.match(source, /AUTO_COMPACT_RESUME_PROMPT/);
  assert.match(source, /customInstructions: AUTO_COMPACT_CUSTOM_INSTRUCTIONS/);
  assert.match(source, /If the prior task was already complete, do not start new work/);
  assert.match(source, /previousPercent = usageRatio\(ctx\.getContextUsage\(\)\) \?\? settings\.autoThreshold \+ Number\.EPSILON/);
  assert.match(source, /pi\.sendUserMessage\(AUTO_COMPACT_RESUME_PROMPT/);
  assert.match(source, /deliverAs: "followUp"/);
  assert.match(source, /triggerTurn: true/);
  assert.match(source, /Auto-compaction started/);
  assert.match(source, /ctx\.isProjectTrusted\(\)/);
  assert.match(source, /path\.join\(ctx\.cwd, "\.pi", "settings\.json"\)/);
  assert.match(source, /previousPercent === null && percent > settings\.autoThreshold/);
});

test("both agent homes load auto-compact and configure default", () => {
  for (const settingsPath of ["agent/settings.json", "agent-bedrock/settings.json"]) {
    const settings = readJson(settingsPath);
    assert.ok(settings.extensions.includes("../pi-base/extensions/auto-compact"));
    assert.equal(settings.compaction.enabled, true);
    assert.equal(settings.compaction.autoThreshold, 0.7);
  }
});
