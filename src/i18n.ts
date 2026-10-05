import { getLanguage } from "obsidian";

// UI strings, one table per language. English is the complete base: its keys
// are the only valid ones (MessageKey), and every other table must have them
// all (enforced by the Translations type and by test/i18n.test.ts). The app
// language comes from Obsidian's own setting (getLanguage(), read once:
// changing it in Obsidian needs a restart anyway); an unknown language falls
// back to English.
//
// "{name}" in a string is a placeholder filled from t()'s vars. A plural entry
// has one form per Intl.PluralRules category the language uses ("one",
// "other", ...); "other" is required and is the fallback for any category a
// table leaves out. Whole sentences live here, never fragments assembled in
// code, since word order and agreement differ between languages.

type Plural = { one?: string; few?: string; many?: string; other: string };

const en = {
	// Commands and ribbon
	"command.open": "Open",
	"command.createNote": "Create new note",
	"command.search": "Search notes",
	"ribbon.open": "Open notes list",

	// View
	"view.title": "Notes list",
	"view.modeNotes": "Notes",
	"view.modeTasks": "Open tasks",
	"tasksView.empty": "No open tasks in these notes.",
	"tasksView.emptyFiltered": "No open tasks match: {filters}.",
	"tasksView.groupCount": { one: "{count} task", other: "{count} tasks" },
	"tasksView.openNote": "Open {note}",
	"view.activity": "Activity",
	"view.tags": "Tags",
	"view.newNote": "New note",
	"view.readMore": "Continue reading",
	"view.search": "Search",
	"view.searchPlaceholder": "Search notes",
	"view.firstPage": "First page",
	"view.previousPage": "Previous page",
	"view.nextPage": "Next page",
	"view.lastPage": "Last page",
	"view.pinNote": "Pin note",
	"view.unpinNote": "Unpin note",
	"view.emptyFolder": "No notes found in the configured folder.",
	"view.emptyFiltered": "No notes match: {filters}.",
	"view.clearSearch": "Clear search",
	"view.clearTag": "Clear tag filter",
	"view.clearDate": "Clear date filter",
	"view.clearMonth": "Clear month filter",
	"view.taskUpdateFailed": "Couldn't update the task: the note has changed. Try again in a moment.",
	"view.taskCounter": { one: "{done} of {count} task completed", other: "{done} of {count} tasks completed" },

	// Date group headers
	"group.today": "Today",
	"group.yesterday": "Yesterday",
	"group.thisWeek": "This week",
	"group.older": "Older",

	// Tags and tasks
	"tags.none": "No tags.",
	"tags.untagged": "Untagged",

	// Heatmap
	"heatmap.less": "Less",
	"heatmap.more": "More",
	"heatmap.cell": { one: "{count} note — {date}", other: "{count} notes — {date}" },
	"heatmap.total": { one: "{count} note", other: "{count} notes" },
	"heatmap.totalFiltered": { one: "{visible} of {count} note", other: "{visible} of {count} notes" },

	// Notices
	"notice.templateNotFound": 'Notes List: template not found at "{path}". Check the Template setting.',
	"notice.templateNoTimestamp":
		'Notes List: the template note "{path}" is missing a "timestamp" property in its frontmatter. Add one (any value) to use it as a template.',
	"notice.createFailed": "Could not create the note — see the developer console for details.",

	// Settings
	"settings.folderGroup": "Folder and files",
	"settings.folder": "Folder",
	"settings.folderDesc": "Vault folder to watch (empty = entire vault)",
	"settings.folderPlaceholder": "e.g. Journal",
	"settings.subfolders": "Subfolders",
	"settings.subfoldersDesc": "Also show notes from its subfolders.",
	"settings.template": "Template",
	"settings.templateDesc":
		'Optional note to use as a template for new notes created with the New note button (empty = a blank note). The template must have a "timestamp" property in its frontmatter.',
	"settings.templatePlaceholder": "e.g. Templates/Daily note.md",
	"settings.uniqueName": "Unique note name format",
	"settings.uniqueNameDesc":
		'moment.js format for the New note button\'s auto-generated file name, and for recognizing a note as still using it ("Show note name" below).',
	"settings.notesListGroup": "Notes list",
	"settings.deviceNote": "Device-specific settings",
	"settings.deviceNoteDesktop":
		"The settings in this section and in the sidebar section are saved separately for each kind of device. Changes made here apply only to the desktop app; the mobile app keeps its own values.",
	"settings.deviceNoteMobile":
		"The settings in this section and in the sidebar section are saved separately for each kind of device. Changes made here apply only to the mobile app (phone and tablet); the desktop app keeps its own values.",
	"settings.showNoteName": "Show note name",
	"settings.showNoteNameDesc": "Whether to show each note's file name.",
	"settings.showNoteName.never": "Never",
	"settings.showNoteName.always": "Always",
	"settings.showNoteName.whenDifferent": "When different from unique note name",
	"settings.contentDisplay": "Content display",
	"settings.contentDisplayDesc":
		'Show a note\'s full content or a truncated preview. A note can override this with its "content-display" frontmatter property.',
	"settings.contentDisplay.full": "Full",
	"settings.contentDisplay.preview": "Preview",
	"settings.previewLength": "Preview length",
	"settings.previewLengthDesc": "Maximum number of characters shown when Content display is set to Preview.",
	"settings.dateGroups": "Show date group headers",
	"settings.dateGroupsDesc": 'Show "Today" / "Yesterday" / "This week" / "Older" headers above notes in the list.',
	"settings.notesPerPage": "Notes per page",
	"settings.notesPerPageDesc": "Number of notes shown per page in the list.",
	"settings.sidebarGroup": "Sidebar",
	"settings.tagTreeExpansion": "Tag tree expansion",
	"settings.tagTreeExpansionDesc":
		"How far the tag tree is expanded when it's shown. You can still expand or collapse any tag by hand.",
	"settings.tagTreeExpansion.1": "Fully collapsed",
	"settings.tagTreeExpansion.2": "Expand to level 2",
	"settings.tagTreeExpansion.3": "Expand to level 3",
	"settings.tagTreeExpansion.all": "Fully expanded",
	"settings.positiveInteger": "Enter a whole number greater than 0.",
} satisfies Record<string, string | Plural>;

