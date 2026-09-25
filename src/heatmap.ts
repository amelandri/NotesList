import { moment } from "obsidian";

const WEEKDAYS = 7;
const RANGE_MONTHS = 6;

export function renderHeatmap(container: HTMLElement, dates: moment.Moment[]): void {
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
			label.setText(weekStart.format("MMM"));
			lastMonth = weekStart.month();
		}

		for (let day = 0; day < WEEKDAYS; day++) {
			const date = cursor.clone();
			cursor.add(1, "day");

			if (date.isAfter(today, "day")) {
				column.createDiv({ cls: "notes-heatmap-cell notes-heatmap-cell-empty" });
				continue;
			}

			const count = dayCounts.get(date.format("YYYY-MM-DD")) ?? 0;
			const level = levelFor(count, maxCount);
			const cell = column.createDiv({ cls: `notes-heatmap-cell level-${level}` });
			cell.setAttr("title", `${count} note${count === 1 ? "" : "s"} — ${date.format("DD MMM YYYY")}`);
		}
	}

	const legend = container.createDiv({ cls: "notes-heatmap-legend" });
	legend.createSpan({ text: "Less" });
	for (let level = 0; level <= 4; level++) {
		legend.createDiv({ cls: `notes-heatmap-cell level-${level}` });
	}
	legend.createSpan({ text: "More" });
}

function levelFor(count: number, maxCount: number): number {
	if (count === 0 || maxCount === 0) return 0;
	const ratio = count / maxCount;
	if (ratio > 0.75) return 4;
	if (ratio > 0.5) return 3;
	if (ratio > 0.25) return 2;
	return 1;
}
