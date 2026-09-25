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
- `src/settings.ts` — the `NotesListSettings` shape and defaults: `folderPath`, `includeSubfolders`, `contentPreviewChars`, `notesPerPage`.
- `src/view.ts` — the `ItemView` (`VIEW_TYPE_NOTES_LIST`). `refresh()` is the single render entry point: it resolves the note set in scope, sorts descending by date, and rebuilds the DOM from scratch (`contentEl.empty()` then re-render) rather than diffing.
- `src/heatmap.ts` — pure DOM-rendering function (`renderHeatmap(container, dates)`), no plugin/view state. Buckets note counts per day into a 6-month, GitHub-style week/weekday grid.
- `src/tagTree.ts` — pure functions for the tag browser: `buildTagTree(tags)` groups `#a/b/c`-style tags (as returned by `getAllTags`) into a nested `TagTreeNode` map by splitting on `/`; `renderTagTree(container, root, selectedPath, collapsedPaths, onSelect, onToggleCollapse)` renders it as nested, collapsible `<ul>`s (a chevron toggle appears only on nodes with children); `tagMatchesFilter(tag, filter)` implements Obsidian's usual hierarchical tag semantics (selecting a tag also matches its sub-tags).
- `src/folderSuggest.ts` — `AbstractInputSuggest<TFolder>` used by the folder-path setting field.
- `styles.css` — all view styling, loaded automatically by Obsidian alongside `main.js`/`manifest.json`.

### Note dating convention

A note's date/time comes from its **frontmatter**: `resolveDate()` in `view.ts` reads the `date` and `time` frontmatter properties via `metadataCache.getFileCache(file)?.frontmatter`. Both fields are handled defensively because Obsidian's frontmatter YAML parser uses **YAML 1.1** resolvers (confirmed by extracting and inspecting the app's own bundled `app.js`, and reproduced directly with the `yaml` npm package under `{ schema: "yaml-1.1" }`), which silently auto-cast unquoted scalars that look like something else:

- An unquoted `date: 2026-09-25` resolves to a native JS **`Date`** object (UTC midnight), not a string. `moment(fm.date)` accepts a `Date` directly, so this is fine, but `.startOf("day")` is required afterwards regardless — a `Date`'s `toString()` is timezone-shifted and not reliably midnight, so this is also what guarantees the 00:00 default when `time` is absent.
- An unquoted `time: 16:20` matches YAML 1.1's **sexagesimal (base-60) integer** grammar (`[0-9]+(:[0-5]?[0-9])+`) and resolves to the **number `980`** (`16*60+20`), not the string `"16:20"`. `parseFrontmatterTime()` handles both shapes: a number is decoded back as `hour = floor(n/60), minute = n%60`; a string (or anything else) is parsed strictly against `["HH:mm", "HH:mm:ss"]`. An earlier version of this code only handled the string case, so `time` was silently ignored for every note — quoting the value in frontmatter (`time: "16:20"`) also avoids the sexagesimal resolver entirely, but the plugin no longer depends on the user doing that.

If `date` is missing, or doesn't parse, `resolveDate()` falls back to `file.stat.mtime` (last-modified time, not creation time — an edit with no explicit `date`/`time` set will keep shifting the note's position in the list and its heatmap day). The heatmap consumes the same resolved dates, so it always agrees with the list's ordering. Note this is unrelated to the filename format "Unique note creator" produces (see below) — that dependency is only about note *creation*, not dating.

### Dependency on the "Unique note creator" core plugin

The list header's "New Note" button does not create files itself — it invokes Obsidian's core plugin **"Unique note creator"** (internal plugin id `zk-prefixer`, formerly "Zettelkasten Prefixer"; must be enabled in Settings → Core plugins). This plugin has no public API or typings, so the integration goes through two undocumented internal surfaces, each isolated behind a small typed wrapper in `view.ts`:

