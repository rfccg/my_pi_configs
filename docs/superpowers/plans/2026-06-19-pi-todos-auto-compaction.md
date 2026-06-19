# Pi Todos and Auto-Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-scoped todo tool with dependency-aware task states and TUI visibility controls, then add configurable 70% auto-compaction threshold support.

**Architecture:** In this `.pi` workspace, implement the todo system as a shared Pi extension under `pi-base/extensions/todo/` and load it from both configured agent homes. True built-in status, true right-sidebar layout, and `compaction.autoThreshold` require the upstream `pi-mono` core source, which is not present in this workspace; those tasks target the documented upstream package paths.

**Tech Stack:** TypeScript Pi extension API, TypeBox schemas, Pi TUI widget/command APIs, Node static tests in this workspace, upstream Pi core TypeScript for built-in TUI/settings/compaction changes.

---

## File Structure

### Current `.pi` workspace deliverable

- `pi-base/extensions/todo/index.ts` — shared todo extension source: tool, session-state reconstruction, widget updates, `/todos` command.
- `agent/settings.json` — add `../pi-base/extensions/todo` to loaded extensions.
- `agent-bedrock/settings.json` — add `../pi-base/extensions/todo` to loaded extensions.
- `todo-extension.test.cjs` — static/regression tests for source, settings, schema, commands, and dependency/status behavior.

### Upstream `pi-mono` deliverable required for true built-in behavior

These files are documented but are not present in this workspace:

- `packages/coding-agent/src/core/tools/todo.ts` — built-in todo tool implementation or built-in extension wrapper.
- `packages/coding-agent/src/core/tools/index.ts` or equivalent registry — include the todo tool by default.
- `packages/coding-agent/src/modes/interactive/...` — add a right-sidebar layout slot/widget host.
- `packages/coding-agent/src/core/settings...` — add `compaction.autoThreshold` with default `0.7`.
- `packages/coding-agent/src/core/compaction/compaction.ts` — trigger threshold by `contextTokens / contextWindow > autoThreshold`.
- Upstream package tests near the affected files.

---

### Task 1: Add todo extension tests and settings integration

**Files:**
- Create: `todo-extension.test.cjs`
- Create: `pi-base/extensions/todo/index.ts`
- Modify: `agent/settings.json`
- Modify: `agent-bedrock/settings.json`

- [ ] **Step 1: Write the failing static test**

Create `todo-extension.test.cjs`:

```js
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
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test todo-extension.test.cjs
```

Expected: FAIL because `pi-base/extensions/todo/index.ts` does not exist and settings do not include the todo extension.

- [ ] **Step 3: Add the extension to settings**

Modify both `agent/settings.json` and `agent-bedrock/settings.json` so `extensions` includes both shared extensions:

```json
"extensions": [
  "../pi-base/extensions/wiki",
  "../pi-base/extensions/todo"
]
```

- [ ] **Step 4: Create the extension skeleton**

Create `pi-base/extensions/todo/index.ts`:

```ts
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type TodoStatus = "pending" | "in_progress" | "done";

type Todo = {
  id: number;
  text: string;
  status: TodoStatus;
  dependencies: number[];
};

type TodoDetails = {
  action: "list" | "add" | "update" | "clear";
  todos: Todo[];
  nextId: number;
  error?: string;
};

const TodoParams = Type.Object({
  action: StringEnum(["list", "add", "update", "clear"] as const),
  text: Type.Optional(Type.String({ description: "Todo text for add/update" })),
  id: Type.Optional(Type.Number({ description: "Todo ID for update" })),
  status: Type.Optional(StringEnum(["pending", "in_progress", "done"] as const)),
  dependencies: Type.Optional(Type.Array(Type.Number(), { description: "Todo IDs this task depends on" })),
});

export default function todoExtension(pi: ExtensionAPI) {
  let todos: Todo[] = [];
  let nextId = 1;
  let sidebarVisible = true;

  const reconstructState = (ctx: ExtensionContext) => {
    todos = [];
    nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
      const details = msg.details as TodoDetails | undefined;
      if (!details) continue;
      todos = details.todos;
      nextId = details.nextId;
    }
  };

  // Tool, widget, and command implementation is added in later tasks.
  pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));
}
```

