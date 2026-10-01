import moment from "moment";
import { describe, expect, it } from "vitest";
import {
	dateGroupLabel,
	findUnbreakableBlocks,
	isUniqueNoteName,
	cutAtPreviewMarker,
	parseDatetime,
	previewBody,
	stripFrontmatter,
	stripInlineTags,
	truncateMarkdown,
	uniqueTags,
} from "../src/view";

describe("cutAtPreviewMarker", () => {
	it("cuts at a marker on its own line, with the ellipsis on its own paragraph", () => {
		expect(cutAtPreviewMarker("Intro.\n\n<!-- more -->\n\nThe rest.")).toBe("Intro.\n\n…");
	});

	it("cuts at a mid-line marker, with the ellipsis inline", () => {
		expect(cutAtPreviewMarker("Intro <!--more--> the rest.")).toBe("Intro …");
	});

	it("adds no ellipsis when nothing follows the marker", () => {
		expect(cutAtPreviewMarker("Whole note.\n<!-- more -->\n")).toBe("Whole note.");
	});

	it("cuts at the first marker only", () => {
		expect(cutAtPreviewMarker("A\n<!-- more -->\nB\n<!-- more -->\nC")).toBe("A\n\n…");
	});

	it("ignores a marker inside a fenced code block", () => {
		const text = "```html\n<!-- more -->\n```\nafter";
		expect(cutAtPreviewMarker(text)).toBeNull();
	});

	it("returns null without a marker, and doesn't take '-----' for one", () => {
		expect(cutAtPreviewMarker("Text\n\n-----\n\nMore")).toBeNull();
	});
});

describe("previewBody", () => {
	const marked = "Intro.\n\n<!-- more -->\n\n" + "x".repeat(50);
	const long = "y".repeat(50);

	it("frontmatter 'full' shows everything, marker or not", () => {
		expect(previewBody(marked, "full", "preview", 10)).toBe(marked);
	});

	it("frontmatter 'preview' cuts at the marker, else at the preview length", () => {
		expect(previewBody(marked, "preview", "full", 10)).toBe("Intro.\n\n…");
		expect(previewBody(long, "preview", "full", 10)).toBe("y".repeat(10) + "…");
	});

	it("a marker cuts there even when the setting is 'full', and wins over the preview length", () => {
		expect(previewBody(marked, null, "full", 10)).toBe("Intro.\n\n…");
		expect(previewBody(marked, null, "preview", 3)).toBe("Intro.\n\n…");
	});

	it("without frontmatter or marker, follows the setting", () => {
		expect(previewBody(long, null, "full", 10)).toBe(long);
		expect(previewBody(long, null, "preview", 10)).toBe("y".repeat(10) + "…");
	});
});

describe("stripInlineTags", () => {
	it("removes tags inside a sentence, collapsing the space they leave", () => {
		expect(stripInlineTags("Met the team #work today")).toBe("Met the team today");
	});

	it("removes nested tags and tags at the start or end of a line", () => {
		expect(stripInlineTags("#area/work/meetings notes #idea")).toBe("notes");
	});

	it("drops a line that held nothing but tags", () => {
		expect(stripInlineTags("First paragraph.\n\n#journal #daily\n\nSecond.")).toBe("First paragraph.\n\n\nSecond.");
	});

	it("keeps a list item's marker and indentation", () => {
		expect(stripInlineTags("  - buy milk #todo")).toBe("  - buy milk");
	});

	it("leaves headings, links with anchors, escaped hashes and numbers alone", () => {
		const text = "# Heading\nSee [[Note#Section]] and https://x.com/#a, \\#notatag, issue #123";
		expect(stripInlineTags(text)).toBe(text);
	});

	it("leaves tags inside inline code and fenced code blocks alone", () => {
		const text = "Use `#tag` here #real\n```\n#notatag\n```\nafter #x";
		expect(stripInlineTags(text)).toBe("Use `#tag` here\n```\n#notatag\n```\nafter");
	});

	it("handles non-ASCII letters", () => {
		expect(stripInlineTags("Oggi #attività fatta")).toBe("Oggi fatta");
	});
});

