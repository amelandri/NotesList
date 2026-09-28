import {
	App,
	CachedMetadata,
	EventRef,
	ItemView,
	MarkdownRenderer,
	Notice,
	TFile,
	WorkspaceLeaf,
	getAllTags,
	moment,
	setIcon,
} from "obsidian";
import type NotesListPlugin from "./main";
import { DEFAULT_UNIQUE_NOTE_NAME_FORMAT, type ContentDisplayMode } from "./settings";
import { renderHeatmap, type HeatmapSelection } from "./heatmap";
import { buildTagTree, renderTagTree, tagMatchesFilter } from "./tagTree";

export const VIEW_TYPE_NOTES_LIST = "notes-list-view";

function isUniqueNoteName(basename: string, format: string): boolean {
	return moment(basename, format, true).isValid();
}

// Filesystem-illegal characters across platforms (Windows is the strictest),
// swapped for a plain hyphen — a user-supplied uniqueNoteNameFormat could
// otherwise place e.g. a literal "/" straight into the generated file name
// (moment.js format tokens don't use it, but plain text in the format string
// passes through verbatim), which would silently create the note in a
// subfolder instead of failing loudly.
function sanitizeFilenameSegment(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "-").trim() || "note";
}

// "metadataTypeManager" is an undocumented internal surface with no public
// typings (verified in app.js) that Obsidian's own Properties panel uses to
// remember which widget a property name should render with — "text", "date",
// "datetime" (its fixed internal name for the "Date & time" picker; not to be
// confused with this plugin's own "timestamp" property name below, which is
// just the property this widget type happens to be assigned to), etc. —
// persisted to .obsidian/types.json. setType() is what a property picker
// calls the moment a value is set through it — calling it ourselves right
// after writing "timestamp" via processFrontMatter means a brand new vault
// shows the proper date+time picker for it immediately, without requiring a
// template or a manual one-time Properties-panel edit.
interface MetadataTypeManagerInternal {
	setType(name: string, type: string): Promise<void>;
}

function internalMetadataTypeManager(app: App): MetadataTypeManagerInternal {
	return (app as unknown as { metadataTypeManager: MetadataTypeManagerInternal }).metadataTypeManager;
}

