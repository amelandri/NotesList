import {
	App,
	CachedMetadata,
	Component,
	EventRef,
	ItemView,
	MarkdownRenderer,
	Notice,
	Scope,
	TFile,
	WorkspaceLeaf,
	getAllTags,
	parseFrontMatterTags,
	setIcon,
} from "obsidian";
import type NotesListPlugin from "./main";
import type { ContentDisplayMode, TagTreeExpandLevel } from "./settings";
import { renderHeatmap, type HeatmapSelection } from "./heatmap";
import {
	buildTagTree,
	uniqueTags,
	isCollapsedByDefault,
	noteMatchesTagFilter,
	renderTagTree,
	UNTAGGED,
	type TagFilter,
} from "./tagTree";
import {
	groupOpenTasks,
	noteLevelTags,
	OpenTaskIndex,
	tagsByLine,
	taskGroupTags,
	type IndexedTask,
	type LineTag,
	type OpenTask,
} from "./openTasks";
import {
	countTasks,
	isOpenTaskStatus,
	noteMatchesTaskFilter,
	setTaskLineChecked,
	TASK_FILTERS,
	taskLineText,
	type TaskCounts,
	type TaskFilter,
} from "./tasks";
import { t, tn } from "./i18n";
import { Moment, moment } from "./moment";
import { SearchIndex, parseSearchQuery } from "./searchIndex";

export const VIEW_TYPE_NOTES_LIST = "notes-list-view";

// Below this pane width (px) the two columns stack into one. Roughly the
// sidebar's own width (the heatmap sets it) plus a usable notes column.
const NARROW_LAYOUT_MAX_WIDTH = 720;

export function isUniqueNoteName(basename: string, format: string): boolean {
	return moment(basename, format, true).isValid();
}

interface NoteEntry {
	file: TFile;
	date: Moment;
	tags: string[];
	pinned: boolean;
	tasks: TaskCounts;
}

// Deliberately does NOT use metadataCache.getFileCache(file)?.frontmatterPosition
// to find where the body starts. That offset comes from Obsidian's cached,
// already-parsed metadata, which is re-parsed asynchronously after a write —
// right after our own processFrontMatter() call (e.g. toggling a pin), a
// render() can run before that re-parse lands, so the cached offset would
// still be the *previous* frontmatter block's length. If the edit changed
// that length by even one byte (e.g. "true" -> "false"), slicing at the stale
// offset lands mid-frontmatter, so the "body" starts with a stray "-" from
// the closing delimiter — which Markdown then renders as a bullet list item
// for a moment, until the next refresh() re-reads it correctly. Deriving the
// cut directly from the raw content we just read is immune to that race.
//
// The body group matches whole lines lazily ((?:.*\r?\n)*?), not [\s\S]*? —
// that variant requires a *separate* newline before the closing "---", which
// a completely empty frontmatter block ("---\n---\n", zero properties) never
// has: its closing "---" sits right after the one newline that already ended
// the opening line. Matching zero whole lines lets the closing delimiter be
// found immediately in that case instead of the regex failing outright and
// leaving both "---" lines to render as a stray bullet.
export function stripFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n(?:.*\r?\n)*?---[ \t]*(?:\r?\n|$)/, "");
}

// A GFM table's delimiter row ("| --- | :-: |", "--- | ---", ...). A pipe is
// required on the line itself, so a bare "---" (a thematic break, or a setext
// heading underline) is never mistaken for one.
const TABLE_DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})/;

// An inline tag, as Obsidian recognizes one: "#" at the start of a line or
// after whitespace (so "Note#heading" links, URLs' "#anchor" and an escaped
// "\#" don't count), then letters, digits, "_", "-" or "/", with at least one
// character that isn't a digit ("#123" is not a tag). "# Heading" doesn't
// match either, since a space can't follow the "#".
const INLINE_TAG = /(^|\s)#(?=[\p{L}\p{N}_\-/]*[\p{L}_\-/])[\p{L}\p{N}_\-/]+/gu;
// An inline code span (`code`, ``co`de``), whose content is never a tag.
const INLINE_CODE = /(`+)[^`]*?\1/g;

// `body` with its inline tags removed, since the list shows a note's tags in a
// row of their own instead (see renderEntry()). Fenced code blocks and inline
// code are left untouched, as Obsidian doesn't read tags there either. Spaces
// a removed tag leaves behind are collapsed (keeping the line's indentation),
// and a line that held nothing but tags is dropped altogether.
export function stripInlineTags(body: string): string {
	const out: string[] = [];
	let closingFence: RegExp | null = null;
	for (const line of body.split("\n")) {
		if (closingFence) {
			if (closingFence.test(line)) closingFence = null;
			out.push(line);
			continue;
		}
		const fence = FENCE_OPENING.exec(line);
		if (fence) {
			const marker = fence[1];
			closingFence = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
			out.push(line);
			continue;
		}

		// Strip tags only from the stretches between inline code spans.
		let stripped = "";
		let last = 0;
		for (const code of line.matchAll(INLINE_CODE)) {
			stripped += line.slice(last, code.index).replace(INLINE_TAG, "$1") + code[0];
			last = code.index + code[0].length;
		}
		stripped += line.slice(last).replace(INLINE_TAG, "$1");
		if (stripped === line) {
			out.push(line);
			continue;
		}

		// Indentation from the original line: a tag removed from the very start
		// leaves its trailing space behind, which isn't indentation.
		const indent = /^\s*/.exec(line)?.[0] ?? "";
		const rest = stripped.trim().replace(/ {2,}/g, " ");
		if (rest) out.push(indent + rest);
	}
	return out.join("\n");
}

// [start, end) character ranges of every fenced code block and table in
// `body` — Markdown that renders as garbage (an unclosed fence swallowing the
// rest of the preview, a table with a half-row) if cut partway through.
// Scanned line by line in document order, so a table-looking line inside a
// code block is correctly treated as code, and the ranges come out sorted and
// non-overlapping. An unclosed fence runs to the end of the body, same as
// Obsidian renders it.
export function findUnbreakableBlocks(body: string): Array<[number, number]> {
	const lines: Array<{ start: number; end: number; text: string }> = [];
	let offset = 0;
	for (const text of body.split("\n")) {
		lines.push({ start: offset, end: offset + text.length, text });
		offset += text.length + 1;
	}

	const blocks: Array<[number, number]> = [];
	for (let i = 0; i < lines.length; i++) {
		const fence = FENCE_OPENING.exec(lines[i].text);
		if (fence) {
			const marker = fence[1];
			const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
			let j = i + 1;
			while (j < lines.length && !closing.test(lines[j].text)) j++;
			j = Math.min(j, lines.length - 1);
			blocks.push([lines[i].start, lines[j].end]);
			i = j;
			continue;
		}

		const next = lines[i + 1];
		if (lines[i].text.includes("|") && next && next.text.includes("|") && TABLE_DELIMITER_ROW.test(next.text)) {
			let j = i + 1;
			while (j + 1 < lines.length && lines[j + 1].text.trim() !== "" && lines[j + 1].text.includes("|")) j++;
			blocks.push([lines[i].start, lines[j].end]);
			i = j;
		}
	}
	return blocks;
}

