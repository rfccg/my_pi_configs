const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = __dirname;
const wikiExtensionPath = join(repoRoot, 'pi-base/extensions/wiki/index.ts');
const agentDirs = ['agent', 'agent-bedrock'];

function read(path) {
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(read(path));
}

test('shared wiki extension is configured for all Pi homes and repo wiki data is ignored', () => {
  assert.equal(existsSync(wikiExtensionPath), true, 'missing shared wiki extension');
  assert.match(read(join(repoRoot, '.gitignore')), /^\/wiki\/$/m, 'repo-local wiki data must be ignored');

  for (const agentDir of agentDirs) {
    const settings = readJson(join(repoRoot, agentDir, 'settings.json'));
    assert.ok(Array.isArray(settings.extensions), `${agentDir} settings.extensions must be an array`);
    assert.ok(settings.extensions.includes('../pi-base/extensions/wiki'), `${agentDir} must load shared wiki extension`);
    assert.deepEqual(settings.wiki, {
      root: '../wiki',
      requireConfirmation: true,
      summaryMaxChars: 280,
      detailsMaxChars: 5000,
    });
  }
});

test('wiki extension implements markdown notes and disposable index helpers', () => {
  const source = read(wikiExtensionPath);

  assert.match(source, /function slugify\(/);
  assert.match(source, /function createNoteId\(/);
  assert.match(source, /YYYY-MM-DD-slug/);
  assert.match(source, /function renderNote\(/);
  assert.match(source, /function parseNote\(/);
  assert.match(source, /function rebuildIndex\(/);
  assert.match(source, /NOTE_ID_RE/);
  assert.match(source, /function assertValidNoteId\(/);
  assert.match(source, /Invalid wiki note id/);
  assert.match(source, /generated.*true/s);
  for (const field of ['id', 'title', 'created', 'updated', 'tags', 'source', 'related']) {
    assert.match(source, new RegExp(`${field}:`), `missing frontmatter field ${field}`);
  }
  assert.match(source, /## Summary/);
  assert.match(source, /## Details/);
  assert.match(source, /summaryMaxChars/);
  assert.match(source, /detailsMaxChars/);
  assert.match(source, /getAgentDir/);
  assert.match(source, /settings\.json/);
});

test('wiki extension registers expected tools and compact search behavior', () => {
  const source = read(wikiExtensionPath);

  for (const tool of ['wiki_search', 'wiki_read', 'wiki_add', 'wiki_update', 'wiki_delete', 'wiki_rebuild_index']) {
    assert.match(source, new RegExp(`name: "${tool}"`), `missing tool ${tool}`);
  }
  assert.match(source, /function searchIndex\(/);
  assert.match(source, /summary/);
  assert.match(source, /Never return full note bodies from search/);
  assert.match(source, /wiki_delete[\s\S]*ctx\.ui\.confirm/);
  assert.match(source, /notePath\(getConfig\(\)\.root, params\.id\)/);
});

test('wiki extension registers /wiki command subcommands without auto-search', () => {
  const source = read(wikiExtensionPath);

  assert.match(source, /registerCommand\("wiki"/);
  for (const subcommand of ['search', 'read', 'rebuild', 'status', 'auto-remember', 'add', 'update']) {
    assert.match(source, new RegExp(`case "${subcommand}"`), `missing /wiki ${subcommand}`);
  }
  assert.doesNotMatch(source, /auto-search/);
  assert.doesNotMatch(source, /autoSearch/);
});

test('all Pi homes include concise LLM Wiki Memory guidance', () => {
  for (const agentDir of agentDirs) {
    const content = read(join(repoRoot, agentDir, 'AGENTS.md'));
    assert.match(content, /LLM Wiki Memory/);
    assert.match(content, /wiki_search/);
    assert.match(content, /wiki_read/);
    assert.match(content, /split large topics into linked ordered notes/);
  }
});
