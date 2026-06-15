---
name: using-kernel-cli
description: Use when an agent needs an interactive Python analysis loop with persistent Jupyter kernel state across multiple CLI submits, including long-running tasks with timeout recovery.
---

# Using Kernel CLI

## Overview

Use this skill to run iterative Python analysis while keeping session state (variables/imports) alive between submits.

Core principle: start one named session, work in a single `.py` file OR use inline `-c` commands, submit repeatedly, then stop cleanly.

## Command Invocation: Prefer Project Environments

Before running kernel commands, choose the command prefix that matches the target project:

1. If the target repository uses `uv` (`pyproject.toml` plus `uv.lock`, or the user says the CLI is installed in uv scope), run commands as `uv run kernel ...` from the repository root.
2. If plain `kernel` is available globally and the task does not depend on project-local packages, `kernel ...` is acceptable.
3. If `kernel ...` fails with command-not-found or imports fail for project packages, retry from the project root with `uv run kernel ...` before concluding the CLI or package is broken.

This matters because Jupyter kernels inherit the Python executable and import paths from the environment used to start the session. For src-layout projects and editable installs, starting with `uv run kernel start ...` ensures the live kernel can import project-local modules and dependencies.

Examples:

```bash
# In a uv project: preferred
cd /path/to/project
uv run kernel start --name analysis
uv run kernel submit --session analysis -c 'import my_project; print("ok")' --sync --timeout-seconds 30
uv run kernel stop --name analysis

# Global/non-project usage: acceptable
kernel start --name analysis
```

Keep the same prefix for the whole session (`start`, `submit`, `poll`, `wait`, `result`, `stop`). Do not start with `kernel` and submit with `uv run kernel` unless you intentionally want to attach to an existing session started from a different environment.

## Critical: Persistent Kernel State

The kernel session is a **live Jupyter kernel**. All previous executions remain in memory:

- Variables defined in earlier submits are still available.
- Imports done once persist for the entire session lifetime.
- **DO NOT** re-import libraries or re-create variables that already exist in the session.
- Treat it exactly like a notebook: each submit is the next cell, building on all prior state.

If you need a clean slate, use `kernel restart --name <session>`.

## When to Use

- You need notebook-like state from a terminal workflow.
- You want to run iterative analysis, debugging, or data exploration.
- You need traceback-driven debugging while preserving session memory.
- You have long-running computations that may exceed timeout.

Do not use for one-off scripts that do not need shared runtime state.

## Preferred Workflow: Single File + Inline Code

Work with a **single `.py` file** per session. Append new cells to it, then submit the latest cell. This keeps a full record of your work.

Alternatively, use `-c` for quick one-liners that don't need to be saved to the file.

### File-Based Flow (preferred for multi-line work)

1. Start session: `uv run kernel start --name analysis` in a uv project, otherwise `kernel start --name analysis`
2. Write code in a single file (e.g. `work.py`) using cell markers:
   ```python
   #%% [load-data]
   import pandas as pd
   df = pd.read_csv("data.csv")

   #%% [explore]
   print(df.describe())
   ```
3. Submit specific cells: `uv run kernel submit work.py --session analysis --cell-code load-data` in a uv project, otherwise `kernel submit work.py --session analysis --cell-code load-data`
4. Submit a range: `uv run kernel submit work.py --session analysis --cell-range load-data..explore --sync` in a uv project, otherwise `kernel submit work.py --session analysis --cell-range load-data..explore --sync`
5. Append new cells to the same file as your analysis progresses.
6. Submit the new cell: `uv run kernel submit work.py --session analysis --cell-code explore` in a uv project, otherwise `kernel submit work.py --session analysis --cell-code explore`

### Inline Code Flow (for quick commands)

For short expressions or one-liners, use `-c` directly:

```bash
kernel submit --session analysis -c 'print(df.shape)'
kernel submit --session analysis -c 'df.head(10)'
kernel submit --session analysis -c 'result = df.groupby("category").sum()'
```

In uv projects, use the same commands with the `uv run` prefix, for example: `uv run kernel submit --session analysis -c 'print(df.shape)'`.

No file needed. The code is recorded in session history.

### Export Session to Script

When done, export all executed code as a single `.py` file:

```bash
kernel export --session analysis --file output.py
```

This reconstructs the full execution sequence as a standalone script.

## Standard Workflow

1. Start a session:
   - uv project: `uv run kernel start --name analysis`
   - `kernel start --name analysis`
2. Submit by index (1-based):
   - `kernel submit file.py --session analysis --cell 2`
3. Submit by tag (`#%% [tag]`):
   - `kernel submit file.py --session analysis --cell-code code-a`
4. Submit inline code:
   - `kernel submit --session analysis -c 'print(x)'`
5. Submit a range of cells (tag or index):
   - `kernel submit file.py --session analysis --cell-range setup..transform --sync`
6. Run synchronously when you need immediate completion or timeout control:
   - `kernel submit file.py --session analysis --cell-code code-a --sync --timeout-seconds 60`
7. Retrieve outputs with structured JSON:
   - `kernel result --session analysis --last --format json`
   - `kernel result --session analysis --submission-id sub-1234567890 --format json`
8. Inspect execution history:
   - `kernel history --session analysis`
   - `kernel history --session analysis --format json`
9. Export session as script:
   - `kernel export --session analysis --file output.py`
10. Interrupt a stuck execution (safe when idle):
    - `kernel interrupt --name analysis`
11. Restart kernel in-place while keeping session name:
    - `kernel restart --name analysis`
