import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, DEVICE_SETTING_KEYS, deviceSettingKey, migrateSettings, resolveDeviceSettings } from "../src/settings";

const CURRENT_VERSION = DEFAULT_SETTINGS.settingsVersion;

describe("migrateSettings", () => {
	it("splits a legacy contentPreviewChars > 0 into contentDisplay/previewLength, then seeds their mobile twins", () => {
		const data: Record<string, unknown> = { folderPath: "Journal", contentPreviewChars: 150 };
		const changed = migrateSettings(data);

		expect(changed).toBe(true);
		expect(data).toEqual({
			folderPath: "Journal",
			contentDisplay: "preview",
			previewLength: 150,
			mobileContentDisplay: "preview",
			mobilePreviewLength: 150,
			settingsVersion: CURRENT_VERSION,
		});
	});

	it("treats a legacy contentPreviewChars of 0 as full content, falling back to the default preview length", () => {
		const data: Record<string, unknown> = { contentPreviewChars: 0 };
		const changed = migrateSettings(data);

		expect(changed).toBe(true);
		expect(data.contentDisplay).toBe("full");
		expect(data.previewLength).toBe(300);
		expect(data.settingsVersion).toBe(CURRENT_VERSION);
	});

	it("copies each saved device-specific setting into its mobile twin (v1 -> v2)", () => {
		const data: Record<string, unknown> = {
			settingsVersion: 1,
			folderPath: "Journal",
			notesPerPage: 25,
			showDateGroups: true,
			tagTreeExpandLevel: "2",
		};
		const changed = migrateSettings(data);

		expect(changed).toBe(true);
		expect(data).toEqual({
			settingsVersion: CURRENT_VERSION,
			folderPath: "Journal",
			notesPerPage: 25,
			showDateGroups: true,
			tagTreeExpandLevel: "2",
			mobileNotesPerPage: 25,
			mobileShowDateGroups: true,
			mobileTagTreeExpandLevel: "2",
		});
	});

	it("doesn't overwrite a mobile value that's already there", () => {
		const data: Record<string, unknown> = { settingsVersion: 1, notesPerPage: 25, mobileNotesPerPage: 5 };
		migrateSettings(data);

		expect(data.mobileNotesPerPage).toBe(5);
	});

	it("stamps a fresh install (empty data) with the current settingsVersion and nothing else", () => {
		const data: Record<string, unknown> = {};
		const changed = migrateSettings(data);

		expect(changed).toBe(true);
		expect(data).toEqual({ settingsVersion: CURRENT_VERSION });
	});

	it("is a no-op for data already at the current settingsVersion", () => {
		const data: Record<string, unknown> = { settingsVersion: CURRENT_VERSION, contentDisplay: "preview", previewLength: 500 };
		const changed = migrateSettings(data);

		expect(changed).toBe(false);
		expect(data).toEqual({ settingsVersion: CURRENT_VERSION, contentDisplay: "preview", previewLength: 500 });
	});
});

describe("deviceSettingKey", () => {
	it("returns the plain key on desktop and the mobile-prefixed one on mobile", () => {
		expect(deviceSettingKey("notesPerPage", false)).toBe("notesPerPage");
		expect(deviceSettingKey("notesPerPage", true)).toBe("mobileNotesPerPage");
		expect(deviceSettingKey("tagTreeExpandLevel", true)).toBe("mobileTagTreeExpandLevel");
	});

	it("gives every device-specific setting a mobile twin with the same default", () => {
		for (const key of DEVICE_SETTING_KEYS) {
			expect(DEFAULT_SETTINGS[deviceSettingKey(key, true)]).toEqual(DEFAULT_SETTINGS[key]);
		}
	});
});

describe("resolveDeviceSettings", () => {
	const settings = { ...DEFAULT_SETTINGS, notesPerPage: 20, mobileNotesPerPage: 5, contentDisplay: "full" as const, mobileContentDisplay: "preview" as const };

	it("picks the desktop values on desktop", () => {
		const resolved = resolveDeviceSettings(settings, false);
		expect(resolved.notesPerPage).toBe(20);
		expect(resolved.contentDisplay).toBe("full");
	});

	it("picks the mobile values on mobile", () => {
		const resolved = resolveDeviceSettings(settings, true);
		expect(resolved.notesPerPage).toBe(5);
		expect(resolved.contentDisplay).toBe("preview");
	});
});
