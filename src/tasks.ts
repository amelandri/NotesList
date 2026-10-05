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

/** The structural subset of Obsidian's ListItemCache this needs. */
export interface TaskListItem {
	task?: string;
}

export const NO_TASKS: TaskCounts = { open: 0, done: 0, total: 0 };

// "x"/"X" is completed and "-" is cancelled (counted in neither group, only in
// the total); every other status, " " and custom ones such as "/" (in
// progress) alike, is still open.
export function isDoneTaskStatus(status: string): boolean {
	return status === "x" || status === "X";
}

/** Still to do: any status but completed ("x"/"X") and cancelled ("-"), so " " and custom ones like "/" alike. */
export function isOpenTaskStatus(status: string): boolean {
	return !isDoneTaskStatus(status) && status !== "-";
}

export function countTasks(listItems: TaskListItem[] | undefined): TaskCounts {
	if (!listItems) return NO_TASKS;
	let open = 0;
	let done = 0;
	let total = 0;
	for (const item of listItems) {
		if (item.task === undefined) continue;
		total++;
		if (isDoneTaskStatus(item.task)) done++;
		else if (isOpenTaskStatus(item.task)) open++;
	}
	return { open, done, total };
}

// A task line: optional indentation and blockquote/callout markers, a list
// marker ("-", "*", "+", "1." or "1)"), then "[<status>]".
const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([^\]])(\])/;

/**
 * Whether a task's text carries the "@waiting" keyword (case-insensitive, as
 * a whole word: not "@waitingroom" or "x@waiting"): a task someone else has
 * to do, shown in its own section of the open-tasks view.
 */
export function hasWaitingKeyword(text: string): boolean {
	return /(^|[^\w@])@waiting(?![\w-])/i.test(text);
}

/** A task line's own text: no indentation, blockquote/callout or list marker, and no "[ ]" checkbox. */
export function taskLineText(line: string): string {
	const match = TASK_LINE.exec(line);
	return match ? line.slice(match[0].length).trim() : line.trim();
}

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
