const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const TODO_PATH = "pi-base/extensions/todo/index.ts";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

test("todo extension source exists and registers expected tool and command", () => {
  assert.ok(fs.existsSync(TODO_PATH), "todo extension should exist");
  const source = fs.readFileSync(TODO_PATH, "utf8");
  assert.match(source, /name:\s*"todo"/);
  assert.match(source, /registerCommand\("todos"/);
  assert.match(source, /pending/);
  assert.match(source, /in_progress/);
  assert.match(source, /done/);
  assert.match(source, /dependencies/);
  assert.match(source, /reconstructState/);
  assert.match(source, /session_start/);
  assert.match(source, /session_tree/);
});

test("both agent homes load the shared todo extension", () => {
  for (const settingsPath of ["agent/settings.json", "agent-bedrock/settings.json"]) {
    const settings = readJson(settingsPath);
    assert.ok(Array.isArray(settings.extensions), `${settingsPath} should have extensions array`);
    assert.ok(
      settings.extensions.includes("../pi-base/extensions/todo"),
      `${settingsPath} should load shared todo extension`,
    );
  }
});

test("todo extension implements all actions and validation messages", () => {
  const source = fs.readFileSync(TODO_PATH, "utf8");
  for (const action of ["case \"list\"", "case \"add\"", "case \"update\"", "case \"clear\""]) {
    assert.match(source, new RegExp(action.replace(/[\\\"]/g, "\\$&")));
  }
  assert.match(source, /validateDependencies/);
  assert.match(source, /cannot depend on itself/);
  assert.match(source, /Dependency #[^`]*not found/);
  assert.match(source, /details:\s*\{ action:/);
  assert.match(source, /function isSafeTodoId/);
  assert.match(source, /function isAllocatableTodoId/);
  assert.match(source, /function canAddTodoWithNextId/);
  assert.match(source, /!canAddTodoWithNextId\(nextId\)/);
  assert.match(source, /todo id limit reached/);
  assert.match(source, /Number\.isSafeInteger/);
  assert.match(source, /function isTodo/);
  assert.match(source, /function hasValidDependencies/);
  assert.match(source, /!isAllocatableTodoId\(saved\.nextId\)/);
  assert.match(source, /Number\.MAX_SAFE_INTEGER - 1/);
  assert.match(source, /!isAllocatableTodoId\(restoredNextId\)/);
  assert.match(source, /ids\.size !== saved\.todos\.length/);
  assert.match(source, /text required for update/);
  assert.doesNotMatch(source, /isError:/);
});

test("todo extension renders widget counts and blockers", () => {
  const source = fs.readFileSync(TODO_PATH, "utf8");
  assert.match(source, /function renderWidgetLines/);
  assert.match(source, /blocked by/);
  assert.match(source, /in_progress/);
  assert.match(source, /pending/);
  assert.match(source, /done/);
  assert.match(source, /TodoListComponent/);
  assert.match(source, /Press Escape to close/);
  assert.match(source, /TODO_STATE_ENTRY/);
  assert.match(source, /pi\.appendEntry\(TODO_STATE_ENTRY, details\("clear"\)\)/);
  assert.match(source, /entry\.type === "custom" && entry\.customType === TODO_STATE_ENTRY/);
});

test("todo command supports show hide clear and full view", () => {
  const source = fs.readFileSync(TODO_PATH, "utf8");
  assert.match(source, /registerCommand\("todos"/);
  assert.match(source, /case "show"/);
  assert.match(source, /case "hide"/);
  assert.match(source, /case "clear"/);
  assert.match(source, /ctx\.ui\.custom/);
});
