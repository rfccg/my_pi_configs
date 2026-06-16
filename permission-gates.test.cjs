const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

for (const extensionPath of [
  'agent/extensions/permission-gates.ts',
  'agent-bedrock/extensions/permission-gates.ts',
]) {
  test(`${extensionPath} keeps rm command protection`, () => {
    const content = readFileSync(extensionPath, 'utf8');

    assert.match(content, /rmCommandPattern/);
    assert.match(content, /event\.toolName !== "bash"/);
    assert.match(content, /rm command blocked: no UI available for confirmation/);
    assert.match(content, /rm command blocked by user/);
    assert.match(content, /ctx\.ui\.confirm\("Confirm rm command"/);
  });

  test(`${extensionPath} does not implement a read outside-workspace gate`, () => {
    const content = readFileSync(extensionPath, 'utf8');

    assert.doesNotMatch(content, /event\.toolName !== "read"/);
    assert.doesNotMatch(content, /Read outside working directory blocked/);
    assert.doesNotMatch(content, /Confirm outside read/);
    assert.doesNotMatch(content, /alwaysAllowedReadRoots/);
    assert.doesNotMatch(content, /skillRootFromCommand/);
  });
}