export type MessageKey = keyof typeof en;
type Translations = { [K in MessageKey]: (typeof en)[K] extends string ? string : Plural };

const it: Translations = {
	"command.open": "Apri",
	"command.createNote": "Crea nuova nota",
	"command.search": "Cerca nelle note",
	"ribbon.open": "Apri l'elenco delle note",

	"view.title": "Elenco note",
	"view.modeNotes": "Note",
	"view.modeTasks": "Task aperti",
	"tasksView.empty": "Nessun task aperto in queste note.",
	"tasksView.emptyFiltered": "Nessun task aperto corrisponde a: {filters}.",
	"tasksView.groupCount": { one: "{count} task", other: "{count} task" },
	"tasksView.openNote": "Apri {note}",
	"view.activity": "Attività",
	"view.tags": "Tag",
	"view.newNote": "Nuova nota",
	"view.readMore": "Continua a leggere",
	"view.search": "Cerca",
	"view.searchPlaceholder": "Cerca nelle note",
	"view.firstPage": "Prima pagina",
	"view.previousPage": "Pagina precedente",
	"view.nextPage": "Pagina successiva",
	"view.lastPage": "Ultima pagina",
	"view.pinNote": "Fissa la nota",
	"view.unpinNote": "Non fissare più",
	"view.emptyFolder": "Nessuna nota nella cartella configurata.",
	"view.emptyFiltered": "Nessuna nota corrisponde a: {filters}.",
	"view.clearSearch": "Cancella la ricerca",
	"view.clearTag": "Rimuovi il filtro per tag",
	"view.clearDate": "Rimuovi il filtro per giorno",
	"view.clearMonth": "Rimuovi il filtro per mese",
	"view.taskUpdateFailed": "Impossibile aggiornare il task: la nota è cambiata. Riprova tra un momento.",
	"view.taskCounter": { one: "{done} di {count} task completato", other: "{done} di {count} task completati" },

	"group.today": "Oggi",
	"group.yesterday": "Ieri",
	"group.thisWeek": "Questa settimana",
	"group.older": "Meno recenti",

	"tags.none": "Nessun tag.",
	"tags.untagged": "Senza tag",

	"heatmap.less": "Meno",
	"heatmap.more": "Più",
	"heatmap.cell": { one: "{count} nota — {date}", other: "{count} note — {date}" },
	"heatmap.total": { one: "{count} nota", other: "{count} note" },
	"heatmap.totalFiltered": { one: "{visible} di {count} nota", other: "{visible} di {count} note" },

	"notice.templateNotFound": 'Notes List: template non trovato in "{path}". Controlla l\'impostazione Template.',
	"notice.templateNoTimestamp":
		'Notes List: nel frontmatter della nota template "{path}" manca la proprietà "timestamp". Aggiungila (con qualsiasi valore) per usarla come template.',
	"notice.createFailed": "Impossibile creare la nota: trovi i dettagli nella console per sviluppatori.",

	"settings.folderGroup": "Cartella e file",
	"settings.folder": "Cartella",
	"settings.folderDesc": "Cartella del vault da mostrare (vuoto = tutto il vault)",
	"settings.folderPlaceholder": "es. Diario",
	"settings.subfolders": "Sottocartelle",
	"settings.subfoldersDesc": "Mostra anche le note delle sue sottocartelle.",
	"settings.template": "Template",
	"settings.templateDesc":
		'Nota facoltativa da usare come template per le note create con il pulsante Nuova nota (vuoto = nota vuota). Il template deve avere la proprietà "timestamp" nel frontmatter.',
	"settings.templatePlaceholder": "es. Template/Nota del giorno.md",
	"settings.uniqueName": "Formato del nome univoco",
	"settings.uniqueNameDesc":
		'Formato moment.js per il nome generato dal pulsante Nuova nota, usato anche per riconoscere le note che lo mantengono ("Mostra il nome della nota", più sotto).',
	"settings.notesListGroup": "Elenco note",
	"settings.deviceNote": "Impostazioni per dispositivo",
	"settings.deviceNoteDesktop":
		"Le impostazioni di questa sezione e della sezione Barra laterale sono salvate separatamente per ogni tipo di dispositivo. Le modifiche fatte qui valgono solo per l'app desktop; l'app mobile mantiene i propri valori.",
	"settings.deviceNoteMobile":
		"Le impostazioni di questa sezione e della sezione Barra laterale sono salvate separatamente per ogni tipo di dispositivo. Le modifiche fatte qui valgono solo per l'app mobile (telefono e tablet); l'app desktop mantiene i propri valori.",
	"settings.showNoteName": "Mostra il nome della nota",
	"settings.showNoteNameDesc": "Se mostrare il nome del file di ogni nota.",
	"settings.showNoteName.never": "Mai",
	"settings.showNoteName.always": "Sempre",
	"settings.showNoteName.whenDifferent": "Quando è diverso dal nome univoco",
	"settings.contentDisplay": "Visualizzazione del contenuto",
	"settings.contentDisplayDesc":
		'Mostra tutto il contenuto della nota oppure un\'anteprima. Una nota può cambiarlo con la proprietà "content-display" nel frontmatter.',
	"settings.contentDisplay.full": "Completo",
	"settings.contentDisplay.preview": "Anteprima",
	"settings.previewLength": "Lunghezza dell'anteprima",
	"settings.previewLengthDesc":
		"Numero massimo di caratteri mostrati quando Visualizzazione del contenuto è impostata su Anteprima.",
	"settings.dateGroups": "Mostra le intestazioni dei periodi",
	"settings.dateGroupsDesc":
		'Mostra le intestazioni "Oggi" / "Ieri" / "Questa settimana" / "Meno recenti" sopra le note della lista.',
	"settings.notesPerPage": "Note per pagina",
	"settings.notesPerPageDesc": "Numero di note mostrate in ogni pagina della lista.",
	"settings.sidebarGroup": "Barra laterale",
	"settings.tagTreeExpansion": "Espansione dell'albero dei tag",
	"settings.tagTreeExpansionDesc":
		"Fino a che livello l'albero dei tag è aperto quando viene mostrato. Puoi comunque aprire o chiudere a mano ogni tag.",
	"settings.tagTreeExpansion.1": "Tutto chiuso",
	"settings.tagTreeExpansion.2": "Aperto fino al livello 2",
	"settings.tagTreeExpansion.3": "Aperto fino al livello 3",
	"settings.tagTreeExpansion.all": "Tutto aperto",
	"settings.positiveInteger": "Inserisci un numero intero maggiore di 0.",
};

