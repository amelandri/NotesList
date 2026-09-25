import { App, EventRef, ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, getAllTags, moment, setIcon } from "obsidian";
import type NotesListPlugin from "./main";
import { renderHeatmap } from "./heatmap";
import { buildTagTree, renderTagTree, tagMatchesFilter } from "./tagTree";

export const VIEW_TYPE_NOTES_LIST = "notes-list-view";

// Command id registered by the "Unique note creator" core plugin (internal id
// "zk-prefixer", formerly "Zettelkasten Prefixer" — verified in app.js). It has
// no public typings, so it's invoked through app.commands, also undocumented.
const UNIQUE_NOTE_CREATOR_COMMAND_ID = "zk-prefixer";

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
	private collapsedTagPaths = new Set<string>();
	private currentPage = 1;

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
				if (key === "readableLineLength") void this.refresh();
			})
		);
		await this.refresh();
	}

	private isReadableLineWidthEnabled(): boolean {
		return Boolean(internalVault(this.app).getConfig("readableLineLength"));
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

	private resolveDate(file: TFile): moment.Moment {
		const parsed = moment(file.basename, "YYYYMMDDHHmm", true);
		if (parsed.isValid()) return parsed;

		return moment(file.stat.ctime);
	}

	async refresh(): Promise<void> {
		const { contentPreviewChars, notesPerPage } = this.plugin.settings;

		const allEntries: NoteEntry[] = this.getNotesInScope().map((file) => {
			const cache = this.app.metadataCache.getFileCache(file);
			return { file, date: this.resolveDate(file), tags: cache ? getAllTags(cache) ?? [] : [] };
		});

		allEntries.sort((a, b) => b.date.valueOf() - a.date.valueOf());

		const visibleEntries = this.selectedTag
			? allEntries.filter((entry) => entry.tags.some((tag) => tagMatchesFilter(tag, this.selectedTag!)))
			: allEntries;

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
			const pill = titleGroup.createDiv({ cls: "notes-list-tag-pill" });
			pill.createSpan({ text: `#${this.selectedTag}` });
			const clearButton = pill.createEl("button", {
				cls: "notes-list-tag-pill-clear",
				attr: { "aria-label": "Clear tag filter", type: "button" },
			});
			setIcon(clearButton, "x");
			clearButton.addEventListener("click", () => {
				this.selectedTag = null;
				this.currentPage = 1;
				void this.refresh();
			});
		}

		const newNoteButton = header.createEl("button", {
			cls: "notes-list-new-note-button",
			attr: { "aria-label": "New note", type: "button" },
		});
		setIcon(newNoteButton, "plus");
		newNoteButton.addEventListener("click", () => this.createUniqueNote());

		if (visibleEntries.length === 0) {
			mainEl.createEl("p", {
				text: this.selectedTag
					? `No notes tagged #${this.selectedTag}.`
					: "No notes found in the configured folder.",
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
				await this.renderEntry(mainEl, entry, contentPreviewChars);
			}

			this.renderPagination(mainEl, totalPages);
		}

		heatmapPanel.createEl("h4", { text: "Activity", cls: "notes-list-panel-title" });
		renderHeatmap(
			heatmapPanel.createDiv(),
			allEntries.map((e) => e.date)
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
				void this.refresh();
			},
			(path) => {
				if (!this.collapsedTagPaths.delete(path)) {
					this.collapsedTagPaths.add(path);
				}
				void this.refresh();
			}
		);
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
		void this.refresh();
	}

	private async renderEntry(container: HTMLElement, entry: NoteEntry, contentPreviewChars: number): Promise<void> {
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

		const contentEl = item.createDiv({ cls: "notes-list-content" });
		const raw = await this.app.vault.cachedRead(file);
		const cache = this.app.metadataCache.getFileCache(file);
		const bodyStart = cache?.frontmatterPosition?.end?.offset ?? 0;
		let body = raw.slice(bodyStart).trim();
		if (contentPreviewChars > 0 && body.length > contentPreviewChars) {
			body = body.slice(0, contentPreviewChars).trim() + "…";
		}
		await MarkdownRenderer.render(this.app, body, contentEl, file.path, this.plugin);
	}
}
