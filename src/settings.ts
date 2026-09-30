export type ShowNoteNameMode = "never" | "always" | "whenDifferent";
export type ContentDisplayMode = "full" | "preview";
/** How deep the sidebar's tag tree is expanded by default: "1" = fully collapsed (only top-level tags shown), "2"/"3" = expanded down to that level, "all" = fully expanded. */
export type TagTreeExpandLevel = "1" | "2" | "3" | "all";

export interface NotesListSettings {
	/** Bumped by migrateSettings() whenever this shape changes — see SETTINGS_MIGRATIONS below. */
	settingsVersion: number;
	/** Folder to watch, relative to the vault root. Empty = entire vault. */
	folderPath: string;
	/** Also include subfolders of folderPath. */
	includeSubfolders: boolean;
	/** Whether to show a note's full content or a truncated preview. Overridable per-note via the "content-display" frontmatter property. */
	contentDisplay: ContentDisplayMode;
	/** Number of content characters to show per note when contentDisplay is "preview". */
	previewLength: number;
	/** Number of notes shown per page in the list. */
	notesPerPage: number;
	/** When to show each note's file name below its date. */
	showNoteName: ShowNoteNameMode;
	/** Whether to show Today/Yesterday/This week/Older group headers above the notes list. */
	showDateGroups: boolean;
	/** moment.js format for the New Note button's auto-generated file name, and for recognizing a note as still using it (showNoteName: "whenDifferent"). */
	uniqueNoteNameFormat: string;
	/** Vault-relative path to a note used as a template for new notes (New Note button). Empty = no template, a blank note. The template's frontmatter must contain a "timestamp" property. */
	templatePath: string;
	/** Default expansion of the sidebar's tag tree — see TagTreeExpandLevel. The user can still expand/collapse individual tags by hand. */
	tagTreeExpandLevel: TagTreeExpandLevel;

	// Mobile (phone/tablet app) counterparts of the device-specific settings
	// above (DEVICE_SETTING_KEYS): the unprefixed field is the desktop value.
	// Both live in the same, synced data.json, and resolveDeviceSettings()
	// picks one set at runtime.
	mobileContentDisplay: ContentDisplayMode;
	mobilePreviewLength: number;
	mobileNotesPerPage: number;
	mobileShowNoteName: ShowNoteNameMode;
	mobileShowDateGroups: boolean;
	mobileTagTreeExpandLevel: TagTreeExpandLevel;
}

/** The "Notes list" and "Sidebar" settings, which have a separate value on the desktop and mobile apps. */
export const DEVICE_SETTING_KEYS = [
	"showNoteName",
	"contentDisplay",
	"previewLength",
	"showDateGroups",
	"notesPerPage",
	"tagTreeExpandLevel",
] as const;

export type DeviceSettingKey = (typeof DEVICE_SETTING_KEYS)[number];
export type MobileSettingKey<K extends DeviceSettingKey = DeviceSettingKey> = `mobile${Capitalize<K>}`;
export type DeviceSettings = Pick<NotesListSettings, DeviceSettingKey>;

/** The settings field holding `key`'s value on the given platform. */
export function deviceSettingKey<K extends DeviceSettingKey>(key: K, mobile: boolean): K | MobileSettingKey<K> {
	return mobile ? (`mobile${key.charAt(0).toUpperCase()}${key.slice(1)}` as MobileSettingKey<K>) : key;
}

/** The device-specific settings in effect on this platform (mobile = the Obsidian mobile app, phone or tablet). */
export function resolveDeviceSettings(settings: NotesListSettings, mobile: boolean): DeviceSettings {
	return {
		showNoteName: settings[deviceSettingKey("showNoteName", mobile)],
		contentDisplay: settings[deviceSettingKey("contentDisplay", mobile)],
		previewLength: settings[deviceSettingKey("previewLength", mobile)],
		showDateGroups: settings[deviceSettingKey("showDateGroups", mobile)],
		notesPerPage: settings[deviceSettingKey("notesPerPage", mobile)],
		tagTreeExpandLevel: settings[deviceSettingKey("tagTreeExpandLevel", mobile)],
	};
}

