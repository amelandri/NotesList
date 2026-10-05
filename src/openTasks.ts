import { uniqueTags } from "./tagTree";

// The open-tasks view's grouping (see renderOpenTasks() in view.ts): every
// open task goes under the exact combination of its tags, so tags #work and
// #alpha land in "#alpha + #work", apart from #work alone, and each task
// appears exactly once. A task's tags are its own (written on its line) when
// it has any, otherwise its note's (taskGroupTags()). Nested tags count whole
// (#area/work is not #area), and tags compare case-insensitively, like the
// tag tree.

export interface OpenTask<T> {
	/** The tags that decide the task's group (see taskGroupTags()), "#"-prefixed. */
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

/** An inline tag as Obsidian indexes it: the tag ("#"-prefixed) and its 0-based line. */
export interface LineTag {
	tag: string;
	line: number;
}

/**
 * The tags of the note itself, for its tasks that carry none of their own:
 * its frontmatter tags plus the inline tags written outside any task line.
 * Tags on task lines belong to those tasks, so they're left out here; else a
 * task without tags would also be grouped under its siblings' tags.
 */
export function noteLevelTags(frontmatterTags: string[], inlineTags: LineTag[], taskLines: ReadonlySet<number>): string[] {
	return [...frontmatterTags, ...inlineTags.filter((t) => !taskLines.has(t.line)).map((t) => t.tag)];
}

/** The tags deciding a task's group: its own, written on its line, if it has any; otherwise the note's. */
export function taskGroupTags(taskLine: number, inlineTags: LineTag[], noteTags: string[]): string[] {
	const own = inlineTags.filter((t) => t.line === taskLine).map((t) => t.tag);
	return own.length > 0 ? own : noteTags;
}

/** A tag combination: the distinct tags sorted case-insensitively, and a key equal for any casing. */
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
