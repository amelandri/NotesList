import {
	App,
	Plugin,
	PluginSettingTab,
	SettingGroup,
	TAbstractFile,
	TextComponent,
	TFile,
	WorkspaceLeaf,
	debounce,
	normalizePath,
} from "obsidian";
import { ContentDisplayMode, DEFAULT_SETTINGS, NotesListSettings, ShowNoteNameMode, migrateSettings } from "./settings";
import { FolderSuggest } from "./folderSuggest";
import { NotesListView, VIEW_TYPE_NOTES_LIST } from "./view";

// Obsidian's own path normalizer handles slashes, leading/trailing junk, and
// Unicode/whitespace quirks a hand-typed folder path can carry — but it turns
// a "" input into "/" (vault root as a path), which would break the "" =
// entire vault sentinel used everywhere else, so that case is special-cased
// ahead of it rather than trusted to round-trip through normalizePath as-is.
function normalizeFolderPath(path: string): string {
	return path.trim() === "" ? "" : normalizePath(path);
}

export default class NotesListPlugin extends Plugin {
	settings!: NotesListSettings;

	private requestRefresh = debounce(
		() => {
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_NOTES_LIST)) {
				const view = leaf.view;
				if (view instanceof NotesListView) void view.refresh();
			}
		},
		300,
		true
	);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_NOTES_LIST, (leaf) => new NotesListView(leaf, this));

		this.addRibbonIcon("list-ordered", "Open Notes List", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-notes-list",
			name: "Open Notes List",
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new NotesListSettingTab(this.app, this));

		this.registerEvent(this.app.vault.on("modify", (f: TAbstractFile) => this.onVaultEvent(f)));
		this.registerEvent(this.app.vault.on("create", (f: TAbstractFile) => this.onVaultEvent(f)));
		this.registerEvent(this.app.vault.on("delete", (f: TAbstractFile) => this.onVaultEvent(f)));
		this.registerEvent(
			this.app.vault.on("rename", (f: TAbstractFile, oldPath: string) => this.onVaultEvent(f, oldPath))
		);
		this.registerEvent(this.app.metadataCache.on("changed", (f: TAbstractFile) => this.onVaultEvent(f)));
	}

	// oldPath is only passed for "rename": a note can be renamed/moved *out* of
	// the watched folder, and by then file.path is the new (out-of-scope) path,
	// so checking that alone would miss it and leave the stale entry showing
	// until some unrelated event happens to trigger a refresh.
	private onVaultEvent(file: TAbstractFile, oldPath?: string): void {
		if (this.isInScope(file.path) || (oldPath !== undefined && this.isInScope(oldPath))) {
			this.requestRefresh();
		}
	}

	// Mirrors NotesListView.getNotesInScope()'s own logic exactly (including the
	// includeSubfolders branch), rather than a plain path.startsWith(folderPath)
	// — that would also match e.g. a "NotesArchive/x.md" file against a "Notes"
	// folder setting, triggering spurious full rescans for files never actually
	// in scope.
	private isInScope(path: string): boolean {
		// Already normalized by loadSettings()/the Folder setting's onChange, so
		// no further trimming is needed here.
		const folderPath = this.settings.folderPath;
		if (folderPath === "") return true;
		if (this.settings.includeSubfolders) {
			return path === folderPath || path.startsWith(folderPath + "/");
		}
		const lastSlash = path.lastIndexOf("/");
		const parent = lastSlash === -1 ? "" : path.slice(0, lastSlash);
		return parent === folderPath;
	}

	// Pin state lives in the note's own frontmatter (a "pinned" property), not
	// in plugin data, so it travels with the file across renames/moves/copies
	// for free and needs no bookkeeping here. processFrontMatter is Obsidian's
	// own safe read-modify-write helper — it creates the frontmatter block if
	// the note doesn't have one yet.
	async setPinned(file: TFile, pinned: boolean): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.pinned = pinned;
		});
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_NOTES_LIST)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_NOTES_LIST, active: true });
		}
		workspace.revealLeaf(leaf);
	}

	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		// Mutates raw in place up to the current settings shape — see
		// migrateSettings() in settings.ts for why this exists and how it's
		// meant to be extended.
		const migrated = migrateSettings(raw);
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw) as NotesListSettings;
		// Re-normalize on every load too, not just when the setting is edited, so
		// a folderPath saved by an older version of this plugin (before this
		// normalization existed) still gets cleaned up on next launch.
		this.settings.folderPath = normalizeFolderPath(this.settings.folderPath);
		// Persist the migrated shape right away rather than waiting for the next
		// unrelated settings change, so a legacy field like contentPreviewChars
		// doesn't linger in data.json indefinitely.
		if (migrated) await this.saveData(this.settings);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.requestRefresh();
	}
}

