# Pi Todos and Auto-Compaction Design

## Summary

Add a built-in todo capability to Pi so agents can create, follow, and complete task lists during a session, with the list visible in the TUI right sidebar and hide/show controls for the user. Also add configurable automatic compaction when context usage crosses 70% of the model context limit by default.

## Goals

- Provide an agent-usable todo tool for planning and progress tracking.
- Support task states: `pending`, `in_progress`, and `done`.
- Represent dependencies between tasks so parallel agents can avoid conflicts and identify blocked work.
- Show todos in a right-side TUI sidebar.
- Provide commands to hide/show the todo sidebar and clear todos.
- Use session-entry state so todos reconstruct correctly on resume, fork, and branch navigation.
- Add configurable auto-compaction with default threshold `0.7`.

## Non-Goals

- Project-global todo persistence across independent sessions.
- External todo storage files.
- A full project management system with assignees, due dates, or comments.

## Todo Tool API

The built-in `todo` tool supports these actions:

- `list`
- `add`
- `update`
- `clear`

Each todo has this shape:

```ts
type Todo = {
  id: number;
  text: string;
  status: "pending" | "in_progress" | "done";
  dependencies: number[];
};
```

`add` creates a pending todo by default and may include dependencies. `update` can change the text, status, and dependency list. `list` returns the current todo list. `clear` removes all todos when the work is completed or the user/agent requests cleanup.

## State Reconstruction

Todo state is stored as snapshots in todo tool result details. Each todo tool execution returns a `details` payload containing the full current state after the action:

```ts
type TodoDetails = {
  action: "list" | "add" | "update" | "clear";
  todos: Todo[];
  nextId: number;
  error?: string;
};
```

When a session starts, resumes, forks, or moves to a different branch, Pi reconstructs todo state by scanning the active session branch from oldest to newest. It ignores unrelated entries and only reads tool results where `toolName === "todo"`. For each matching result, it replaces the in-memory todo state with the snapshot from `details`. The final snapshot on the active branch becomes the current state.

This makes todos branch-correct without external storage. If one fork marks task #1 done while another fork adds task #3, each branch reconstructs the correct state for that branch.

## TUI Design

Interactive mode shows a right-sidebar todo panel. The panel displays:

- status counts
- `pending`, `in_progress`, and `done` markers
- dependency blockers such as `blocked by #2`
- a compact empty state when there are no todos

The user can hide and show the sidebar through slash commands:

```txt
/todos show
/todos hide
/todos clear
```

Plain `/todos` opens a larger todo view for the current branch. `/todos clear` clears current branch todos.

## Auto-Compaction

Add configurable auto-compaction settings with defaults:

```json
{
  "compaction": {
    "enabled": true,
    "autoThreshold": 0.7
  }
}
```

After each turn, Pi checks context usage. If usage is available and the current ratio crosses from at-or-below the threshold to above the threshold, Pi triggers compaction. The threshold is a ratio of the active model context limit, not a fixed token number. Manual compaction continues to work independently.

The TUI should notify:

- `Auto-compaction started`
- `Auto-compaction completed`
- `Auto-compaction failed: <message>`

Crossing detection prevents repeated compactions every turn while usage remains above the threshold.

## Testing

Todo tests should cover add/list/update/clear, `in_progress`, dependency validation and display, and branch-history reconstruction. TUI tests should cover sidebar hidden/shown and compact display where practical. Auto-compaction tests should cover default threshold, disabled behavior, crossing-trigger behavior, and ensuring manual compaction remains unaffected.
