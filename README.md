# Notes List

An [Obsidian](https://obsidian.md) plugin that opens a custom view showing every note in a configurable folder as a chronological, descending list — alongside a GitHub-style activity heatmap.

> **Status: work in progress.** This plugin is under active, personal development and is **not published on Obsidian's official Community Plugins directory**. It must be installed manually (see below) and its features/settings may change at any time.

> **Built with vibecoding.** This project is developed primarily through conversational, prompt-driven "vibecoding" with an AI coding assistant rather than hand-written from a spec. Expect the code and docs to evolve iteratively as new requests come in.

## Features

- **Configurable folder** — pick any vault folder to watch (with autocomplete), optionally including its subfolders.
- **Chronological note list** — every note in scope, sorted newest first (pinned notes float to the top of the list, still newest-first among themselves — see **Pin notes** below), each entry showing:
  - **date and time**, read from the note's `date`/`time` frontmatter properties, falling back to the file's last-modified time if those aren't set, rendered as a clickable link to the note, with a pin button aligned to the right of that same row;
  - the note's **file name**, below the date — controlled by the "Show note name" setting: *Never*, *Always*, or *When different from unique note name* (the default), which hides it only for notes still using the auto-generated `YYYYMMDDHHmm` name from "Unique note creator" and shows it for anything renamed to something meaningful;
  - the note's **rendered content** — full or a truncated preview, per the "Content display" setting (*Full* / *Preview*, with a configurable preview length). A note can override the setting for itself with its own `content-display: full` or `content-display: preview` frontmatter property.
- **Pin notes** — the icon-only button on a note's date row pins it (click again to unpin). Among the notes currently matching any active tag/day/month filter, pinned ones sort to the top, ahead of everything else, in their own newest-first order — pinning doesn't bypass a filter, it only affects ordering within whatever the filter already shows. Pinned rows get a `.notes-list-item.is-pinned` CSS class (a subtle accent by default) — customize or remove the look with a CSS snippet. The pin is stored as a `pinned: true`/`pinned: false` property in the note's own frontmatter (not plugin data), so it's visible/editable directly in the note and travels with the file across a rename or move.
- **Pagination** — the list is split into pages (size configurable, default 10). Page navigation appears at the bottom of the list only when there's more than one page: previous/next buttons plus up to 5 page numbers, kept centered around the current page as you move through a long list. Only the notes on the current page have their content actually read and rendered, so browsing a large folder stays fast regardless of how many notes are in scope.
- **Fast on large folders** — scanning a folder's notes (reading each one's date/tags) only happens when the note set could actually have changed (opening the view, a note being created/edited/renamed/deleted, or a settings change). Changing page, expanding/collapsing a tag, or picking/clearing a tag/day/month filter reuses that scan instead of redoing it, so those stay instant even with several thousand notes in scope.
- **New Note button** — a small circular `+` button next to the list title creates a new, uniquely-named note in one click (see [Unique note creator](#unique-note-creator-nice-to-have)).
- **Activity heatmap** — a GitHub-contributions-style grid of the last 6 months, one cell per day, shaded by how many notes were created that day. It stays pinned in view while the notes list scrolls. Every cell has a tooltip showing its date, and clicking a cell filters the notes list down to that day (the cell is outlined to show it's the active filter). Clicking a month label instead filters down to every note in that month. The legend row ("Less"/"More") also shows the note count, right-aligned — the total in scope, or "*n* of *total*" while a tag/day/month filter narrows the list.
- **Hierarchical tag browser** — below the heatmap, a nested, collapsible list of every tag found across the notes in scope (nested tags like `#area/work` render as a tree; branches with children can be collapsed/expanded with the chevron). Clicking a tag's name filters the notes list to notes carrying that tag or any of its nested sub-tags.
- The tag, day and month filters can all be active at once, and each shows as its own pill next to the "Notes" title, with an `x` to clear just that one and restore the rest of the list.
- **Respects your Editor settings** — the notes column honors Obsidian's own "Readable line length" toggle (Settings → Editor), live.
- Auto-refreshes when notes in the watched folder are created, edited, deleted, renamed, or have their frontmatter changed.

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
| Folder settings | Folder | Vault folder to watch, empty = entire vault. |
| Folder settings | Subfolders | Also show notes from subfolders of the chosen folder. |
| Notes Display | Show note name | *Never* / *Always* / *When different from unique note name* (default; see [Features](#features) above). |
| Notes Display | Content display | *Full* / *Preview* (default); a note can override this with its own `content-display` frontmatter property. |
| Notes Display | Preview length | Max characters shown when Content display (or a note's own override) is *Preview* (default 300); the field stays enabled either way. |
| — | Notes per page | Number of notes shown per page in the list (default 10). |

## Development

See [CLAUDE.md](./CLAUDE.md) for build commands and an architecture overview.

## License

[MIT](./LICENSE)
