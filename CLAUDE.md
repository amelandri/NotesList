# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Obsidian community plugin ("Notes List", id `notes-list`) that opens a custom two-column view: a chronological list of notes from one configurable vault folder on the left, and a GitHub-style contribution heatmap of note activity on the right.

## Commands

- `npm run build` — type-check (`tsc -noEmit -skipLibCheck`) then bundle `src/main.ts` → `main.js` via esbuild (production, no sourcemap).
- `npm run dev` — esbuild in watch mode (inline sourcemap), no type-check.
- `npm run install-to-vault` — copies `manifest.json`, `main.js`, `styles.css` into `<vault>/.obsidian/plugins/notes-list/`. Vault path defaults to `/Users/amelandri/Syncthing/TestObsidian`, overridable with `OBSIDIAN_VAULT_PATH`.
- `npm run deploy` — `build` + `install-to-vault`; the normal edit/verify loop for this repo. After deploying, reload Obsidian (`Cmd+R`) to pick up the new `main.js`/`styles.css` — there is no test suite, so this manual reload against the live vault is the only verification step.
- `npm run generate-test-notes -- [count] [folder]` (or `node generate-test-notes.mjs [count] [folder]`) — writes `count` (default 100) throwaway `.md` notes into `<vault>/[folder]` (default `Note`) for load-testing the list/heatmap/tag-tree against a large folder. Same identical multi-paragraph Lorem ipsum body every time (content doesn't affect what's being measured — edit the `BODY` array directly to change its length/shape); `date`/`time` frontmatter randomized across the last 6 months; filenames follow the `YYYYMMDDHHmm` pattern (deduped with a `-2`, `-3`, … suffix on collision) to look like real "Unique note creator" output. Dev-only, not part of the shipped plugin — same `OBSIDIAN_VAULT_PATH` override as `copy-to-vault.mjs`.

There are no automated tests and no linter configured.

## Architecture

