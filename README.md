# Notes List

Notes List turns a vault folder into a browsable timeline: a chronological list of its notes on one side, and a GitHub-style activity heatmap and tag browser on the other. It's a good fit for a daily journal, a work log, or any "one note per entry" habit, where seeing *when* things happened matters as much as the notes themselves.

![screenshot](images/screenshot.png)

## Features

- **Chronological list** — every note in a folder you choose (optionally including its subfolders), newest first. Each entry shows its date and time, an optional file name, and its content — full or a preview, your choice.
- **Date from frontmatter** — a note's date and time come from its own property named `timestamp` (set it via Obsidian's own "Date & time" property type in the Properties panel), falling back to the file's last-modified time if it isn't set. Click the date to open the note.
- **Pin notes** — click the bookmark icon on a note to keep it pinned to the top of the list, ahead of everything else matching the current filter. The pin is stored as a `pinned` property in the note's own frontmatter, so it's visible in the note itself and travels with it across a rename or move.
- **Date group headers** (optional) — "Today" / "Yesterday" / "This week" / "Older" labels above the list, so it's obvious at a glance when notes were written.
- **Activity heatmap** — a GitHub-contributions-style grid of the last 6 months, shaded by how many notes were created each day. Click a day or a month label to filter the list down to it.
- **Tag browser** — a collapsible tree of every tag found in the notes in scope, each with a count of matching notes. Click a tag to filter the list to it (including its nested sub-tags, e.g. `#area/work` under `#area`).
- **Combine filters** — the tag, day and month filters can all be active together, each with its own pill (and `x`) below the heatmap to clear just that one.
- **Pagination** — long lists are split into pages, so browsing stays fast no matter how many notes are in the folder.
- **New Note button** — creates a new, uniquely-named note directly in the watched folder in one click, with today's date already set. No other plugin required; optionally starts from a template note of your choice (see Settings below). Also available as the **Create new note** command, so you can assign it your own keyboard shortcut from Settings → Hotkeys — it works even when the Notes List view isn't open.
- Respects Obsidian's own "Readable line length" setting, and refreshes automatically as notes in the folder are created, edited, deleted, renamed, or have their frontmatter changed.

## Installation

Notes List is available in the official Obsidian Community Plugins directory: [community.obsidian.md/plugins/notes-list](https://community.obsidian.md/plugins/notes-list).

To install it from Obsidian:

1. Open **Settings → Community plugins** and turn off Restricted mode if it's on.
2. Click **Browse**, search for "Notes List", then click **Install** and **Enable**.

### Building from source

To build it yourself instead:

```bash
npm install
npm run build
```

Then copy `manifest.json`, `main.js` and `styles.css` into `<your-vault>/.obsidian/plugins/notes-list/`, and enable the plugin from Settings → Community plugins.

For local development, `npm run deploy` builds and copies those three files straight into a vault in one step (see `copy-to-vault.mjs`; defaults to a path set for local testing, override with `OBSIDIAN_VAULT_PATH`).

## Settings

Requires Obsidian **1.13.0** or later. The settings tab groups related controls under a shared heading, and every setting can be found through Obsidian's settings search:

| Group | Setting | Description |
| --- | --- | --- |
| Folder and files | Folder | Vault folder to watch, empty = entire vault. |
| Folder and files | Subfolders | Also show notes from subfolders of the chosen folder. |
| Folder and files | Template | Optional note to start new notes from (empty = a blank note); the template must have a property named `timestamp` in its frontmatter. |
| Folder and files | Unique note name format | moment.js format for the New Note button's auto-generated file name (default `YYYYMMDDHHmmss`); also what "When different from unique note name" compares against. |
| Notes display | Show note name | *Never* / *Always* / *When different from unique note name* (default; see [Features](#features) above). |
| Notes display | Content display | *Full* / *Preview* (default); a note can override this with its own `content-display` frontmatter property. |
| Notes display | Preview length | Max characters shown when Content display (or a note's own override) is *Preview* (default 300); the field stays enabled either way. |
| Notes display | Show date group headers | Show "Today" / "Yesterday" / "This week" / "Older" headers above the list (default off). |
| Notes display | Notes per page | Number of notes shown per page in the list (default 10). |

## Development

See [CLAUDE.md](./CLAUDE.md) for build commands and an architecture overview.

## License

[MIT](./LICENSE)
