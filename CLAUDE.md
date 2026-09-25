# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Obsidian community plugin ("Notes List", id `notes-list`) that opens a custom two-column view: a chronological list of notes from one configurable vault folder on the left, and a GitHub-style contribution heatmap of note activity on the right.

## Commands

- `npm run build` — type-check (`tsc -noEmit -skipLibCheck`) then bundle `src/main.ts` → `main.js` via esbuild (production, no sourcemap).
- `npm run dev` — esbuild in watch mode (inline sourcemap), no type-check.
- `npm run install-to-vault` — copies `manifest.json`, `main.js`, `styles.css` into `<vault>/.obsidian/plugins/notes-list/`. Vault path defaults to `/Users/amelandri/Syncthing/TestObsidian`, overridable with `OBSIDIAN_VAULT_PATH`.
- `npm run deploy` — `build` + `install-to-vault`; the normal edit/verify loop for this repo. After deploying, reload Obsidian (`Cmd+R`) to pick up the new `main.js`/`styles.css` — there is no test suite, so this manual reload against the live vault is the only verification step.

There are no automated tests and no linter configured.

## Architecture

- `src/main.ts` — `Plugin` entry point. Registers the `ItemView`, a ribbon icon + command to open it, and the `PluginSettingTab`. Also wires vault (`modify`/`create`/`delete`/`rename`) and `metadataCache` (`changed`) events to a debounced `requestRefresh()` that re-renders any open `NotesListView` leaf. Settings persist via `loadData`/`saveData` (`data.json` in the plugin folder), merged over `DEFAULT_SETTINGS`.
- `src/settings.ts` — the `NotesListSettings` shape and defaults: `folderPath`, `includeSubfolders`, `showTags`, `contentPreviewChars`.
- `src/view.ts` — the `ItemView` (`VIEW_TYPE_NOTES_LIST`). `refresh()` is the single render entry point: it resolves the note set in scope, sorts descending by date, and rebuilds the DOM from scratch (`contentEl.empty()` then re-render) rather than diffing.
- `src/heatmap.ts` — pure DOM-rendering function (`renderHeatmap(container, dates)`), no plugin/view state. Buckets note counts per day into a 6-month, GitHub-style week/weekday grid.
- `src/folderSuggest.ts` — `AbstractInputSuggest<TFolder>` used by the folder-path setting field.
- `styles.css` — all view styling, loaded automatically by Obsidian alongside `main.js`/`manifest.json`.

### Note dating convention

A note's date/time is derived from its **filename**, not frontmatter: `resolveDate()` in `view.ts` parses `file.basename` strictly against `YYYYMMDDHHmm` (moment, strict mode) and falls back to `file.stat.ctime` only if that parse fails. This is the same filename format produced by Obsidian's "Unique note creator" core plugin (see below), so the two features are designed to work together. The heatmap consumes the same resolved dates, so it always agrees with the list's ordering.

### Dependency on the "Unique note creator" core plugin

The list header's "New Note" button does not create files itself — it invokes Obsidian's core plugin **"Unique note creator"** (internal plugin id `zk-prefixer`, formerly "Zettelkasten Prefixer"; must be enabled in Settings → Core plugins). This plugin has no public API or typings, so the integration goes through two undocumented internal surfaces, each isolated behind a small typed wrapper in `view.ts`:

- `internalVault(app).getConfig("readableLineLength")` / `.on("config-changed", ...)` — reads and watches Obsidian's editor-wide "Readable line length" setting, so the notes column's `is-readable-line-width` class (and thus its `max-width: var(--file-line-width)`) mirrors the same core mechanism used by `.markdown-preview-view.is-readable-line-width` (confirmed by inspecting the app's own `app.css`/`app.js`).
- `internalCommands(app).executeCommandById("zk-prefixer")` — triggers unique-note creation; a `false` return (command not found, i.e. the core plugin is disabled) surfaces a `Notice` telling the user to enable it.

If Obsidian changes either internal API in a future release, these two wrapper functions in `view.ts` are the only places that need to change.

### Layout

The view content is a flex row (`.notes-list-layout`): `.notes-list-main` (flex-grow, `overflow-y: auto`, scrolls independently) and `.notes-list-heatmap-panel` (`flex: 0 0 auto`, sized to its own content, never shrinks). Because only the notes column scrolls, the heatmap panel stays fully visible without needing `position: sticky`.
