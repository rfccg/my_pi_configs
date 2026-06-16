const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = __dirname;
const agentDirs = ['agent', 'agent-bedrock', 'agent-headroom'];
const superpowersSkillsPath = '../pi-base/skills/superpowers/skills';

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
  for (const agentDir of agentDirs) {
    const settings = readJson(join(repoRoot, agentDir, 'settings.json'));
    assert.ok(Array.isArray(settings.skills), `${agentDir} settings.skills must be an array`);
    assert.ok(
      settings.skills.includes(superpowersSkillsPath),
      `${agentDir} must include ${superpowersSkillsPath}`,
    );
  }
});

test('all configured Pi agent homes include superpowers bootstrap instructions in loaded global context', () => {
  for (const agentDir of agentDirs) {
    const agentsPath = join(repoRoot, agentDir, 'AGENTS.md');
    assert.equal(existsSync(agentsPath), true, `${agentDir} missing AGENTS.md`);
    const content = readFileSync(agentsPath, 'utf8');
    assert.match(content, /Superpowers Bootstrap/);
    assert.match(content, /using-superpowers/);
    assert.match(content, /At the start of each conversation/);

    const appendSystemPath = join(repoRoot, agentDir, 'APPEND_SYSTEM.md');
    assert.equal(existsSync(appendSystemPath), true, `${agentDir} missing APPEND_SYSTEM.md`);
    assert.equal(readFileSync(appendSystemPath, 'utf8'), content);
  }
});