interface NoteEntry {
	file: TFile;
	date: moment.Moment;
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
function stripFrontmatter(raw: string): string {
	return raw.replace(/^---\r?\n(?:.*\r?\n)*?---[ \t]*(?:\r?\n|$)/, "");
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

export class NotesListView extends ItemView {
	private plugin: NotesListPlugin;
	private selectedTag: string | null = null;
	private selectedDate: string | null = null;
	private selectedMonth: string | null = null;
	private collapsedTagPaths = new Set<string>();
	private currentPage = 1;
	// Populated by rebuildEntries() — the expensive per-note scan (metadata
	// lookup, date resolution, tag extraction). Reused across render()s that
	// only change UI state (pagination, filter selection, tag-tree collapse),
	// so those stay cheap even in a folder with thousands of notes; only
	// refresh() (vault/metadata changes, settings changes, initial open)
	// rebuilds it.
	private cachedEntries: NoteEntry[] = [];

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
		this.registerEvent(
			internalVault(this.app).on("config-changed", (key) => {
				// Only affects the is-readable-line-width CSS class — no need to
				// rescan every note in scope for a purely visual toggle.
				if (key === "readableLineLength") void this.render();
			})
		);
		await this.refresh();
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

	// Falls back to DEFAULT_UNIQUE_NOTE_NAME_FORMAT whenever the setting is
	// blank, rather than persisting that fallback into the setting itself —
	// used identically by note creation and by "whenDifferent" detection below,
	// so the two always agree on what counts as an auto-generated name.
	private uniqueNoteNameFormat(): string {
		return this.plugin.settings.uniqueNoteNameFormat.trim() || DEFAULT_UNIQUE_NOTE_NAME_FORMAT;
	}

	private notePath(folderPath: string, basename: string): string {
		return folderPath ? `${folderPath}/${basename}.md` : `${basename}.md`;
	}

	// If settings.templatePath is set, the template note's frontmatter must
	// already declare a "timestamp" property (any value — it gets overwritten
	// with "now" regardless, same as the no-template case) so the resulting
	// note's shape is something the user actually configured, not silently
	// invented. Returns null (after surfacing a Notice) when the template is
	// unusable for any reason, which createUniqueNote() treats as "abort,
	// don't create anything" rather than falling back to a blank note —
	// misconfigured templatePath should be fixed, not silently ignored.
	private async resolveTemplateContent(): Promise<string | null> {
		const templatePath = this.plugin.settings.templatePath;
		if (!templatePath) return "";

		const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
		if (!(templateFile instanceof TFile)) {
			new Notice(`Notes List: template not found at "${templatePath}". Check the Template setting.`);
			return null;
		}

		const frontmatter = this.app.metadataCache.getFileCache(templateFile)?.frontmatter;
		if (!frontmatter || !("timestamp" in frontmatter)) {
			new Notice(
				`Notes List: the template note "${templatePath}" is missing a "timestamp" property in its frontmatter. Add one (any value) to use it as a template.`
			);
			return null;
		}

		return this.app.vault.cachedRead(templateFile);
	}

	// Self-contained: no longer depends on the "Unique note creator" core
	// plugin at all, for naming or otherwise. Creates the note directly inside
	// the watched folder (so it immediately shows up in the list), pre-fills
	// "timestamp" to now, and registers that property's type so the Properties
	// panel shows the proper date+time picker even in a brand new vault with
	// no prior "timestamp" property and no template.
	private async createUniqueNote(): Promise<void> {
		try {
			const content = await this.resolveTemplateContent();
			if (content === null) return;

			const folderPath = this.plugin.settings.folderPath;
			if (folderPath && !this.app.vault.getAbstractFileByPath(folderPath)) {
				await this.app.vault.createFolder(folderPath);
			}

			const stamp = sanitizeFilenameSegment(moment().format(this.uniqueNoteNameFormat()));
			let basename = stamp;
			for (let suffix = 2; this.app.vault.getAbstractFileByPath(this.notePath(folderPath, basename)); suffix++) {
				basename = `${stamp}-${suffix}`;
			}

			const file = await this.app.vault.create(this.notePath(folderPath, basename), content);
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				frontmatter.timestamp = moment().format("YYYY-MM-DDTHH:mm:ss");
			});

			// Isolated in its own try/catch, deliberately: the note itself is
			// already fully created and correctly dated by this point, so a
			// failure here (metadataTypeManager is undocumented and could change
			// in a future Obsidian release) should degrade to "no auto-registered
			// picker widget" rather than being reported as "failed to create the
			// note" — which would be misleading, since it already exists on disk.
			// The second argument is Obsidian's own fixed internal widget-type
			// name for its "Date & time" picker (see MetadataTypeManagerInternal
			// above) — it's not related to, and doesn't need to match, the
			// property name in the first argument.
			try {
				await internalMetadataTypeManager(this.app).setType("timestamp", "datetime");
			} catch (error) {
				console.warn('Notes List: could not register "timestamp" as a Date & time property', error);
			}

			await this.app.workspace.getLeaf(false).openFile(file);
		} catch (error) {
			console.error("Notes List: failed to create a new note", error);
			new Notice("Could not create the note — see the developer console for details.");
		}
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

	private resolveDate(file: TFile, cache: CachedMetadata | null): moment.Moment {
		const fm = cache?.frontmatter;

		const timestamp = fm?.timestamp ? this.parseDatetime(fm.timestamp) : null;
		if (timestamp?.isValid()) return timestamp;

		// Legacy fallback for notes written before "timestamp" replaced the old,
		// separate "date"/"time" fields: only "date" is still read, and only as a
		// date (never with a time-of-day) — "time" itself is no longer read at
		// all. parseDatetime() already resolves a date-only value to local
		// midnight on its own (see below), so there's nothing extra to do here.
		const date = fm?.date ? this.parseDatetime(fm.date) : null;
		if (date?.isValid()) return date;

		return moment(file.stat.mtime);
	}

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
	private parseDatetime(raw: any): moment.Moment | null {
		if (typeof raw === "string") {
			const parsed = moment(raw, ["YYYY-MM-DDTHH:mm:ss", "YYYY-MM-DDTHH:mm", "YYYY-MM-DD"], true);
			return parsed.isValid() ? parsed : null;
		}

		const date = moment(raw);
		if (!date.isValid()) return null;
		if (date.clone().utc().format("HH:mm:ss") === "00:00:00") {
			date.startOf("day");
		}
		return date;
	}

	// Full data reload: re-scans every note in scope (metadata, date, tags) —
	// the only expensive step, so it's kept out of render() (see cachedEntries).
	// Call this when the note set or its metadata might have changed (vault
	// events, settings changes, initial open); call render() directly for
	// anything that only changes UI state.
	async refresh(): Promise<void> {
		this.rebuildEntries();
		await this.render();
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
		const { notesPerPage } = this.plugin.settings;
		const allEntries = this.cachedEntries;

		const filteredEntries = allEntries.filter((entry) => {
			const matchesTag = !this.selectedTag || entry.tags.some((tag) => tagMatchesFilter(tag, this.selectedTag!));
			const matchesDate = !this.selectedDate || entry.date.format("YYYY-MM-DD") === this.selectedDate;
			const matchesMonth = !this.selectedMonth || entry.date.format("YYYY-MM") === this.selectedMonth;
			return matchesTag && matchesDate && matchesMonth;
		});

		// Pinned notes float to the top, each group still newest-first: allEntries
		// is already sorted by date desc, and Array#filter is stable, so simply
		// partitioning it (rather than re-sorting) preserves that order within
		// both groups.
		const visibleEntries = [
			...filteredEntries.filter((entry) => entry.pinned),
			...filteredEntries.filter((entry) => !entry.pinned),
		];

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
		newNoteButton.addEventListener("click", () => void this.createUniqueNote());

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
				if (this.plugin.settings.showDateGroups && !entry.pinned) {
					const group = this.dateGroupLabel(entry.date);
					if (group !== lastGroup) {
						mainEl.createDiv({ cls: "notes-list-date-group-header", text: group });
						lastGroup = group;
					}
				}
				renders.push(this.renderEntry(mainEl, entry));
			}
			await Promise.all(renders);

			this.renderPagination(mainEl, totalPages);
		}

