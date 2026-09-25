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
import type { ContentDisplayMode } from "./settings";
import { renderHeatmap, type HeatmapSelection } from "./heatmap";
import { buildTagTree, renderTagTree, tagMatchesFilter } from "./tagTree";

export const VIEW_TYPE_NOTES_LIST = "notes-list-view";

// Command id registered by the "Unique note creator" core plugin (internal id
// "zk-prefixer", formerly "Zettelkasten Prefixer" — verified in app.js). It has
// no public typings, so it's invoked through app.commands, also undocumented.
const UNIQUE_NOTE_CREATOR_COMMAND_ID = "zk-prefixer";

// Default filename pattern "Unique note creator" falls back to when it has no
// configured format of its own (verified in app.js: getFormat() reads
// this.options.format and falls back to this same literal). Used only to tell
// an auto-named note apart from a manually (re)named one for the "when
// different" showNoteName mode — unrelated to date resolution, which comes
// from frontmatter (see resolveDate()).
const DEFAULT_UNIQUE_NOTE_NAME_FORMAT = "YYYYMMDDHHmm";

interface InternalPlugins {
	getEnabledPluginById(id: string): { options?: { format?: unknown } } | null;
}

function internalPlugins(app: App): InternalPlugins {
	return (app as unknown as { internalPlugins: InternalPlugins }).internalPlugins;
}

// Reads the *actual* format "Unique note creator" is configured to generate
// names with (its own settings tab, not a value we hardcode), so renamed-note
// detection stays correct even if the user changed that format.
function getUniqueNoteNameFormat(app: App): string {
	const format = internalPlugins(app).getEnabledPluginById(UNIQUE_NOTE_CREATOR_COMMAND_ID)?.options?.format;
	return typeof format === "string" && format ? format : DEFAULT_UNIQUE_NOTE_NAME_FORMAT;
}

function isUniqueNoteName(basename: string, format: string): boolean {
	return moment(basename, format, true).isValid();
}

