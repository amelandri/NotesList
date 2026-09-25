# Notes List

An [Obsidian](https://obsidian.md) plugin that opens a custom view showing every note in a configurable folder as a chronological, descending list — alongside a GitHub-style activity heatmap.

> **Status: work in progress.** This plugin is under active, personal development and is **not published on Obsidian's official Community Plugins directory**. It must be installed manually (see below) and its features/settings may change at any time.

> **Built with vibecoding.** This project is developed primarily through conversational, prompt-driven "vibecoding" with an AI coding assistant rather than hand-written from a spec. Expect the code and docs to evolve iteratively as new requests come in.

## Features

- **Configurable folder** — pick any vault folder to watch (with autocomplete), optionally including its subfolders.
- **Chronological note list** — every note in scope, sorted newest first, each entry showing:
  - **date and time**, derived from the note's filename (see [Dependency](#dependency-unique-note-creator) below), rendered as a clickable link to the note;
  - the note's **rendered content** (full or truncated to a configurable character length);
  - the note's **tags** (can be toggled off).
- **New Note button** — a small circular `+` button next to the list title creates a new, uniquely-named note in one click (see [Dependency](#dependency-unique-note-creator)).
- **Activity heatmap** — a GitHub-contributions-style grid of the last 6 months, one cell per day, shaded by how many notes were created that day, with a hover tooltip and month labels. It stays pinned in view while the notes list scrolls.
- **Respects your Editor settings** — the notes column honors Obsidian's own "Readable line length" toggle (Settings → Editor), live.
- Auto-refreshes when notes in the watched folder are created, edited, deleted, renamed, or have their metadata (tags, frontmatter) changed.

## Dependency: Unique note creator

This plugin **depends on Obsidian's own core plugin "Unique note creator"** (internal id `zk-prefixer`; enable it under Settings → Core plugins).

- The **New Note** button doesn't create files itself — it triggers that core plugin's note-creation command.
- Notes List reads each note's **date and time from its filename**, expecting the strict format `YYYYMMDDHHmm` (e.g. `202609251050.md` → 25 Sep 2026, 10:50). This is the same naming pattern "Unique note creator" can generate, so **that plugin must be configured (its note title/date format setting) to produce filenames in this exact `YYYYMMDDHHmm` pattern** for the list and heatmap to date notes correctly. A note whose filename doesn't match falls back to the file's creation time.

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
| Show tags | Toggle each note's tags in the list. |
| Content preview length | Max characters of content shown per note (0 = full content). |

## Development

See [CLAUDE.md](./CLAUDE.md) for build commands and an architecture overview.

## License

[MIT](./LICENSE)
