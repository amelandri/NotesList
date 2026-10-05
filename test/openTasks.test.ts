import { describe, expect, it } from "vitest";
import {
	groupOpenTasks,
	noteLevelTags,
	OpenTaskIndex,
	splitByWaiting,
	tagCombination,
	tagsByLine,
	taskGroupTags,
	type IndexedTask,
	type OpenTask,
} from "../src/openTasks";

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
	const inline = tagsByLine([
		{ tag: "#urgent", line: 5 },
		{ tag: "#call", line: 5 },
		{ tag: "#project", line: 2 },
	]);

	it("uses the task's own tags when its line has any", () => {
		expect(taskGroupTags(5, inline, ["#work"])).toEqual(["#urgent", "#call"]);
	});

	it("falls back to the note's tags for a task without its own", () => {
		expect(taskGroupTags(6, inline, ["#work"])).toEqual(["#work"]);
	});

	it("leaves a task untagged when neither it nor the note has tags", () => {
		expect(taskGroupTags(6, new Map(), [])).toEqual([]);
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

describe("OpenTaskIndex", () => {
	type File = { path: string; version: number };
	const tasks = (path: string): IndexedTask[] => [{ line: 1, text: path, tags: [] }];

	function setup(batchSize = 50) {
		const extracted: string[] = [];
		let inFlight = 0;
		let maxInFlight = 0;
		const index = new OpenTaskIndex<File>(
			async (file) => {
				extracted.push(file.path);
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Promise.resolve();
				inFlight--;
				if (file.path === "broken.md") throw new Error("unreadable");
				return tasks(file.path);
			},
			(file) => [file.version],
			batchSize
		);
		return { index, extracted, maxInFlight: () => maxInFlight };
	}

	it("extracts each note once, and reuses it while its version stays the same", async () => {
		const { index, extracted } = setup();
		const files = [{ path: "a.md", version: 1 }, { path: "b.md", version: 1 }];
		await index.get(files);
		const second = await index.get(files);
		expect(extracted).toEqual(["a.md", "b.md"]);
		expect(second.get("a.md")).toEqual(tasks("a.md"));
	});

	it("re-extracts only the notes whose version changed", async () => {
		const { index, extracted } = setup();
		await index.get([{ path: "a.md", version: 1 }, { path: "b.md", version: 1 }]);
		await index.get([{ path: "a.md", version: 2 }, { path: "b.md", version: 1 }]);
		expect(extracted).toEqual(["a.md", "b.md", "a.md"]);
	});

	it("runs extractions in batches, not all at once", async () => {
		const { index, maxInFlight } = setup(2);
		await index.get([1, 2, 3, 4, 5].map((n) => ({ path: `${n}.md`, version: 1 })));
		expect(maxInFlight()).toBe(2);
	});

	it("skips a note that fails, without caching it", async () => {
		const { index, extracted } = setup();
		const result = await index.get([{ path: "broken.md", version: 1 }, { path: "a.md", version: 1 }]);
		expect(result.has("broken.md")).toBe(false);
		expect(result.get("a.md")).toEqual(tasks("a.md"));
		await index.get([{ path: "broken.md", version: 1 }]);
		expect(extracted.filter((p) => p === "broken.md")).toHaveLength(2);
	});

	it("forgets pruned notes", async () => {
		const { index, extracted } = setup();
		await index.get([{ path: "a.md", version: 1 }]);
		index.prune(new Set());
		await index.get([{ path: "a.md", version: 1 }]);
		expect(extracted).toEqual(["a.md", "a.md"]);
	});
});

describe("splitByWaiting", () => {
	it("puts @waiting tasks in their own section, keeping the order of both", () => {
		const tasks = [
			task(["#a"], 0, 1, "call Anna"),
			task(["#a"], 0, 2, "offer from Bob @waiting"),
			task([], 1, 1, "write report"),
			task([], 1, 3, "@Waiting reply"),
		];
		const { mine, waiting } = splitByWaiting(tasks);
		expect(mine.map((t) => t.text)).toEqual(["call Anna", "write report"]);
		expect(waiting.map((t) => t.text)).toEqual(["offer from Bob @waiting", "@Waiting reply"]);
	});
});
