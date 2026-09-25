# Notes List

An [Obsidian](https://obsidian.md) plugin that opens a custom view showing every note in a configurable folder as a chronological, descending list — alongside a GitHub-style activity heatmap.

> **Status: work in progress.** This plugin is under active, personal development and is **not published on Obsidian's official Community Plugins directory**. It must be installed manually (see below) and its features/settings may change at any time.

> **Built with vibecoding.** This project is developed primarily through conversational, prompt-driven "vibecoding" with an AI coding assistant rather than hand-written from a spec. Expect the code and docs to evolve iteratively as new requests come in.

## Features

- **Configurable folder** — pick any vault folder to watch (with autocomplete), optionally including its subfolders.
- **Chronological note list** — every note in scope, sorted newest first, each entry showing:
  - **date and time**, read from the note's `date`/`time` frontmatter properties, falling back to the file's last-modified time if those aren't set, rendered as a clickable link to the note;
  - the note's **rendered content** (full or truncated to a configurable character length).
- **Pagination** — the list is split into pages (size configurable, default 10). Page navigation appears at the bottom of the list only when there's more than one page: previous/next buttons plus up to 5 page numbers, kept centered around the current page as you move through a long list. Only the notes on the current page have their content actually read and rendered, so browsing a large folder stays fast regardless of how many notes are in scope.
- **New Note button** — a small circular `+` button next to the list title creates a new, uniquely-named note in one click (see [Dependency](#dependency-unique-note-creator)).
- **Activity heatmap** — a GitHub-contributions-style grid of the last 6 months, one cell per day, shaded by how many notes were created that day. It stays pinned in view while the notes list scrolls. Every cell has a tooltip showing its date, and clicking a cell filters the notes list down to that day (the cell is outlined to show it's the active filter). Clicking a month label instead filters down to every note in that month.
- **Hierarchical tag browser** — below the heatmap, a nested, collapsible list of every tag found across the notes in scope (nested tags like `#area/work` render as a tree; branches with children can be collapsed/expanded with the chevron). Clicking a tag's name filters the notes list to notes carrying that tag or any of its nested sub-tags.
- The tag, day and month filters can all be active at once, and each shows as its own pill next to the "Notes" title, with an `x` to clear just that one and restore the rest of the list.
- **Respects your Editor settings** — the notes column honors Obsidian's own "Readable line length" toggle (Settings → Editor), live.
- Auto-refreshes when notes in the watched folder are created, edited, deleted, renamed, or have their frontmatter changed.

## Dependency: Unique note creator

This plugin **depends on Obsidian's own core plugin "Unique note creator"** (internal id `zk-prefixer`; enable it under Settings → Core plugins).

The **New Note** button doesn't create files itself — it triggers that core plugin's note-creation command.

Note dating is independent of this dependency: Notes List reads each note's `date`/`time` frontmatter properties; if a note doesn't have them, its file's last-modified time is used instead.

## Installation

Not on the Community Plugins directory yet — install manually from source:

```bash
npm install
npm run build
```

Then copy `manifest.json`, `main.js` and `styles.css` into `<your-vault>/.obsidian/plugins/notes-list/`, and enable the plugin from Settings → Community plugins.

For local development, `npm run deploy` builds and copies those three files straight into a vault in one step (see `copy-to-vault.mjs`; defaults to a path set for local testing, override with `OBSIDIAN_VAULT_PATH`).

## Settings

| Setting | Description |
| --- | --- |
| Folder | Vault folder to watch. Empty = entire vault. |
| Include subfolders | Also show notes from subfolders of the chosen folder. |
| Content preview length | Max characters of content shown per note (0 = full content). |
| Notes per page | Number of notes shown per page in the list (default 10). |

## Development

See [CLAUDE.md](./CLAUDE.md) for build commands and an architecture overview.

## License

[MIT](./LICENSE)
