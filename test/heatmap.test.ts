import moment from "moment";
import { describe, expect, it } from "vitest";
import { computeVisibleMaxCount, countByDay, levelFor } from "../src/heatmap";

describe("countByDay", () => {
	it("returns an empty map for no dates", () => {
		expect(countByDay([]).size).toBe(0);
	});

	it("buckets multiple notes on the same day into one count", () => {
		const day = moment("2026-09-25");
		const counts = countByDay([day, day.clone().add(3, "hours"), day.clone().add(20, "hours")]);
		expect(counts.get("2026-09-25")).toBe(3);
	});

	it("keeps different days separate", () => {
		const counts = countByDay([moment("2026-09-25"), moment("2026-09-26")]);
		expect(counts.get("2026-09-25")).toBe(1);
		expect(counts.get("2026-09-26")).toBe(1);
	});
});

describe("computeVisibleMaxCount", () => {
	it("ignores a day outside the visible window even if it has a much higher count", () => {
		// This is the exact bug fixed this session: a bulk-import day from a year
		// ago dominating the color scale for the actually-visible 6-month window.
		const counts = new Map([
			["2020-01-01", 300], // far outside the window below
			["2026-09-20", 5],
			["2026-09-25", 2],
		]);
		const start = moment("2026-09-01");
		const end = moment("2026-09-30");

		expect(computeVisibleMaxCount(counts, start, end)).toBe(5);
	});

	it("returns 0 when no day in the window has any notes", () => {
		const counts = new Map([["2020-01-01", 300]]);
		expect(computeVisibleMaxCount(counts, moment("2026-09-01"), moment("2026-09-30"))).toBe(0);
	});

	it("includes both the start and end day of the window", () => {
		const start = moment("2026-09-01");
		const end = moment("2026-09-02");
		const counts = new Map([
			["2026-09-01", 1],
			["2026-09-02", 4],
		]);
		expect(computeVisibleMaxCount(counts, start, end)).toBe(4);
	});
});

describe("levelFor", () => {
	it("is level 0 when there are no notes that day, regardless of maxCount", () => {
		expect(levelFor(0, 10)).toBe(0);
	});

	it("is level 0 when maxCount is 0 (avoids a division by zero)", () => {
		expect(levelFor(0, 0)).toBe(0);
	});

	it("is level 4 at the busiest day (ratio 1)", () => {
		expect(levelFor(10, 10)).toBe(4);
	});

	it("buckets ratios at the documented thresholds (> not >=)", () => {
		expect(levelFor(25, 100)).toBe(1); // ratio exactly 0.25
		expect(levelFor(26, 100)).toBe(2); // just above 0.25
		expect(levelFor(50, 100)).toBe(2); // ratio exactly 0.5
		expect(levelFor(51, 100)).toBe(3); // just above 0.5
		expect(levelFor(75, 100)).toBe(3); // ratio exactly 0.75
		expect(levelFor(76, 100)).toBe(4); // just above 0.75
	});
});
