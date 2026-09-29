import { describe, expect, it, vi } from "vitest";
import { SearchIndex, buildSearchText, matchesAllTerms, parseSearchQuery, type IndexableFile } from "../src/searchIndex";

function file(path: string, mtime = 1): IndexableFile {
	return { path, basename: path.replace(/^.*\//, "").replace(/\.md$/, ""), stat: { mtime } };
}

describe("parseSearchQuery", () => {
	it("lowercases, splits on any whitespace and drops empty terms", () => {
		expect(parseSearchQuery("  Foo\tBAR \n baz ")).toEqual(["foo", "bar", "baz"]);
	});

	it("de-duplicates repeated terms", () => {
		expect(parseSearchQuery("foo Foo foo")).toEqual(["foo"]);
	});

	it("returns no terms for a blank query", () => {
		expect(parseSearchQuery("   ")).toEqual([]);
	});
});

describe("matchesAllTerms", () => {
	it("requires every term (AND), in any order, as substrings", () => {
		expect(matchesAllTerms("the quick brown fox", ["fox", "qui"])).toBe(true);
		expect(matchesAllTerms("the quick brown fox", ["fox", "dog"])).toBe(false);
	});
});

describe("buildSearchText", () => {
	it("includes the file name and lowercases everything once", () => {
		expect(buildSearchText("Meeting Notes", "Discussed BUDGET")).toBe("meeting notes\ndiscussed budget");
	});
});

describe("SearchIndex", () => {
	it("finds notes by body or file name, case-insensitively", async () => {
		const bodies: Record<string, string> = { "a.md": "Alpha body", "Project plan.md": "nothing here" };
		const index = new SearchIndex(async (f) => bodies[f.path]);
		const files = [file("a.md"), file("Project plan.md")];
		await index.update(files);

		expect(index.search(files, parseSearchQuery("ALPHA"))).toEqual(new Set(["a.md"]));
		expect(index.search(files, parseSearchQuery("project"))).toEqual(new Set(["Project plan.md"]));
		expect(index.search(files, parseSearchQuery("alpha project"))).toEqual(new Set());
	});

	it("re-reads only files whose mtime changed", async () => {
		const read = vi.fn(async (f: IndexableFile) => `body of ${f.path}`);
		const index = new SearchIndex(read);
		await index.update([file("a.md", 1), file("b.md", 1)]);
		expect(read).toHaveBeenCalledTimes(2);

		read.mockClear();
		await index.update([file("a.md", 1), file("b.md", 2)]);
		expect(read).toHaveBeenCalledTimes(1);
		expect(read.mock.calls[0][0].path).toBe("b.md");
	});

	it("picks up an edited note's new content", async () => {
		let body = "old text";
		const index = new SearchIndex(async () => body);
		await index.update([file("a.md", 1)]);
		body = "new text";
		await index.update([file("a.md", 2)]);

		expect(index.search([file("a.md", 2)], ["new"])).toEqual(new Set(["a.md"]));
		expect(index.search([file("a.md", 2)], ["old"])).toEqual(new Set());
	});

	it("drops notes that are no longer in scope", async () => {
		const index = new SearchIndex(async () => "text");
		await index.update([file("a.md"), file("b.md")]);
		await index.update([file("a.md")]);
		expect(index.size).toBe(1);
	});

	it("serializes overlapping updates, reading each file only once", async () => {
		const read = vi.fn(async () => "text");
		const index = new SearchIndex(read);
		const files = [file("a.md"), file("b.md")];
		await Promise.all([index.update(files), index.update(files)]);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("keeps indexing the rest when one file can't be read", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const index = new SearchIndex(async (f) => {
			if (f.path === "bad.md") throw new Error("unreadable");
			return "good text";
		});
		const files = [file("bad.md"), file("ok.md")];
		await index.update(files);
		expect(index.search(files, ["good"])).toEqual(new Set(["ok.md"]));
		warn.mockRestore();
	});
});
