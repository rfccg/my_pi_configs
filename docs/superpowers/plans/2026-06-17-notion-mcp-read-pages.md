# Notion MCP Read Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Pi tool that accepts a Notion page URL and reads it through Notion's official MCP server.

**Architecture:** Implement a shared Pi extension in `pi-base/extensions/notion/` and load it from both Pi homes. The extension exposes only `notion_read_page`, validates Notion URLs, starts the official Notion MCP server over stdio, performs the MCP initialize/tools flow, calls only an allow-listed read-like tool, normalizes output, and truncates large results.

**Tech Stack:** TypeScript Pi extension API, Node.js child_process stdio, JSON-RPC 2.0 MCP messages, Node built-in test runner/static tests.

---

## File Structure

- Create `pi-base/extensions/notion/index.ts`: extension entrypoint, URL validation, MCP stdio client, read-only tool selection, tool registration.
- Create `notion-extension.test.cjs`: static tests covering wiring, read-only scope, URL schema, and MCP flow safeguards.
- Modify `agent/settings.json`: add `../pi-base/extensions/notion` to `extensions`.
- Modify `agent-bedrock/settings.json`: add `../pi-base/extensions/notion` to `extensions`.

---

### Task 1: Add failing static tests for Notion extension wiring and safeguards

**Files:**
- Create: `notion-extension.test.cjs`
- Read: `agent/settings.json`
- Read: `agent-bedrock/settings.json`

- [ ] **Step 1: Write the failing test file**

Create `notion-extension.test.cjs` with this content:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = __dirname;
const extensionPath = join(repoRoot, 'pi-base/extensions/notion/index.ts');
const source = () => readFileSync(extensionPath, 'utf8');
const readJson = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));

test('shared Notion extension exists and is loaded by both Pi homes', () => {
  assert.equal(existsSync(extensionPath), true, 'missing shared Notion extension');

  for (const settingsPath of ['agent/settings.json', 'agent-bedrock/settings.json']) {
    const settings = readJson(settingsPath);
    assert.ok(Array.isArray(settings.extensions), `${settingsPath} settings.extensions must be an array`);
    assert.ok(
      settings.extensions.includes('../pi-base/extensions/notion'),
      `${settingsPath} must load shared Notion extension`,
    );
  }
});

