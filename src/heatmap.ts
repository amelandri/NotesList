import { t, tn } from "./i18n";
import { Moment, moment } from "./moment";

const WEEKDAYS = 7;
const RANGE_MONTHS = 6;

export interface HeatmapSelection {
	selectedDate: string | null;
	onSelectDate: (date: string) => void;
	selectedMonth: string | null;
	onSelectMonth: (month: string) => void;
}

export function renderHeatmap(
	container: HTMLElement,
	dates: Moment[],
	visibleCount: number,
	selection: HeatmapSelection
): void {
	const { selectedDate, onSelectDate, selectedMonth, onSelectMonth } = selection;

	const dayCounts = countByDay(dates);

	const today = moment().startOf("day");
	const start = today.clone().subtract(RANGE_MONTHS, "months").startOf("week");

	const maxCount = computeVisibleMaxCount(dayCounts, start, today);

	container.empty();
	container.addClass("notes-heatmap");

	const scroller = container.createDiv({ cls: "notes-heatmap-scroller" });
	const monthsRow = scroller.createDiv({ cls: "notes-heatmap-months" });
	const grid = scroller.createDiv({ cls: "notes-heatmap-grid" });

	// Each week column's month (of its first day), so a label knows how many
	// columns its month spans before the next label starts.
	const weekMonths: number[] = [];
	for (const week = start.clone(); week.isSameOrBefore(today, "day"); week.add(1, "week")) {
		weekMonths.push(week.month());
	}
	const spans = monthSpans(weekMonths);

	let lastMonth = -1;
	let weekIndex = 0;
	const cursor = start.clone();

	while (cursor.isSameOrBefore(today, "day")) {
		const weekStart = cursor.clone();
		const column = grid.createDiv({ cls: "notes-heatmap-week" });

		const label = monthsRow.createDiv({ cls: "notes-heatmap-month-label" });
		if (weekStart.month() !== lastMonth) {
			const monthKey = weekStart.format("YYYY-MM");
			label.setText(monthLabelText(weekStart.format("MMM"), spans[weekIndex]));
			label.setAttr("title", weekStart.format("MMMM YYYY"));
			label.addClass("is-clickable");
			if (monthKey === selectedMonth) label.addClass("is-selected");
			label.addEventListener("click", () => onSelectMonth(monthKey));
			lastMonth = weekStart.month();
		}

		for (let day = 0; day < WEEKDAYS; day++) {
			const date = cursor.clone();
			cursor.add(1, "day");

			if (date.isAfter(today, "day")) {
				column.createDiv({ cls: "notes-heatmap-cell notes-heatmap-cell-empty" });
				continue;
			}

			const dateKey = date.format("YYYY-MM-DD");
			const count = dayCounts.get(dateKey) ?? 0;
			const level = levelFor(count, maxCount);
			const cell = column.createDiv({
				cls: `notes-heatmap-cell level-${level}` + (dateKey === selectedDate ? " is-selected" : ""),
			});
			cell.setAttr("title", tn("heatmap.cell", count, { date: date.format("D MMM") }));
			cell.addEventListener("click", () => onSelectDate(dateKey));
		}
		weekIndex++;
	}

	const legend = container.createDiv({ cls: "notes-heatmap-legend" });
	legend.createSpan({ text: t("heatmap.less") });
	for (let level = 0; level <= 4; level++) {
		legend.createDiv({ cls: `notes-heatmap-cell level-${level}` });
	}
	legend.createSpan({ text: t("heatmap.more") });

	const total = dates.length;
	legend.createSpan({
		text:
			visibleCount === total
				? tn("heatmap.total", total)
				: tn("heatmap.totalFiltered", total, { visible: visibleCount }),
		cls: "notes-heatmap-total",
	});
}

// For each week column, how many consecutive columns (itself included) share
// its month: the room a month label has, since it starts on the month's first
// column and overflows to the right until the next label.
export function monthSpans(weekMonths: number[]): number[] {
	const spans = new Array<number>(weekMonths.length);
	for (let i = weekMonths.length - 1; i >= 0; i--) {
		spans[i] = i + 1 < weekMonths.length && weekMonths[i + 1] === weekMonths[i] ? spans[i + 1] + 1 : 1;
	}
	return spans;
}

// A month label with a single column of room (the partial first month of
// the window, or the current month when it has just started) would overlap
// the next label, so it shrinks to its initial plus a period ("S."). The full
// name stays in the label's tooltip. Either way the first letter is upper
// case: some locales write month names in lower case (Italian "giu", "lug"),
// which looks off as a label.
export function monthLabelText(shortName: string, span: number): string {
	const initial = shortName.charAt(0).toLocaleUpperCase();
	return span > 1 ? initial + shortName.slice(1) : initial + ".";
}

export function levelFor(count: number, maxCount: number): number {
	if (count === 0 || maxCount === 0) return 0;
	const ratio = count / maxCount;
	if (ratio > 0.75) return 4;
	if (ratio > 0.5) return 3;
	if (ratio > 0.25) return 2;
	return 1;
}

// One entry per distinct "YYYY-MM-DD" among `dates`, regardless of how far
// outside the heatmap's own 6-month window a date falls — computeVisibleMaxCount
// below is what restricts the *color scale* to the visible range; this just
// buckets every note's date, unfiltered.
export function countByDay(dates: Moment[]): Map<string, number> {
	const dayCounts = new Map<string, number>();
	for (const date of dates) {
		const key = date.format("YYYY-MM-DD");
		dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
	}
	return dayCounts;
}

// Scaled from only the days actually drawn in the heatmap (start..end,
// inclusive of both), not every dayCounts entry — a date outside that window
// (e.g. a bulk import from a year ago) would otherwise dominate the result
// and flatten every visible cell's contrast down near "Less" even on the
// grid's own busiest day.
export function computeVisibleMaxCount(dayCounts: Map<string, number>, start: Moment, end: Moment): number {
	let maxCount = 0;
	for (const cursor = start.clone(); cursor.isSameOrBefore(end, "day"); cursor.add(1, "day")) {
		const count = dayCounts.get(cursor.format("YYYY-MM-DD")) ?? 0;
		if (count > maxCount) maxCount = count;
	}
	return maxCount;
}