12. Checkpoint and restore variables:
    - `kernel snapshot --session analysis --vars "df,model" --file checkpoint.pkl`
    - `kernel restore --session analysis --file checkpoint.pkl`
13. Dump history when needed:
    - `kernel dump-history --session analysis --file history.jsonl`
14. End session:
    - `kernel stop --name analysis`

## Long-Running Task Workflow

When a cell may take a long time, use `--sync --timeout-seconds` with the poll/wait pattern.

### Step 1: Submit with a conservative timeout

```bash
kernel submit pipeline.py --session analysis --cell-code train --sync --timeout-seconds 60
```

If the cell finishes in time, exit code is 0. If it times out, exit code is 5.
**The kernel continues executing after timeout** — do not restart.

### Step 2: Poll to check if it finished

```bash
kernel poll --session analysis --format json
```

Exit code 0 means done. Exit code 3 means still running.

### Step 3: Wait with a longer timeout

```bash
kernel wait --session analysis --timeout-seconds 600 --format json
```

Blocks until completion or another timeout.

### Key Rules for Long-Running Tasks

- **Never restart after timeout.** The kernel is still working.
- **Use poll for quick checks.** It returns immediately with status.
- **Use wait when you're ready to block.** It collects output when done.
- **Use result --last only after poll/wait confirms completion.** Before that it returns the timeout record.

## Commands Reference

| Command | Purpose |
|---------|---------|
| `kernel start --name X` | Start a new session |
| `kernel submit file.py --session X --cell N` | Submit cell by 1-based index |
| `kernel submit file.py --session X --cell-code tag` | Submit cell by tag |
| `kernel submit --session X -c 'code'` | Submit inline code |
| `kernel submit file.py --session X --cell-range a..b` | Submit range of cells |
| `kernel submit file.py --session X --cell-code tag --sync --timeout-seconds 60` | Synchronous with timeout |
| `kernel result --session X --last` | Get last submission output |
| `kernel result --session X --last --format json` | Get last result as JSON |
| `kernel poll --session X` | Check if timed-out submission finished |
| `kernel wait --session X --timeout-seconds 600` | Block until timed-out submission finishes |
| `kernel history --session X` | List execution history |
| `kernel history --session X --format json` | History as JSON |
| `kernel export --session X --file out.py` | Export history as .py script |
| `kernel dump-history --session X --file h.jsonl` | Raw JSONL history dump |
| `kernel snapshot --session X --vars "a,b" --file cp.pkl` | Pickle variables |
| `kernel restore --session X --file cp.pkl` | Restore pickled variables |
| `kernel list` | List active sessions |
| `kernel restart --name X` | Restart kernel (clears state) |
| `kernel interrupt --name X` | Interrupt running execution |
| `kernel stop --name X` | End session |

## Cell Rules

- Cell delimiter is `#%%`.
- Tagged cells must use `#%% [tag-name]`.
- `--cell`, `--cell-code`, and `--cell-range` are mutually exclusive — provide exactly one.
- `--cell-range` uses `start..end` syntax (inclusive), with tags or 1-based indices.
- `-c`/`--code` and file argument are mutually exclusive.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success (or poll: completed) |
| 3 | Still running (poll only) |
| 4 | Execution error (traceback in stderr) |
| 5 | Timeout |

## Output Behavior

- `stdout/stderr` prints to terminal.
- Exceptions print traceback, return non-zero, and keep the session alive.
- `submit --sync --timeout-seconds` controls CLI wait time, not hard kernel cancellation.
- After timeout, use `poll` or `wait` to follow up — **not** `result --last` (which returns the timeout record).
- Use `--format json` on `result` and `history` for structured output agents can parse.
- `interrupt` returns success even when idle and reports idle status.
- `restart` hard-restarts the kernel process while preserving the same session name. Works across processes.
- Rich outputs are overwritten to `.kernel/last-rich-output.json` by default.
- Use `--output-file path.json` to overwrite a different target file.

## Guidelines for AI Agents

1. **Use one `.py` file per session.** Append new `#%%` cells as you iterate. Submit only the latest cell.
2. **Use `-c` for quick checks.** One-liners like `print(x)`, `type(obj)`, `len(df)` don't need a file.
3. **Never re-import or re-define.** Everything from prior submits is still in memory.
4. **Build incrementally.** Each cell should be small and focused — one logical step.
5. **Use `export` at the end** to produce a clean reproducible script from your session.
6. **If something errors**, fix only the failing cell and re-submit it. Don't re-run everything.
7. **For long tasks**, use `--sync --timeout-seconds`, then `poll`/`wait`. Never restart after timeout.
8. **Use `--format json`** when you need to parse output programmatically.
9. **Always `stop`** when done to avoid leaving kernels running.

## Common Mistakes

- Starting a session with plain `kernel` inside a uv project, then expecting imports from the uv environment to work. Use `uv run kernel ...` consistently from the project root.
- Re-importing libraries that were already imported in an earlier submit.
- Re-creating DataFrames or variables that already exist in kernel memory.
- Submitting before `start` for the chosen `--session`.
- Using invalid tag syntax (must be in the `#%% [tag]` header).
- Assuming `--cell` is zero-based (it is 1-based).
- Passing both `--submission-id` and `--last` to `result` (provide exactly one).
- Forgetting `stop`, leaving background kernels running.
- Restarting the kernel after a timeout instead of using `poll`/`wait` — the kernel is still running, don't throw away the computation.
- Using `result --last` after timeout to get output — use `wait` instead, which resumes collecting output from the still-running kernel.
- Providing `--cell-code` and `--cell-range` together (mutually exclusive).