/** Fallback used whenever uniqueNoteNameFormat is blank — also this plugin's out-of-the-box default, matching the pattern Obsidian's own "Unique note creator" core plugin used to generate (this plugin no longer depends on or reads from it). */
export const DEFAULT_UNIQUE_NOTE_NAME_FORMAT = "YYYYMMDDHHmmss";

// Each entry migrates the raw data exactly as loaded from data.json — which,
// for an old enough file, may carry fields no longer in NotesListSettings at
// all — from its own array index (the settingsVersion it applies to) up to
// the next one, mutating it in place. migrateSettings() runs every entry from
// the file's saved settingsVersion (missing entirely = 0, i.e. every file
// saved before this framework existed) onward, in order, so a very old file
// runs all of them in sequence and a current one runs none. Add a new
// function to the END of this array — never edit or remove an old one —
// whenever a future settings-shape change needs the same treatment; the
// current version is simply this array's length, so there's nothing else to
// keep in sync by hand.
const SETTINGS_MIGRATIONS: Array<(data: Record<string, unknown>) => void> = [
	// v0 -> v1: contentPreviewChars (a single number — 0 meant "show full
	// content", anything higher meant "preview", truncated to that many
	// characters) was replaced by two separate fields, contentDisplay and
	// previewLength (see "Content display" in CLAUDE.md).
	(data) => {
		if (!("contentPreviewChars" in data)) return;
		const chars = data.contentPreviewChars;
		const hasPreviewLength = typeof chars === "number" && chars > 0;
		data.contentDisplay = hasPreviewLength ? "preview" : "full";
		data.previewLength = hasPreviewLength ? chars : DEFAULT_SETTINGS.previewLength;
		delete data.contentPreviewChars;
	},
	// v1 -> v2: the "Notes list" and "Sidebar" settings became device-specific
	// (DEVICE_SETTING_KEYS), each gaining a mobile* twin. The saved value
	// seeds both, so upgrading changes nothing on either device until the
	// user sets them apart. A field never saved stays unset, so both fall
	// back to the same default.
	(data) => {
		for (const key of DEVICE_SETTING_KEYS) {
			const mobileKey = deviceSettingKey(key, true);
			if (key in data && !(mobileKey in data)) data[mobileKey] = data[key];
		}
	},
];

/**
 * Mutates `data` (as loaded straight from data.json) up to the current
 * settings shape, in place. Returns whether anything actually changed, so the
 * caller can decide whether the migrated result is worth persisting right
 * away rather than waiting for the next unrelated settings save.
 */
export function migrateSettings(data: Record<string, unknown>): boolean {
	const savedVersion = typeof data.settingsVersion === "number" ? data.settingsVersion : 0;
	for (let v = savedVersion; v < SETTINGS_MIGRATIONS.length; v++) {
		SETTINGS_MIGRATIONS[v](data);
	}
	data.settingsVersion = SETTINGS_MIGRATIONS.length;
	return savedVersion < SETTINGS_MIGRATIONS.length;
}

export const DEFAULT_SETTINGS: NotesListSettings = {
	settingsVersion: SETTINGS_MIGRATIONS.length,
	folderPath: "",
	includeSubfolders: false,
	contentDisplay: "preview",
	previewLength: 300,
	notesPerPage: 10,
	showNoteName: "whenDifferent",
	showDateGroups: false,
	uniqueNoteNameFormat: DEFAULT_UNIQUE_NOTE_NAME_FORMAT,
	templatePath: "",
	tagTreeExpandLevel: "all",
	mobileContentDisplay: "preview",
	mobilePreviewLength: 300,
	mobileNotesPerPage: 10,
	mobileShowNoteName: "whenDifferent",
	mobileShowDateGroups: false,
	mobileTagTreeExpandLevel: "all",
};
