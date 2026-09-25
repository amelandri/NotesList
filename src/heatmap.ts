import { moment } from "obsidian";

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
	dates: moment.Moment[],
	visibleCount: number,
	selection: HeatmapSelection
): void {
	const { selectedDate, onSelectDate, selectedMonth, onSelectMonth } = selection;

	const dayCounts = new Map<string, number>();
	for (const date of dates) {
		const key = date.format("YYYY-MM-DD");
		dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
	}
	const maxCount = Math.max(0, ...dayCounts.values());

	const today = moment().startOf("day");
	const start = today.clone().subtract(RANGE_MONTHS, "months").startOf("week");

	container.empty();
	container.addClass("notes-heatmap");

	const scroller = container.createDiv({ cls: "notes-heatmap-scroller" });
	const monthsRow = scroller.createDiv({ cls: "notes-heatmap-months" });
	const grid = scroller.createDiv({ cls: "notes-heatmap-grid" });

	let lastMonth = -1;
	const cursor = start.clone();

	while (cursor.isSameOrBefore(today, "day")) {
		const weekStart = cursor.clone();
		const column = grid.createDiv({ cls: "notes-heatmap-week" });

		const label = monthsRow.createDiv({ cls: "notes-heatmap-month-label" });
		if (weekStart.month() !== lastMonth) {
			const monthKey = weekStart.format("YYYY-MM");
			label.setText(weekStart.format("MMM"));
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
			cell.setAttr("title", `${count} note${count === 1 ? "" : "s"} — ${date.format("D MMM")}`);
			cell.addEventListener("click", () => onSelectDate(dateKey));
		}
	}

	const legend = container.createDiv({ cls: "notes-heatmap-legend" });
	legend.createSpan({ text: "Less" });
	for (let level = 0; level <= 4; level++) {
		legend.createDiv({ cls: `notes-heatmap-cell level-${level}` });
	}
	legend.createSpan({ text: "More" });

	const total = dates.length;
	const totalLabel = `${total} note${total === 1 ? "" : "s"}`;
	legend.createSpan({
		text: visibleCount === total ? totalLabel : `${visibleCount} of ${totalLabel}`,
		cls: "notes-heatmap-total",
	});
}

function levelFor(count: number, maxCount: number): number {
	if (count === 0 || maxCount === 0) return 0;
	const ratio = count / maxCount;
	if (ratio > 0.75) return 4;
	if (ratio > 0.5) return 3;
	if (ratio > 0.25) return 2;
	return 1;
}
