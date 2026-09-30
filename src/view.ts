import {
	App,
	CachedMetadata,
	Component,
	EventRef,
	ItemView,
	MarkdownRenderer,
	Scope,
	TFile,
	WorkspaceLeaf,
	getAllTags,
	setIcon,
} from "obsidian";
import type NotesListPlugin from "./main";
import type { ContentDisplayMode, TagTreeExpandLevel } from "./settings";
import { renderHeatmap, type HeatmapSelection } from "./heatmap";
import {
	buildTagTree,
	isCollapsedByDefault,
	noteMatchesTagFilter,
	renderTagTree,
	UNTAGGED,
	type TagFilter,
} from "./tagTree";
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
export function truncateMarkdown(body: string, maxLength: number): string {
	if (body.length <= maxLength) return body;

	const block = findUnbreakableBlocks(body).find(([start, end]) => start < maxLength && maxLength < end);
	if (!block) return body.slice(0, maxLength).trimEnd() + "…";

	const blockEnd = block[1];
	if (body.slice(blockEnd).trim() === "") return body;
	return body.slice(0, blockEnd).trimEnd() + "\n\n…";
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
	if (date.isSameOrAfter(today, "day")) return "Today";
	if (date.isSame(today.clone().subtract(1, "day"), "day")) return "Yesterday";
	if (date.isSameOrAfter(today.clone().startOf("week"), "day")) return "This week";
	return "Older";
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
		return "Notes list";
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
		const resizeObserver = new ResizeObserver(() => {
			this.contentEl.toggleClass("is-narrow", this.isNarrowLayout());
		});
		resizeObserver.observe(this.contentEl);
		this.register(() => resizeObserver.disconnect());
		this.registerEvent(
			internalVault(this.app).on("config-changed", (key) => {
				// Only affects the is-readable-line-width CSS class — no need to
				// rescan every note in scope for a purely visual toggle.
				if (key === "readableLineLength") void this.render();
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
		await this.render();
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
			};
		});
		this.cachedEntries.sort((a, b) => b.date.valueOf() - a.date.valueOf());
	}

	private async render(): Promise<void> {
		// Unload whatever the *previous* render() pass registered against its
		// now-discarded DOM (see the field comment above) before this pass's
		// renderEntry() calls start registering against a fresh one.
		this.markdownComponent.unload();
		this.markdownComponent = new Component();

		const { notesPerPage } = this.plugin.deviceSettings();
		const allEntries = this.cachedEntries;

		const filteredEntries = allEntries.filter((entry) => {
			const matchesTag = !this.selectedTag || noteMatchesTagFilter(entry.tags, this.selectedTag);
			const matchesDate = !this.selectedDate || entry.date.format("YYYY-MM-DD") === this.selectedDate;
			const matchesMonth = !this.selectedMonth || entry.date.format("YYYY-MM") === this.selectedMonth;
			const matchesSearch = !this.searchMatches || this.searchMatches.has(entry.file.path);
			return matchesTag && matchesDate && matchesMonth && matchesSearch;
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
		container.empty();
		container.addClass("notes-list-view");

		const layout = container.createDiv({ cls: "notes-list-layout" });
		const mainEl = layout.createDiv({ cls: "notes-list-main" });
		const heatmapPanel = layout.createDiv({ cls: "notes-list-heatmap-panel" });

		mainEl.toggleClass("is-readable-line-width", this.isReadableLineWidthEnabled());

		const header = mainEl.createDiv({ cls: "notes-list-header" });
		const titleGroup = header.createDiv({ cls: "notes-list-header-title-group" });
		titleGroup.createEl("h4", { text: "Notes", cls: "notes-list-panel-title" });

		const newNoteButton = header.createEl("button", {
			cls: "notes-list-new-note-button",
			attr: { "aria-label": "New note", type: "button" },
		});
		setIcon(newNoteButton, "plus");
		newNoteButton.addEventListener("click", () => void this.plugin.createUniqueNote());

		// Awaited only at the very end, after the sidebar is built: each note's
		// content fill is the slow, async part of render(), and the search field
		// shouldn't vanish from under the user's cursor while it runs.
		let noteRenders: Promise<void>[] = [];
		if (visibleEntries.length === 0) {
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

		this.renderSearchForm(heatmapPanel, searchFocus);

		const activityPanel = heatmapPanel.createDiv({ cls: "notes-list-activity" });
		activityPanel.createEl("h4", { text: "Activity", cls: "notes-list-panel-title" });
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
		const hasActiveFilter = Boolean(this.selectedTag || this.selectedDate || this.selectedMonth || this.searchMatches);
		const activeFilters = heatmapPanel.createDiv({ cls: "notes-list-active-filters" });
		activeFilters.toggleClass("is-empty", !hasActiveFilter);

		if (this.searchMatches) {
			this.renderFilterPill(activeFilters, `"${this.searchQuery}"`, "Clear search", () => this.clearSearch());
		}

		if (this.selectedTag) {
			const tagLabel = this.selectedTag === UNTAGGED ? "Untagged" : `#${this.selectedTag}`;
			this.renderFilterPill(activeFilters, tagLabel, "Clear tag filter", () => {
				this.selectedTag = null;
				this.currentPage = 1;
				void this.render();
			});
		}

		if (this.selectedDate) {
			this.renderFilterPill(
				activeFilters,
				moment(this.selectedDate).format("D MMM YYYY"),
				"Clear date filter",
				() => {
					this.selectedDate = null;
					this.currentPage = 1;
					void this.render();
				}
			);
		}

		if (this.selectedMonth) {
			this.renderFilterPill(
				activeFilters,
				moment(this.selectedMonth, "YYYY-MM").format("MMMM YYYY"),
				"Clear month filter",
				() => {
					this.selectedMonth = null;
					this.currentPage = 1;
					void this.render();
				}
			);
		}

		if (!hasActiveFilter) {
			this.renderFilterPill(activeFilters, "placeholder", "", () => {});
		}

		const tagPanel = heatmapPanel.createDiv({ cls: "notes-tag-tree-panel" });
		tagPanel.toggleClass("is-collapsed", this.tagPanelCollapsed);
		// A disclosure toggle only in the narrow layout (the chevron is hidden
		// and clicks are ignored otherwise, see styles.css).
		const tagHeader = tagPanel.createDiv({ cls: "notes-tag-tree-header" });
		tagHeader.createEl("h4", { text: "Tags", cls: "notes-list-panel-title" });
		setIcon(tagHeader.createSpan({ cls: "notes-tag-tree-header-toggle" }), "chevron-down");
		tagHeader.addEventListener("click", () => {
			if (!this.isNarrowLayout()) return;
			this.tagPanelCollapsed = !this.tagPanelCollapsed;
			void this.render();
		});
		const tagTree = buildTagTree(allEntries.map((e) => e.tags));
		const expandLevel = this.plugin.deviceSettings().tagTreeExpandLevel;
		if (expandLevel !== this.appliedTagTreeExpandLevel) {
			this.tagCollapseOverrides.clear();
			this.appliedTagTreeExpandLevel = expandLevel;
		}
		renderTagTree(
			tagPanel.createDiv({ cls: "notes-tag-tree" }),
			tagTree,
			allEntries.filter((e) => e.tags.length === 0).length,
			this.selectedTag,
			(path, depth) => this.tagCollapseOverrides.get(path) ?? isCollapsedByDefault(depth, expandLevel),
			(filter) => {
				this.selectedTag = filter;
				this.currentPage = 1;
				// Fold the section back in the narrow layout, so the filtered list
				// is right there; its filter pill stays visible above.
				this.tagPanelCollapsed = true;
				void this.render();
			},
			(path, collapsed) => {
				this.tagCollapseOverrides.set(path, collapsed);
				void this.render();
			}
		);

		await Promise.all(noteRenders);
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
			placeholder: "Search notes",
			value: this.searchDraft,
			attr: { "aria-label": "Search notes", enterkeyhint: "search", spellcheck: "false" },
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
			attr: { type: "submit", "aria-label": "Search" },
		});
		setIcon(searchButton.createSpan({ cls: "notes-list-search-button-icon" }), "search");
		searchButton.createSpan({ text: "Search", cls: "notes-list-search-button-label" });
		// The narrow layout's "new note" button, next to the search button
		// (hidden in two columns, where the notes header has its own).
		const newNoteButton = form.createEl("button", {
			cls: "notes-list-search-new-note",
			attr: { type: "button", "aria-label": "New note" },
		});
		setIcon(newNoteButton, "plus");
		newNoteButton.addEventListener("click", () => void this.plugin.createUniqueNote());
		form.addEventListener("submit", (evt) => {
			evt.preventDefault();
			void this.runSearch(input.value);
		});
	}

	private buildEmptyMessage(): string {
		const searchPart = this.searchMatches ? `matching "${this.searchQuery}"` : "";
		const tagPart =
			this.selectedTag === UNTAGGED ? "without tags" : this.selectedTag ? `tagged #${this.selectedTag}` : "";
		const datePart = this.selectedDate ? `on ${moment(this.selectedDate).format("D MMM YYYY")}` : "";
		const monthPart = this.selectedMonth
			? `in ${moment(this.selectedMonth, "YYYY-MM").format("MMMM YYYY")}`
			: "";
		const parts = [searchPart, tagPart, datePart, monthPart].filter(Boolean);

		if (parts.length === 0) return "No notes found in the configured folder.";

		return `No notes ${parts.join(" ")}.`;
	}

	private renderPagination(container: HTMLElement, totalPages: number): void {
		if (totalPages <= 1) return;

		const nav = container.createDiv({ cls: "notes-list-pagination" });

		if (this.currentPage > 1) {
			const prev = nav.createEl("button", {
				cls: "notes-list-page-button",
				attr: { type: "button", "aria-label": "Previous page" },
			});
			setIcon(prev, "chevron-left");
			prev.addEventListener("click", () => this.goToPage(this.currentPage - 1));
		}

		const maxVisiblePages = 5;
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
			const next = nav.createEl("button", {
				cls: "notes-list-page-button",
				attr: { type: "button", "aria-label": "Next page" },
			});
			setIcon(next, "chevron-right");
			next.addEventListener("click", () => this.goToPage(this.currentPage + 1));
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
	private resolveContentDisplay(fm: Record<string, unknown> | undefined): ContentDisplayMode {
		const override = fm?.["content-display"];
		if (override === "full" || override === "preview") return override;
		return this.plugin.deviceSettings().contentDisplay;
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

		// "clickable-icon" is Obsidian's own convention for icon-only buttons —
		// adding it (and using "is-active" for the pinned state, also Obsidian's
		// own convention) gets the muted/bold-on-hover/accent-when-active states
		// from Obsidian's own app.css almost for free, instead of fighting its
		// generic button reset (see styles.css for why that fight needed
		// !important before this).
		const pinButton = itemHeader.createEl("button", {
			cls: "notes-list-pin-button clickable-icon" + (entry.pinned ? " is-active" : ""),
			attr: { "aria-label": entry.pinned ? "Unpin note" : "Pin note", type: "button" },
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
			item.createDiv({ text: file.basename, cls: "notes-list-title" });
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
			if ((evt.target as HTMLElement).closest("a, button")) return;
			openNote(evt);
		});
		const raw = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		let body = stripFrontmatter(raw).trim();

		if (this.resolveContentDisplay(cache?.frontmatter) === "preview") {
			body = truncateMarkdown(body, this.plugin.deviceSettings().previewLength);
		}

		await MarkdownRenderer.render(this.app, body, contentEl, file.path, this.markdownComponent);
	}
}
