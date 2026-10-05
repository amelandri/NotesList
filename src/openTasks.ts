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

/** Inline tags indexed by line, so each task finds its own in constant time. */
export function tagsByLine(inlineTags: LineTag[]): Map<number, string[]> {
	const byLine = new Map<number, string[]>();
	for (const { tag, line } of inlineTags) {
		const tags = byLine.get(line);
		if (tags) tags.push(tag);
		else byLine.set(line, [tag]);
	}
	return byLine;
}

/** The tags deciding a task's group: its own, written on its line, if it has any; otherwise the note's. */
export function taskGroupTags(taskLine: number, byLine: ReadonlyMap<number, string[]>, noteTags: string[]): string[] {
	return byLine.get(taskLine) ?? noteTags;
}

/** One open task as the index keeps it: everything but its place in the list. */
export interface IndexedTask {
	line: number;
	text: string;
	tags: string[];
}

/**
 * The open tasks of each note, extracted once per note version and reused
 * across renders, the same idea as SearchIndex: in open-tasks mode every
 * refresh (any edit, often just opening a note) rebuilds the view, and
 * re-reading every note with tasks each time is the expensive part.
 *
 * A note is extracted again only when its version changes. The view's version
 * is [mtime, metadata cache object]: the file's mtime alone isn't enough,
 * because right after a save the content is new while Obsidian's metadata
 * (task lines, tags) may not be re-parsed yet; caching that mix under the new
 * mtime would keep it stale for good. Extractions run 50 at a time, not all at
 * once, and a note that fails is logged and skipped, not cached. Imports
 * nothing from Obsidian, so the tests drive it with plain objects.
 */
export class OpenTaskIndex<F extends { path: string }> {
	private entries = new Map<string, { version: readonly unknown[]; tasks: IndexedTask[] }>();

	constructor(
		private readonly extract: (file: F) => Promise<IndexedTask[]>,
		private readonly versionOf: (file: F) => readonly unknown[],
		private readonly batchSize = 50
	) {}

	/** The open tasks of `files`, by path, extracting only the notes whose version changed. */
	async get(files: F[]): Promise<Map<string, IndexedTask[]>> {
		const result = new Map<string, IndexedTask[]>();
		const stale: F[] = [];
		for (const file of files) {
			const cached = this.entries.get(file.path);
			if (cached && sameVersion(cached.version, this.versionOf(file))) result.set(file.path, cached.tasks);
			else stale.push(file);
		}
		for (let i = 0; i < stale.length; i += this.batchSize) {
			await Promise.all(
				stale.slice(i, i + this.batchSize).map(async (file) => {
					const version = this.versionOf(file);
					try {
						const tasks = await this.extract(file);
						this.entries.set(file.path, { version, tasks });
						result.set(file.path, tasks);
					} catch (error) {
						console.error(`Notes List: could not read the tasks of ${file.path}`, error);
					}
				})
			);
		}
		return result;
	}

	/** Drops the notes not in `paths` (e.g. moved out of scope or deleted). */
	prune(paths: ReadonlySet<string>): void {
		for (const path of this.entries.keys()) {
			if (!paths.has(path)) this.entries.delete(path);
		}
	}
}

function sameVersion(a: readonly unknown[], b: readonly unknown[]): boolean {
	return a.length === b.length && a.every((value, i) => value === b[i]);
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
