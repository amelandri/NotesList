import { describe, expect, it } from "vitest";
import { normalizeOptionalPath, resolveUniqueNoteNameFormat, sanitizeFilenameSegment } from "../src/main";
import { DEFAULT_UNIQUE_NOTE_NAME_FORMAT } from "../src/settings";

describe("normalizeOptionalPath", () => {
	it("keeps an empty string empty (the 'not set' sentinel), rather than routing it through normalizePath", () => {
		// Obsidian's real normalizePath("") returns "/" (vault root as a path),
		// which would break the "" = "entire vault"/"no template" sentinel this
		// is guarding — see the comment above normalizeOptionalPath in main.ts.
		expect(normalizeOptionalPath("")).toBe("");
	});

	it("treats a whitespace-only value the same as empty", () => {
		expect(normalizeOptionalPath("   ")).toBe("");
	});

	it("delegates a non-empty value to normalizePath", () => {
		// Exercises the delegation itself, not Obsidian's exact real-world
		// normalizePath semantics (see test/obsidian-mock.ts).
		expect(normalizeOptionalPath("Notes/")).toBe("Notes");
	});
});

describe("sanitizeFilenameSegment", () => {
	it("replaces every filesystem-illegal character with a hyphen", () => {
		expect(sanitizeFilenameSegment('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
	});

	it("trims surrounding whitespace", () => {
		expect(sanitizeFilenameSegment("  My Note  ")).toBe("My Note");
	});

	it("falls back to a safe default when the result would otherwise be empty", () => {
		expect(sanitizeFilenameSegment("")).toBe("note");
		expect(sanitizeFilenameSegment("   ")).toBe("note");
	});

	it("turns each illegal character into its own hyphen, rather than collapsing them", () => {
		// "///" isn't empty after sanitizing — it's three hyphens — so it must
		// NOT hit the empty-input fallback above.
		expect(sanitizeFilenameSegment("///")).toBe("---");
	});

	it("leaves an already-safe name untouched", () => {
		expect(sanitizeFilenameSegment("20260925162000")).toBe("20260925162000");
	});
});

describe("resolveUniqueNoteNameFormat", () => {
	it("falls back to the default format when the configured value is empty", () => {
		expect(resolveUniqueNoteNameFormat("")).toBe(DEFAULT_UNIQUE_NOTE_NAME_FORMAT);
	});

	it("falls back to the default format when the configured value is whitespace-only", () => {
		expect(resolveUniqueNoteNameFormat("   ")).toBe(DEFAULT_UNIQUE_NOTE_NAME_FORMAT);
	});

	it("passes a real configured format through unchanged", () => {
		expect(resolveUniqueNoteNameFormat("YYYY-MM-DD")).toBe("YYYY-MM-DD");
	});
});