		heatmapPanel.createEl("h4", { text: "Activity", cls: "notes-list-panel-title" });
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
			heatmapPanel.createDiv(),
			allEntries.map((e) => e.date),
			visibleEntries.length,
			heatmapSelection
		);

		// Always present (not just when a filter is active) and with a real
		// pill's worth of markup inside even when empty, so its height is
		// reserved and the Tags section below never shifts when a filter is
		// toggled on/off. When nothing is selected, that placeholder pill is
		// just hidden via CSS (.is-empty) rather than left out of the DOM.
		const hasActiveFilter = Boolean(this.selectedTag || this.selectedDate || this.selectedMonth);
		const activeFilters = heatmapPanel.createDiv({ cls: "notes-list-active-filters" });
		activeFilters.toggleClass("is-empty", !hasActiveFilter);

		if (this.selectedTag) {
			this.renderFilterPill(activeFilters, `#${this.selectedTag}`, "Clear tag filter", () => {
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
		tagPanel.createEl("h4", { text: "Tags", cls: "notes-list-panel-title" });
		const tagTree = buildTagTree(allEntries.map((e) => e.tags));
		renderTagTree(
			tagPanel.createDiv({ cls: "notes-tag-tree" }),
			tagTree,
			this.selectedTag,
			this.collapsedTagPaths,
			(path) => {
				this.selectedTag = path;
				this.currentPage = 1;
				void this.render();
			},
			(path) => {
				if (!this.collapsedTagPaths.delete(path)) {
					this.collapsedTagPaths.add(path);
				}
				void this.render();
			}
		);
	}

	// "Today" also catches a future-dated note (isSameOrAfter, not isSame) —
	// none of the four labels the setting offers fit a note dated ahead of
	// today, and folding it into "Today" avoids inventing a fifth one.
	// weekStart uses moment's own locale-aware start of week, same as the
	// heatmap's own week bucketing in heatmap.ts, so both agree on where a
	// week begins.
	private dateGroupLabel(date: moment.Moment): string {
		const today = moment().startOf("day");
		if (date.isSameOrAfter(today, "day")) return "Today";
		if (date.isSame(today.clone().subtract(1, "day"), "day")) return "Yesterday";
		if (date.isSameOrAfter(today.clone().startOf("week"), "day")) return "This week";
		return "Older";
	}

	private buildEmptyMessage(): string {
		const tagPart = this.selectedTag ? `tagged #${this.selectedTag}` : "";
		const datePart = this.selectedDate ? `on ${moment(this.selectedDate).format("D MMM YYYY")}` : "";
		const monthPart = this.selectedMonth
			? `in ${moment(this.selectedMonth, "YYYY-MM").format("MMMM YYYY")}`
			: "";
		const parts = [tagPart, datePart, monthPart].filter(Boolean);

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
		switch (this.plugin.settings.showNoteName) {
			case "always":
				return true;
			case "whenDifferent":
				return !isUniqueNoteName(file.basename, this.uniqueNoteNameFormat());
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
		return this.plugin.settings.contentDisplay;
	}

	private async renderEntry(container: HTMLElement, entry: NoteEntry): Promise<void> {
		const { file, date } = entry;
		const item = container.createDiv({ cls: "notes-list-item" + (entry.pinned ? " is-pinned" : "") });

		const itemHeader = item.createDiv({ cls: "notes-list-item-header" });

		const openNote = (evt: MouseEvent) => {
			this.app.workspace.getLeaf(evt.ctrlKey || evt.metaKey).openFile(file);
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

		const pinButton = itemHeader.createEl("button", {
			cls: "notes-list-pin-button" + (entry.pinned ? " is-pinned" : ""),
			attr: { "aria-label": entry.pinned ? "Unpin note" : "Pin note", type: "button" },
		});
		setIcon(pinButton, "bookmark");
		pinButton.addEventListener("click", async () => {
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
		});

		if (this.shouldShowNoteName(file)) {
			item.createEl("div", { text: file.basename, cls: "notes-list-title" });
		}

		const contentEl = item.createDiv({ cls: "notes-list-content" });
		contentEl.addEventListener("dblclick", (evt) => {
			// Don't also open *this* note over a link the rendered body already
			// handles its own way (e.g. an internal link to some other note, or an
			// external URL) — only open on a double-click that lands on plain body
			// content.
			if ((evt.target as HTMLElement).closest("a")) return;
			openNote(evt);
		});
		const raw = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		let body = stripFrontmatter(raw).trim();

		if (this.resolveContentDisplay(cache?.frontmatter) === "preview") {
			const { previewLength } = this.plugin.settings;
			if (body.length > previewLength) {
				body = body.slice(0, previewLength).trim() + "…";
			}
		}

		await MarkdownRenderer.render(this.app, body, contentEl, file.path, this.plugin);
	}
}
