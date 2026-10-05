# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- An "Open tasks" view, switched from the notes header: every open task in the listed notes, in one list, grouped by the exact combination of their tags (e.g. "#alpha + #work"): a task's own tags, written on its line, when it has any, otherwise its note's. Tasks with no tags at all get their own group. Tasks can be checked off right there, and each links to its note. The sidebar's search and filters narrow it too.

### Removed

- The "Tasks" section in the sidebar (filter by any / open / completed tasks). The "Open tasks" view now covers open tasks; the task counter on each note stays.

## [0.2.5] - 2026-10-04

### Added

- Italian translation. The plugin follows Obsidian's language setting, and falls back to English for languages it doesn't have yet. Plurals follow each language's own rules, and the "no notes" message now lists the active filters by the same labels as their pills. Heatmap month labels always start with a capital letter, also in languages that write month names in lower case.

### Changed

- A note cut short in the list is now clearly marked: a "Continue reading" link below it opens the note. This replaces the "…" that used to end the preview, which was easy to miss.
- The pagination bar also has buttons to jump to the first and the last page.
- On desktop, the new note button in the notes header is now labeled "New note" next to its "+" icon and uses the accent color. The single-column layout keeps its icon-only button next to search.

### Fixed

- In the single-column layout, date group headers ("Today", "This week"…) no longer overlap the note above them: the negative top margin that tightens the two-column list doesn't apply there.
- Heatmap month labels are easier to click: the whole month name responds, not just its first letter, and the click area is taller.
- Task checkboxes in the list line up with their text, as in Obsidian's reading view, instead of sitting slightly above it.

## [0.2.4] - 2026-10-01

### Added

- Each note shows its tags in a row below its content, collected from both the frontmatter `tags` property and the body. Inline tags are removed from the displayed text (except inside code), so they no longer appear as part of it. Clicking a tag filters the list by it.
- A `<!-- more -->` marker in a note sets exactly where its preview ends. It takes priority over the Content display and Preview length settings, while a note's own `content-display: full` still shows the whole note. See "Preview break" in the README.
- A "Tasks" section in the sidebar, under the tags, filters the list to notes with any task, with open tasks or with completed tasks, each with a note count. Notes with tasks also show a "completed/total" counter next to the bookmark.

### Changed

- The pagination bar shows up to 10 page numbers instead of 5. The single-column (mobile) layout keeps 5, so the bar still fits on one row.
- Double-clicking a note's file name (when shown) opens the note, like double-clicking its content.
- In the single-column layout, the Tags and Tasks sections sit side by side, half the width each; an opened one shows its content below them at full width. Notes are also spaced more tightly there.
- The sidebar now starts level with the first item of the notes list (a date group header, or the first note), instead of with the "Notes" title.

### Fixed

- Checking or unchecking a task in the list now saves it to the note. Before, the checkbox changed on screen only.
- The list keeps its scroll position when it refreshes in the background, for example right after opening a note, instead of jumping back to the top. Changing page, filters or search still starts from the top.

## [0.2.3] - 2026-09-30

### Added

- Separate desktop and mobile values for all the "Notes list" and "Sidebar" settings (note name, content display, preview length, date group headers, notes per page, tag tree expansion). Each setting still appears once in the settings tab, and changing it only affects the kind of device you're on. Existing values are copied to both on upgrade.
- An "Untagged" entry, always last in the tag list, that filters the list to notes with no tags, with its own note count.
- `--notes-list-panel-title-font-size` and `--notes-list-mobile-panel-title-font-size` CSS variables, for the size of the "Notes", "Activity" and "Tags" section titles.

### Changed

- In the single-column layout, the search button shows a magnifier icon instead of its label, and the new note button sits right next to it instead of floating in the bottom-right corner. The layout also drops its outer padding, to use the whole screen width.

### Fixed

- Heatmap month labels no longer overlap: a month that only spans one week column (typically the first one) shows just its initial, e.g. "S.", with the full name in the tooltip.

## [0.2.2] - 2026-09-30

### Added

- CSS variables to customize the size of the notes' text, date and file name, and the content's line height, with separate `--notes-list-mobile-…` variants for the single-column layout. See "Customizing font sizes" in the README.

### Changed

- In the single-column layout, the new note button is now a floating, accent-colored button in the bottom-right corner.

## [0.2.1] - 2026-09-29

### Fixed

- The view is now usable on phones and in narrow panes: below 720 px of width it switches to a single column with search, heatmap, active filters, tags and then the notes list. In this layout the Tags section is collapsible, collapsed by default, and folds back after a tag is selected, and the heatmap stretches to the full width.

## [0.2.0] - 2026-09-29

### Added

