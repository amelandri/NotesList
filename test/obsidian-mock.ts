// Stand-in for the "obsidian" module, used only by Vitest (see
// vitest.config.ts's resolve.alias) when a test imports a src/*.ts file that
// imports from "obsidian" — the real "obsidian" npm package ships no runtime
// at all (see CLAUDE.md's Commands section), only type declarations, so
// there's nothing a plain Node/Vitest process can actually import from it.
//
// This does NOT touch the plugin's own build (esbuild.config.mjs already
// marks "obsidian" as external, same as always) — it only exists so tests
// can import a src file's already-exported, already-pure functions without
// the module's own top-level class declarations (e.g. `class X extends
// ItemView`) throwing at import time for want of a real base class.
//
// Everything here is a bare stub with no real behavior, *except* moment,
// which re-exports the real npm package: it's already a genuine transitive
// dependency (declared by "obsidian" itself), and this project's date logic
// depends on its exact, real behavior — a fake would defeat the point of
// testing it at all.
export { default as moment } from "moment";

export function setIcon() {}

export function getAllTags() {
	return [];
}

export function debounce<T extends (...args: unknown[]) => unknown>(fn: T): T {
	return fn;
}

// A rough approximation, not Obsidian's real implementation — good enough to
// exercise this project's *own* logic that calls it (see normalizeOptionalPath
// in main.ts), which is what these tests actually care about verifying.
export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\.\//, "")
		.replace(/\/+$/, "");
}

export class TFile {
	path = "";
	basename = "";
	stat = { mtime: 0, ctime: 0, size: 0 };
}

export class TFolder {
	path = "";
	children: unknown[] = [];
}

export class ItemView {
	app: unknown;
	contentEl: unknown;
	constructor(public leaf: unknown) {}
	registerEvent() {}
}

export class Plugin {
	app: unknown;
	manifest: unknown;
	constructor(app: unknown, manifest: unknown) {
		this.app = app;
		this.manifest = manifest;
	}
	registerEvent() {}
	registerView() {}
	addCommand() {}
	addRibbonIcon() {}
	addSettingTab() {}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: unknown;
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class SettingGroup {
	setHeading() {
		return this;
	}
	addSetting() {
		return this;
	}
}

export class Notice {
	constructor(public message?: string) {}
}

export class AbstractInputSuggest<T> {
	app: unknown;
	inputEl: unknown;
	constructor(app: unknown, inputEl: unknown) {
		this.app = app;
		this.inputEl = inputEl;
	}
	close() {}
}

export const MarkdownRenderer = {
	render() {
		return Promise.resolve();
	},
};
