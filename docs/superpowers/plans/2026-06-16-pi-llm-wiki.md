# Pi LLM Wiki Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact global LLM wiki memory to Pi with markdown notes, a disposable JSON index, tools, commands, Gondolin access, and concise agent guidance.

**Architecture:** Implement a shared Pi extension under `pi-base/extensions/wiki/` as the source of truth, then load it from both Pi agent homes if supported by settings. The wiki stores human-readable markdown notes in `~/.pi/wiki/notes`, derives a disposable `index.json`, and exposes compact lexical search plus read/add/update/delete/rebuild operations. Gondolin mounts the global wiki root read-write so model-visible tools can access the same memory from any project folder.

**Tech Stack:** TypeScript Pi extension API, Node.js fs/path utilities, markdown with simple YAML-like frontmatter, Node built-in test runner/static tests, Gondolin VFS mounts.

---

### Task 1: Add wiki extension source and settings integration

**Files:**
- Create: `pi-base/extensions/wiki/index.ts`
- Modify: `agent/settings.json`
- Modify: `agent-bedrock/settings.json`
- Modify: `.gitignore`
- Create/Modify tests: `wiki-extension.test.cjs`

- [ ] **Step 1: Write tests for shared wiki extension configuration**

Create `wiki-extension.test.cjs` with assertions that:
- `pi-base/extensions/wiki/index.ts` exists.
- `.gitignore` ignores `wiki/`.
- both `agent/settings.json` and `agent-bedrock/settings.json` include the wiki extension path, if Pi settings supports an `extensions` array in this repo; otherwise assert copied extension files exist under each agent home.
- both settings include default `wiki` config with `root`, `requireConfirmation`, `summaryMaxChars`, and `detailsMaxChars`.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test wiki-extension.test.cjs`
Expected: FAIL because extension/config does not exist yet.

- [ ] **Step 3: Add `.gitignore` entry**

Add:

```gitignore
wiki/
```

This keeps `~/.pi/wiki` out of this repository when working in the `.pi` checkout.

- [ ] **Step 4: Add settings defaults**

Add this object to both `agent/settings.json` and `agent-bedrock/settings.json`:

```json
"wiki": {
  "root": "../wiki",
  "requireConfirmation": true,
  "summaryMaxChars": 280,
  "detailsMaxChars": 5000
}
```

- [ ] **Step 5: Configure the extension for both Pi homes**

Prefer a shared extension path under settings if supported by project conventions. If no settings convention exists in this repo, copy source into `agent/extensions/wiki/index.ts` and `agent-bedrock/extensions/wiki/index.ts` and keep `pi-base/extensions/wiki/index.ts` as the canonical shared source.

- [ ] **Step 6: Implement extension skeleton**

Create `pi-base/extensions/wiki/index.ts` exporting a default Pi extension function. Include config resolution helpers for:
- `root`, default `../wiki` relative to the agent home/settings directory when possible, otherwise `~/.pi/wiki`.
- `requireConfirmation`, default `true`.
- `summaryMaxChars`, default `280`.
- `detailsMaxChars`, default `5000`.

### Task 2: Implement markdown note storage and disposable index

**Files:**
- Modify: `pi-base/extensions/wiki/index.ts`
- Test: `wiki-extension.test.cjs`

- [ ] **Step 1: Add tests for note format helpers**

Test source contains functions/logic for:
- date + slug IDs (`YYYY-MM-DD-title-slug`).
- frontmatter fields: `id`, `title`, `created`, `updated`, `tags`, `source`, `related`.
- `## Summary` and `## Details` sections.
- generated index warning header or generated marker.

- [ ] **Step 2: Implement note helpers**

Implement helpers:
- `slugify(title: string): string`
- `today(): string`
- `notePath(root, id): string`
- `renderNote(note): string`
- `parseNote(markdown): ParsedNote`
- `ensureWikiDirs(root)`
- `rebuildIndex(root)`

Index format:

```json
{
  "generated": true,
  "generatedAt": "ISO timestamp",
  "notes": [
    {
      "id": "2026-06-16-example",
      "title": "Example",
      "tags": ["pi"],
      "summary": "Compact summary only.",
      "updated": "2026-06-16",
      "path": "notes/2026-06-16-example.md"
    }
  ]
}
```

- [ ] **Step 3: Enforce size limits**

Reject add/update when:
- Summary exceeds `summaryMaxChars`.
- Details/body exceeds `detailsMaxChars`.

The content passed to `wiki_add`/`wiki_update` should be already summarized and should map to the note body sections.

### Task 3: Add tools

**Files:**
- Modify: `pi-base/extensions/wiki/index.ts`
- Test: `wiki-extension.test.cjs`

- [ ] **Step 1: Add static tests for tool registration names**

Assert source contains registrations for:
- `wiki_search`
- `wiki_read`
- `wiki_add`
- `wiki_update`
- `wiki_delete`
- `wiki_rebuild_index`