- Full-text search: a search field at the top of the sidebar filters the list to notes whose name or body contains every search term. Search runs on submit (button or Enter), not while typing, and combines with the tag, day and month filters.
- "Search notes" command, which opens the view with the search field focused. While the view is focused, `Mod+F` and `/` also focus the search field.
- "Tag tree expansion" setting (new "Sidebar" group) to choose how far the tag tree starts expanded: level 1, 2, 3 or fully expanded (default).

### Changed

- Slightly adjusted the spacing below a note's title.

## [0.1.6] - 2026-09-29

### Fixed

- Tables and code blocks inside notes now render with Obsidian's own styles instead of bare browser styles ([#1], [#2]).
- Double-clicking a code block's copy button no longer also opens the note.
- Content previews no longer cut through the middle of a code block or table, which used to render broken; the preview extends to the end of that block instead.

## [0.1.5] - 2026-09-29

### Changed

- **Requires Obsidian 1.13.0 or later.**
- The settings tab uses Obsidian's declarative settings API, so every setting now shows up in Obsidian's settings search. Folder and template pickers use Obsidian's built-in vault suggesters.
- "Preview length" and "Notes per page" reject values that aren't positive integers, with an inline message, instead of silently clamping them.

### Fixed

- A `timestamp` value that is neither a string nor a date (for example a bare number) is ignored instead of being misread as epoch milliseconds.

## [0.1.4] - 2026-09-29

### Fixed

- Rendered note content no longer leaks event listeners across re-renders of the view.
- Toggling a pin is now handled without unhandled promise rejections.

## [0.1.3] - 2026-09-29

### Changed

- README updates.

## [0.1.2] - 2026-09-29

### Changed

- The "Open Notes List" command is now "Open" (Obsidian already prefixes it with the plugin name), as required by the community plugin guidelines.
- The pin button uses Obsidian's own icon-button styling.

## [0.1.1] - 2026-09-29

### Added

- "Create new note" command, so note creation can be bound to a hotkey from Settings → Hotkeys. It works even when the Notes List view isn't open.

## [0.1.0] - 2026-09-28

Initial release.

### Added

- Two-column view: a chronological list of the notes in a configurable folder (optionally including subfolders), and a GitHub-style activity heatmap of the last six months.
- Note dates come from a `timestamp` frontmatter property (Obsidian's "Date & time" type), falling back to a legacy `date` property and then to the file's modification time.
- Hierarchical tag tree with per-tag note counts; clicking a tag filters the list, including its sub-tags. Tag matching is case-insensitive, like Obsidian's own tag pane.
- Clicking a heatmap day or month label filters the list to that day or month. Tag, day and month filters combine, and each is cleared from its own pill.
- Pinned notes, stored as a `pinned` frontmatter property and shown at the top of the list.
- "New note" button that creates a uniquely named note directly in the watched folder, with no dependency on the "Unique note creator" core plugin. Configurable "Unique note name format" (default `YYYYMMDDHHmmss`) and optional "Template".
- Display settings: "Show note name", "Content display" (full or preview, overridable per note with a `content-display` property), "Preview length", "Notes per page" and "Show date group headers" (Today, Yesterday, This week, Older).
- Pagination, so only the notes on the current page are read and rendered.
- Double-clicking a note's content opens the note.
- The notes column follows Obsidian's "Readable line length" setting.

[Unreleased]: https://github.com/amelandri/NotesList/compare/0.2.5...HEAD
[0.2.5]: https://github.com/amelandri/NotesList/compare/0.2.4...0.2.5
[0.2.4]: https://github.com/amelandri/NotesList/compare/0.2.3...0.2.4
[0.2.3]: https://github.com/amelandri/NotesList/compare/0.2.2...0.2.3
[0.2.2]: https://github.com/amelandri/NotesList/compare/0.2.1...0.2.2
[0.2.1]: https://github.com/amelandri/NotesList/compare/0.2.0...0.2.1
[0.2.0]: https://github.com/amelandri/NotesList/compare/0.1.6...0.2.0
[0.1.6]: https://github.com/amelandri/NotesList/compare/0.1.5...0.1.6
[0.1.5]: https://github.com/amelandri/NotesList/compare/0.1.4...0.1.5
[0.1.4]: https://github.com/amelandri/NotesList/compare/0.1.3...0.1.4
[0.1.3]: https://github.com/amelandri/NotesList/compare/0.1.2...0.1.3
[0.1.2]: https://github.com/amelandri/NotesList/compare/0.1.1...0.1.2
[0.1.1]: https://github.com/amelandri/NotesList/compare/0.1.0...0.1.1
[0.1.0]: https://github.com/amelandri/NotesList/releases/tag/0.1.0
[#1]: https://github.com/amelandri/NotesList/issues/1
[#2]: https://github.com/amelandri/NotesList/issues/2
