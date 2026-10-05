import { describe, expect, it } from "vitest";
import { groupOpenTasks, tagCombination, type OpenTask } from "../src/openTasks";

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
