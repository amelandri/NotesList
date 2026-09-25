export interface NotesListSettings {
	/** Folder to watch, relative to the vault root. Empty = entire vault. */
	folderPath: string;
	/** Also include subfolders of folderPath. */
	includeSubfolders: boolean;
	/** Maximum number of content characters to show per note. 0 = full content. */
	contentPreviewChars: number;
	/** Number of notes shown per page in the list. */
	notesPerPage: number;
}

export const DEFAULT_SETTINGS: NotesListSettings = {
	folderPath: "",
	includeSubfolders: false,
	contentPreviewChars: 300,
	notesPerPage: 10,
};
