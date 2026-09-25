import { App, EventRef, ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, getAllTags, moment, setIcon } from "obsidian";
import type NotesListPlugin from "./main";
import { renderHeatmap } from "./heatmap";

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
		const { showTags, contentPreviewChars } = this.plugin.settings;

		const entries: NoteEntry[] = this.getNotesInScope().map((file) => {
			const cache = this.app.metadataCache.getFileCache(file);
			const tags = cache ? getAllTags(cache) ?? [] : [];
			return { file, date: this.resolveDate(file), tags };
		});

		entries.sort((a, b) => b.date.valueOf() - a.date.valueOf());

		const container = this.contentEl;
		container.empty();
		container.addClass("notes-list-view");

		const layout = container.createDiv({ cls: "notes-list-layout" });
		const mainEl = layout.createDiv({ cls: "notes-list-main" });
		const heatmapPanel = layout.createDiv({ cls: "notes-list-heatmap-panel" });

		mainEl.toggleClass("is-readable-line-width", this.isReadableLineWidthEnabled());

		const header = mainEl.createDiv({ cls: "notes-list-header" });
		header.createEl("h4", { text: "Notes", cls: "notes-list-panel-title" });
		const newNoteButton = header.createEl("button", {
			cls: "notes-list-new-note-button",
			attr: { "aria-label": "New note", type: "button" },
		});
		setIcon(newNoteButton, "plus");
		newNoteButton.addEventListener("click", () => this.createUniqueNote());

		if (entries.length === 0) {
			mainEl.createEl("p", {
				text: "No notes found in the configured folder.",
				cls: "notes-list-empty",
			});
		} else {
			for (const entry of entries) {
				await this.renderEntry(mainEl, entry, showTags, contentPreviewChars);
			}
		}

		heatmapPanel.createEl("h4", { text: "Activity", cls: "notes-list-panel-title" });
		renderHeatmap(
			heatmapPanel.createDiv(),
			entries.map((e) => e.date)
		);
	}

	private async renderEntry(
		container: HTMLElement,
		entry: NoteEntry,
		showTags: boolean,
		contentPreviewChars: number
	): Promise<void> {
		const { file, date, tags } = entry;
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

		if (showTags && tags.length > 0) {
			const tagsEl = item.createDiv({ cls: "notes-list-tags" });
			for (const tag of tags) {
				tagsEl.createEl("span", { text: tag, cls: "notes-list-tag" });
			}
		}
	}
}
