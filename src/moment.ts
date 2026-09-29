import { moment as obsidianMoment } from "obsidian";

// A locally-declared, deliberately minimal view of the moment.js API — only
// the calls this plugin actually makes. obsidian.d.ts types its `moment`
// export via `import * as Moment from 'moment'`, which only resolves when the
// `moment` package's own typings are installed where the type checker can
// find them; the community plugin review's lint environment evidently can't
// (declaring `moment` as a devDependency didn't help), so there every
// moment-derived value typed as `error` and tripped the whole
// @typescript-eslint/no-unsafe-* family. Typing against this interface
// instead makes the rest of the codebase independent of that resolution.
//
// Runtime behavior is unchanged: `moment` below *is* Obsidian's own bundled
// moment instance, just re-typed. Add a method here (matching moment's real
// signature) before calling it anywhere else in src/.
export type TimeUnit = "day" | "week" | "month" | "months";

export interface Moment {
	clone(): Moment;
	format(format?: string): string;
	isValid(): boolean;
	valueOf(): number;
	utc(): Moment;
	startOf(unit: TimeUnit): Moment;
	add(amount: number, unit: TimeUnit): Moment;
	subtract(amount: number, unit: TimeUnit): Moment;
	month(): number;
	isSame(other: Moment, granularity?: TimeUnit): boolean;
	isAfter(other: Moment, granularity?: TimeUnit): boolean;
	isSameOrAfter(other: Moment, granularity?: TimeUnit): boolean;
	isSameOrBefore(other: Moment, granularity?: TimeUnit): boolean;
}

export type MomentInput = string | number | Date | Moment | null | undefined;

export type MomentFactory = (input?: MomentInput, format?: string | string[], strict?: boolean) => Moment;

export const moment = obsidianMoment as unknown as MomentFactory;
