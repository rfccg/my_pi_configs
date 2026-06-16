const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = __dirname;
const superpowersSkillsPath = '../pi-base/skills/superpowers/skills';

function configuredPiAgentDirs() {
  return readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(repoRoot, name, 'settings.json')))
    .sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('superpowers skills source is present', () => {
  const skillsRoot = join(repoRoot, 'pi-base/skills/superpowers/skills');
  assert.equal(existsSync(join(skillsRoot, 'using-superpowers/SKILL.md')), true);
  assert.equal(existsSync(join(skillsRoot, 'brainstorming/SKILL.md')), true);
  const skillDirs = readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.ok(skillDirs.length >= 10, `expected many superpowers skills, found ${skillDirs.length}`);
});

test('all configured Pi agent homes load superpowers skills', () => {
  const agentDirs = configuredPiAgentDirs();
  assert.deepEqual(agentDirs, ['agent', 'agent-bedrock']);

  for (const agentDir of agentDirs) {
    const settings = readJson(join(repoRoot, agentDir, 'settings.json'));
    assert.ok(Array.isArray(settings.skills), `${agentDir} settings.skills must be an array`);
    assert.ok(
      settings.skills.includes(superpowersSkillsPath),
      `${agentDir} must include ${superpowersSkillsPath}`,
    );
  }
});

test('all configured Pi agent homes include superpowers bootstrap instructions in global AGENTS context', () => {
  const agentDirs = configuredPiAgentDirs();
  assert.deepEqual(agentDirs, ['agent', 'agent-bedrock']);

  for (const agentDir of agentDirs) {
    const agentsPath = join(repoRoot, agentDir, 'AGENTS.md');
    assert.equal(existsSync(agentsPath), true, `${agentDir} missing AGENTS.md`);
    const content = readFileSync(agentsPath, 'utf8');
    assert.match(content, /Superpowers Bootstrap/);
    assert.match(content, /using-superpowers/);
    assert.match(content, /At the start of each conversation/);
  }
});

test('superpowers bootstrap is not duplicated through APPEND_SYSTEM files', () => {
  const agentDirs = configuredPiAgentDirs();
  assert.deepEqual(agentDirs, ['agent', 'agent-bedrock']);

  for (const agentDir of agentDirs) {
    const appendSystemPath = join(repoRoot, agentDir, 'APPEND_SYSTEM.md');
    assert.equal(existsSync(appendSystemPath), false, `${agentDir} should use AGENTS.md, not APPEND_SYSTEM.md`);
  }
});
