// The same rule set the Obsidian community plugin review runs
// (eslint-plugin-obsidianmd's "recommended": ESLint core, typescript-eslint
// type-checked rules and Obsidian-specific rules), plus guards for the two
// ways this project has passed lint locally but not in the review — see
// "Lint" in CLAUDE.md. Runs as part of `npm run build`.
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		// Dev-only Node scripts, tests and the build output aren't part of the
		// shipped plugin source the review lints. package.json stays in: the
		// review lints it too (e.g. depend/ban-dependencies).
		ignores: ["main.js", "*.mjs", "test/**", "vitest.config.ts"],
	},
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.*"] },
			},
		},
	},
	{
		// Locally the `moment` package's typings resolve, so importing Obsidian's
		// `moment` directly lints clean here — but not in the review, where it
		// types as `any` and trips every @typescript-eslint/no-unsafe-* rule.
		// src/moment.ts is the one place allowed to touch it.
		files: ["src/**/*.ts"],
		ignores: ["src/moment.ts"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "obsidian",
							importNames: ["moment"],
							message: 'Import { moment, Moment } from "./moment" instead (see src/moment.ts for why).',
						},
						{
							name: "moment",
							message: 'Import { moment, Moment } from "./moment" instead (see src/moment.ts for why).',
						},
					],
				},
			],
		},
	},
]);
