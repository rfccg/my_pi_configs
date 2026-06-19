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

const TODO_STATE_ENTRY = "todo-state";

function isSafeTodoId(value: unknown): value is number {
	return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isAllocatableTodoId(value: unknown): value is number {
	return isSafeTodoId(value) && value < Number.MAX_SAFE_INTEGER;
}

function canAddTodoWithNextId(value: unknown): value is number {
	return isSafeTodoId(value) && value < Number.MAX_SAFE_INTEGER - 1;
}

function isTodo(value: unknown): value is Todo {
	if (!value || typeof value !== "object") return false;
	const todo = value as Partial<Todo>;
	return (
		isSafeTodoId(todo.id) &&
		typeof todo.text === "string" &&
		(todo.status === "pending" || todo.status === "in_progress" || todo.status === "done") &&
		Array.isArray(todo.dependencies) &&
		todo.dependencies.every(isSafeTodoId)
	);
}

function hasValidDependencies(todo: Todo, allTodos: Todo[]): boolean {
	return todo.dependencies.every(
		(depId) => depId !== todo.id && allTodos.some((candidate) => candidate.id === depId),
	);
}

function cloneTodos(todos: Todo[]): Todo[] {
	return todos.map((todo) => ({ ...todo, dependencies: [...todo.dependencies] }));
}

function formatTodo(todo: Todo): string {
	const marker = todo.status === "done" ? "x" : todo.status === "in_progress" ? ">" : " ";
	const deps = todo.dependencies.length > 0 ? ` depends on ${todo.dependencies.map((id) => `#${id}`).join(", ")}` : "";
	return `[${marker}] #${todo.id}: ${todo.text}${deps}`;
}

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

export default function todoExtension(pi: ExtensionAPI) {
	let todos: Todo[] = [];
	let nextId = 1;
	let sidebarVisible = true;

	const details = (action: TodoDetails["action"], error?: string): TodoDetails => ({
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

	const updateWidget = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!sidebarVisible) {
			ctx.ui.setWidget("todos", undefined);
			return;
		}
		ctx.ui.setWidget("todos", renderWidgetLines(todos));
	};

	const applySavedDetails = (saved: TodoDetails | undefined) => {
		if (!saved || !Array.isArray(saved.todos) || !isAllocatableTodoId(saved.nextId)) return;
		if (!saved.todos.every(isTodo)) return;
		const ids = new Set(saved.todos.map((todo) => todo.id));
		if (ids.size !== saved.todos.length) return;
		if (!saved.todos.every((todo) => hasValidDependencies(todo, saved.todos))) return;
		const maxTodoId = Math.max(0, ...saved.todos.map((todo) => todo.id));
		if (maxTodoId >= Number.MAX_SAFE_INTEGER - 1) return;
		const restoredNextId = Math.max(saved.nextId, maxTodoId + 1, 1);
		if (!isAllocatableTodoId(restoredNextId)) return;
		todos = cloneTodos(saved.todos);
		nextId = restoredNextId;
	};

	const reconstructState = (ctx: ExtensionContext) => {
		todos = [];
		nextId = 1;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message") {
				const msg = entry.message;
				if (msg.role === "toolResult" && msg.toolName === "todo") {
					applySavedDetails(msg.details as TodoDetails | undefined);
				}
			} else if (entry.type === "custom" && entry.customType === TODO_STATE_ENTRY) {
				applySavedDetails(entry.data as TodoDetails | undefined);
			}
		}
		updateWidget(ctx);
	};

	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description: "Manage the session todo list with pending, in_progress, and done states plus dependencies.",
		parameters: TodoParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "list":
					updateWidget(ctx);
					return {
						content: [{ type: "text" as const, text: todos.length ? todos.map(formatTodo).join("\n") : "No todos" }],
						details: { action: "list", todos: cloneTodos(todos), nextId },
					};

				case "add": {
					if (!canAddTodoWithNextId(nextId)) {
						const error = "todo id limit reached";
						return { content: [{ type: "text" as const, text: `Error: ${error}` }], details: details("add", error) };
					}
					if (!params.text?.trim()) {
						const error = "text required for add";
						return { content: [{ type: "text" as const, text: `Error: ${error}` }], details: details("add", error) };
					}
					const dependencyError = validateDependencies(undefined, params.dependencies);
					if (dependencyError) {
						return { content: [{ type: "text" as const, text: `Error: ${dependencyError}` }], details: details("add", dependencyError) };
					}
					const todo: Todo = {
						id: nextId++,
						text: params.text.trim(),
						status: params.status ?? "pending",
						dependencies: [...(params.dependencies ?? [])],
					};
					todos.push(todo);
					updateWidget(ctx);
					return { content: [{ type: "text" as const, text: `Added todo #${todo.id}: ${todo.text}` }], details: details("add") };
				}

				case "update": {
					if (params.id === undefined) {
						const error = "id required for update";
						return { content: [{ type: "text" as const, text: `Error: ${error}` }], details: details("update", error) };
					}
					const todo = todos.find((item) => item.id === params.id);
					if (!todo) {
						const error = `Todo #${params.id} not found`;
						return { content: [{ type: "text" as const, text: error }], details: details("update", error) };
					}
					const dependencyError = validateDependencies(params.id, params.dependencies);
					if (dependencyError) {
						return { content: [{ type: "text" as const, text: `Error: ${dependencyError}` }], details: details("update", dependencyError) };
					}
					if (params.text !== undefined) {
						const text = params.text.trim();
						if (!text) {
							const error = "text required for update";
							return { content: [{ type: "text" as const, text: `Error: ${error}` }], details: details("update", error) };
						}
						todo.text = text;
					}
					if (params.status !== undefined) todo.status = params.status;
					if (params.dependencies !== undefined) todo.dependencies = [...params.dependencies];
					updateWidget(ctx);
					return { content: [{ type: "text" as const, text: `Updated todo #${todo.id}` }], details: details("update") };
				}

				case "clear": {
					const count = todos.length;
					todos = [];
					nextId = 1;
					updateWidget(ctx);
					return { content: [{ type: "text" as const, text: `Cleared ${count} todos` }], details: details("clear") };
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

	pi.registerCommand("todos", {
		description: "Show, hide, or clear the session todo list. Usage: /todos [show|hide|clear]",
		getArgumentCompletions: (prefix) => {
			const values = ["show", "hide", "clear"];
			return values.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const action = args.trim();
			switch (action) {
				case "show":
				case "":
					if (action === "show") {
					sidebarVisible = true;
					updateWidget(ctx);
					ctx.ui.notify("Todo sidebar shown", "info");
					return;
				}
				if (ctx.mode !== "tui") {
					ctx.ui.notify(todos.length ? todos.map(formatTodo).join("\n") : "No todos", "info");
					return;
				}
				await ctx.ui.custom<void>((_tui, theme, _kb, done) => new TodoListComponent(cloneTodos(todos), theme, () => done()));
				return;
				case "hide":
					sidebarVisible = false;
					updateWidget(ctx);
					ctx.ui.notify("Todo sidebar hidden", "info");
					return;
				case "clear": {
					const count = todos.length;
					todos = [];
					nextId = 1;
					pi.appendEntry(TODO_STATE_ENTRY, details("clear"));
					updateWidget(ctx);
					ctx.ui.notify(`Cleared ${count} todos`, "info");
					return;
				}
				default:
					ctx.ui.notify("Usage: /todos [show|hide|clear]", "error");
			}
		},
	});
}