- [ ] **Step 2: Implement `wiki_search`**

Read `index.json`, rebuilding if missing. Score lowercased query tokens across `id`, `title`, `tags`, and `summary`. Return only compact fields: `id`, `title`, `tags`, `summary`, `updated`. Never return full note body.

- [ ] **Step 3: Implement `wiki_read`**

Read a single note by id and return full markdown content.

- [ ] **Step 4: Implement `wiki_add`**

Input: `title`, `content`, optional `tags`, `source`, `related`. Require content to include or be convertible into `## Summary` and `## Details`. Enforce confirmation when configured or session auto-remember is off. Write note, rebuild index, return id/path.

- [ ] **Step 5: Implement `wiki_update`**

Input: `id`, optional `title`, `content`, `tags`, `source`, `related`. Same confirmation rule as add. Preserve `created`, update `updated`, rebuild index.

- [ ] **Step 6: Implement `wiki_delete`**

Always require UI confirmation. Delete note, rebuild index. If no UI is available, block with a clear message.

- [ ] **Step 7: Implement `wiki_rebuild_index`**

Rebuild index from all markdown notes and return count.

### Task 4: Add `/wiki` commands

**Files:**
- Modify: `pi-base/extensions/wiki/index.ts`
- Test: `wiki-extension.test.cjs`

- [ ] **Step 1: Add static tests for command forms**

Assert source contains a `wiki` command and handles subcommands:
- `search`
- `read`
- `rebuild`
- `status`
- `auto-remember`
- `add`
- `update`

Assert source does not contain `auto-search`.

- [ ] **Step 2: Implement `/wiki status`**

Show root, confirmation mode, session auto-remember state, summary/details limits, index status/count if available.

- [ ] **Step 3: Implement `/wiki auto-remember on|off|status`**

Maintain session-local override only. Do not edit settings.

- [ ] **Step 4: Implement `/wiki search`, `/wiki read`, `/wiki rebuild`**

Command wrappers around tool logic.

- [ ] **Step 5: Implement JSON command arguments for `/wiki add` and `/wiki update`**

Parse JSON after the subcommand and call the same add/update implementation. Return parse errors with expected examples.

### Task 5: Add concise agent guidance

**Files:**
- Modify: `agent/AGENTS.md`
- Modify: `agent-bedrock/AGENTS.md`
- Test: `wiki-extension.test.cjs`

- [ ] **Step 1: Add tests for AGENTS guidance**

Assert both files include `LLM Wiki Memory`, `wiki_search`, `wiki_read`, and compact/split guidance.

- [ ] **Step 2: Add short guidance**

Append:

```md
# LLM Wiki Memory

- Use `wiki_search` when prior durable context may help.
- Use `wiki_read` only after search identifies a relevant note.
- Suggest saving durable user preferences, project decisions, or reusable procedures.
- Before saving, search for related notes and link them when useful.
- Keep wiki notes compact; split large topics into linked ordered notes.
```

### Task 6: Mount wiki in Gondolin

**Files:**
- Modify: `agent/extensions/gondolin/index.ts`
- Modify: `agent/extensions/gondolin/pi-docs-mounts.test.mjs`

- [ ] **Step 1: Add failing mount test**

Extend `pi-docs-mounts.test.mjs` to assert:
- a `PI_WIKI_ROOT` or equivalent is defined.
- it is mounted with `new RealFSProvider(PI_WIKI_ROOT)` without `ReadonlyProvider`, because wiki writes are expected.

- [ ] **Step 2: Implement wiki mount**

Mount `~/.pi/wiki` into Gondolin at the same host-absolute path or a stable guest path. Ensure the path exists before VM creation. Use read-write `RealFSProvider` so agent-visible tools and wiki extension can access it from sessions launched in any project.

- [ ] **Step 3: Run Gondolin tests**

Run: `node agent/extensions/gondolin/pi-docs-mounts.test.mjs`
Expected: PASS.

### Task 7: Verify and review

**Files:**
- All changed files

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test wiki-extension.test.cjs superpowers-install.test.cjs permission-gates.test.cjs
node agent/extensions/gondolin/pi-docs-mounts.test.mjs
TMPDIR=/tmp node agent/extensions/gondolin/pi-ignore-policy.test.mjs
```

Expected: all pass.

- [ ] **Step 2: Run full tests**

Run: `node --test *.test.cjs`
Expected: all pass.

- [ ] **Step 3: Request code review**

Ask code-review to inspect:
- security of global wiki path and Gondolin mount.
- token discipline of search results.
- confirmation behavior for add/update/delete.
- no inert `autoSearch` config.

- [ ] **Step 4: Fix review findings and rerun tests**

Apply required fixes, rerun focused and full tests, and stop only when reviewer approves or the configured review iteration limit is reached.
