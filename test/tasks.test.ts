import { describe, expect, it } from "vitest";
import { countTasks, isOpenTaskStatus, setTaskLineChecked, taskLineText } from "../src/tasks";

describe("isOpenTaskStatus", () => {
	it("is open for a space and custom statuses, not for completed or cancelled", () => {
		expect(isOpenTaskStatus(" ")).toBe(true);
		expect(isOpenTaskStatus("/")).toBe(true);
		expect(isOpenTaskStatus("x")).toBe(false);
		expect(isOpenTaskStatus("X")).toBe(false);
		expect(isOpenTaskStatus("-")).toBe(false);
	});
});

describe("taskLineText", () => {
	it("drops indentation, list marker and checkbox", () => {
		expect(taskLineText("    - [ ] buy **milk** [[Shop]]")).toBe("buy **milk** [[Shop]]");
		expect(taskLineText("1. [/] numbered")).toBe("numbered");
		expect(taskLineText("> - [ ] in a callout")).toBe("in a callout");
	});
});

describe("setTaskLineChecked", () => {
	it("checks and unchecks a plain task, keeping the rest of the line", () => {
		expect(setTaskLineChecked("- [ ] buy milk [today]", true)).toBe("- [x] buy milk [today]");
		expect(setTaskLineChecked("- [x] buy milk", false)).toBe("- [ ] buy milk");
	});

	it("handles indentation, other list markers and callouts", () => {
		expect(setTaskLineChecked("    * [ ] nested", true)).toBe("    * [x] nested");
		expect(setTaskLineChecked("1. [ ] numbered", true)).toBe("1. [x] numbered");
		expect(setTaskLineChecked("> - [ ] in a callout", true)).toBe("> - [x] in a callout");
	});

	it("unchecks a custom status (rendered as checked) back to a space", () => {
		expect(setTaskLineChecked("- [/] in progress", false)).toBe("- [ ] in progress");
		expect(setTaskLineChecked("- [-] cancelled", false)).toBe("- [ ] cancelled");
	});

	it("returns null when the line is already in the requested state", () => {
		expect(setTaskLineChecked("- [x] done", true)).toBeNull();
		expect(setTaskLineChecked("- [/] in progress", true)).toBeNull();
		expect(setTaskLineChecked("- [ ] open", false)).toBeNull();
	});

	it("returns null for a line that isn't a task", () => {
		expect(setTaskLineChecked("- plain item", true)).toBeNull();
		expect(setTaskLineChecked("Some [ ] text", true)).toBeNull();
	});
});

describe("countTasks", () => {
	it("returns zero counts for a note without list items", () => {
		expect(countTasks(undefined)).toEqual({ open: 0, done: 0, total: 0 });
	});

	it("ignores plain list items, which have no task status", () => {
		expect(countTasks([{}, { task: " " }, {}])).toEqual({ open: 1, done: 0, total: 1 });
	});

	it("counts x/X as completed, '-' as cancelled (total only), and any other status as open", () => {
		const items = [{ task: " " }, { task: "x" }, { task: "X" }, { task: "-" }, { task: "/" }];
		expect(countTasks(items)).toEqual({ open: 2, done: 2, total: 5 });
	});
});
