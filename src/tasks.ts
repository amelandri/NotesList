// A note's tasks, as Obsidian's metadataCache already parses them: every list
// item that's a checkbox carries a `task` status character (" " for "- [ ]",
// "x" for "- [x]", or a custom one such as "-" or "/"). Tasks inside code
// blocks are already left out by Obsidian's parser. Nothing here imports from
// Obsidian at runtime, so the tests can call it directly.

/** How a note's tasks break down. `total` also includes cancelled ones. */
export interface TaskCounts {
	open: number;
	done: number;
	total: number;
}

/** The Tasks section's choices: notes with any task, with an open one, or with a completed one. */
export type TaskFilter = "any" | "open" | "done";

/** The structural subset of Obsidian's ListItemCache this needs. */
export interface TaskListItem {
	task?: string;
}

export const NO_TASKS: TaskCounts = { open: 0, done: 0, total: 0 };

// "x"/"X" is completed and "-" is cancelled (counted in neither group, only in
// the total); every other status, " " and custom ones such as "/" (in
// progress) alike, is still open.
export function countTasks(listItems: TaskListItem[] | undefined): TaskCounts {
	if (!listItems) return NO_TASKS;
	let open = 0;
	let done = 0;
	let total = 0;
	for (const item of listItems) {
		if (item.task === undefined) continue;
		total++;
		if (item.task === "x" || item.task === "X") done++;
		else if (item.task !== "-") open++;
	}
	return { open, done, total };
}

export function noteMatchesTaskFilter(counts: TaskCounts, filter: TaskFilter): boolean {
	if (filter === "open") return counts.open > 0;
	if (filter === "done") return counts.done > 0;
	return counts.total > 0;
}

// A task line: optional indentation and blockquote/callout markers, a list
// marker ("-", "*", "+", "1." or "1)"), then "[<status>]".
const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\])/;

/**
 * `line` with its task checked ("x") or unchecked (" "). Returns null when it
 * isn't a task line, or when it's already in the requested state (Obsidian
 * renders any status but " " as checked, so a click can only flip it): either
 * way the note isn't what was rendered, and the caller must write nothing.
 * Unchecking always goes back to " ", whatever the status was ("x", "/", "-").
 */
export function setTaskLineChecked(line: string, checked: boolean): string | null {
	const match = TASK_LINE.exec(line);
	if (!match) return null;
	const wasChecked = match[2] !== " ";
	if (wasChecked === checked) return null;
	return line.replace(TASK_LINE, `$1${checked ? "x" : " "}$3`);
}

/** The Tasks section's entries, in display order. Their labels are UI strings ("tasks.<filter>" in i18n.ts). */
export const TASK_FILTERS: readonly TaskFilter[] = ["any", "open", "done"];