- `src/main.ts` — `Plugin` entry point. Registers the `ItemView`, a ribbon icon + command to open it, and the `PluginSettingTab`. Also wires vault (`modify`/`create`/`delete`/`rename`) and `metadataCache` (`changed`) events to a debounced `requestRefresh()` that re-renders any open `NotesListView` leaf. Settings persist via `loadData`/`saveData` (`data.json` in the plugin folder), merged over `DEFAULT_SETTINGS`.
- `src/settings.ts` — the `NotesListSettings` shape and defaults: `folderPath`, `includeSubfolders`, `contentDisplay` (`ContentDisplayMode`: `"full" | "preview"`), `previewLength`, `notesPerPage`, `showNoteName` (`ShowNoteNameMode`: `"never" | "always" | "whenDifferent"`).
- `src/view.ts` — the `ItemView` (`VIEW_TYPE_NOTES_LIST`). `refresh()` (rescans every note in scope, expensive) and `render()` (rebuilds the DOM from scratch — `contentEl.empty()` then re-render, rather than diffing — from the already-scanned `cachedEntries`, cheap) are separate for performance at scale; see "`refresh()` vs `render()`" below.
- `src/heatmap.ts` — pure DOM-rendering function `renderHeatmap(container, dates, selection)`, no plugin/view state (`selection: HeatmapSelection` bundles `selectedDate`/`onSelectDate`/`selectedMonth`/`onSelectMonth` — grouped into one object once the parameter list grew past a couple of callbacks). Buckets note counts per day into a 6-month, GitHub-style week/weekday grid; every real (non-future) day cell gets a tooltip and a click handler calling `onSelectDate` with its `"YYYY-MM-DD"` key (`.is-selected` when it matches `selectedDate`), and the (one per month) visible month label gets a click handler calling `onSelectMonth` with its `"YYYY-MM"` key (`.is-selected`/`.is-clickable` likewise). The legend row ends with `.notes-heatmap-total`, pushed to the row's right edge with `margin-left: auto` since `.notes-heatmap-legend` is a flex row. `renderHeatmap`'s new `visibleCount` parameter (the caller's already-filtered count, e.g. `visibleEntries.length` in `view.ts`) is compared against `dates.length` (every note in scope, unfiltered, not just the ones inside the 6-month window): equal → just the total; otherwise → `"{visibleCount} of {total} notes"`. No separate "is a filter active" flag is threaded through — the two counts simply differing is what drives the "of" format, so it stays correct by construction even if a new filter kind is added later.
- `src/tagTree.ts` — pure functions for the tag browser: `buildTagTree(tags)` groups `#a/b/c`-style tags (as returned by `getAllTags`) into a nested `TagTreeNode` map by splitting on `/`; `renderTagTree(container, root, selectedPath, collapsedPaths, onSelect, onToggleCollapse)` renders it as nested, collapsible `<ul>`s (a chevron toggle appears only on nodes with children); `tagMatchesFilter(tag, filter)` implements Obsidian's usual hierarchical tag semantics (selecting a tag also matches its sub-tags).
- `src/folderSuggest.ts` — `AbstractInputSuggest<TFolder>` used by the folder-path setting field.
- `styles.css` — all view styling, loaded automatically by Obsidian alongside `main.js`/`manifest.json`.

### Note dating convention

A note's date/time comes from its **frontmatter**: `resolveDate()` in `view.ts` reads the `date` and `time` frontmatter properties via `metadataCache.getFileCache(file)?.frontmatter`. Both fields are handled defensively because Obsidian's frontmatter YAML parser uses **YAML 1.1** resolvers (confirmed by extracting and inspecting the app's own bundled `app.js`, and reproduced directly with the `yaml` npm package under `{ schema: "yaml-1.1" }`), which silently auto-cast unquoted scalars that look like something else:

- An unquoted `date: 2026-09-25` resolves to a native JS **`Date`** object (UTC midnight), not a string. `moment(fm.date)` accepts a `Date` directly, so this is fine, but `.startOf("day")` is required afterwards regardless — a `Date`'s `toString()` is timezone-shifted and not reliably midnight, so this is also what guarantees the 00:00 default when `time` is absent.
- An unquoted `time: 16:20` matches YAML 1.1's **sexagesimal (base-60) integer** grammar (`[0-9]+(:[0-5]?[0-9])+`) and resolves to the **number `980`** (`16*60+20`), not the string `"16:20"`. `parseFrontmatterTime()` handles both shapes: a number is decoded back as `hour = floor(n/60), minute = n%60`; a string (or anything else) is parsed strictly against `["HH:mm", "HH:mm:ss"]`. An earlier version of this code only handled the string case, so `time` was silently ignored for every note — quoting the value in frontmatter (`time: "16:20"`) also avoids the sexagesimal resolver entirely, but the plugin no longer depends on the user doing that.

If `date` is missing, or doesn't parse, `resolveDate()` falls back to `file.stat.mtime` (last-modified time, not creation time — an edit with no explicit `date`/`time` set will keep shifting the note's position in the list and its heatmap day). The heatmap consumes the same resolved dates, so it always agrees with the list's ordering. Note this is unrelated to the filename format "Unique note creator" produces (see below) — that integration is only about note *creation*, not dating.

### Content display

`resolveContentDisplay(fm)` in `view.ts` picks the effective mode for a note: its own `content-display` frontmatter property if it's exactly `"full"` or `"preview"`, otherwise `settings.contentDisplay`. `renderEntry()` only truncates the rendered body (to `settings.previewLength` characters) when the resolved mode is `"preview"` — `"full"` always renders the whole body. There's no magic-number sentinel (no `0` meaning "full"); the mode and the length are separate settings.

### Settings tab layout

`NotesListSettingTab.display()` puts every setting except **Notes per page** (its own plain row) inside one of two `SettingGroup`s:

- **"Folder settings"**: **Folder** (text) + **Subfolders** (toggle).
- **"Notes Display"**: **Show note name** (dropdown), **Content display** (dropdown), **Preview length** (text) — always enabled, even though it only affects rendering when Content display (or a note's own `content-display` override) resolves to `"preview"`; it's independent of that other setting rather than reactively disabled, so there's no cross-`Setting` state to wire up between the two `.addSetting()` calls.

Each `SettingGroup.addSetting((setting) => ...)` callback receives an already-constructed `Setting` — the group appends it to its own `listEl` before calling back, so don't `new Setting(...)` again inside the callback (just configure the one you're given). `SettingGroup` is a real Obsidian API class (`obsidian.d.ts`, since **1.11.0**) that renders a heading plus its member settings as one visual block — this is *why* `manifest.json`'s `minAppVersion` is `"1.11.0"` rather than something older; don't lower it without checking every API this plugin touches is still available at the lower version.

Putting each setting in the "Notes Display" group on its **own row** (rather than an earlier design that crammed all three controls onto one `Setting`) also sidesteps a real layout bug: a `Setting`'s `.setDesc()` lives in its `.setting-item-info` column, which flexes against `.setting-item-control` — squeezing 3 controls onto one row left barely any width for a description, so it wrapped down to a couple of characters per line. One control per row means each gets a normal-width `.setDesc()`; there's no longer a need for the `containerEl.createEl("p", ...)` full-width-paragraph workaround an even earlier version of this file used instead. If a future setting ever needs multiple controls crammed onto one row again, watch out for this exact squeeze.

### Show note name

`shouldShowNoteName(file)` in `view.ts` decides whether `renderEntry()` appends the file name below the date link (`.notes-list-title`): `"never"`/`"always"` are direct; `"whenDifferent"` (the default) shows the name only when `!isUniqueNoteName(file.basename, format)` — i.e. the file has been renamed away from whatever pattern "Unique note creator" is currently configured to generate names with.

That format is **read live from the core plugin's own settings**, not hardcoded: `getUniqueNoteNameFormat(app)` calls `internalPlugins(app).getEnabledPluginById("zk-prefixer")?.options?.format` (another undocumented internal surface, alongside `internalVault`/`internalCommands` below) and falls back to `"YYYYMMDDHHmm"` only if that's unset — matching `getFormat()`'s own fallback in the core plugin's source (verified in app.js: `this.options.format` or else that same literal). This way the check stays correct even if the user changes "Unique note creator"'s format setting; this is otherwise unrelated to date resolution, which comes from frontmatter (see above), not the filename.

### "Unique note creator" core plugin — nice to have, not a hard dependency

The list header's "New Note" button invokes Obsidian's core plugin **"Unique note creator"** (internal plugin id `zk-prefixer`, formerly "Zettelkasten Prefixer") if it's enabled in Settings → Core plugins — but nothing else in this plugin requires it. It has no public API or typings, so both integration points go through undocumented internal surfaces, each isolated behind a small typed wrapper in `view.ts`:

- `internalCommands(app).executeCommandById("zk-prefixer")` — triggers unique-note creation from the "New Note" button; a `false` return (command not found, i.e. the core plugin is disabled) surfaces a `Notice` telling the user to enable it, and nothing else in the view is affected.
- `getUniqueNoteNameFormat(app)` (see "Show note name" above) — reads that plugin's configured naming format for `showNoteName: "whenDifferent"`, falling back to its own default format string if the core plugin is disabled or has no custom format set, so that mode degrades gracefully rather than breaking.

If Obsidian changes either internal API in a future release, these two functions in `view.ts` are the only places that need to change.

### Tag, date and month filtering

`NotesListView.selectedTag`, `selectedDate`, `selectedMonth` and `collapsedTagPaths` are transient view state (not persisted to `data.json` — all reset when the view is closed/reopened). `selectedTag` is set from the tag tree under the heatmap panel; `selectedDate` (`"YYYY-MM-DD"`) and `selectedMonth` (`"YYYY-MM"`) are set by clicking a heatmap day cell or a month label, respectively. All three are cleared independently, each via the `x` on its own filter pill next to the "Notes" title (`renderFilterPill()`, shared by all three) — there's no toggle-off-by-clicking-again anywhere (tag tree, day cell, or month label), by design, so removal always goes through the pill. `render()` always builds the tag tree and the heatmap from the *full* unfiltered `cachedEntries` (aliased `allEntries` inside `render()`); only the main notes list (`visibleEntries`) is filtered down to notes matching `selectedTag` (via `tagMatchesFilter`) **and** `selectedDate` (exact match on `entry.date.format("YYYY-MM-DD")`) **and** `selectedMonth` (exact match on `entry.date.format("YYYY-MM")`) when set — all three combine with AND, and any subset can be active at once (e.g. selecting a day inside a selected-but-different month just yields an empty list — the pills stay visible so it's clear why, rather than the filters silently overriding each other). The tag index and activity heatmap stay stable reference points regardless of the current filter. Clicking a tag-tree node's chevron toggles its path in/out of `collapsedTagPaths` and calls `render()` again like any other interaction (the view always rebuilds its whole DOM rather than patching just the tree — see `src/view.ts`'s `render()`).