interface NoteEntry {
	file: TFile;
	date: moment.Moment;
	tags: string[];
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

interface CommandsInternal {
	executeCommandById(id: string): boolean;
}

function internalCommands(app: App): CommandsInternal {
	return (app as unknown as { commands: CommandsInternal }).commands;
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

	private createUniqueNote(): void {
		const executed = internalCommands(this.app).executeCommandById(UNIQUE_NOTE_CREATOR_COMMAND_ID);
		if (!executed) {
			new Notice('Could not create the note: enable the "Unique note creator" core plugin in Obsidian settings.');
		}
	}

	private getNotesInScope(): TFile[] {
		const { folderPath, includeSubfolders } = this.plugin.settings;
		const normalized = folderPath.replace(/^\/+|\/+$/g, "");

		return this.app.vault.getMarkdownFiles().filter((file) => {
			if (normalized === "") return true;
			if (includeSubfolders) {
				return file.path === normalized || file.path.startsWith(normalized + "/");
			}
			return file.parent?.path === normalized;
		});
	}

	private resolveDate(file: TFile, cache: CachedMetadata | null): moment.Moment {
		const fm = cache?.frontmatter;

		// fm.date may be a plain string, or a native Date object — YAML auto-casts an
		// unquoted YYYY-MM-DD scalar to one. moment(...) accepts either; startOf("day")
		// pins it to local midnight regardless (a Date's toString() is timezone-shifted
		// and not reliably midnight on its own), giving the 00:00 default with no time.
		const date = fm?.date ? moment(fm.date).startOf("day") : null;

		if (date?.isValid()) {
			const time = this.parseFrontmatterTime(fm?.time);
			if (time) date.set(time);
			return date;
		}

		return moment(file.stat.mtime);
	}

	// fm.time is usually an "HH:mm"/"HH:mm:ss" string, but an unquoted "HH:MM"-shaped
	// scalar (e.g. "16:20") is legacy-YAML for a base-60 integer — 16*60+20 = 980 — not
	// a time string, so Obsidian's frontmatter cache hands that back as the number 980.
	// Both forms are handled here rather than assuming the field is always a string.
	private parseFrontmatterTime(value: unknown): { hour: number; minute: number; second: number } | null {
		if (typeof value === "number" && Number.isFinite(value)) {
			const totalMinutes = Math.trunc(value);
			return { hour: Math.floor(totalMinutes / 60) % 24, minute: totalMinutes % 60, second: 0 };
		}

		if (value) {
			const parsed = moment(String(value), ["HH:mm", "HH:mm:ss"], true);
			if (parsed.isValid()) {
				return { hour: parsed.hour(), minute: parsed.minute(), second: parsed.second() };
			}
		}

		return null;
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
			return { file, date: this.resolveDate(file, cache), tags: cache ? getAllTags(cache) ?? [] : [] };
		});
		this.cachedEntries.sort((a, b) => b.date.valueOf() - a.date.valueOf());
	}

	private async render(): Promise<void> {
		const { notesPerPage } = this.plugin.settings;
		const allEntries = this.cachedEntries;

		const visibleEntries = allEntries.filter((entry) => {
			const matchesTag = !this.selectedTag || entry.tags.some((tag) => tagMatchesFilter(tag, this.selectedTag!));
			const matchesDate = !this.selectedDate || entry.date.format("YYYY-MM-DD") === this.selectedDate;
			const matchesMonth = !this.selectedMonth || entry.date.format("YYYY-MM") === this.selectedMonth;
			return matchesTag && matchesDate && matchesMonth;
		});

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

		if (this.selectedTag) {
			this.renderFilterPill(titleGroup, `#${this.selectedTag}`, "Clear tag filter", () => {
				this.selectedTag = null;
				this.currentPage = 1;
				void this.render();
			});
		}

		if (this.selectedDate) {
			this.renderFilterPill(titleGroup, moment(this.selectedDate).format("D MMM YYYY"), "Clear date filter", () => {
				this.selectedDate = null;
				this.currentPage = 1;
				void this.render();
			});
		}

		if (this.selectedMonth) {
			this.renderFilterPill(
				titleGroup,
				moment(this.selectedMonth, "YYYY-MM").format("MMMM YYYY"),
				"Clear month filter",
				() => {
					this.selectedMonth = null;
					this.currentPage = 1;
					void this.render();
				}
			);
		}

		const newNoteButton = header.createEl("button", {
			cls: "notes-list-new-note-button",
			attr: { "aria-label": "New note", type: "button" },
		});
		setIcon(newNoteButton, "plus");
		newNoteButton.addEventListener("click", () => this.createUniqueNote());

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

			for (const entry of pageEntries) {
				await this.renderEntry(mainEl, entry);
			}

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

		const tagPanel = heatmapPanel.createDiv({ cls: "notes-tag-tree-panel" });
		tagPanel.createEl("h4", { text: "Tags", cls: "notes-list-panel-title" });
		const tagTree = buildTagTree(allEntries.flatMap((e) => e.tags));
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
				return !isUniqueNoteName(file.basename, getUniqueNoteNameFormat(this.app));
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
		const item = container.createDiv({ cls: "notes-list-item" });

		const link = item.createEl("a", {
			text: date.format("YYYY-MM-DD HH:mm"),
			cls: "notes-list-datetime internal-link",
			href: file.path,
		});
		link.addEventListener("click", (evt) => {
			evt.preventDefault();
			this.app.workspace.getLeaf(evt.ctrlKey || evt.metaKey).openFile(file);
		});

		if (this.shouldShowNoteName(file)) {
			item.createEl("div", { text: file.basename, cls: "notes-list-title" });
		}

		const contentEl = item.createDiv({ cls: "notes-list-content" });
		const raw = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const bodyStart = cache?.frontmatterPosition?.end?.offset ?? 0;
		let body = raw.slice(bodyStart).trim();

		if (this.resolveContentDisplay(cache?.frontmatter) === "preview") {
			const { previewLength } = this.plugin.settings;
			if (body.length > previewLength) {
				body = body.slice(0, previewLength).trim() + "…";
			}
		}

		await MarkdownRenderer.render(this.app, body, contentEl, file.path, this.plugin);
	}
}
