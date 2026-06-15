const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');

const piRequire = createRequire('/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/package.json');
const { createJiti } = piRequire('jiti');
const jiti = createJiti(__filename, { interopDefault: true });

async function runReadGate(extensionPath, requestedPath, commands = []) {
  const handlers = [];
  const extension = jiti(extensionPath);
  const register = typeof extension.default === 'function' ? extension.default : extension;
  register({
    on(event, handler) {
      if (event === 'tool_call') handlers.push(handler);
    },
    getCommands() {
      return commands;
    },
  });

  const ctx = {
    cwd: '/workspace/project',
    hasUI: false,
    ui: {
      async confirm() {
        throw new Error('read gate should not ask for confirmation');
      },
    },
  };

  for (const handler of handlers) {
    const result = await handler({ toolName: 'read', input: { path: requestedPath } }, ctx);
    if (result?.block) return result;
  }
  return undefined;
}

for (const extensionPath of [
  '/Users/rafael.gouveia/.pi/agent/extensions/permission-gates.ts',
  '/Users/rafael.gouveia/.pi/agent-bedrock/extensions/permission-gates.ts',
]) {
  test(`${extensionPath} allows /mypath descendants without confirmation`, async () => {
    const result = await runReadGate(extensionPath, '/mypath/secret.txt');
    assert.equal(result, undefined);
  });

  test(`${extensionPath} allows files inside any discovered skill directory without confirmation`, async () => {
    const skillFile = '/Users/example/.pi/agent/skills/my-skill/SKILL.md';
    const result = await runReadGate(
      extensionPath,
      join(dirname(skillFile), 'references', 'guide.md'),
      [
        {
          source: 'skill',
          sourceInfo: {
            path: skillFile,
            source: 'user',
            scope: 'user',
            origin: 'top-level',
          },
        },
      ],
    );
    assert.equal(result, undefined);
  });
}
