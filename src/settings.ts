export type ShowNoteNameMode = "never" | "always" | "whenDifferent";
export type ContentDisplayMode = "full" | "preview";

export interface NotesListSettings {
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
}

export const DEFAULT_SETTINGS: NotesListSettings = {
	folderPath: "",
	includeSubfolders: false,
	contentDisplay: "preview",
	previewLength: 300,
	notesPerPage: 10,
	showNoteName: "whenDifferent",
};