test('Notion extension registers exactly one read-only page tool', () => {
  const content = source();
  assert.match(content, /name:\s*["']notion_read_page["']/, 'tool name must be notion_read_page');
  assert.match(content, /description:\s*[`"'][^`"']*Notion page URL/i, 'description must mention Notion page URL');
  assert.match(content, /url:\s*Type\.String\(/, 'tool schema must require url string');
  assert.doesNotMatch(content, /name:\s*["']notion_(create|update|delete|write|search)/, 'must not register write/search tools');
});

test('Notion extension uses MCP stdio initialize, list, and call flow', () => {
  const content = source();
  assert.match(content, /child_process/, 'must spawn official MCP server process');
  assert.match(content, /initialize/, 'must initialize MCP session');
  assert.match(content, /tools\/list/, 'must list MCP tools');
  assert.match(content, /tools\/call/, 'must call selected MCP tool');
  assert.match(content, /NOTION_MCP_COMMAND/, 'must support environment override for MCP command');
});

test('Notion extension contains read-only allow-list and write deny-list safeguards', () => {
  const content = source();
  assert.match(content, /READ_TOOL_NAME_PATTERNS/, 'must use read tool allow-list patterns');
  assert.match(content, /WRITE_TOOL_NAME_PATTERNS/, 'must use write tool deny-list patterns');
  assert.match(content, /selectReadOnlyTool/, 'must isolate read-only tool selection');
  assert.match(content, /validateNotionUrl/, 'must validate Notion URLs');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test notion-extension.test.cjs
```

Expected: FAIL because `pi-base/extensions/notion/index.ts` does not exist and settings are not wired.

- [ ] **Step 3: Commit failing test**

```bash
git add notion-extension.test.cjs
git commit -m "test: cover notion mcp extension wiring"
```

---

### Task 2: Wire the shared Notion extension into both Pi homes

**Files:**
- Modify: `agent/settings.json`
- Modify: `agent-bedrock/settings.json`
- Test: `notion-extension.test.cjs`

- [ ] **Step 1: Add the shared Notion extension path to `agent/settings.json`**

Change the `extensions` array from:

```json
"extensions": [
  "../pi-base/extensions/wiki"
]
```

to:

```json
"extensions": [
  "../pi-base/extensions/wiki",
  "../pi-base/extensions/notion"
]
```

- [ ] **Step 2: Add the shared Notion extension path to `agent-bedrock/settings.json`**

Change the `extensions` array from:

```json
"extensions": [
  "../pi-base/extensions/wiki"
]
```

to:

```json
"extensions": [
  "../pi-base/extensions/wiki",
  "../pi-base/extensions/notion"
]
```

- [ ] **Step 3: Run tests to verify remaining failure**

Run:

```bash
node --test notion-extension.test.cjs
```

Expected: FAIL because the Notion extension file still does not exist.

- [ ] **Step 4: Commit settings wiring**

```bash
git add agent/settings.json agent-bedrock/settings.json
git commit -m "feat: load notion extension"
```

---

### Task 3: Implement the read-only Notion MCP extension

**Files:**
- Create: `pi-base/extensions/notion/index.ts`
- Test: `notion-extension.test.cjs`

- [ ] **Step 1: Create the extension implementation**

Create `pi-base/extensions/notion/index.ts` with a TypeScript implementation that includes these exact pieces:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type JsonRpcResponse = { jsonrpc: "2.0"; id?: number; result?: unknown; error?: { code: number; message: string; data?: unknown } };
type McpTool = { name: string; description?: string; inputSchema?: unknown };
type ToolCallResult = { content?: Array<{ type?: string; text?: string; [key: string]: unknown }>; [key: string]: unknown };

const READ_TOOL_NAME_PATTERNS = [/read.*page/i, /fetch.*page/i, /get.*page/i, /retrieve.*page/i, /^notion.*page/i];
const WRITE_TOOL_NAME_PATTERNS = [/create/i, /update/i, /delete/i, /write/i, /append/i, /patch/i, /insert/i, /remove/i, /archive/i, /search/i, /database/i];
const DEFAULT_NOTION_MCP_COMMAND = "npx -y @notionhq/notion-mcp-server";

function validateNotionUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  const host = parsed.hostname.toLowerCase();
  const isNotionHost = host === "notion.so" || host.endsWith(".notion.so") || host === "notion.site" || host.endsWith(".notion.site");
  if (!isNotionHost) throw new Error(`Expected a Notion URL, got: ${rawUrl}`);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Expected an http(s) Notion URL, got: ${rawUrl}`);
  return parsed;
}

function shellSplit(command: string): { command: string; args: string[] } {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
  if (parts.length === 0) throw new Error("NOTION_MCP_COMMAND is empty");
  return { command: parts[0], args: parts.slice(1) };
}

function selectReadOnlyTool(tools: McpTool[]): McpTool {
  const safeTools = tools.filter((tool) => !WRITE_TOOL_NAME_PATTERNS.some((pattern) => pattern.test(tool.name)));
  const selected = safeTools.find((tool) => READ_TOOL_NAME_PATTERNS.some((pattern) => pattern.test(tool.name)));
  if (!selected) {
    const names = tools.map((tool) => tool.name).join(", ") || "none";
    throw new Error(`Could not find a read-only Notion page MCP tool. Available tools: ${names}`);
  }
  return selected;
}

function normalizeToolResult(result: unknown, requestedUrl: string): string {
  const typed = result as ToolCallResult;
  const textParts = typed.content?.filter((item) => item.type === "text" && typeof item.text === "string").map((item) => item.text) ?? [];
  const body = textParts.length > 0 ? textParts.join("\n\n") : JSON.stringify(result, null, 2);
  return `Notion page: ${requestedUrl}\n\n${body}`;
}

function truncateForTool(text: string): string {
  const truncation = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return truncation.content;
  return `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
}

class McpStdioClient {
  private nextId = 1;
  private buffer = "";
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onStdout(String(chunk)));
    child.stderr.setEncoding("utf8");
  }

  static start(): McpStdioClient {
    const configured = process.env.NOTION_MCP_COMMAND || DEFAULT_NOTION_MCP_COMMAND;
    const command = shellSplit(configured);
    const child = spawn(command.command, command.args, { stdio: ["pipe", "pipe", "pipe"], env: process.env });
    child.on("error", (error) => {
      throw new Error(`Failed to start Notion MCP server: ${error.message}`);
    });
    return new McpStdioClient(child);
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    const promise = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child.stdin.write(payload);
    return promise;
  }

  async close(): Promise<void> {
    this.child.stdin.end();
    this.child.kill();
    await Promise.race([once(this.child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      const message = JSON.parse(line) as JsonRpcResponse;
      if (typeof message.id !== "number") continue;
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    }
  }
}

async function readNotionPage(url: string): Promise<string> {
  const parsed = validateNotionUrl(url);
  const client = McpStdioClient.start();
  try {
    await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "pi-notion-read-pages", version: "1.0.0" },
    });
    const listResult = (await client.request("tools/list", {})) as { tools?: McpTool[] };
    const tool = selectReadOnlyTool(listResult.tools ?? []);
    const result = await client.request("tools/call", { name: tool.name, arguments: { url: parsed.toString(), page_url: parsed.toString() } });
    return truncateForTool(normalizeToolResult(result, parsed.toString()));
  } finally {
    await client.close();
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "notion_read_page",
    label: "Read Notion Page",
    description: "Read a Notion page URL through Notion's official MCP server. This tool is read-only and cannot create, update, delete, or search Notion content.",
    promptSnippet: "Read a Notion page URL through Notion's official MCP server",
    promptGuidelines: ["Use notion_read_page only when the user provides a Notion page URL and asks to read that page."],
    parameters: Type.Object({
      url: Type.String({ description: "The Notion page URL to read" }),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };
      const content = await readNotionPage(params.url);
      return { content: [{ type: "text", text: content }], details: { url: params.url } };
    },
  });
}
```

- [ ] **Step 2: Run static tests**

Run:

```bash
node --test notion-extension.test.cjs
```

Expected: PASS.

- [ ] **Step 3: Fix TypeScript/runtime import issues if tests or Pi loading reveal them**

If `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`, `formatSize`, or `truncateHead` are not exported in the installed Pi package, replace the import and `truncateForTool` with a local 50KB/2000-line truncation helper:

```ts
const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2000;

function truncateForTool(text: string): string {
  const lines = text.split("\n");
  let output = lines.slice(0, DEFAULT_MAX_LINES).join("\n");
  while (Buffer.byteLength(output, "utf8") > DEFAULT_MAX_BYTES) output = output.slice(0, -1024);
  const truncated = lines.length > DEFAULT_MAX_LINES || Buffer.byteLength(text, "utf8") > DEFAULT_MAX_BYTES;
  if (!truncated) return text;
  return `${output}\n\n[Output truncated to 2000 lines or 50KB.]`;
}
```

Then rerun:

```bash
node --test notion-extension.test.cjs
```

Expected: PASS.

- [ ] **Step 4: Commit extension implementation**

```bash
git add pi-base/extensions/notion/index.ts notion-extension.test.cjs
git commit -m "feat: add read-only notion mcp page tool"
```

---

### Task 4: Verify all relevant tests and inspect changes

**Files:**
- Test: `notion-extension.test.cjs`
- Test: existing extension tests if available

- [ ] **Step 1: Run Notion extension tests**

```bash
node --test notion-extension.test.cjs
```

Expected: PASS.

- [ ] **Step 2: Run adjacent repository tests**

```bash
node --test wiki-extension.test.cjs permission-gates.test.cjs subagent.test.cjs superpowers-install.test.cjs host-git-sign.test.cjs
```

Expected: PASS or only failures unrelated to Notion caused by existing workspace state. Record any unrelated failures in the final response.

- [ ] **Step 3: Inspect changed files**

```bash
git diff -- agent/settings.json agent-bedrock/settings.json pi-base/extensions/notion/index.ts notion-extension.test.cjs
```

Expected: Diff only adds the Notion extension, settings wiring, and tests.

- [ ] **Step 4: Commit verification fixes if needed**

If Task 4 requires fixes, commit them:

```bash
git add agent/settings.json agent-bedrock/settings.json pi-base/extensions/notion/index.ts notion-extension.test.cjs
git commit -m "fix: harden notion mcp page reader"
```

---

## Self-Review

- Spec coverage: The plan covers the single read-only page tool, Notion URL input, official MCP server subprocess, settings wiring, output normalization/truncation, and read-only safeguards.
- Placeholder scan: No placeholders are present; each task has exact files and commands.
- Type consistency: The tool name `notion_read_page`, helper names, test assertions, and settings path are consistent across tasks.