class NotesListSettingTab extends PluginSettingTab {
	plugin: NotesListPlugin;

	constructor(app: App, plugin: NotesListPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new SettingGroup(containerEl)
			.setHeading("Folder")
			.addSetting((setting) => {
				setting
					.setName("Folder")
					.setDesc("Vault folder to watch (empty = entire vault)")
					.addText((text) => {
						new FolderSuggest(this.app, text.inputEl);
						text
							.setPlaceholder("e.g. Journal")
							.setValue(this.plugin.settings.folderPath)
							.onChange(async (value) => {
								this.plugin.settings.folderPath = normalizeFolderPath(value);
								await this.plugin.saveSettings();
							});
					});
			})
			.addSetting((setting) => {
				setting
					.setName("Subfolders")
					.setDesc("includes its subfolders.")
					.addToggle((toggle) =>
						toggle
							.setTooltip("Include subfolders")
							.setValue(this.plugin.settings.includeSubfolders)
							.onChange(async (value) => {
								this.plugin.settings.includeSubfolders = value;
								await this.plugin.saveSettings();
							})
					);
			});

		new SettingGroup(containerEl)
			.setHeading("Notes display")
			.addSetting((setting) => {
				setting
					.setName("Show note name")
					.setDesc("Whether to show each note's file name.")
					.addDropdown((dropdown) =>
						dropdown
							.addOption("never", "Never")
							.addOption("always", "Always")
							.addOption("whenDifferent", "When different from unique note name")
							.setValue(this.plugin.settings.showNoteName)
							.onChange(async (value) => {
								this.plugin.settings.showNoteName = value as ShowNoteNameMode;
								await this.plugin.saveSettings();
							})
					);
			})
			.addSetting((setting) => {
				setting
					.setName("Content display")
					.setDesc(
						'Show a note\'s full content or a truncated preview. A note can override this with "content-display" frontmatter property.'
					)
					.addDropdown((dropdown) =>
						dropdown
							.addOption("full", "Full")
							.addOption("preview", "Preview")
							.setValue(this.plugin.settings.contentDisplay)
							.onChange(async (value) => {
								this.plugin.settings.contentDisplay = value as ContentDisplayMode;
								await this.plugin.saveSettings();
							})
					);
			})
			.addSetting((setting) => {
				setting
					.setName("Preview length")
					.setDesc("Maximum number of characters shown when Content display is set to Preview.")
					.addText((text) => {
						text.setPlaceholder("300").setValue(String(this.plugin.settings.previewLength));
						this.bindClampedNumberInput(
							text,
							() => this.plugin.settings.previewLength,
							async (value) => {
								this.plugin.settings.previewLength = value;
								await this.plugin.saveSettings();
							},
							300
						);
					});
			})
			.addSetting((setting) => {
				setting
					.setName("Show date group headers")
					.setDesc('Show "Today" / "Yesterday" / "This week" / "Older" headers above notes in the list.')
					.addToggle((toggle) =>
						toggle.setValue(this.plugin.settings.showDateGroups).onChange(async (value) => {
							this.plugin.settings.showDateGroups = value;
							await this.plugin.saveSettings();
						})
					);
			})
			.addSetting((setting) => {
				setting
					.setName("Notes per page")
					.setDesc("Number of notes shown per page in the list.")
					.addText((text) => {
						text.setPlaceholder("10").setValue(String(this.plugin.settings.notesPerPage));
						this.bindClampedNumberInput(
							text,
							() => this.plugin.settings.notesPerPage,
							async (value) => {
								this.plugin.settings.notesPerPage = value;
								await this.plugin.saveSettings();
							},
							10
						);
					});
			});
	}

	// Parses on every keystroke (so typing a valid number takes effect right
	// away) but only snaps the field's *displayed* text back to the resolved
	// value on blur, not immediately — correcting it mid-edit made it
	// impossible to clear the field and type a new number, since deleting a
	// digit already left it invalid (NaN) and the old behavior rewrote the
	// input back to the fallback before the next keystroke could land.
	private bindClampedNumberInput(
		text: TextComponent,
		getCurrent: () => number,
		setResolved: (value: number) => Promise<void>,
		fallback: number
	): void {
		text.onChange(async (value) => {
			const parsed = Number.parseInt(value, 10);
			const resolved = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
			await setResolved(resolved);
		});
		text.inputEl.addEventListener("blur", () => {
			text.setValue(String(getCurrent()));
		});
	}
}
