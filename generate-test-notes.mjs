import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";

// Dev-only utility: generates throwaway notes to load-test the plugin's list/
// heatmap/tag-tree rendering against a large folder. Not part of the shipped
// plugin (like copy-to-vault.mjs).
//
// Usage: node generate-test-notes.mjs [count] [folder]
//   count  - number of notes to generate (default 100)
//   folder - vault-relative folder to write them into (default "Note")
// Vault path: $OBSIDIAN_VAULT_PATH, or the same default as copy-to-vault.mjs.

const DEFAULT_VAULT = "/Users/amelandri/Syncthing/TestObsidian";
const vaultPath = process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT;

const count = Number.parseInt(process.argv[2], 10) || 100;
const folder = process.argv[3] || "Note";

const targetDir = resolve(vaultPath, folder);
mkdirSync(targetDir, { recursive: true });

// Same filler text in every note — content doesn't need to be unique, only
// long enough (3+ paragraphs) to be representative of real Markdown rendering
// cost.
const BODY = [
	"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
	"Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
	"Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
	"Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
	"Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
	"Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
	"Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
	"Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
	"Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
].join("\n\n");

const RANGE_END = new Date();
const RANGE_START = new Date();
RANGE_START.setMonth(RANGE_START.getMonth() - 6);

function randomDateInRange() {
	const t = RANGE_START.getTime() + Math.random() * (RANGE_END.getTime() - RANGE_START.getTime());
	return new Date(t);
}

function pad(n) {
	return String(n).padStart(2, "0");
}

function formatFrontmatterDate(d) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatFrontmatterTime(d) {
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Matches the filename pattern "Unique note creator" generates by default
// (YYYYMMDDHHmm), so generated notes look like real ones.
function formatFilenameStamp(d) {
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

for (let i = 0; i < count; i++) {
	const date = randomDateInRange();
	const stamp = formatFilenameStamp(date);

	let filePath = resolve(targetDir, `${stamp}.md`);
	let suffix = 2;
	while (existsSync(filePath)) {
		filePath = resolve(targetDir, `${stamp}-${suffix++}.md`);
	}

	const frontmatter = `---\ndate: ${formatFrontmatterDate(date)}\ntime: ${formatFrontmatterTime(date)}\n---\n\n`;
	writeFileSync(filePath, frontmatter + BODY + "\n", "utf8");
}

console.log(`Generated ${count} test notes in ${targetDir}`);