### `refresh()` vs `render()` — why there are two

`NotesListView` splits its single old `refresh()` method in two, because the per-note scan (`app.metadataCache.getFileCache(file)`, `resolveDate()`, `getAllTags()` for *every* note in scope) is the one genuinely expensive step once a folder has thousands of notes — measurably slow (multiple seconds) at ~8000 notes, even though each note's individual cost is small:

- `rebuildEntries()` does that scan once and stores the sorted result in `cachedEntries` (a `TFile` reference + resolved date + tags per note — never file content). It also fixes a redundant double `getFileCache()` call an earlier version had (`resolveDate()` now takes the already-fetched `cache` as a parameter instead of re-fetching it).
- `render()` is everything else — filtering `cachedEntries` by the active tag/date/month, paginating, building the heatmap and tag tree, and rendering the DOM. All of that is proportional to *small* bounded quantities (`notesPerPage`, ~26 heatmap weeks, the unique-tag count), not to the total note count, so it's fast regardless of folder size.
- `refresh()` is now just `rebuildEntries()` + `render()` — kept as the public entry point so `main.ts` (vault events, settings changes) and `onOpen()` don't need to change; they still call something that guarantees fresh data.

Every interaction that only changes *view* state — clearing or selecting a tag/day/month filter, expanding/collapsing a tag-tree node, changing page, toggling the `readableLineLength` CSS class — calls `render()` directly instead of `refresh()`. None of those can add, remove, or change the metadata of a note, so re-scanning the whole folder for them would be pure waste. If you add a new interaction, ask whether it can possibly change which notes are in scope or their resolved date/tags: if not, wire it to `render()`, not `refresh()`.

