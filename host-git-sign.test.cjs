const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const extensionPath = join(__dirname, 'agent/extensions/host-git-sign.ts');

test('host git signing extension exposes only a narrow signed commit tool', () => {
  assert.equal(existsSync(extensionPath), true);
  const content = readFileSync(extensionPath, 'utf8');

  assert.match(content, /name: "host_git_signed_commit"/);
  assert.match(content, /spawn\("git", args/);
  assert.match(content, /shell: false/);
  assert.match(content, /const SAFE_GIT_CONFIG_ARGS = \["-c", "core\.hooksPath=\/dev\/null", "-c", "core\.fsmonitor=false"\]/);
  assert.match(content, /\[\.\.\.SAFE_GIT_CONFIG_ARGS, "commit", "-S", "-m", message\]/);
  assert.doesNotMatch(content, /command: Type\.String/);
  assert.doesNotMatch(content, /shell: true/);
});

test('host git signing extension validates staging paths stay in the workspace', () => {
  const content = readFileSync(extensionPath, 'utf8');

  assert.match(content, /function validateRelativePath\(cwd: string, inputPath: string\): string/);
  assert.match(content, /if \(path\.isAbsolute\(inputPath\)\)/);
  assert.match(content, /if \(!isInside\(cwd, resolved\)\)/);
  assert.match(content, /Refusing to stage git internals/);
  assert.match(content, /git add -A/);
  assert.match(content, /git add failed/);
});

test('host git signing extension disables repository hooks for host git operations', () => {
  const content = readFileSync(extensionPath, 'utf8');

  assert.match(content, /core\.hooksPath=\/dev\/null/);
  assert.match(content, /core\.fsmonitor=false/);
  assert.match(content, /\[\.\.\.SAFE_GIT_CONFIG_ARGS, "add", "-A"\]/);
  assert.match(content, /\["--literal-pathspecs", \.\.\.SAFE_GIT_CONFIG_ARGS, "add", "--", \.\.\.normalizedPaths\]/);
});

test('host git signing extension rejects repository-local executable git config', () => {
  const content = readFileSync(extensionPath, 'utf8');

  assert.match(content, /function getUnsafeLocalGitConfig\(cwd: string\): Promise<string \| null>/);
  assert.match(content, /"--local"/);
  assert.doesNotMatch(content, /"--includes"/);
  assert.match(content, /filter\\\\\./);
  assert.match(content, /gpg\\\\\./);
  assert.doesNotMatch(content, /gpg\\\\\.program\$/);
  assert.match(content, /core\\\\\.fsmonitor/);
  assert.match(content, /include\\\\\./);
  assert.match(content, /includeif\\\\\./);
  assert.doesNotMatch(content, /includeIf\\\\\./);
  assert.match(content, /unsafeKeys\.join\("\\\\n"\)|unsafeKeys\.join\("\\n"\)/);
  assert.match(content, /Refusing host signed commit because repository-local git config contains unsafe executable settings/);
});

test('host git signing extension treats explicit staged paths as literal pathspecs', () => {
  const content = readFileSync(extensionPath, 'utf8');

  assert.match(content, /"--literal-pathspecs", \.\.\.SAFE_GIT_CONFIG_ARGS, "add", "--", \.\.\.normalizedPaths/);
});
