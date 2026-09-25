import { copyFileSync, mkdirSync } from "fs";
import { resolve } from "path";

const DEFAULT_VAULT = "/Users/amelandri/Syncthing/TestObsidian";
const vaultPath = process.env.OBSIDIAN_VAULT_PATH || DEFAULT_VAULT;

const pluginDir = resolve(vaultPath, ".obsidian/plugins/notes-list");
mkdirSync(pluginDir, { recursive: true });

for (const file of ["manifest.json", "main.js", "styles.css"]) {
	copyFileSync(resolve(file), resolve(pluginDir, file));
}

console.log(`Plugin copied to ${pluginDir}`);