export const TRANSLATIONS: Record<string, Translations> = { en, it };

let language: string | null = null;

function currentLanguage(): string {
	language ??= getLanguage();
	return language;
}

/** Overrides the app language (tests only). */
export function setLanguage(lang: string): void {
	language = lang;
}

function table(): Translations {
	return TRANSLATIONS[currentLanguage()] ?? TRANSLATIONS[currentLanguage().split("-")[0]] ?? en;
}

function fill(text: string, vars: Record<string, string | number>): string {
	return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

type StringKey = { [K in MessageKey]: (typeof en)[K] extends string ? K : never }[MessageKey];
type PluralKey = Exclude<MessageKey, StringKey>;

/** A UI string in the app language, with its "{name}" placeholders filled from `vars`. */
export function t(key: StringKey, vars: Record<string, string | number> = {}): string {
	return fill(table()[key], vars);
}

/** A count-dependent UI string: the plural form for `count` in the app language, with "{count}" and `vars` filled. */
export function tn(key: PluralKey, count: number, vars: Record<string, string | number> = {}): string {
	const forms = table()[key];
	let category: string;
	try {
		category = new Intl.PluralRules(currentLanguage()).select(count);
	} catch {
		category = "other";
	}
	const form = forms[category as keyof Plural] ?? forms.other;
	return fill(form, { ...vars, count });
}
