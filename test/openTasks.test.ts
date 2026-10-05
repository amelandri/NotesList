import { describe, expect, it } from "vitest";
import { groupOpenTasks, noteLevelTags, tagCombination, taskGroupTags, type OpenTask } from "../src/openTasks";

describe("noteLevelTags", () => {
	it("keeps frontmatter tags and inline tags off task lines, drops those on task lines", () => {
		const inline = [
			{ tag: "#project", line: 2 },
			{ tag: "#urgent", line: 5 },
		];
		expect(noteLevelTags(["#work"], inline, new Set([5, 6]))).toEqual(["#work", "#project"]);
	});
});

describe("taskGroupTags", () => {
	const inline = [
		{ tag: "#urgent", line: 5 },
		{ tag: "#call", line: 5 },
		{ tag: "#project", line: 2 },
	];

	it("uses the task's own tags when its line has any", () => {
		expect(taskGroupTags(5, inline, ["#work"])).toEqual(["#urgent", "#call"]);
	});

	it("falls back to the note's tags for a task without its own", () => {
		expect(taskGroupTags(6, inline, ["#work"])).toEqual(["#work"]);
	});

	it("leaves a task untagged when neither it nor the note has tags", () => {
		expect(taskGroupTags(6, [], [])).toEqual([]);
	});
});

const task = (tags: string[], noteIndex: number, line: number, text = `t${noteIndex}.${line}`): OpenTask<string> => ({
	tags,
	noteIndex,
	line,
	text,
	note: `note${noteIndex}`,
});

describe("tagCombination", () => {
	it("sorts and dedupes a note's tags case-insensitively, keeping the first-seen casing", () => {
		expect(tagCombination(["#work", "#Alpha", "#alpha", "#work"])).toEqual({
			key: "#alpha\n#work",
			tags: ["#Alpha", "#work"],
		});
	});

	it("keeps nested tags whole", () => {
		expect(tagCombination(["#area/work", "#area"]).tags).toEqual(["#area", "#area/work"]);
	});

	it("gives an untagged note an empty key", () => {
		expect(tagCombination([])).toEqual({ key: "", tags: [] });
	});
});

describe("groupOpenTasks", () => {
	it("groups by the exact tag combination, each task once", () => {
		const groups = groupOpenTasks([
			task(["#work", "#alpha"], 0, 3),
			task(["#alpha", "#Work"], 1, 5),
			task(["#work"], 2, 1),
		]);
		expect(groups.map((g) => g.tags)).toEqual([["#alpha", "#work"], ["#work"]]);
		expect(groups[0].tasks.map((t) => t.note)).toEqual(["note0", "note1"]);
		expect(groups[1].tasks.map((t) => t.note)).toEqual(["note2"]);
	});

	it("puts the untagged group last, after the alphabetical ones", () => {
		const groups = groupOpenTasks([task([], 0, 1), task(["#zeta"], 1, 1), task(["#alpha"], 2, 1)]);
		expect(groups.map((g) => g.tags)).toEqual([["#alpha"], ["#zeta"], []]);
	});

	it("orders a group's tasks by note position, then by line", () => {
		const groups = groupOpenTasks([task(["#a"], 1, 2), task(["#a"], 0, 9), task(["#a"], 1, 1)]);
		expect(groups[0].tasks.map((t) => [t.noteIndex, t.line])).toEqual([
			[0, 9],
			[1, 1],
			[1, 2],
		]);
	});
});
