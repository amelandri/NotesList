import {
	App,
	Notice,
	Plugin,
	PluginSettingTab,
	SettingGroup,
	TAbstractFile,
	TextComponent,
	TFile,
	WorkspaceLeaf,
	debounce,
	moment,
	normalizePath,
} from "obsidian";
import {
	ContentDisplayMode,
	DEFAULT_SETTINGS,
	DEFAULT_UNIQUE_NOTE_NAME_FORMAT,
	NotesListSettings,
	ShowNoteNameMode,
	migrateSettings,
} from "./settings";
import { FolderSuggest } from "./folderSuggest";
import { TemplateSuggest } from "./templateSuggest";
import { NotesListView, VIEW_TYPE_NOTES_LIST } from "./view";

// Obsidian's own path normalizer handles slashes, leading/trailing junk, and
// Unicode/whitespace quirks a hand-typed path can carry — but it turns a ""
// input into "/" (vault root as a path), which would break the "" = "not set"
// sentinel both folderPath (entire vault) and templatePath (no template) rely
// on, so that case is special-cased ahead of it rather than trusted to
// round-trip through normalizePath as-is. Shared by both settings below.
function normalizeOptionalPath(path: string): string {
	return path.trim() === "" ? "" : normalizePath(path);
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

		// Deliberately no default hotkey (Obsidian's own plugin guidelines
		// advise against setting one, to avoid clashing with the user's
		// existing bindings) — assign one from Settings → Hotkeys instead. This
		// is the same action as the "New Note" button in the view, but callable
		// (and bindable to a shortcut) even when no Notes List view is open.
		this.addCommand({
			id: "create-new-note",
			name: "Create new note",
			callback: () => {
				void this.createUniqueNote();
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

	// Falls back to DEFAULT_UNIQUE_NOTE_NAME_FORMAT whenever the setting is
	// blank, rather than persisting that fallback into the setting itself —
	// used identically here and by NotesListView's "whenDifferent" detection,
	// so the two always agree on what counts as an auto-generated name.
	uniqueNoteNameFormat(): string {
		return this.settings.uniqueNoteNameFormat.trim() || DEFAULT_UNIQUE_NOTE_NAME_FORMAT;
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
		const templatePath = this.settings.templatePath;
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

	// Self-contained: no dependency on any other plugin. Creates the note
	// directly inside the watched folder (so it immediately shows up in the
	// list), pre-fills "timestamp" to now, and registers that property's type
	// so the Properties panel shows the proper date+time picker even in a
	// brand new vault with no prior "timestamp" property and no template.
	// Called both from the view's "New Note" button and the
	// "Create new note" command, so it works from a user-assigned hotkey too,
	// with no Notes List view needing to be open.
	async createUniqueNote(): Promise<void> {
		try {
			const content = await this.resolveTemplateContent();
			if (content === null) return;

			const folderPath = this.settings.folderPath;
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
		this.settings.folderPath = normalizeOptionalPath(this.settings.folderPath);
		this.settings.templatePath = normalizeOptionalPath(this.settings.templatePath);
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
			.setHeading("Folder and files")
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
								this.plugin.settings.folderPath = normalizeOptionalPath(value);
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
			})
			.addSetting((setting) => {
				setting
					.setName("Template")
					.setDesc(
						'Optional note to use as a template for new notes created with the New Note button (empty = a blank note). The template must have a "timestamp" property in its frontmatter.'
					)
					.addText((text) => {
						new TemplateSuggest(this.app, text.inputEl);
						text
							.setPlaceholder("e.g. Templates/Daily note")
							.setValue(this.plugin.settings.templatePath)
							.onChange(async (value) => {
								this.plugin.settings.templatePath = normalizeOptionalPath(value);
								await this.plugin.saveSettings();
							});
					});
			})
			.addSetting((setting) => {
				setting
					.setName("Unique note name format")
					.setDesc(
						"moment.js format for the New Note button's auto-generated file name, and for recognizing a note as still using it (\"Show note name\" below)."
					)
					.addText((text) =>
						text
							.setPlaceholder(DEFAULT_UNIQUE_NOTE_NAME_FORMAT)
							.setValue(this.plugin.settings.uniqueNoteNameFormat)
							.onChange(async (value) => {
								this.plugin.settings.uniqueNoteNameFormat = value;
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