### Pagination

`NotesListView.currentPage` (transient, like `selectedTag`) is clamped into `[1, totalPages]` on every `render()` based on `visibleEntries.length` and `settings.notesPerPage`, then `visibleEntries` is sliced to just that page's window (`pageEntries`) **before** calling `renderEntry()` — the only step that actually reads file content (`vault.cachedRead`) and runs `MarkdownRenderer.render`. This is what keeps a large watched folder fast to page through *within* a single `render()`: the expensive-per-`render()` work scales with `notesPerPage`, not with the total note count (`rebuildEntries()`'s one-time scan, above, is the part that scales with total count). `renderPagination()` renders prev/next buttons only when a previous/next page exists, and windows the page-number buttons to at most 5, sliding to keep `currentPage` inside the window (clamped at both ends so it never shows fewer than 5 when `totalPages >= 5`). Selecting or clearing any of the three filters always resets `currentPage` to 1; other refresh triggers (vault events, settings changes) just re-clamp it, so unrelated background updates don't kick you back to page 1 mid-browsing.

### Readable line length

`internalVault(app).getConfig("readableLineLength")` / `.on("config-changed", ...)` — an undocumented internal Vault surface, unrelated to "Unique note creator" — reads and watches Obsidian's editor-wide "Readable line length" setting, so the notes column's `is-readable-line-width` class (and thus its `max-width: var(--file-line-width)`) mirrors the same core mechanism used by `.markdown-preview-view.is-readable-line-width` (confirmed by inspecting the app's own `app.css`/`app.js`).

### Layout

`.notes-list-view` (the `ItemView`'s `contentEl`) is the single scroll container (`overflow-y: auto`, no padding of its own), so the browser's scrollbar sits at the pane's real right edge, same as any other Obsidian view. The visual inset (`padding: var(--size-4-4)`) lives one level in, on `.notes-list-layout` (the flex row: `.notes-list-main`, flex-grow, and `.notes-list-heatmap-panel`, `flex: 0 0 auto`, sized to its own content and never shrinking).

The heatmap panel is `position: sticky` with `top: var(--size-4-4)` — matching `.notes-list-layout`'s padding-top exactly, since the panel already sits that far from the scroll container's top before any scrolling happens; if `top` didn't match, the panel would visibly slide up by the difference before locking in place on the first scroll. This keeps the heatmap pinned and fully visible while the notes list scrolls past beside it.

### Heatmap edge-cell clipping

`.notes-heatmap-scroller` sets `overflow-x: auto` for horizontal scrolling of the grid — but per the CSS overflow spec, setting only one axis to a non-`visible` value implicitly computes the other axis (`overflow-y`, left unset) to `auto` as well, so it clips in *both* directions. Selected day cells and month labels are highlighted with `outline`, which paints outside the element's box; without padding on the scroller, cells flush against its edge (first/last week column, top/bottom row) had their outline clipped by that implicit clipping box. `.notes-heatmap-scroller` carries a small `padding` (3px) on every side specifically to leave room for that outline — removing it (or setting it back to a bottom-only `padding-bottom`) reintroduces the clipping.

### Text selection

Obsidian sets `body { user-select: none }` globally (confirmed in the app's own `app.css`) and only re-enables it on its own reading/editing views and `[contenteditable]` elements — a custom `ItemView` like this one isn't covered by that allowlist by default. `.notes-list-item` opts back into `user-select: text` explicitly for that reason. Any new custom sub-view added here that should have selectable text needs the same opt-in.
