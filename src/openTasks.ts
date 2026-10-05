import { uniqueTags } from "./tagTree";

// The open-tasks view's grouping (see renderOpenTasks() in view.ts): every
// open task goes under the exact combination of its note's tags, so a note
// tagged #work and #alpha lands in "#work + #alpha", apart from one tagged
// #work alone, and each task appears exactly once. Nested tags count whole
// (#area/work is not #area), and tags compare case-insensitively, like the
// tag tree.

export interface OpenTask<T> {
	/** The note's tags, "#"-prefixed, as getAllTags() returns them. */
	tags: string[];
	/** The note's position in the list (0 = first, i.e. newest or pinned). */
	noteIndex: number;
	/** 0-based line of the task in the note's file. */
	line: number;
	/** The task's own text, already stripped of its checkbox. */
	text: string;
	/** Whatever the caller needs to reach the note (a TFile in the view). */
	note: T;
}

export interface TaskGroup<T> {
	/** The combination's tags, sorted, first-seen casing; empty = untagged. */
	tags: string[];
	tasks: OpenTask<T>[];
}

/** A note's tag combination: its distinct tags sorted case-insensitively, and a key equal for any casing. */
export function tagCombination(tags: string[]): { key: string; tags: string[] } {
	const sorted = uniqueTags(tags).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
	return { key: sorted.map((tag) => tag.toLowerCase()).join("\n"), tags: sorted };
}

// Groups sorted by their tags, alphabetically, with the untagged group last;
// inside a group, tasks follow the list's own note order, then line order.
export function groupOpenTasks<T>(tasks: OpenTask<T>[]): TaskGroup<T>[] {
	const groups = new Map<string, TaskGroup<T>>();
	for (const task of tasks) {
		const { key, tags } = tagCombination(task.tags);
		let group = groups.get(key);
		if (!group) {
			group = { tags, tasks: [] };
			groups.set(key, group);
		}
		group.tasks.push(task);
	}
	for (const group of groups.values()) {
		group.tasks.sort((a, b) => a.noteIndex - b.noteIndex || a.line - b.line);
	}
	return [...groups.entries()]
		.sort(([keyA], [keyB]) => {
			if (keyA === "" || keyB === "") return keyA === "" ? (keyB === "" ? 0 : 1) : -1;
			return keyA.localeCompare(keyB);
		})
		.map(([, group]) => group);
}
