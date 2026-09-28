# Notes List

Notes List turns a vault folder into a browsable timeline: a chronological list of its notes on one side, and a GitHub-style activity heatmap and tag browser on the other. It's a good fit for a daily journal, a work log, or any "one note per entry" habit, where seeing *when* things happened matters as much as the notes themselves.

![screenshot](images/screenshot.png)

## Features

- **Chronological list** — every note in a folder you choose (optionally including its subfolders), newest first. Each entry shows its date and time, an optional file name, and its content — full or a preview, your choice.
- **Date from frontmatter** — a note's date and time come from its own `date`/`time` frontmatter properties, falling back to the file's last-modified time if those aren't set. Click the date to open the note.
- **Pin notes** — click the bookmark icon on a note to keep it pinned to the top of the list, ahead of everything else matching the current filter. The pin is stored as a `pinned` property in the note's own frontmatter, so it's visible in the note itself and travels with it across a rename or move.
- **Date group headers** (optional) — "Today" / "Yesterday" / "This week" / "Older" labels above the list, so it's obvious at a glance when notes were written.
- **Activity heatmap** — a GitHub-contributions-style grid of the last 6 months, shaded by how many notes were created each day. Click a day or a month label to filter the list down to it.
- **Tag browser** — a collapsible tree of every tag found in the notes in scope, each with a count of matching notes. Click a tag to filter the list to it (including its nested sub-tags, e.g. `#area/work` under `#area`).
- **Combine filters** — the tag, day and month filters can all be active together, each with its own pill (and `x`) below the heatmap to clear just that one.
- **Pagination** — long lists are split into pages, so browsing stays fast no matter how many notes are in the folder.
- **New Note button** — create a new, uniquely-named note in one click (works with Obsidian's own "Unique note creator" core plugin — see below).
- Respects Obsidian's own "Readable line length" setting, and refreshes automatically as notes in the folder are created, edited, deleted, renamed, or have their frontmatter changed.

## Unique note creator (nice to have)

Notes List integrates with Obsidian's own core plugin **"Unique note creator"** (internal id `zk-prefixer`; enable it under Settings → Core plugins) — but it's **not a hard requirement**. Everything else (the list, heatmap, tag/day/month filters, pagination) works fine whether or not it's enabled.

What it adds when enabled:

- The **New Note** button creates a new, uniquely-named note in one click by triggering that core plugin's own command. If it's disabled, clicking the button just shows a notice asking you to enable it — nothing else in the plugin is affected.
- The "Show note name" setting's *When different from unique note name* mode compares each note's file name against whatever format "Unique note creator" is currently configured to generate (read live from its own settings; defaults to `YYYYMMDDHHmm` if that plugin is disabled or left at its own default).

Note dating is entirely independent of this: Notes List always reads each note's `date`/`time` frontmatter properties, falling back to the file's last-modified time if those aren't set.

## Installation

Not on the Community Plugins directory yet — install manually from source:

```bash
npm install
npm run build
```

Then copy `manifest.json`, `main.js` and `styles.css` into `<your-vault>/.obsidian/plugins/notes-list/`, and enable the plugin from Settings → Community plugins.

For local development, `npm run deploy` builds and copies those three files straight into a vault in one step (see `copy-to-vault.mjs`; defaults to a path set for local testing, override with `OBSIDIAN_VAULT_PATH`).

## Settings

Requires Obsidian **1.11.0** or later. The settings tab groups related controls under a shared heading:

| Group | Setting | Description |
| --- | --- | --- |
| Folder | Folder | Vault folder to watch, empty = entire vault. |
| Folder | Subfolders | Also show notes from subfolders of the chosen folder. |
| Notes display | Show note name | *Never* / *Always* / *When different from unique note name* (default; see [Features](#features) above). |
| Notes display | Content display | *Full* / *Preview* (default); a note can override this with its own `content-display` frontmatter property. |
| Notes display | Preview length | Max characters shown when Content display (or a note's own override) is *Preview* (default 300); the field stays enabled either way. |
| Notes display | Show date group headers | Show "Today" / "Yesterday" / "This week" / "Older" headers above the list (default off). |
| — | Notes per page | Number of notes shown per page in the list (default 10). |

## Development

See [CLAUDE.md](./CLAUDE.md) for build commands and an architecture overview.

## License

[MIT](./LICENSE)
