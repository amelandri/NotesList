// Full-text search over the notes in scope, built for speed at thousands of
// notes: Obsidian's metadataCache doesn't hold note text, so every note's
// content is read once (vault.cachedRead) and kept here as a single
// pre-lowercased string. A search is then a plain in-memory substring scan,
// with no disk access at all. Each update() re-reads only files whose mtime
// changed since they were indexed, so keeping the index current after an
// edit costs one read per changed note, not a rescan of the whole folder.
//
// Deliberately free of any Obsidian runtime import (IndexableFile is the
// structural subset of TFile it needs), so it's unit-testable directly.

export interface IndexableFile {
	path: string;
	basename: string;
	stat: { mtime: number };
}

interface IndexedNote {
	mtime: number;
	text: string;
}

// How many files are read concurrently while (re)indexing: enough to keep
// the I/O pipeline busy, few enough not to flood it when a large folder is
// first indexed.
const READ_BATCH_SIZE = 50;

// Lowercased, whitespace-separated, de-duplicated terms. Every term must
// appear in a note for it to match (AND), anywhere and in any order.
export function parseSearchQuery(query: string): string[] {
	return Array.from(new Set(query.toLowerCase().split(/\s+/).filter(Boolean)));
}

export function matchesAllTerms(text: string, terms: readonly string[]): boolean {
	return terms.every((term) => text.includes(term));
}

// What a note is searched by: its file name plus its body (frontmatter is
// excluded — property values aren't what "search the note's text" means,
// and tags already have the tag tree). Lowercased once here, at index time,
// so search() never has to lowercase anything per note.
export function buildSearchText(basename: string, body: string): string {
	return `${basename}\n${body}`.toLowerCase();
}

export class SearchIndex<F extends IndexableFile = IndexableFile> {
	private notes = new Map<string, IndexedNote>();
	// Serializes update() calls, so two overlapping ones (e.g. the background
	// pre-warm and a search submitted before it finished) never read the same
	// files twice or race on the map: each waits for the previous one, which
	// by then has usually done all the work already.
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly readBody: (file: F) => Promise<string>
	) {}

	update(files: readonly F[]): Promise<void> {
		this.queue = this.queue.then(() => this.doUpdate(files));
		return this.queue;
	}

	// Paths of the files (among `files`, in their given order) whose indexed
	// text contains every term. A file not indexed yet simply doesn't match —
	// callers await update() first.
	search(files: readonly F[], terms: readonly string[]): Set<string> {
		const matches = new Set<string>();
		for (const file of files) {
			const note = this.notes.get(file.path);
			if (note && matchesAllTerms(note.text, terms)) matches.add(file.path);
		}
		return matches;
	}

	get size(): number {
		return this.notes.size;
	}

	private async doUpdate(files: readonly F[]): Promise<void> {
		// Drop notes that left the scope (deleted, moved out, folder setting
		// changed) so the index doesn't keep their text in memory forever.
		const inScope = new Set(files.map((file) => file.path));
		for (const path of this.notes.keys()) {
			if (!inScope.has(path)) this.notes.delete(path);
		}

		const stale = files.filter((file) => this.notes.get(file.path)?.mtime !== file.stat.mtime);
		for (let i = 0; i < stale.length; i += READ_BATCH_SIZE) {
			await Promise.all(
				stale.slice(i, i + READ_BATCH_SIZE).map(async (file) => {
					try {
						const body = await this.readBody(file);
						this.notes.set(file.path, { mtime: file.stat.mtime, text: buildSearchText(file.basename, body) });
					} catch (err) {
						// One unreadable file shouldn't abort indexing the rest; it just
						// won't match until a later update() manages to read it.
						console.warn(`Notes List: couldn't index ${file.path} for search`, err);
					}
				})
			);
		}
	}
}
