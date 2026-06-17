# Notion MCP Read Pages Design

## Summary

Add a narrow, read-only Notion integration for Pi. The integration exposes one Pi tool that accepts a Notion page URL and reads that page through Notion's official MCP server behind the scenes.

## Goals

- Let the agent read a Notion page when given a Notion page URL.
- Use Notion's official MCP server behind the scenes.
- Keep the integration read-only.
- Avoid adding generic MCP support beyond what this Notion page reader needs.

## Non-Goals

- Creating, editing, deleting, or searching Notion content.
- Database mutation or generic Notion workspace browsing.
- A full reusable MCP framework for arbitrary servers.

## Architecture

Create a shared Pi extension under `pi-base/extensions/notion/`. The extension registers a single tool, `notion_read_page`, and both Pi homes load it through their `settings.json` extension lists.

The tool validates the provided URL, extracts or normalizes the Notion page ID, launches the configured official Notion MCP server over stdio, performs the MCP initialize/tools flow, selects an allowed read-only page-fetch tool, calls it with the page URL/page ID, and returns normalized text plus metadata. The extension denies write-oriented MCP tools by never exposing or calling them.

## Components

- `pi-base/extensions/notion/index.ts`: Pi extension entrypoint, tool registration, MCP stdio client, URL validation, response normalization, and output truncation.
- `notion-extension.test.cjs`: Static tests for extension registration, read-only scope, settings wiring, and MCP flow safeguards.
- `agent/settings.json` and `agent-bedrock/settings.json`: Load the shared Notion extension.

## Configuration

The extension uses a command from `NOTION_MCP_COMMAND` when set. If unset, it defaults to running Notion's official MCP server through `npx` using the package command documented by Notion. Authentication is delegated to the official MCP server and its environment variables.

## Tool Contract

Tool name: `notion_read_page`

Input:

```json
{
  "url": "https://www.notion.so/..."
}
```

Output:

- Page title when available.
- Canonical URL or requested URL.
- Text/markdown-like page content returned by the MCP server.
- Truncation notice if the page content exceeds Pi's normal tool-output limits.

## Error Handling

- Invalid or non-Notion URLs throw a tool error.
- Missing MCP server command or spawn failure throws a clear setup error.
- Missing usable read-only MCP tool throws an error listing available read-like tools.
- MCP protocol errors are surfaced without exposing secrets.
- Tool output is truncated to avoid overwhelming model context.

## Testing

Use Node's built-in test runner with static tests that assert:

- The shared Notion extension exists.
- Both Pi homes load it.
- The extension registers only `notion_read_page`.
- The tool schema accepts `url`.
- The implementation contains MCP initialize/tools/list/tools/call flow.
- The implementation contains deny-list or allow-list safeguards that avoid write-oriented calls.
