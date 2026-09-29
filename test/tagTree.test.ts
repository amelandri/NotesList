import { describe, expect, it } from "vitest";
import { buildTagTree, tagMatchesFilter } from "../src/tagTree";

describe("tagMatchesFilter", () => {
	it("matches an exact tag case-insensitively", () => {
		expect(tagMatchesFilter("Project", "project")).toBe(true);
		expect(tagMatchesFilter("project", "Project")).toBe(true);
	});

	it("matches a nested sub-tag under the filter", () => {
		expect(tagMatchesFilter("area/work", "area")).toBe(true);
		expect(tagMatchesFilter("Area/Work", "area")).toBe(true);
	});

	it("does not match a tag that merely starts with the filter's letters", () => {
		expect(tagMatchesFilter("areawork", "area")).toBe(false);
	});

	it("does not match an unrelated tag", () => {
		expect(tagMatchesFilter("area/work", "home")).toBe(false);
	});
});

describe("buildTagTree", () => {
	it("returns an empty tree for no notes", () => {
		const root = buildTagTree([]);
		expect(root.children.size).toBe(0);
	});

	it("nests a/b/c-style tags and counts each ancestor once per note", () => {
		const root = buildTagTree([["#area/work"]]);

		const area = root.children.get("area");
		expect(area?.count).toBe(1);
		expect(area?.segment).toBe("area");

		const work = area?.children.get("work");
		expect(work?.count).toBe(1);
		expect(work?.path).toBe("area/work");
	});

	it("counts a note once towards a parent even if it also carries the parent tag directly", () => {
		// One note tagged both #area and #area/work must still only count once
		// towards "area" — not twice — see "Tag note counts" in CLAUDE.md.
		const root = buildTagTree([["#area", "#area/work"]]);
		expect(root.children.get("area")?.count).toBe(1);
	});

	it("counts distinct notes correctly across a folder", () => {
		const root = buildTagTree([["#area"], ["#area/work"], ["#other"]]);
		expect(root.children.get("area")?.count).toBe(2);
		expect(root.children.get("area")?.children.get("work")?.count).toBe(1);
		expect(root.children.get("other")?.count).toBe(1);
	});

	it("merges tags that only differ by case into one node, keeping the first-seen casing", () => {
		const root = buildTagTree([["#Project"], ["#project"]]);

		expect(root.children.size).toBe(1);
		const node = root.children.get("project");
		expect(node?.segment).toBe("Project");
		expect(node?.count).toBe(2);
	});

	it("counts a single note only once even if it carries the same tag under two different casings", () => {
		const root = buildTagTree([["#Project", "#project"]]);
		expect(root.children.get("project")?.count).toBe(1);
	});
});
