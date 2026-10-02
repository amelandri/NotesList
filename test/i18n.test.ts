import { afterEach, describe, expect, it } from "vitest";
import { setLanguage, t, tn, TRANSLATIONS } from "../src/i18n";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (value: string | Record<string, string>) => (typeof value === "string" ? [value] : Object.values(value));

afterEach(() => setLanguage("en"));

describe("translations", () => {
	const en = TRANSLATIONS.en;

	for (const [lang, table] of Object.entries(TRANSLATIONS)) {
		it(`${lang} has exactly English's keys`, () => {
			expect(Object.keys(table).sort()).toEqual(Object.keys(en).sort());
		});

		it(`${lang} uses the same placeholders as English in every string`, () => {
			for (const key of Object.keys(en) as Array<keyof typeof en>) {
				const expected = placeholders(forms(en[key]).join(" "));
				for (const form of forms(table[key])) {
					// A plural form may leave {count} implicit, but no other placeholder.
					expect({ key, placeholders: placeholders(form).filter((p) => p !== "count") }).toEqual({
						key,
						placeholders: [...new Set(expected)].filter((p) => p !== "count"),
					});
				}
			}
		});
	}
});

describe("t", () => {
	it("fills placeholders", () => {
		expect(t("notice.templateNotFound", { path: "T.md" })).toContain('"T.md"');
	});

	it("follows the app language, falling back to English for an unknown one", () => {
		setLanguage("it");
		expect(t("view.newNote")).toBe("Nuova nota");
		setLanguage("xx");
		expect(t("view.newNote")).toBe("New note");
	});

	it("matches a regional variant to its base language", () => {
		setLanguage("it-CH");
		expect(t("group.today")).toBe("Oggi");
	});
});

describe("tn", () => {
	it("picks the plural form for the count, in English", () => {
		expect(tn("heatmap.total", 1)).toBe("1 note");
		expect(tn("heatmap.total", 0)).toBe("0 notes");
		expect(tn("heatmap.total", 5)).toBe("5 notes");
	});

	it("picks the plural form for the count, in Italian", () => {
		setLanguage("it");
		expect(tn("heatmap.total", 1)).toBe("1 nota");
		expect(tn("heatmap.total", 7)).toBe("7 note");
		expect(tn("heatmap.totalFiltered", 3, { visible: 2 })).toBe("2 di 3 note");
	});

	it("falls back to the 'other' form for a category the table leaves out", () => {
		// Italian has a "many" category for e.g. 1,000,000 in recent CLDR data.
		setLanguage("it");
		expect(tn("heatmap.total", 1_000_000)).toBe("1000000 note");
	});
});
