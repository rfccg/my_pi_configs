const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = __dirname;
const extensionPath = join(repoRoot, 'agent/extensions/subagent/index.ts');
const agentsPath = join(repoRoot, 'agent/extensions/subagent/agents.ts');
const researchAgentPath = join(repoRoot, 'agent/agents/code-research.md');
const reviewAgentPath = join(repoRoot, 'agent/agents/code-review.md');
const implementerAgentPath = join(repoRoot, 'agent/agents/implementer.md');

test('global subagent extension is installed and defines the subagent tool guidance', () => {
  assert.equal(existsSync(extensionPath), true);
  assert.equal(existsSync(agentsPath), true);

  const content = readFileSync(extensionPath, 'utf8');
  assert.match(content, /name: "subagent"/);
  assert.match(content, /Delegate tasks to specialized subagents/);
  assert.match(content, /promptSnippet: "Delegate focused code research or code review/);
  assert.match(content, /Use subagent with agent=\\"code-research\\"/);
  assert.match(content, /Use subagent with agent=\\"code-review\\"/);
  assert.match(content, /repeat until the reviewer responds with APPROVED/);
  assert.match(content, /maximum of 2 code-review iterations/);
  assert.match(content, /explicitly say the code-review iteration limit was reached/);
  assert.match(
    content,
    /const args: string\[\] = \["--mode", "json", "-p", "--no-session", "--no-context-files"\]/,
  );
  assert.match(content, /const GUEST_WORKSPACE = "\/workspace";/);
  assert.match(content, /function normalizeSubagentCwd\(defaultCwd: string, requestedCwd: string \| undefined\): string/);
  assert.match(content, /const guestResolved = path\.posix\.resolve\("\/", requestedCwd\);/);
  assert.match(content, /Refusing to map cwd outside \$\{GUEST_WORKSPACE\}/);
  assert.match(content, /const hostTarget = path\.resolve\(defaultCwd, relativePath\);/);
  assert.match(content, /if \(!isInside\(defaultCwd, hostTarget\)\)/);
  assert.match(content, /cwd: normalizeSubagentCwd\(defaultCwd, cwd\)/);
  assert.doesNotMatch(content, /--no-extensions/);
});

test('project-local subagent definitions are filtered through .pi-ignore policy before host reads', () => {
  const content = readFileSync(agentsPath, 'utf8');

  assert.match(content, /createPiIgnorePolicySync/);
  assert.match(content, /isIgnoredAgentFile/);
  assert.match(content, /realpathSync/);
  assert.match(content, /function isInside\(/);
  assert.match(content, /canonicalRoot/);
  assert.match(content, /if \(!isInside\(canonicalRoot, canonicalFile\)\) return true;/);
  assert.match(content, /if \(isIgnoredAgentFile\(dir, source, filePath\)\) continue;/);
});

test('code-research agent is read-only and instructed to return only relevant information', () => {
  assert.equal(existsSync(researchAgentPath), true);
  const content = readFileSync(researchAgentPath, 'utf8');

  assert.match(content, /^name: code-research$/m);
  assert.match(content, /^tools: read, grep, find, ls$/m);
  assert.match(content, /Return only information directly relevant to the requested research task/);
  assert.match(content, /Do not edit, write, or modify files/);
});

test('code-review agent can inspect code but must approve or request fixes', () => {
  assert.equal(existsSync(reviewAgentPath), true);
  const content = readFileSync(reviewAgentPath, 'utf8');

  assert.match(content, /^name: code-review$/m);
  assert.match(content, /^tools: read, grep, find, ls$/m);
  assert.match(content, /If issues are found, return findings/);
  assert.match(content, /If no blocking issues remain, respond with APPROVED/);
  assert.match(content, /Do not edit, write, or modify files/);
});

test('implementer agent exists, can edit code, and is scoped to the requested task', () => {
  assert.equal(existsSync(implementerAgentPath), true);
  const content = readFileSync(implementerAgentPath, 'utf8');

  assert.match(content, /^name: implementer$/m);
  assert.match(content, /^tools: read, grep, find, ls, bash, edit, write$/m);
  assert.match(content, /Implement only the requested task/);
  assert.match(content, /Do not broaden scope/);
  assert.match(content, /Return STATUS: DONE/);
  assert.match(content, /STATUS: BLOCKED/);
});

test('subagent extension supports configurable implementer enablement and model override', () => {
  const content = readFileSync(extensionPath, 'utf8');
  const agentSettings = readFileSync(join(repoRoot, 'agent/settings.json'), 'utf8');
  const bedrockSettings = readFileSync(join(repoRoot, 'agent-bedrock/settings.json'), 'utf8');

  assert.match(content, /type SubagentSettings/);
  assert.match(content, /readSubagentSettings/);
  assert.match(content, /findNearestProjectSettingsFile/);
  assert.match(content, /path\.join\(currentDir, "\.pi", "settings\.json"\)/);
  assert.match(content, /if \(parentDir === currentDir\) return null;/);
  assert.match(content, /const projectSettingsFile = findNearestProjectSettingsFile\(cwd\);/);
  assert.match(content, /const projectSettings = projectSettingsFile \? readJsonFile\(projectSettingsFile\) : \{\};/);
  assert.match(content, /implementer\?: \{ enabled\?: boolean; model\?: string \}/);
  assert.match(content, /filterConfiguredAgents/);
  assert.match(content, /agent\.name === "implementer"/);
  assert.match(content, /settings\.implementer\.enabled === false/);
  assert.match(content, /settings\.implementer\.model/);
  assert.match(content, /const globalSubagent = globalSettings\.subagent \?\? \{\};/);
  assert.match(content, /const projectSubagent = projectSettings\.subagent \?\? \{\};/);
  assert.match(content, /\.\.\.\(globalSubagent\.implementer \?\? \{\}\)/);
  assert.match(content, /\.\.\.\(projectSubagent\.implementer \?\? \{\}\)/);
  assert.match(content, /Use subagent with agent=\"implementer\"/);
  assert.match(content, /only when tasks are independent and non-conflicting/);
  assert.match(content, /worktrees/);

  assert.match(agentSettings, /"subagent"\s*:/);
  assert.match(agentSettings, /"implementer"\s*:/);
  assert.match(agentSettings, /"enabled"\s*:\s*true/);
  assert.match(agentSettings, /"model"\s*:/);
  assert.match(bedrockSettings, /"subagent"\s*:/);
  assert.match(bedrockSettings, /"implementer"\s*:/);
});