// Cuts `body` to about `maxLength` characters for "preview" mode, but never
// inside a code block or table (see findUnbreakableBlocks): a cut that would
// land in one is moved to right after it instead, so the preview can run
// longer than maxLength by up to that one block. The ellipsis goes on its own
// paragraph in that case — appended straight onto the closing "```" it would
// stop that line being a valid closing fence, and onto a table's last row it
// would end up inside a cell. If the block is the last thing in the body,
// there's nothing left to cut, so the whole body is returned with no ellipsis.
// The author's own preview break, WordPress/Hugo style. An HTML comment, so
// Obsidian's reading view doesn't show it, and it can't collide with real
// content the way a "-----" (a horizontal rule) would.
const PREVIEW_MARKER = /<!--\s*more\s*-->/i;

/**
 * What a note's body shows in the list. `truncated` says whether anything was
 * left out, which the list shows as a "Continue reading" link (see
 * renderEntry()), rather than as a "…" paragraph inside the text. An
 * inline "…" stays only where a sentence is broken off mid-line.
 */
export interface Preview {
	text: string;
	truncated: boolean;
}

// `body` cut at its first preview marker outside a fenced code block,
// `truncated` when anything follows it (plus an inline "…" after a mid-line
// marker, where a sentence breaks off). null when there's no marker.
export function cutAtPreviewMarker(body: string): Preview | null {
	let offset = 0;
	let closingFence: RegExp | null = null;
	for (const line of body.split("\n")) {
		if (closingFence) {
			if (closingFence.test(line)) closingFence = null;
		} else {
			const fence = FENCE_OPENING.exec(line);
			if (fence) {
				const marker = fence[1];
				closingFence = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}\\s*$`);
			} else {
				const match = PREVIEW_MARKER.exec(line);
				if (match) {
					const before = line.slice(0, match.index);
					const head = (body.slice(0, offset) + before).trimEnd();
					const rest = body.slice(offset + match.index + match[0].length);
					if (rest.trim() === "") return { text: head, truncated: false };
					// Mid-line, the sentence goes on after the marker: say so inline.
					return { text: before.trim() === "" ? head : head + " …", truncated: true };
				}
			}
		}
		offset += line.length + 1;
	}
	return null;
}
// What a note's body shows in the list, by precedence:
// 1. its own "content-display" frontmatter: "full" shows everything, "preview"
//    cuts at the preview marker, or at previewLength when there's none;
// 2. a preview marker: cut there, whatever the setting says (it's a per-note
//    choice, like the frontmatter);
// 3. the Content display setting, cutting at previewLength for "preview".
export function previewBody(
	body: string,
	frontmatterMode: ContentDisplayMode | null,
	settingMode: ContentDisplayMode,
	previewLength: number
): Preview {
	if (frontmatterMode === "full") return { text: body, truncated: false };
	const atMarker = cutAtPreviewMarker(body);
	if (atMarker !== null) return atMarker;
	return (frontmatterMode ?? settingMode) === "preview"
		? truncateMarkdown(body, previewLength)
		: { text: body, truncated: false };
}
export function truncateMarkdown(body: string, maxLength: number): Preview {
	if (body.length <= maxLength) return { text: body, truncated: false };

	const block = findUnbreakableBlocks(body).find(([start, end]) => start < maxLength && maxLength < end);
	// Cut mid-text: the inline ellipsis marks where the sentence breaks off.
	if (!block) return { text: body.slice(0, maxLength).trimEnd() + "…", truncated: true };

	const blockEnd = block[1];
	if (body.slice(blockEnd).trim() === "") return { text: body, truncated: false };
	return { text: body.slice(0, blockEnd).trimEnd(), truncated: true };
}
// Doesn't depend on any view/plugin state — a free function (not a method)
// so it can be unit-tested directly, and reused as-is from resolveDate()
// below.
//
// The normal case is a quoted string written by Obsidian's own "Date & time"
// (or plain "Date") property picker — always local wall-clock time, e.g.
// "2026-09-25T16:20:00" (or "2026-09-25" with no time at all) — parsed
// directly against those formats, with no conversion needed.
//
// An unquoted value typed by hand bypasses that: YAML 1.1's timestamp
// resolver auto-casts it to a native Date instead, always at exactly UTC
// midnight when the source text carried no time-of-day at all
// (Date.UTC(year, month, day) — hour/minute/second default to 0 with no
// exceptions), and to a real, non-midnight UTC time when it did. Checking
// the *UTC* time-of-day, not the local one, is what reliably tells those
// two cases apart: a date-only value's *local* representation is shifted
// away from midnight by whatever the runtime's UTC offset happens to be —
// exactly the artifact this needs to see past, not react to. (A genuinely
// embedded time is still off by that same offset, since the resolver has
// no notion of "local time" and always treats it as UTC — an unavoidable
// quirk of typing it unquoted; quoting the value sidesteps it entirely,
// which is what Obsidian's own property picker always does.)
export function parseDatetime(raw: unknown): Moment | null {
	if (typeof raw === "string") {
		const parsed = moment(raw, ["YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DDTHH:mm", "YYYY-MM-DD"], true);
		return parsed.isValid() ? parsed : null;
	}

	// Besides a string, the only other thing YAML's timestamp resolver ever
	// hands back for an unquoted value is a native Date, per the comment
	// above. Anything else (a number, a list, ...) isn't a date this plugin
	// can interpret, so it's rejected (falling back to mtime) rather than
	// handed to moment(), which would e.g. read a bare number as epoch ms.
	if (!(raw instanceof Date)) return null;
	const date = moment(raw);
	if (!date.isValid()) return null;
	if (date.clone().utc().format("HH:mm:ss") === "00:00:00") {
		date.startOf("day");
	}
	return date;
}

// "Today" also catches a future-dated note (isSameOrAfter, not isSame) —
// none of the four labels the setting offers fit a note dated ahead of
// today, and folding it into "Today" avoids inventing a fifth one.
// weekStart uses moment's own locale-aware start of week, same as the
// heatmap's own week bucketing in heatmap.ts, so both agree on where a week
// begins. `now` defaults to the real current time for every production call
// site — it's a parameter (not a hardcoded moment() inside) purely so tests
// can pin it to a fixed instant instead of depending on whatever day the
// test happens to run on.
export function dateGroupLabel(date: Moment, now: Moment = moment()): string {
	const today = now.clone().startOf("day");
	if (date.isSameOrAfter(today, "day")) return t("group.today");
	if (date.isSame(today.clone().subtract(1, "day"), "day")) return t("group.yesterday");
	if (date.isSameOrAfter(today.clone().startOf("week"), "day")) return t("group.thisWeek");
	return t("group.older");
}

// "readableLineLength" is an undocumented internal Vault config key with no public
// typings; Obsidian's own core reads/toggles it the same way (verified in app.js).
interface VaultInternal {
	getConfig(key: string): unknown;
	on(name: "config-changed", callback: (key: string) => unknown): EventRef;
}

function internalVault(app: App): VaultInternal {
	return app.vault as unknown as VaultInternal;
}

// Whether a key event is aimed at something the user is typing into, where a
// bare-key shortcut like "/" must type the character instead of firing.
function isEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

export class NotesListView extends ItemView {
	private plugin: NotesListPlugin;
	private selectedTag: TagFilter | null = null;
	private selectedDate: string | null = null;
	private selectedMonth: string | null = null;
	// Tags the user has expanded/collapsed by hand (path -> collapsed),
	// overriding the "Tag tree expansion" setting's default for that one node.
	// Cleared whenever that setting changes (see render()), so a new default
	// shows up immediately instead of being masked by earlier clicks.
	private tagCollapseOverrides = new Map<string, boolean>();
	private appliedTagTreeExpandLevel: TagTreeExpandLevel | null = null;
	// Whether the whole Tags section is folded away. Only honored in the
	// single-column (narrow) layout, where an expanded tree would push the
	// notes list off screen; the two-column layout always shows it.
	private tagPanelCollapsed = true;
	// The Tasks section's filter (see tasks.ts), and its own narrow-layout
	// fold, both working like their Tags counterparts.
	private selectedTaskFilter: TaskFilter | null = null;
	// What the main column shows: the notes, or the open tasks found in them
	// (renderOpenTasks()), switched from the header. Transient, like the filters.
	private mode: "notes" | "tasks" = "notes";
	// Open tasks per note, re-extracted only when a note changes (see
	// OpenTaskIndex). Its version also tracks the metadata cache object, since
	// task lines and tags come from there.
	private openTaskIndex = new OpenTaskIndex<TFile>(
		(file) => this.extractOpenTasks(file),
		(file) => [file.stat.mtime, this.app.metadataCache.getFileCache(file)]
	);
	private taskPanelCollapsed = true;
	private currentPage = 1;
	// Full-text search (see searchIndex.ts). searchQuery is the submitted text
	// (also what the input shows after a re-render, since render() rebuilds
	// the whole DOM); searchMatches is the set of matching note paths, or null
	// when no search is active. Both transient, like the other filters.
	private searchQuery = "";
	private searchMatches: Set<string> | null = null;
	// What's typed in the field but not submitted yet. render() rebuilds the
	// whole DOM, and runs for reasons the user didn't trigger (a vault event,
	// a sync), so the draft, focus and caret are carried over explicitly —
	// otherwise a background refresh mid-typing would wipe the field.
	private searchDraft = "";
	private searchInputEl: HTMLInputElement | null = null;
	// Set when focusSearch() is called before the field exists yet (e.g. the
	// "Search notes" command opening the view), consumed by the next render.
	private pendingSearchFocus = false;
	private searchIndex = new SearchIndex<TFile>(async (file) => stripFrontmatter(await this.app.vault.cachedRead(file)));
	// Populated by rebuildEntries() — the expensive per-note scan (metadata
	// lookup, date resolution, tag extraction). Reused across render()s that
	// only change UI state (pagination, filter selection, tag-tree collapse),
	// so those stay cheap even in a folder with thousands of notes; only
	// refresh() (vault/metadata changes, settings changes, initial open)
	// rebuilds it.
	private cachedEntries: NoteEntry[] = [];
	// The Component passed to MarkdownRenderer.render() for every note's body —
	// deliberately its own short-lived Component, not the plugin itself (whose
	// lifecycle spans the whole Obsidian session): replaced at the start of
	// every render() (see there) so whatever MarkdownRenderer registered
	// against the *previous* pass's now-discarded DOM gets unloaded first,
	// rather than accumulating for as long as the plugin stays enabled.
	private markdownComponent = new Component();

	constructor(leaf: WorkspaceLeaf, plugin: NotesListPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_NOTES_LIST;
	}

	getDisplayText(): string {
		return t("view.title");
	}

	getIcon(): string {
		return "list-ordered";
	}

	async onOpen(): Promise<void> {
		// Shortcuts active only while this view is focused; a view's scope takes
		// precedence over the app's global hotkeys while it is. Mod+F is
		// Obsidian's "Search current file", which only works in an editor and
		// does nothing here, so claiming it inside this view loses nothing.
		this.scope = new Scope(this.app.scope);
		this.scope.register(["Mod"], "f", () => {
			this.focusSearch();
			return false;
		});
		// "/" with any modifiers (null), because on some layouts it takes Shift
		// (Shift+7 on an Italian keyboard). A real Ctrl/Cmd/Alt chord is left
		// alone, and so is typing a "/" into a text field.
		this.scope.register(null, "/", (evt) => {
			if (evt.ctrlKey || evt.metaKey || evt.altKey || isEditableTarget(evt.target)) return;
			this.focusSearch();
			return false;
		});
		// Single-column layout below NARROW_LAYOUT_MAX_WIDTH (see styles.css,
		// .is-narrow). Based on the pane's own width rather than on the device,
		// so a narrow pane on desktop gets it too, and a phone rotated to a wide
		// landscape doesn't. contentEl survives render()'s empty(), so the class
		// only has to change when the width crosses the threshold.
		// Also re-renders when the threshold is crossed, for what render() itself
		// sizes by layout (the number of page buttons), not just CSS.
		const resizeObserver = new ResizeObserver(() => {
			const narrow = this.isNarrowLayout();
			if (narrow === this.contentEl.hasClass("is-narrow")) return;
			this.contentEl.toggleClass("is-narrow", narrow);
			void this.render({ keepScroll: true });
		});
		resizeObserver.observe(this.contentEl);
		this.register(() => resizeObserver.disconnect());
		this.registerEvent(
			internalVault(this.app).on("config-changed", (key) => {
				// Only affects the is-readable-line-width CSS class — no need to
				// rescan every note in scope for a purely visual toggle.
				if (key === "readableLineLength") void this.render({ keepScroll: true });
			})
		);
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.markdownComponent.unload();
	}

	private isNarrowLayout(): boolean {
		return this.contentEl.clientWidth < NARROW_LAYOUT_MAX_WIDTH;
	}

	private isReadableLineWidthEnabled(): boolean {
		return Boolean(internalVault(this.app).getConfig("readableLineLength"));
	}

	private renderFilterPill(container: HTMLElement, label: string, clearLabel: string, onClear: () => void): void {
		const pill = container.createDiv({ cls: "notes-list-filter-pill" });
		pill.createSpan({ text: label });
		const clearButton = pill.createEl("button", {
			cls: "notes-list-filter-pill-clear",
			attr: { "aria-label": clearLabel, type: "button" },
		});
		setIcon(clearButton, "x");
		clearButton.addEventListener("click", onClear);
	}

	// folderPath is already normalized (see normalizeOptionalPath() in main.ts —
	// applied both when the setting is edited and on every plugin load, so a
	// value saved before that normalization existed still gets cleaned up).
	private getNotesInScope(): TFile[] {
		const { folderPath, includeSubfolders } = this.plugin.settings;

		return this.app.vault.getMarkdownFiles().filter((file) => {
			if (folderPath === "") return true;
			if (includeSubfolders) {
				return file.path === folderPath || file.path.startsWith(folderPath + "/");
			}
			return file.parent?.path === folderPath;
		});
	}

	private resolveDate(file: TFile, cache: CachedMetadata | null): Moment {
		const fm = cache?.frontmatter;

		const timestamp = fm?.timestamp ? parseDatetime(fm.timestamp) : null;
		if (timestamp?.isValid()) return timestamp;

		// Legacy fallback for notes written before "timestamp" replaced the old,
		// separate "date"/"time" fields: only "date" is still read, and only as a
		// date (never with a time-of-day) — "time" itself is no longer read at
		// all. parseDatetime() already resolves a date-only value to local
		// midnight on its own (see below), so there's nothing extra to do here.
		const date = fm?.date ? parseDatetime(fm.date) : null;
		if (date?.isValid()) return date;

		return moment(file.stat.mtime);
	}

	// Full data reload: re-scans every note in scope (metadata, date, tags) —
	// the only expensive step, so it's kept out of render() (see cachedEntries).
	// Call this when the note set or its metadata might have changed (vault
	// events, settings changes, initial open); call render() directly for
	// anything that only changes UI state.
	async refresh(): Promise<void> {
		this.rebuildEntries();
		const files = this.cachedEntries.map((entry) => entry.file);
		if (this.searchMatches) {
			// A search is active: bring the index up to date (normally just the
			// note(s) that triggered this refresh) and re-run it, so the results
			// reflect the edit instead of going stale.
			await this.searchIndex.update(files);
			this.searchMatches = this.searchIndex.search(files, parseSearchQuery(this.searchQuery));
		} else {
			// Otherwise keep the index warm in the background — on first open
			// this reads every note once — so a search submitted later only
			// has to scan memory. Not awaited: rendering the list never waits
			// on it.
			void this.searchIndex.update(files);
		}
		await this.render({ keepScroll: true });
	}

	focusSearch(): void {
		if (this.searchInputEl?.isConnected) {
			this.searchInputEl.focus();
			this.searchInputEl.select();
		} else {
			this.pendingSearchFocus = true;
		}
	}

	private async runSearch(query: string): Promise<void> {
		const terms = parseSearchQuery(query);
		this.currentPage = 1;
		if (terms.length === 0) {
			this.clearSearch();
			return;
		}
		this.searchQuery = query.trim();
		this.searchDraft = this.searchQuery;
		const files = this.cachedEntries.map((entry) => entry.file);
		// Usually a no-op: the background pre-warm from refresh() has already
		// indexed everything, and only notes changed since then get re-read.
		await this.searchIndex.update(files);
		this.searchMatches = this.searchIndex.search(files, terms);
		await this.render();
	}

	private clearSearch(): void {
		this.searchQuery = "";
		this.searchDraft = "";
		this.searchMatches = null;
		this.currentPage = 1;
		void this.render();
	}

	private rebuildEntries(): void {
		this.cachedEntries = this.getNotesInScope().map((file) => {
			const cache = this.app.metadataCache.getFileCache(file);
			return {
				file,
				date: this.resolveDate(file, cache),
				tags: cache ? getAllTags(cache) ?? [] : [],
				pinned: cache?.frontmatter?.pinned === true,
				tasks: countTasks(cache?.listItems),
			};
		});
		this.cachedEntries.sort((a, b) => b.date.valueOf() - a.date.valueOf());
	}

	// keepScroll: for rebuilds the user didn't navigate into (vault events,
	// settings, resizes), which must leave the list where it was. Rebuilding
	// empties contentEl, which would otherwise snap the scroll back to the top.
	// Navigation (page, filters, search) leaves it off and lands at the top.
	private async render({ keepScroll = false }: { keepScroll?: boolean } = {}): Promise<void> {
		// Unload whatever the *previous* render() pass registered against its
		// now-discarded DOM (see the field comment above) before this pass's
		// renderEntry() calls start registering against a fresh one.
		this.markdownComponent.unload();
		this.markdownComponent = new Component();

		const { notesPerPage } = this.plugin.deviceSettings();
		const allEntries = this.cachedEntries;

		const filteredEntries = allEntries.filter((entry) => {
			const matchesTag = !this.selectedTag || noteMatchesTagFilter(entry.tags, this.selectedTag);
			const matchesTasks = !this.selectedTaskFilter || noteMatchesTaskFilter(entry.tasks, this.selectedTaskFilter);
			const matchesDate = !this.selectedDate || entry.date.format("YYYY-MM-DD") === this.selectedDate;
			const matchesMonth = !this.selectedMonth || entry.date.format("YYYY-MM") === this.selectedMonth;
			const matchesSearch = !this.searchMatches || this.searchMatches.has(entry.file.path);
			return matchesTag && matchesTasks && matchesDate && matchesMonth && matchesSearch;
		});

		// Pinned notes float to the top, each group still newest-first: allEntries
		// is already sorted by date desc, and Array#filter is stable, so simply
		// partitioning it (rather than re-sorting) preserves that order within
		// both groups.
		const visibleEntries = [
			...filteredEntries.filter((entry) => entry.pinned),
			...filteredEntries.filter((entry) => !entry.pinned),
		];

		const previousInput = this.searchInputEl;
		const searchFocus =
			previousInput && previousInput.ownerDocument.activeElement === previousInput
				? { start: previousInput.selectionStart, end: previousInput.selectionEnd }
				: null;

		const container = this.contentEl;
		const previousScrollTop = container.scrollTop;
		const previousHeight = container.scrollHeight;
		container.empty();
		container.addClass("notes-list-view");
		// Set here as well as by the ResizeObserver, so the CSS always matches
		// the structure this pass builds (see `sidebar` below), first pass
		// included; the observer then only re-renders when the threshold is
		// actually crossed.
		const narrow = this.isNarrowLayout();
		container.toggleClass("is-narrow", narrow);

		const layout = container.createDiv({ cls: "notes-list-layout" });
		// Holds the previous height while the note bodies fill in (they render
		// asynchronously, below): without it the list would briefly be too short
		// to keep the old scroll position, and the browser would clamp it.
		if (keepScroll) layout.setCssStyles({ minHeight: `${previousHeight}px` });
		const mainEl = layout.createDiv({ cls: "notes-list-main" });
		// Where the sidebar's blocks (search, heatmap, filters, tags, tasks) go:
		// their own column, or, in the narrow layout, straight into the layout
		// column next to the notes, where CSS `order` sequences them. Choosing
		// the parent here replaces a `display: contents` sidebar, which the
		// community review flags as only partially supported.
		const sidebar = narrow ? layout : layout.createDiv({ cls: "notes-list-heatmap-panel" });

		mainEl.toggleClass("is-readable-line-width", this.isReadableLineWidthEnabled());

		const header = mainEl.createDiv({ cls: "notes-list-header" });
		const titleGroup = header.createDiv({ cls: "notes-list-header-title-group" });
		// Notes / Tasks switch, in place of a plain "Notes" title.
		const modeSwitch = titleGroup.createDiv({ cls: "notes-list-mode-switch", attr: { role: "group" } });
		for (const [mode, label] of [
			["notes", t("view.modeNotes")],
			["tasks", t("view.modeTasks")],
		] as const) {
			const button = modeSwitch.createEl("button", {
				text: label,
				cls: "notes-list-mode-button" + (mode === this.mode ? " is-active" : ""),
				attr: { type: "button", "aria-pressed": String(mode === this.mode) },
			});
			button.addEventListener("click", () => {
				if (mode === this.mode) return;
				this.mode = mode;
				this.currentPage = 1;
				void this.render();
			});
		}

		// Two columns only: the narrow layout hides it in favor of the icon-only
		// button next to search (see renderSearchForm()).
		const newNoteButton = header.createEl("button", {
			cls: "notes-list-new-note-button",
			attr: { type: "button" },
		});
		setIcon(newNoteButton.createSpan({ cls: "notes-list-new-note-button-icon" }), "plus");
		newNoteButton.createSpan({ text: t("view.newNote") });
		newNoteButton.addEventListener("click", () => void this.plugin.createUniqueNote());

		// Awaited only at the very end, after the sidebar is built: each note's
		// content fill is the slow, async part of render(), and the search field
		// shouldn't vanish from under the user's cursor while it runs.
		let noteRenders: Promise<void>[] = [];
		if (this.mode === "tasks") {
			noteRenders = [this.renderOpenTasks(mainEl, visibleEntries)];
		} else if (visibleEntries.length === 0) {
			mainEl.createEl("p", {
				text: this.buildEmptyMessage(),
				cls: "notes-list-empty",
			});
		} else {
			const totalPages = Math.max(1, Math.ceil(visibleEntries.length / notesPerPage));
			this.currentPage = Math.min(Math.max(1, this.currentPage), totalPages);

			// Only the current page's notes get their content read from disk and
			// rendered as Markdown — the expensive part. allEntries/visibleEntries
			// above only ever hold TFile references plus already-cached metadata
			// (date, tags), so scanning a large folder to paginate it stays cheap.
			const pageStart = (this.currentPage - 1) * notesPerPage;
			const pageEntries = visibleEntries.slice(pageStart, pageStart + notesPerPage);

			// Each renderEntry() call creates its own item/contentEl synchronously
			// before its first await, so calling it inside this loop (rather than
			// awaiting one at a time) still appends it to mainEl in page order —
			// only the async content-fill inside each one finishes out of order.
			// Group headers are inserted the same way, synchronously, between
			// entries whose group differs from the one before it — recomputed
			// fresh for every page rather than carried over from the previous one,
			// so a group that spans a page boundary shows its header again at the
			// top of the next page instead of tracking cross-page continuity.
			// Pinned entries are skipped entirely (no header, and they don't count
			// towards lastGroup either): they already float to their own spot at
			// the top regardless of date, so grouping them by date alongside would
			// either show a header out of order (an old pinned note ahead of
			// today's) or force the *next*, unpinned entry to repeat a header it
			// already showed above the pinned block.
			const renders: Promise<void>[] = [];
			let lastGroup: string | null = null;
			for (const entry of pageEntries) {
				if (this.plugin.deviceSettings().showDateGroups && !entry.pinned) {
					const group = dateGroupLabel(entry.date);
					if (group !== lastGroup) {
						mainEl.createDiv({ cls: "notes-list-date-group-header", text: group });
						lastGroup = group;
					}
				}
				renders.push(this.renderEntry(mainEl, entry));
			}
			noteRenders = renders;

			this.renderPagination(mainEl, totalPages);
		}

		this.renderSearchForm(sidebar, searchFocus);

		const activityPanel = sidebar.createDiv({ cls: "notes-list-activity" });
		activityPanel.createEl("h4", { text: t("view.activity"), cls: "notes-list-panel-title" });
		const heatmapSelection: HeatmapSelection = {
			selectedDate: this.selectedDate,
			onSelectDate: (date) => {
				this.selectedDate = date;
				this.currentPage = 1;
				void this.render();
			},
			selectedMonth: this.selectedMonth,
			onSelectMonth: (month) => {
				this.selectedMonth = month;
				this.currentPage = 1;
				void this.render();
			},
		};
		renderHeatmap(
			activityPanel.createDiv(),
			allEntries.map((e) => e.date),
			visibleEntries.length,
			heatmapSelection
		);

		// Always present (not just when a filter is active) and with a real
		// pill's worth of markup inside even when empty, so its height is
		// reserved and the Tags section below never shifts when a filter is
		// toggled on/off. When nothing is selected, that placeholder pill is
		// just hidden via CSS (.is-empty) rather than left out of the DOM.
		const hasActiveFilter = Boolean(
			this.selectedTag || this.selectedTaskFilter || this.selectedDate || this.selectedMonth || this.searchMatches
		);
		const activeFilters = sidebar.createDiv({ cls: "notes-list-active-filters" });
		activeFilters.toggleClass("is-empty", !hasActiveFilter);

		for (const filter of this.activeFilters()) {
			this.renderFilterPill(activeFilters, filter.label, filter.clearLabel, filter.clear);
		}

		if (!hasActiveFilter) {
			this.renderFilterPill(activeFilters, "placeholder", "", () => {});
		}

		const expandLevel = this.plugin.deviceSettings().tagTreeExpandLevel;
		if (expandLevel !== this.appliedTagTreeExpandLevel) {
			this.tagCollapseOverrides.clear();
			this.appliedTagTreeExpandLevel = expandLevel;
		}
		this.renderFilterSections(sidebar, narrow, [
			{
				title: t("view.tags"),
				cls: "notes-tag-panel",
				collapsed: this.tagPanelCollapsed,
				setCollapsed: (collapsed) => (this.tagPanelCollapsed = collapsed),
				renderContent: (el) =>
					renderTagTree(
						el,
						buildTagTree(allEntries.map((e) => e.tags)),
						allEntries.filter((e) => e.tags.length === 0).length,
						this.selectedTag,
						(path, depth) => this.tagCollapseOverrides.get(path) ?? isCollapsedByDefault(depth, expandLevel),
						(filter) => {
							this.selectedTag = filter;
							this.currentPage = 1;
							// Fold the section back in the narrow layout, so the filtered
							// list is right there; its filter pill stays visible above.
							this.tagPanelCollapsed = true;
							void this.render();
						},
						(path, collapsed) => {
							this.tagCollapseOverrides.set(path, collapsed);
							void this.render();
						}
					),
			},
			{
				title: t("view.tasks"),
				cls: "notes-task-panel",
				collapsed: this.taskPanelCollapsed,
				setCollapsed: (collapsed) => (this.taskPanelCollapsed = collapsed),
				renderContent: (el) => this.renderTaskFilters(el, allEntries),
			},
		]);

		if (keepScroll) container.scrollTop = previousScrollTop;

		await Promise.all(noteRenders);

		// Content is in: release the held height. The position stays, unless the
		// list is now genuinely shorter, in which case it settles at the end.
		if (keepScroll) layout.setCssStyles({ minHeight: "" });
	}

	// Writes a checkbox click in a rendered note body back to the note: the
	// renderer draws working checkboxes, but persisting them is up to whoever
	// hosts the output (Obsidian's reading view does its own). The n-th
	// checkbox rendered is the n-th task in the file: the list shows the note's
	// beginning (a preview only cuts the end) and stripInlineTags() never drops
	// a task line, so the rendered tasks are always a prefix of the note's,
	// whose lines metadataCache already knows. Checkboxes inside an embedded
	// note belong to another file, so they're left out of the count and
	// clicking them does nothing. The line is checked to still be a task before
	// writing; otherwise nothing is written and the click is undone. Toggling
	// never changes the number of lines, so positions stay valid across clicks
	// even before the cache catches up. The write's own vault events refresh
	// the list (keeping its scroll position) and the task counts.
	private async toggleTask(file: TFile, contentEl: HTMLElement, checkbox: HTMLInputElement): Promise<void> {
		const checked = checkbox.checked;
		const undo = () => {
			checkbox.checked = !checked;
		};
		if (checkbox.closest(".internal-embed")) {
			undo();
			return;
		}

		const ownCheckboxes = Array.from(contentEl.querySelectorAll("input.task-list-item-checkbox")).filter(
			(el) => !el.closest(".internal-embed")
		);
		const index = ownCheckboxes.indexOf(checkbox);
		const taskLines = (this.app.metadataCache.getFileCache(file)?.listItems ?? [])
			.filter((item) => item.task !== undefined)
			.map((item) => item.position.start.line)
			.sort((a, b) => a - b);
		const line = taskLines[index];
		if (index === -1 || line === undefined) {
			undo();
			return;
		}

		await this.writeTaskState(file, line, checkbox);
	}

	// Saves a task checkbox's new state to line `line` of `file`, shared by the
	// notes list (toggleTask()) and the open-tasks view. setTaskLineChecked()
	// refuses unless the line is a task currently in the opposite state; then
	// nothing is written, the checkbox is reverted and a Notice says why. The
	// write's own vault events refresh the view.
	private async writeTaskState(file: TFile, line: number, checkbox: HTMLInputElement): Promise<void> {
		const checked = checkbox.checked;
		let written = false;
		try {
			await this.app.vault.process(file, (data) => {
				const lines = data.split("\n");
				const updated = lines[line] === undefined ? null : setTaskLineChecked(lines[line], checked);
				if (updated === null) return data;
				lines[line] = updated;
				written = true;
				return lines.join("\n");
			});
		} catch (error) {
			console.error("Notes List: could not update the task", error);
		}
		if (!written) {
			checkbox.checked = !checked;
			new Notice(t("view.taskUpdateFailed"));
		}
	}

	// A note's open tasks, for OpenTaskIndex: task lines from Obsidian's
	// metadata, their text from the file. Each is grouped by its own tags when
	// it has some, else by the note's own (frontmatter, plus inline tags off any
	// task line); both from Obsidian's index, so tags are recognized exactly as
	// Obsidian does.
	private async extractOpenTasks(file: TFile): Promise<IndexedTask[]> {
		const cache = this.app.metadataCache.getFileCache(file);
		const taskItems = (cache?.listItems ?? []).filter((item) => item.task !== undefined);
		const openItems = taskItems.filter((item) => isOpenTaskStatus(item.task ?? ""));
		if (openItems.length === 0) return [];
		const inlineTags: LineTag[] = (cache?.tags ?? []).map((t) => ({ tag: t.tag, line: t.position.start.line }));
		const byLine = tagsByLine(inlineTags);
		const noteTags = noteLevelTags(
			parseFrontMatterTags(cache?.frontmatter) ?? [],
			inlineTags,
			new Set(taskItems.map((item) => item.position.start.line))
		);
		const lines = (await this.app.vault.cachedRead(file)).split("\n");
		return openItems.map((item) => {
			const line = item.position.start.line;
			return {
				line,
				text: stripInlineTags(taskLineText(lines[line] ?? "")).trim(),
				tags: taskGroupTags(line, byLine, noteTags),
			};
		});
	}

	// The main column in tasks mode: every open task of `entries` (the list's
	// own, already filtered by the sidebar), grouped by the exact combination
	// of its note's tags (groupOpenTasks()). Only notes with open tasks are
	// read. Each group renders as one Markdown task list, so checkboxes, links
	// and formatting are Obsidian's own, and the n-th checkbox is the group's
	// n-th task, whose line is known exactly. No pagination: the list holds
	// tasks, not whole notes.
	private async renderOpenTasks(container: HTMLElement, entries: NoteEntry[]): Promise<void> {
		const listEl = container.createDiv({ cls: "notes-list-open-tasks" });
		// Only notes with open tasks, extracted through the index (re-read only
		// when they change). Notes that left the scope are dropped from it.
		const withTasks = entries.filter((entry) => entry.tasks.open > 0);
		const tasksByPath = await this.openTaskIndex.get(withTasks.map((entry) => entry.file));
		this.openTaskIndex.prune(new Set(this.cachedEntries.map((entry) => entry.file.path)));
		const collected: Array<OpenTask<NoteEntry>> = [];
		withTasks.forEach((entry, noteIndex) => {
			for (const task of tasksByPath.get(entry.file.path) ?? []) {
				collected.push({ ...task, noteIndex, note: entry });
			}
		});
		const groups = groupOpenTasks(collected);
		if (groups.length === 0) {
			const filters = this.activeFilters();
			listEl.createEl("p", {
				text:
					filters.length === 0
						? t("tasksView.empty")
						: t("tasksView.emptyFiltered", { filters: filters.map((f) => f.label).join(", ") }),
				cls: "notes-list-empty",
			});
			return;
		}

		const renders: Promise<void>[] = [];
		for (const group of groups) {
			const groupEl = listEl.createDiv({ cls: "notes-list-task-group" });
			const header = groupEl.createDiv({ cls: "notes-list-task-group-header" });
			header.createSpan({ text: group.tags.length > 0 ? group.tags.join(" + ") : t("tags.untagged") });
			header.createSpan({ text: tn("tasksView.groupCount", group.tasks.length), cls: "notes-list-task-group-count" });
			const body = groupEl.createDiv({ cls: "notes-list-content markdown-rendered" });
			body.addEventListener("click", (evt) => {
				const target = evt.target;
				if (!(target instanceof HTMLInputElement) || !target.matches("input.task-list-item-checkbox")) return;
				const own = Array.from(body.querySelectorAll("input.task-list-item-checkbox")).filter(
					(el) => !el.closest(".internal-embed")
				);
				const task = group.tasks[own.indexOf(target)];
				if (!task || target.closest(".internal-embed")) {
					target.checked = !target.checked;
					return;
				}
				void this.writeTaskState(task.note.file, task.line, target);
			});
			const markdown = group.tasks.map((task) => `- [ ] ${task.text}`).join("\n");
			renders.push(
				MarkdownRenderer.render(this.app, markdown, body, group.tasks[0].note.file.path, this.markdownComponent).then(
					() => {
						// The note each task comes from, as a link at the end of its row.
						const rows = Array.from(body.querySelectorAll("li.task-list-item")).filter(
							(li) => !li.closest(".internal-embed")
						);
						rows.forEach((row, index) => {
							const task = group.tasks[index];
							if (!task) return;
							const { file, date } = task.note;
							const label =
								date.format("YYYY-MM-DD HH:mm") + (this.shouldShowNoteName(file) ? ` · ${file.basename}` : "");
							const link = row.createEl("a", {
								text: label,
								cls: "notes-list-task-source internal-link",
								href: file.path,
								attr: { "aria-label": t("tasksView.openNote", { note: file.basename }) },
							});
							link.addEventListener("click", (evt) => {
								evt.preventDefault();
								void this.app.workspace.getLeaf(evt.ctrlKey || evt.metaKey).openFile(file);
							});
						});
					}
				)
			);
		}
		await Promise.all(renders);
	}

	// The sidebar's filter sections (Tags, Tasks), all built the same way. In
	// two columns each is one panel, its title above its content. In the
	// narrow layout the titles become foldable headers side by side, half the
	// width each, in a two-column grid, and an expanded section's content comes
	// below them at full width (several stack if several are open). Header and
	// content are separate elements there, which is why this builds the DOM
	// per layout rather than leaving it to CSS. Both reuse the tag tree's
	// panel classes, so they look the same.
	private renderFilterSections(
		sidebar: HTMLElement,
		narrow: boolean,
		sections: Array<{
			title: string;
			cls: string;
			collapsed: boolean;
			setCollapsed: (collapsed: boolean) => void;
			renderContent: (el: HTMLElement) => void;
		}>
	): void {
		const renderTitle = (parent: HTMLElement, title: string) => {
			const header = parent.createDiv({ cls: "notes-tag-tree-header" });
			header.createEl("h4", { text: title, cls: "notes-list-panel-title" });
			return header;
		};

		if (!narrow) {
			for (const section of sections) {
				const panel = sidebar.createDiv({ cls: `notes-tag-tree-panel ${section.cls}` });
				renderTitle(panel, section.title);
				section.renderContent(panel.createDiv({ cls: "notes-tag-tree" }));
			}
			return;
		}

		const grid = sidebar.createDiv({ cls: "notes-list-filter-sections" });
		for (const section of sections) {
			const box = grid.createDiv({ cls: `notes-tag-tree-panel notes-filter-section-header ${section.cls}` });
			box.toggleClass("is-collapsed", section.collapsed);
			const header = renderTitle(box, section.title);
			setIcon(header.createSpan({ cls: "notes-tag-tree-header-toggle" }), "chevron-down");
			header.addEventListener("click", () => {
				section.setCollapsed(!section.collapsed);
				void this.render();
			});
		}
		for (const section of sections) {
			if (section.collapsed) continue;
			const box = grid.createDiv({ cls: `notes-tag-tree-panel notes-filter-section-content ${section.cls}` });
			section.renderContent(box.createDiv({ cls: "notes-tag-tree" }));
		}
	}

	// The Tasks section's content: one entry per TASK_FILTERS choice, with its
	// note count across every note in scope (like the tag counts), in the tag
	// tree's row markup.
	private renderTaskFilters(container: HTMLElement, allEntries: NoteEntry[]): void {
		const list = container.createEl("ul", { cls: "notes-tag-tree-list" });
		for (const filter of TASK_FILTERS) {
			const label = t(`tasks.${filter}` as const);
			const count = allEntries.filter((e) => noteMatchesTaskFilter(e.tasks, filter)).length;
			const row = list.createEl("li", { cls: "notes-tag-tree-item" }).createDiv({ cls: "notes-tag-tree-row" });
			row.createSpan({ cls: "notes-tag-tree-toggle" });
			const labelEl = row.createSpan({
				cls: "notes-tag-tree-label" + (filter === this.selectedTaskFilter ? " is-selected" : ""),
			});
			labelEl.createSpan({ text: label });
			labelEl.createSpan({ text: ` (${count})`, cls: "notes-tag-tree-count" });
			labelEl.addEventListener("click", () => {
				this.selectedTaskFilter = filter;
				this.currentPage = 1;
				this.taskPanelCollapsed = true;
				void this.render();
			});
		}
	}

	// Runs only on submit (the button, or Enter in the field), never while
	// typing: each search is one in-memory scan plus a full render(), so it's
	// triggered deliberately rather than on every keystroke.
	private renderSearchForm(
		container: HTMLElement,
		restoreFocus: { start: number | null; end: number | null } | null
	): void {
		const form = container.createEl("form", { cls: "notes-list-search" });
		const inputContainer = form.createDiv({ cls: "search-input-container" });
		const input = inputContainer.createEl("input", {
			type: "search",
			placeholder: t("view.searchPlaceholder"),
			value: this.searchDraft,
			attr: { "aria-label": t("view.searchPlaceholder"), enterkeyhint: "search", spellcheck: "false" },
		});
		input.addEventListener("input", () => {
			this.searchDraft = input.value;
		});
		this.searchInputEl = input;
		if (restoreFocus) {
			input.focus();
			input.setSelectionRange(restoreFocus.start, restoreFocus.end);
		} else if (this.pendingSearchFocus) {
			this.pendingSearchFocus = false;
			this.focusSearch();
		}
		// Both a label and a magnifier icon: CSS shows the label in the two-column
		// layout and only the icon in the narrow one (.is-narrow).
		const searchButton = form.createEl("button", {
			cls: "notes-list-search-button",
			attr: { type: "submit", "aria-label": t("view.search") },
		});
		setIcon(searchButton.createSpan({ cls: "notes-list-search-button-icon" }), "search");
		searchButton.createSpan({ text: t("view.search"), cls: "notes-list-search-button-label" });
		// The narrow layout's "new note" button, next to the search button
		// (hidden in two columns, where the notes header has its own).
		const newNoteButton = form.createEl("button", {
			cls: "notes-list-search-new-note",
			attr: { type: "button", "aria-label": t("view.newNote") },
		});
		setIcon(newNoteButton, "plus");
		newNoteButton.addEventListener("click", () => void this.plugin.createUniqueNote());
		form.addEventListener("submit", (evt) => {
			evt.preventDefault();
			void this.runSearch(input.value);
		});
	}

	// The active filters, each with its pill label and how to clear it: shared
	// by the pills and by the empty-list message, so both always agree.
	private activeFilters(): Array<{ label: string; clearLabel: string; clear: () => void }> {
		const resetTo = (reset: () => void) => () => {
			reset();
			this.currentPage = 1;
			void this.render();
		};
		const filters: Array<{ label: string; clearLabel: string; clear: () => void }> = [];
		if (this.searchMatches) {
			filters.push({ label: `"${this.searchQuery}"`, clearLabel: t("view.clearSearch"), clear: () => this.clearSearch() });
		}
		if (this.selectedTag) {
			filters.push({
				label: this.selectedTag === UNTAGGED ? t("tags.untagged") : `#${this.selectedTag}`,
				clearLabel: t("view.clearTag"),
				clear: resetTo(() => (this.selectedTag = null)),
			});
		}
		if (this.selectedTaskFilter) {
			filters.push({
				label: t(`tasks.pill.${this.selectedTaskFilter}` as const),
				clearLabel: t("view.clearTasks"),
				clear: resetTo(() => (this.selectedTaskFilter = null)),
			});
		}
		if (this.selectedDate) {
			filters.push({
				label: moment(this.selectedDate).format("D MMM YYYY"),
				clearLabel: t("view.clearDate"),
				clear: resetTo(() => (this.selectedDate = null)),
			});
		}
		if (this.selectedMonth) {
			filters.push({
				label: moment(this.selectedMonth, "YYYY-MM").format("MMMM YYYY"),
				clearLabel: t("view.clearMonth"),
				clear: resetTo(() => (this.selectedMonth = null)),
			});
		}
		return filters;
	}

	// One whole sentence per case, listing the same labels as the pills,
	// rather than a sentence assembled from fragments, which wouldn't
	// translate (word order and agreement differ between languages).
	private buildEmptyMessage(): string {
		const filters = this.activeFilters();
		if (filters.length === 0) return t("view.emptyFolder");
		return t("view.emptyFiltered", { filters: filters.map((f) => f.label).join(", ") });
	}

	private renderPagination(container: HTMLElement, totalPages: number): void {
		if (totalPages <= 1) return;

		const nav = container.createDiv({ cls: "notes-list-pagination" });
		// An icon-only jump button. First/previous show only off the first page,
		// next/last only off the last one, like the old prev/next pair.
		const jumpButton = (icon: string, label: string, page: number) => {
			const button = nav.createEl("button", {
				cls: "notes-list-page-button",
				attr: { type: "button", "aria-label": label },
			});
			setIcon(button, icon);
			button.addEventListener("click", () => this.goToPage(page));
		};

		if (this.currentPage > 1) {
			jumpButton("chevrons-left", t("view.firstPage"), 1);
			jumpButton("chevron-left", t("view.previousPage"), this.currentPage - 1);
		}

		// Fewer in the single-column layout, where 10 wouldn't fit on one row.
		const maxVisiblePages = this.isNarrowLayout() ? 5 : 10;
		let start = Math.max(1, this.currentPage - Math.floor(maxVisiblePages / 2));
		const end = Math.min(totalPages, start + maxVisiblePages - 1);
		start = Math.max(1, end - maxVisiblePages + 1);

		for (let page = start; page <= end; page++) {
			const button = nav.createEl("button", {
				text: String(page),
				cls: "notes-list-page-button" + (page === this.currentPage ? " is-active" : ""),
				attr: { type: "button" },
			});
			button.addEventListener("click", () => this.goToPage(page));
		}

		if (this.currentPage < totalPages) {
			jumpButton("chevron-right", t("view.nextPage"), this.currentPage + 1);
			jumpButton("chevrons-right", t("view.lastPage"), totalPages);
		}
	}

	private goToPage(page: number): void {
		this.currentPage = page;
		void this.render();
	}

	private shouldShowNoteName(file: TFile): boolean {
		switch (this.plugin.deviceSettings().showNoteName) {
			case "always":
				return true;
			case "whenDifferent":
				return !isUniqueNoteName(file.basename, this.plugin.uniqueNoteNameFormat());
			case "never":
			default:
				return false;
		}
	}

	// The global "Content display" setting, unless a note overrides it with its
	// own content-display: full/preview frontmatter property.
	// The note's own "content-display" frontmatter override, if it's a valid
	// mode (see previewBody() for how it ranks against the rest).
	private contentDisplayOverride(fm: Record<string, unknown> | undefined): ContentDisplayMode | null {
		const override = fm?.["content-display"];
		return override === "full" || override === "preview" ? override : null;
	}

	private async togglePin(entry: NoteEntry, file: TFile): Promise<void> {
		const next = !entry.pinned;
		await this.plugin.setPinned(file, next);
		// Update the cached entry in place rather than re-scanning: Obsidian's
		// metadataCache re-parses the frontmatter write asynchronously, so
		// re-reading it immediately after could still see the old value.
		entry.pinned = next;
		// Pinning/unpinning reorders visibleEntries (pinned notes float to the
		// top), same as any other action that reorders or refilters the list,
		// so it resets to page 1 for consistency with those.
		this.currentPage = 1;
		void this.render();
	}

	private async renderEntry(container: HTMLElement, entry: NoteEntry): Promise<void> {
		const { file, date } = entry;
		const item = container.createDiv({ cls: "notes-list-item" + (entry.pinned ? " is-pinned" : "") });

		const itemHeader = item.createDiv({ cls: "notes-list-item-header" });

		const openNote = (evt: MouseEvent) => {
			void this.app.workspace.getLeaf(evt.ctrlKey || evt.metaKey).openFile(file);
		};

		const link = itemHeader.createEl("a", {
			text: date.format("YYYY-MM-DD HH:mm"),
			cls: "notes-list-datetime internal-link",
			href: file.path,
		});
		link.addEventListener("click", (evt) => {
			evt.preventDefault();
			openNote(evt);
		});

		// Completed out of open + completed tasks ("2/5"), cancelled ones left
		// out of both; only when there's something to count. Pushed right, next
		// to the pin button, by margin-left: auto (see styles.css).
		const { open, done } = entry.tasks;
		if (open + done > 0) {
			const taskCount = itemHeader.createSpan({
				cls: "notes-list-task-count",
				attr: { "aria-label": tn("view.taskCounter", open + done, { done }) },
			});
			setIcon(taskCount.createSpan({ cls: "notes-list-task-count-icon" }), "list-checks");
			taskCount.createSpan({ text: `${done}/${open + done}` });
		}

		// "clickable-icon" is Obsidian's own convention for icon-only buttons —
		// adding it (and using "is-active" for the pinned state, also Obsidian's
		// own convention) gets the muted/bold-on-hover/accent-when-active states
		// from Obsidian's own app.css almost for free, instead of fighting its
		// generic button reset (see styles.css for why that fight needed
		// !important before this).
		const pinButton = itemHeader.createEl("button", {
			cls: "notes-list-pin-button clickable-icon" + (entry.pinned ? " is-active" : ""),
			attr: { "aria-label": t(entry.pinned ? "view.unpinNote" : "view.pinNote"), type: "button" },
		});
		setIcon(pinButton, "bookmark");
		// A plain (non-async) callback, deliberately: addEventListener's own
		// listener type expects a void return, not a Promise — an async
		// function passed directly there would still run, but its rejection
		// (if setPinned ever throws) would go entirely unhandled. Delegating to
		// an async method and voiding *that* call keeps the same fire-and-forget
		// behavior while making the "not awaiting this on purpose" explicit.
		pinButton.addEventListener("click", () => void this.togglePin(entry, file));

		if (this.shouldShowNoteName(file)) {
			// Opens on double-click too, like the body below (plain text, so no
			// links or buttons to step around).
			const title = item.createDiv({ text: file.basename, cls: "notes-list-title" });
			title.addEventListener("dblclick", openNote);
		}

		// "markdown-rendered" is the class Obsidian's own reading view puts on
		// rendered Markdown: its app.css scopes table, code block (pre/code) and
		// copy-code-button styles under it (".markdown-rendered table", etc.), so
		// without it MarkdownRenderer's output falls back to bare browser styles.
		const contentEl = item.createDiv({ cls: "notes-list-content markdown-rendered" });
		contentEl.addEventListener("dblclick", (evt) => {
			// Don't also open *this* note over a link or button the rendered body
			// already handles its own way (e.g. an internal link to some other
			// note, an external URL, or a code block's copy button) — only open on
			// a double-click that lands on plain body content.
			if ((evt.target as HTMLElement).closest("a, button, input")) return;
			openNote(evt);
		});
		contentEl.addEventListener("click", (evt) => {
			const target = evt.target;
			if (target instanceof HTMLInputElement && target.matches("input.task-list-item-checkbox")) {
				void this.toggleTask(file, contentEl, target);
			}
		});

		// "Continue reading": filled in below, once the body is known to be cut.
		// Created here, before the first await, so it stays between the content
		// and the tags row.
		const readMoreSlot = item.createDiv({ cls: "notes-list-read-more-slot" });

		// The note's tags, from the frontmatter and the body alike, in a row of
		// their own below the content (the body's inline tags are stripped from
		// the text below). Created before the first await so it stays in place
		// after the content. Clicking one filters the list by it, like the tag
		// tree. "tag" is Obsidian's own class for a rendered tag pill.
		const tags = uniqueTags(entry.tags);
		if (tags.length > 0) {
			const tagRow = item.createDiv({ cls: "notes-list-tags" });
			for (const tag of tags) {
				const tagEl = tagRow.createEl("a", { text: tag, cls: "tag", href: tag });
				tagEl.addEventListener("click", (evt) => {
					evt.preventDefault();
					this.selectedTag = tag.replace(/^#/, "");
					this.currentPage = 1;
					this.tagPanelCollapsed = true;
					void this.render();
				});
			}
		}

		const raw = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		// Tags stripped before truncating, so the preview length counts text.
		const body = stripInlineTags(stripFrontmatter(raw)).trim();

		const { contentDisplay, previewLength } = this.plugin.deviceSettings();
		const preview = previewBody(body, this.contentDisplayOverride(cache?.frontmatter), contentDisplay, previewLength);

		// A cut note gets an explicit link to the rest, so the cut is obvious
		// rather than a "…" that's easy to miss. Same openNote() as the date
		// link and the double-click.
		if (preview.truncated) {
			const link = readMoreSlot.createEl("a", {
				cls: "notes-list-read-more",
				href: file.path,
			});
			link.createSpan({ text: t("view.readMore") });
			setIcon(link.createSpan({ cls: "notes-list-read-more-icon" }), "arrow-right");
			link.addEventListener("click", (evt) => {
				evt.preventDefault();
				openNote(evt);
			});
		} else {
			readMoreSlot.remove();
		}

		await MarkdownRenderer.render(this.app, preview.text, contentEl, file.path, this.markdownComponent);
	}
}
