import { describe, expect, it } from "vitest";
import { migrateSettings } from "../src/settings";

describe("migrateSettings", () => {
	it("splits a legacy contentPreviewChars > 0 into contentDisplay/previewLength", () => {
		const data: Record<string, unknown> = { folderPath: "Journal", contentPreviewChars: 150 };
		const changed = migrateSettings(data);

		expect(changed).toBe(true);
		expect(data).toEqual({
			folderPath: "Journal",
			contentDisplay: "preview",
			previewLength: 150,
			settingsVersion: 1,
		});
	});

	it("treats a legacy contentPreviewChars of 0 as full content, falling back to the default preview length", () => {
		const data: Record<string, unknown> = { contentPreviewChars: 0 };
		const changed = migrateSettings(data);

		expect(changed).toBe(true);
		expect(data.contentDisplay).toBe("full");
		expect(data.previewLength).toBe(300);
		expect(data.settingsVersion).toBe(1);
	});

	it("stamps a fresh install (empty data) with the current settingsVersion and nothing else", () => {
		const data: Record<string, unknown> = {};
		const changed = migrateSettings(data);

		expect(changed).toBe(true);
		expect(data).toEqual({ settingsVersion: 1 });
	});

	it("is a no-op for data already at the current settingsVersion", () => {
		const data: Record<string, unknown> = { settingsVersion: 1, contentDisplay: "preview", previewLength: 500 };
		const changed = migrateSettings(data);

		expect(changed).toBe(false);
		expect(data).toEqual({ settingsVersion: 1, contentDisplay: "preview", previewLength: 500 });
	});
});
