export interface NotesListSettings {
	/** Folder to watch, relative to the vault root. Empty = entire vault. */
	folderPath: string;
	/** Also include subfolders of folderPath. */
	includeSubfolders: boolean;
	/** Show each note's tags. */
	showTags: boolean;
	/** Maximum number of content characters to show per note. 0 = full content. */
	contentPreviewChars: number;
}

export const DEFAULT_SETTINGS: NotesListSettings = {
	folderPath: "",
	includeSubfolders: false,
	showTags: true,
	contentPreviewChars: 300,
};