- [ ] **Step 5: Run the test and commit**

Run:

```bash
node --test todo-extension.test.cjs
```

Expected: PASS.

Commit:

```bash
git add todo-extension.test.cjs pi-base/extensions/todo/index.ts agent/settings.json agent-bedrock/settings.json
git commit -m "feat: add todo extension skeleton"
```

---

### Task 2: Implement todo actions and dependency validation

**Files:**
- Modify: `todo-extension.test.cjs`
- Modify: `pi-base/extensions/todo/index.ts`

- [ ] **Step 1: Add static tests for action behavior**

Append to `todo-extension.test.cjs`:

```js
test("todo extension implements all actions and validation messages", () => {
  const source = fs.readFileSync(TODO_PATH, "utf8");
  for (const action of ["case \"list\"", "case \"add\"", "case \"update\"", "case \"clear\""]) {
    assert.match(source, new RegExp(action.replace(/[\\"]/g, "\\$&")));
  }
  assert.match(source, /validateDependencies/);
  assert.match(source, /cannot depend on itself/);
  assert.match(source, /Dependency #[^`]*not found/);
  assert.match(source, /details:\s*\{ action:/);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test todo-extension.test.cjs
```

Expected: FAIL because actions are not implemented.

- [ ] **Step 3: Replace the skeleton extension body with full action logic**

In `pi-base/extensions/todo/index.ts`, keep imports/types/schema and replace `export default function todoExtension(...)` with:

```ts
function cloneTodos(todos: Todo[]): Todo[] {
  return todos.map((todo) => ({ ...todo, dependencies: [...todo.dependencies] }));
}

function formatTodo(todo: Todo): string {
  const marker = todo.status === "done" ? "x" : todo.status === "in_progress" ? ">" : " ";
  const deps = todo.dependencies.length > 0 ? ` depends on ${todo.dependencies.map((id) => `#${id}`).join(", ")}` : "";
  return `[${marker}] #${todo.id}: ${todo.text}${deps}`;
}

export default function todoExtension(pi: ExtensionAPI) {
  let todos: Todo[] = [];
  let nextId = 1;
  let sidebarVisible = true;

  const snapshot = (action: TodoDetails["action"], error?: string): TodoDetails => ({
    action,
    todos: cloneTodos(todos),
    nextId,
    ...(error ? { error } : {}),
  });

  const validateDependencies = (id: number | undefined, dependencies: number[] | undefined): string | undefined => {
    for (const depId of dependencies ?? []) {
      if (id !== undefined && depId === id) return `Todo #${id} cannot depend on itself`;
      if (!todos.some((todo) => todo.id === depId)) return `Dependency #${depId} not found`;
    }
    return undefined;
  };

  const reconstructState = (ctx: ExtensionContext) => {
    todos = [];
    nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
      const details = msg.details as TodoDetails | undefined;
      if (!details) continue;
      todos = cloneTodos(details.todos);
      nextId = details.nextId;
    }
    updateWidget(ctx);
  };

  const updateWidget = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    if (!sidebarVisible) {
      ctx.ui.setWidget("todos", undefined);
      return;
    }
    ctx.ui.setWidget("todos", renderWidgetLines(todos));
  };

  pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
  pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Manage the session todo list. Supports list, add, update, clear; statuses pending/in_progress/done; dependencies by todo id.",
    parameters: TodoParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      switch (params.action) {
        case "list":
          updateWidget(ctx);
          return {
            content: [{ type: "text", text: todos.length ? todos.map(formatTodo).join("\n") : "No todos" }],
            details: snapshot("list"),
          };

        case "add": {
          if (!params.text?.trim()) {
            const error = "text required for add";
            return { content: [{ type: "text", text: `Error: ${error}` }], details: snapshot("add", error), isError: true };
          }
          const dependencyError = validateDependencies(undefined, params.dependencies);
          if (dependencyError) {
            return { content: [{ type: "text", text: `Error: ${dependencyError}` }], details: snapshot("add", dependencyError), isError: true };
          }
          const todo: Todo = {
            id: nextId++,
            text: params.text.trim(),
            status: params.status ?? "pending",
            dependencies: [...(params.dependencies ?? [])],
          };
          todos.push(todo);
          updateWidget(ctx);
          return { content: [{ type: "text", text: `Added todo #${todo.id}: ${todo.text}` }], details: snapshot("add") };
        }

        case "update": {
          if (params.id === undefined) {
            const error = "id required for update";
            return { content: [{ type: "text", text: `Error: ${error}` }], details: snapshot("update", error), isError: true };
          }
          const todo = todos.find((item) => item.id === params.id);
          if (!todo) {
            const error = `Todo #${params.id} not found`;
            return { content: [{ type: "text", text: error }], details: snapshot("update", error), isError: true };
          }
          const dependencyError = validateDependencies(params.id, params.dependencies);
          if (dependencyError) {
            return { content: [{ type: "text", text: `Error: ${dependencyError}` }], details: snapshot("update", dependencyError), isError: true };
          }
          if (params.text !== undefined) todo.text = params.text.trim();
          if (params.status !== undefined) todo.status = params.status;
          if (params.dependencies !== undefined) todo.dependencies = [...params.dependencies];
          updateWidget(ctx);
          return { content: [{ type: "text", text: `Updated todo #${todo.id}` }], details: snapshot("update") };
        }

        case "clear": {
          const count = todos.length;
          todos = [];
          nextId = 1;
          updateWidget(ctx);
          return { content: [{ type: "text", text: `Cleared ${count} todos` }], details: snapshot("clear") };
        }
      }
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action);
      if (args.id !== undefined) text += ` ${theme.fg("accent", `#${args.id}`)}`;
      if (args.status) text += ` ${theme.fg("muted", args.status)}`;
      if (args.text) text += ` ${theme.fg("dim", `"${args.text}"`)}`;
      return new Text(text, 0, 0);
    },
  });

  // Command implementation is added in Task 4.
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test todo-extension.test.cjs
```

Expected: PASS.

Commit:

```bash
git add todo-extension.test.cjs pi-base/extensions/todo/index.ts
git commit -m "feat: implement todo actions"
```

---

### Task 3: Add widget rendering and full `/todos` view

**Files:**
- Modify: `todo-extension.test.cjs`
- Modify: `pi-base/extensions/todo/index.ts`

- [ ] **Step 1: Add static tests for widget/view rendering**

Append to `todo-extension.test.cjs`:

```js
test("todo extension renders widget counts and blockers", () => {
  const source = fs.readFileSync(TODO_PATH, "utf8");
  assert.match(source, /function renderWidgetLines/);
  assert.match(source, /blocked by/);
  assert.match(source, /in_progress/);
  assert.match(source, /pending/);
  assert.match(source, /done/);
  assert.match(source, /TodoListComponent/);
  assert.match(source, /Press Escape to close/);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test todo-extension.test.cjs
```

Expected: FAIL because widget helpers and full view do not exist.

- [ ] **Step 3: Add render helpers before `export default`**

Add to `pi-base/extensions/todo/index.ts` before `export default`:

```ts
function statusGlyph(status: TodoStatus): string {
  if (status === "done") return "✓";
  if (status === "in_progress") return "▶";
  return "○";
}

function blockingText(todo: Todo, allTodos: Todo[]): string {
  const blockers = todo.dependencies.filter((id) => allTodos.find((candidate) => candidate.id === id)?.status !== "done");
  return blockers.length > 0 ? ` blocked by ${blockers.map((id) => `#${id}`).join(",")}` : "";
}

function renderWidgetLines(todos: Todo[]): string[] {
  if (todos.length === 0) return ["Todos: empty"];
  const pending = todos.filter((todo) => todo.status === "pending").length;
  const inProgress = todos.filter((todo) => todo.status === "in_progress").length;
  const done = todos.filter((todo) => todo.status === "done").length;
  const lines = [`Todos: ${pending} pending · ${inProgress} in_progress · ${done} done`];
  for (const todo of todos.slice(0, 8)) {
    lines.push(`${statusGlyph(todo.status)} #${todo.id} ${todo.text}${blockingText(todo, todos)}`);
  }
  if (todos.length > 8) lines.push(`… ${todos.length - 8} more`);
  return lines;
}

class TodoListComponent {
  constructor(
    private todos: Todo[],
    private theme: Theme,
    private onClose: () => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) this.onClose();
  }

  render(width: number): string[] {
    const th = this.theme;
    const lines: string[] = ["", th.fg("accent", " Todos "), ""];
    if (this.todos.length === 0) {
      lines.push(th.fg("dim", "No todos yet."));
    } else {
      for (const todo of this.todos) {
        const status = todo.status === "done" ? th.fg("success", statusGlyph(todo.status)) : th.fg("accent", statusGlyph(todo.status));
        const text = todo.status === "done" ? th.fg("dim", todo.text) : th.fg("text", todo.text);
        const blockers = blockingText(todo, this.todos);
        lines.push(`${status} ${th.fg("accent", `#${todo.id}`)} ${text}${blockers ? th.fg("warning", blockers) : ""}`);
      }
    }
    lines.push("", th.fg("dim", "Press Escape to close"), "");
    return lines.map((line) => truncateToWidth(line, width));
  }

  invalidate(): void {}
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test todo-extension.test.cjs
```

Expected: PASS.

Commit:

```bash
git add todo-extension.test.cjs pi-base/extensions/todo/index.ts
git commit -m "feat: render todo widget"
```

---

### Task 4: Add `/todos` show/hide/clear commands

**Files:**
- Modify: `todo-extension.test.cjs`
- Modify: `pi-base/extensions/todo/index.ts`

- [ ] **Step 1: Add command tests**

Append to `todo-extension.test.cjs`:

```js
test("todo command supports show hide clear and full view", () => {
  const source = fs.readFileSync(TODO_PATH, "utf8");
  assert.match(source, /registerCommand\("todos"/);
  assert.match(source, /case "show"/);
  assert.match(source, /case "hide"/);
  assert.match(source, /case "clear"/);
  assert.match(source, /ctx\.ui\.custom/);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test todo-extension.test.cjs
```

Expected: FAIL because command logic is absent.

- [ ] **Step 3: Add the command before the end of `todoExtension`**

Add before the final `}` in `export default function todoExtension(...)`:

```ts
  pi.registerCommand("todos", {
    description: "Show, hide, or clear the session todo list. Usage: /todos [show|hide|clear]",
    getArgumentCompletions: (prefix) => {
      const values = ["show", "hide", "clear"];
      return values.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const subcommand = args.trim();
      switch (subcommand) {
        case "show":
          sidebarVisible = true;
          updateWidget(ctx);
          ctx.ui.notify("Todo sidebar shown", "info");
          return;
        case "hide":
          sidebarVisible = false;
          updateWidget(ctx);
          ctx.ui.notify("Todo sidebar hidden", "info");
          return;
        case "clear":
          todos = [];
          nextId = 1;
          updateWidget(ctx);
          ctx.ui.notify("Todos cleared", "info");
          return;
        case "":
          if (ctx.mode !== "tui") {
            ctx.ui.notify(renderWidgetLines(todos).join("\n"), "info");
            return;
          }
          await ctx.ui.custom<void>((_tui, theme, _kb, done) => new TodoListComponent(cloneTodos(todos), theme, () => done()));
          return;
        default:
          ctx.ui.notify("Usage: /todos [show|hide|clear]", "error");
      }
    },
  });
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
node --test todo-extension.test.cjs
```

Expected: PASS.

Commit:

```bash
git add todo-extension.test.cjs pi-base/extensions/todo/index.ts
git commit -m "feat: add todo commands"
```

---

### Task 5: Add extension-based configurable 70% auto-compaction fallback

**Files:**
- Create: `pi-base/extensions/auto-compact/index.ts`
- Modify: `agent/settings.json`
- Modify: `agent-bedrock/settings.json`
- Create/Modify: `auto-compact-extension.test.cjs`

This task provides a workspace extension fallback. It is not the final core implementation, but it honors the requested configurable default in this environment.

- [ ] **Step 1: Write the failing static test**

Create `auto-compact-extension.test.cjs`:

```js
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
  assert.match(source, /ctx\.compact/);
  assert.match(source, /Auto-compaction started/);
});

test("both agent homes load auto-compact and configure default", () => {
  for (const settingsPath of ["agent/settings.json", "agent-bedrock/settings.json"]) {
    const settings = readJson(settingsPath);
    assert.ok(settings.extensions.includes("../pi-base/extensions/auto-compact"));
    assert.equal(settings.compaction.enabled, true);
    assert.equal(settings.compaction.autoThreshold, 0.7);
  }
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test auto-compact-extension.test.cjs
```

Expected: FAIL because the extension and settings do not exist.

- [ ] **Step 3: Add settings**

Modify both settings files:

```json
"extensions": [
  "../pi-base/extensions/wiki",
  "../pi-base/extensions/todo",
  "../pi-base/extensions/auto-compact"
],
"compaction": {
  "enabled": true,
  "autoThreshold": 0.7
}
```

If a `compaction` object already exists, preserve existing keys and add `autoThreshold`.

- [ ] **Step 4: Implement extension fallback**

Create `pi-base/extensions/auto-compact/index.ts`:

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type AutoCompactSettings = {
  enabled?: boolean;
  autoThreshold?: number;
};

function getSettings(ctx: ExtensionContext): Required<AutoCompactSettings> {
  const raw = ((ctx as unknown as { settings?: { compaction?: AutoCompactSettings } }).settings?.compaction ?? {}) as AutoCompactSettings;
  return {
    enabled: raw.enabled !== false,
    autoThreshold: typeof raw.autoThreshold === "number" ? raw.autoThreshold : 0.7,
  };
}

export default function autoCompactExtension(pi: ExtensionAPI) {
  let previousPercent: number | null = null;
  let compacting = false;

  pi.on("turn_end", (_event, ctx) => {
    const settings = getSettings(ctx);
    if (!settings.enabled || compacting) return;

    const usage = ctx.getContextUsage();
    const percent = typeof usage?.percent === "number" ? usage.percent : null;
    if (percent === null) return;

    const crossed = previousPercent !== null && previousPercent <= settings.autoThreshold && percent > settings.autoThreshold;
    previousPercent = percent;
    if (!crossed) return;

    compacting = true;
    if (ctx.hasUI) ctx.ui.notify("Auto-compaction started", "info");
    ctx.compact({
      onComplete: () => {
        compacting = false;
        previousPercent = null;
        if (ctx.hasUI) ctx.ui.notify("Auto-compaction completed", "info");
      },
      onError: (error) => {
        compacting = false;
        if (ctx.hasUI) ctx.ui.notify(`Auto-compaction failed: ${error.message}`, "error");
      },
    });
  });
}
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test auto-compact-extension.test.cjs todo-extension.test.cjs
```

Expected: PASS.

Commit:

```bash
git add auto-compact-extension.test.cjs pi-base/extensions/auto-compact/index.ts agent/settings.json agent-bedrock/settings.json
git commit -m "feat: add configurable auto-compaction extension"
```

---

### Task 6: Upstream core implementation for true built-in behavior

**Files:**
- Requires upstream clone: `git clone https://github.com/earendil-works/pi-mono`
- Modify in upstream: `packages/coding-agent/src/core/tools/todo.ts`
- Modify in upstream: tool registry file that currently registers `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`
- Modify in upstream: `packages/coding-agent/src/modes/interactive/...` right-sidebar layout files
- Modify in upstream: `packages/coding-agent/src/core/settings...`
- Modify in upstream: `packages/coding-agent/src/core/compaction/compaction.ts`

- [ ] **Step 1: Clone or open upstream source**

Run outside this `.pi` config workspace:

```bash
git clone https://github.com/earendil-works/pi-mono
cd pi-mono
```

Expected: repo includes `packages/coding-agent`, `packages/tui`, `packages/agent`, and `packages/ai`.

- [ ] **Step 2: Port todo extension logic into a built-in tool**

Create `packages/coding-agent/src/core/tools/todo.ts` using the same `Todo`, `TodoDetails`, `TodoParams`, snapshot reconstruction, and renderers from `pi-base/extensions/todo/index.ts`. Register it in the same registry that exports/constructs `createReadTool`, `createBashTool`, `createEditTool`, `createWriteTool`, `createGrepTool`, `createFindTool`, and `createLsTool`.

- [ ] **Step 3: Add right-sidebar TUI layout slot**

Find the interactive layout root under `packages/coding-agent/src/modes/interactive/`. Add a right column widget host that can display extension/core widget lines without obscuring transcript content. Wire `/todos hide` to remove the todo widget and `/todos show` to restore it.

- [ ] **Step 4: Add `compaction.autoThreshold` setting**

In the settings schema/defaults, add:

```ts
compaction: {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
  autoThreshold: 0.7,
}
```

Document that `autoThreshold` is a ratio and defaults to `0.7`.

- [ ] **Step 5: Change threshold logic**

In `packages/coding-agent/src/core/compaction/compaction.ts`, replace or augment the current trigger:

```ts
contextTokens > contextWindow - reserveTokens
```

with ratio crossing logic equivalent to:

```ts
const ratio = contextTokens / contextWindow;
const threshold = settings.compaction.autoThreshold ?? 0.7;
const shouldCompact = settings.compaction.enabled && previousRatio <= threshold && ratio > threshold;
```

Keep `reserveTokens` as a safety floor if desired:

```ts
const reserveExceeded = contextTokens > contextWindow - reserveTokens;
const shouldCompact = settings.compaction.enabled && (crossedRatioThreshold || reserveExceeded);
```

- [ ] **Step 6: Add upstream tests**

Add focused tests for:

- todo add/list/update/clear
- `in_progress` status
- dependency validation
- branch reconstruction from todo tool result details
- `/todos show`, `/todos hide`, `/todos clear`
- `autoThreshold` default and settings parsing
- compaction triggers once on threshold crossing
- disabled compaction does not trigger

- [ ] **Step 7: Run upstream tests and commit**

Run the package test command documented by `pi-mono` after cloning. Expected: all focused tests pass, then full package tests pass.

Commit upstream changes:

```bash
git add packages/coding-agent packages/tui docs
git commit -m "feat: add built-in todos and auto-compaction threshold"
```

---

### Task 7: Verify current workspace fallback

**Files:**
- All changed files in `/workspace`

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test todo-extension.test.cjs auto-compact-extension.test.cjs wiki-extension.test.cjs permission-gates.test.cjs superpowers-install.test.cjs
```

Expected: all pass.

- [ ] **Step 2: Run full tests**

Run:

```bash
node --test *.test.cjs
```

Expected: all pass.

- [ ] **Step 3: Request code review**

Ask the reviewer to inspect:

- todo state reconstruction from branch history
- dependency validation and blocked display
- `/todos hide` reliably clearing the widget
- extension fallback limitation versus true upstream built-in requirements
- auto-compaction threshold crossing logic

- [ ] **Step 4: Fix review findings and rerun tests**

Apply required fixes, rerun focused and full tests, and stop only when reviewer approves or the review iteration limit is reached.
