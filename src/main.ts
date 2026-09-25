import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingGroup,
	TAbstractFile,
	WorkspaceLeaf,
	debounce,
} from "obsidian";
import { ContentDisplayMode, DEFAULT_SETTINGS, NotesListSettings, ShowNoteNameMode } from "./settings";
import { FolderSuggest } from "./folderSuggest";
import { NotesListView, VIEW_TYPE_NOTES_LIST } from "./view";

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
		this.registerEvent(this.app.vault.on("rename", (f: TAbstractFile) => this.onVaultEvent(f)));
		this.registerEvent(this.app.metadataCache.on("changed", (f: TAbstractFile) => this.onVaultEvent(f)));
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_NOTES_LIST);
	}

	private onVaultEvent(file: TAbstractFile): void {
		const folderPath = this.settings.folderPath.replace(/^\/+|\/+$/g, "");
		if (folderPath === "" || file.path.startsWith(folderPath)) {
			this.requestRefresh();
		}
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
			.setHeading("Folder settings")
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
								this.plugin.settings.folderPath = value;
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
			.setHeading("Notes Display")
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
						text
							.setPlaceholder("300")
							.setValue(String(this.plugin.settings.previewLength))
							.onChange(async (value) => {
								const parsed = Number.parseInt(value, 10);
								this.plugin.settings.previewLength = Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
								await this.plugin.saveSettings();
							});
					});
			});

		new Setting(containerEl)
			.setName("Notes per page")
			.setDesc("Number of notes shown per page in the list.")
			.addText((text) =>
				text
					.setPlaceholder("10")
					.setValue(String(this.plugin.settings.notesPerPage))
					.onChange(async (value) => {
						const parsed = Number.parseInt(value, 10);
						this.plugin.settings.notesPerPage = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
						await this.plugin.saveSettings();
					})
			);
	}
}