- `internalVault(app).getConfig("readableLineLength")` / `.on("config-changed", ...)` — reads and watches Obsidian's editor-wide "Readable line length" setting, so the notes column's `is-readable-line-width` class (and thus its `max-width: var(--file-line-width)`) mirrors the same core mechanism used by `.markdown-preview-view.is-readable-line-width` (confirmed by inspecting the app's own `app.css`/`app.js`).
- `internalCommands(app).executeCommandById("zk-prefixer")` — triggers unique-note creation; a `false` return (command not found, i.e. the core plugin is disabled) surfaces a `Notice` telling the user to enable it.

If Obsidian changes either internal API in a future release, these two wrapper functions in `view.ts` are the only places that need to change.

### Tag filtering

`NotesListView.selectedTag` and `NotesListView.collapsedTagPaths` are transient view state (not persisted to `data.json` — both reset when the view is closed/reopened). `selectedTag` is set when a tag's label is clicked in the tag tree under the heatmap panel and cleared via the `x` on the filter pill next to the "Notes" title. `refresh()` always builds the tag tree and the heatmap from the *full* unfiltered note set in scope, but only the main notes list is filtered down to notes matching `selectedTag` (via `tagMatchesFilter`) — so the tag index and activity heatmap stay stable reference points regardless of the current filter. Clicking a node's chevron toggles its path in/out of `collapsedTagPaths` and calls `refresh()` again like any other interaction (the view always rebuilds its whole DOM rather than patching just the tree — see `src/view.ts`'s `refresh()`).

### Pagination

`refresh()` computes `allEntries`/`visibleEntries` (after tag filtering) cheaply for every note in scope — those only ever hold a `TFile` reference plus already-cached metadata (resolved date, tags via `getAllTags`), never file content. `NotesListView.currentPage` (transient, like `selectedTag`) is clamped into `[1, totalPages]` on every `refresh()` based on `visibleEntries.length` and `settings.notesPerPage`, then `visibleEntries` is sliced to just that page's window (`pageEntries`) **before** calling `renderEntry()` — the only step that actually reads file content (`vault.cachedRead`) and runs `MarkdownRenderer.render`. This is what keeps a large watched folder fast to page through: the expensive per-note work scales with `notesPerPage`, not with the total note count. `renderPagination()` renders prev/next buttons only when a previous/next page exists, and windows the page-number buttons to at most 5, sliding to keep `currentPage` inside the window (clamped at both ends so it never shows fewer than 5 when `totalPages >= 5`). Selecting or clearing a tag filter always resets `currentPage` to 1; other refresh triggers (vault events, settings changes) just re-clamp it, so unrelated background updates don't kick you back to page 1 mid-browsing.

### Layout

`.notes-list-view` (the `ItemView`'s `contentEl`) is the single scroll container (`overflow-y: auto`, no padding of its own), so the browser's scrollbar sits at the pane's real right edge, same as any other Obsidian view. The visual inset (`padding: var(--size-4-4)`) lives one level in, on `.notes-list-layout` (the flex row: `.notes-list-main`, flex-grow, and `.notes-list-heatmap-panel`, `flex: 0 0 auto`, sized to its own content and never shrinking).

The heatmap panel is `position: sticky` with `top: var(--size-4-4)` — matching `.notes-list-layout`'s padding-top exactly, since the panel already sits that far from the scroll container's top before any scrolling happens; if `top` didn't match, the panel would visibly slide up by the difference before locking in place on the first scroll. This keeps the heatmap pinned and fully visible while the notes list scrolls past beside it.

### Text selection

Obsidian sets `body { user-select: none }` globally (confirmed in the app's own `app.css`) and only re-enables it on its own reading/editing views and `[contenteditable]` elements — a custom `ItemView` like this one isn't covered by that allowlist by default. `.notes-list-item` opts back into `user-select: text` explicitly for that reason. Any new custom sub-view added here that should have selectable text needs the same opt-in.