describe("uniqueTags", () => {
	it("dedupes case-insensitively, keeping the first-seen casing and order", () => {
		expect(uniqueTags(["#Project", "#idea", "#project", "#idea"])).toEqual(["#Project", "#idea"]);
	});
});

describe("parseDatetime", () => {
	it("parses a quoted string with seconds at face value, in local time", () => {
		const date = parseDatetime("2026-09-25T16:20:00");
		expect(date?.isValid()).toBe(true);
		expect(date?.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-09-25 16:20:00");
	});

	it("parses a quoted string without seconds", () => {
		const date = parseDatetime("2026-09-25T16:20");
		expect(date?.format("YYYY-MM-DD HH:mm")).toBe("2026-09-25 16:20");
	});

	it("parses a quoted date-only string as local midnight", () => {
		const date = parseDatetime("2026-09-25");
		expect(date?.format("YYYY-MM-DD HH:mm:ss")).toBe("2026-09-25 00:00:00");
	});

	it("returns null for a string that doesn't match any accepted format", () => {
		expect(parseDatetime("not a date")).toBeNull();
		expect(parseDatetime("25/09/2026")).toBeNull();
	});

	it("forces local midnight for a date-only value auto-cast to a native Date (unquoted YAML)", () => {
		// A bare "date: 2026-09-25" resolves to Date.UTC(2026, 8, 25) — always
		// exactly UTC midnight when the source text carries no time-of-day.
		// Asserting on the *local* hour/minute/second (rather than a specific
		// UTC offset) keeps this test's result the same on any machine,
		// regardless of its configured timezone.
		const date = parseDatetime(new Date(Date.UTC(2026, 8, 25, 0, 0, 0)));
		expect(date?.isValid()).toBe(true);
		expect(date?.hour()).toBe(0);
		expect(date?.minute()).toBe(0);
		expect(date?.second()).toBe(0);
	});

	it("preserves a genuinely combined date+time value auto-cast to a native Date, instead of discarding it to midnight", () => {
		// Verified via its UTC time-of-day (not a specific local hour) so this
		// test's expectation doesn't depend on the machine's timezone — the
		// documented residual limitation is that this is interpreted as UTC,
		// not local, which this assertion reflects rather than papers over.
		const date = parseDatetime(new Date(Date.UTC(2026, 8, 25, 16, 20, 0)));
		expect(date?.isValid()).toBe(true);
		expect(date?.clone().utc().format("HH:mm:ss")).toBe("16:20:00");
	});

	it("returns null for an unparseable value", () => {
		expect(parseDatetime(new Date(NaN))).toBeNull();
	});

	it("rejects non-string, non-Date values instead of guessing at them", () => {
		expect(parseDatetime(2026)).toBeNull();
		expect(parseDatetime(["2026-09-25"])).toBeNull();
		expect(parseDatetime(null)).toBeNull();
		expect(parseDatetime(undefined)).toBeNull();
	});
});

describe("dateGroupLabel", () => {
	// A fixed Wednesday reference, itself derived from "now" so the test still
	// passes no matter which real day it's run on — every case below is an
	// offset *from* this reference, not an absolute calendar date, so the
	// result stays correct regardless of what week it actually is.
	const now = moment().day(3).startOf("day").hour(12);

	it("labels today as Today", () => {
		expect(dateGroupLabel(now.clone(), now)).toBe("Today");
	});

	it("folds a future-dated note into Today rather than inventing a fifth label", () => {
		expect(dateGroupLabel(now.clone().add(5, "days"), now)).toBe("Today");
	});

	it("labels exactly one day back as Yesterday", () => {
		expect(dateGroupLabel(now.clone().subtract(1, "day"), now)).toBe("Yesterday");
	});

	it("labels an earlier day in the same week as This week", () => {
		expect(dateGroupLabel(now.clone().subtract(2, "days"), now)).toBe("This week");
	});

	it("labels the day right before the start of this week as Older", () => {
		const dayBeforeWeekStart = now.clone().startOf("week").subtract(1, "day");
		expect(dateGroupLabel(dayBeforeWeekStart, now)).toBe("Older");
	});

	it("labels a note from weeks ago as Older", () => {
		expect(dateGroupLabel(now.clone().subtract(3, "weeks"), now)).toBe("Older");
	});
});

describe("isUniqueNoteName", () => {
	it("matches a basename generated by the given format, exactly", () => {
		expect(isUniqueNoteName("202609251620", "YYYYMMDDHHmm")).toBe(true);
	});

	it("does not match a renamed note", () => {
		expect(isUniqueNoteName("My renamed note", "YYYYMMDDHHmm")).toBe(false);
	});

	it("does not match a string of the wrong length for the format (strict parsing)", () => {
		expect(isUniqueNoteName("20260925162000", "YYYYMMDDHHmm")).toBe(false);
	});
});

describe("stripFrontmatter", () => {
	it("removes a normal frontmatter block, leaving only the body", () => {
		const raw = "---\ntimestamp: \"2026-09-25T16:20:00\"\ntags: [a, b]\n---\nBody text.";
		expect(stripFrontmatter(raw)).toBe("Body text.");
	});

	it("removes a completely empty frontmatter block (the regression fixed this session)", () => {
		const raw = "---\n---\nBody text.";
		expect(stripFrontmatter(raw)).toBe("Body text.");
	});

	it("leaves content with no frontmatter block untouched", () => {
		const raw = "Just a body, no frontmatter.";
		expect(stripFrontmatter(raw)).toBe(raw);
	});

	it("handles CRLF line endings", () => {
		const raw = "---\r\ntimestamp: \"2026-09-25T16:20:00\"\r\n---\r\nBody text.";
		expect(stripFrontmatter(raw)).toBe("Body text.");
	});
});

describe("findUnbreakableBlocks", () => {
	it("finds a fenced code block, from its opening to its closing fence", () => {
		const body = "intro\n```ts\nconst x = 1;\n```\nafter";
		const blocks = findUnbreakableBlocks(body);
		expect(blocks).toHaveLength(1);
		expect(body.slice(...blocks[0])).toBe("```ts\nconst x = 1;\n```");
	});

	it("runs an unclosed fence to the end of the body", () => {
		const body = "intro\n~~~\ncode";
		expect(findUnbreakableBlocks(body)).toEqual([[6, body.length]]);
	});

	it("only closes a fence with the same character, at least as long", () => {
		const body = "````\n```\n~~~\n````";
		expect(findUnbreakableBlocks(body)).toEqual([[0, body.length]]);
	});

	it("finds a table from its header row through its last row", () => {
		const body = "intro\n\n| a | b |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |\n\nafter";
		const [[start, end]] = findUnbreakableBlocks(body);
		expect(body.slice(start, end)).toBe("| a | b |\n| --- | :-: |\n| 1 | 2 |\n| 3 | 4 |");
	});

	it("doesn't mistake a setext heading or thematic break for a table", () => {
		expect(findUnbreakableBlocks("a | b\n---\ntext")).toEqual([]);
	});

	it("treats a table-looking block inside a code fence as code only", () => {
		const body = "```\n| a | b |\n| - | - |\n```";
		expect(findUnbreakableBlocks(body)).toEqual([[0, body.length]]);
	});
});

describe("truncateMarkdown", () => {
	it("returns a body within the limit unchanged", () => {
		expect(truncateMarkdown("short", 10)).toBe("short");
	});

	it("cuts plain text at the limit, with an inline ellipsis", () => {
		expect(truncateMarkdown("hello world", 5)).toBe("hello…");
	});

	it("moves a cut inside a code block to right after it, ellipsis on its own paragraph", () => {
		const body = "intro\n```\nline one\nline two\n```\nmore text after";
		expect(truncateMarkdown(body, 12)).toBe("intro\n```\nline one\nline two\n```\n\n…");
	});

	it("moves a cut inside a table to right after its last row", () => {
		const body = "| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\nmore text after";
		expect(truncateMarkdown(body, 25)).toBe("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n\n…");
	});

	it("returns the whole body, with no ellipsis, when the protected block is the last thing in it", () => {
		const body = "intro\n```\nline one\nline two\n```\n";
		expect(truncateMarkdown(body, 12)).toBe(body);
	});

	it("still cuts normally before a block that starts after the limit", () => {
		expect(truncateMarkdown("hello world\n```\ncode\n```", 5)).toBe("hello…");
	});
});
