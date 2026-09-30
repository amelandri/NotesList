# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/amelandri/NotesList/compare/0.2.1...HEAD
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
