import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Redirects any `from "obsidian"` import to a local stub (see
// test/obsidian-mock.ts for why) — test-only; the plugin's own build
// (esbuild.config.mjs) is untouched and keeps marking "obsidian" external.
export default defineConfig({
	resolve: {
		alias: {
			obsidian: fileURLToPath(new URL("./test/obsidian-mock.ts", import.meta.url)),
		},
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
});
