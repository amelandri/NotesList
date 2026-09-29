// Release script: bumps the version everywhere, builds, tags, pushes "dev",
// fast-forwards "main" to match it, and publishes a GitHub release with the
// built plugin artifacts attached.
//
// Usage: node release.mjs <version> ["release notes"]
//   version        - required, plain semver x.y.z (Obsidian's own
//                    manifest.json requirement — no "v" prefix, no
//                    pre-release suffix)
//   release notes  - optional; defaults to a generic one-liner with a
//                    compare link. Edit the release on GitHub afterwards if
//                    you want something more specific.
//
// Must be run from "dev", with a clean working tree, up to date with
// "origin/dev". Every commit/tag/push this script makes uses your own git
// identity (whatever "git config user.name/user.email" already is) and your
// own stored GitHub credential (the same one "git push" already uses) — none
// of it runs or is attributed as Claude. "main" is only ever fast-forwarded
// (a plain push, never --force), matching its force-push protection: if
// "main" has diverged, this fails loudly instead of overwriting anything.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REQUIRED_BRANCH = "dev";
const MANIFEST_PATH = "manifest.json";
const PACKAGE_PATH = "package.json";
const VERSIONS_PATH = "versions.json";
const RELEASE_ASSETS = [
	["main.js", "application/javascript"],
	["manifest.json", "application/json"],
	["styles.css", "text/css"],
];

function capture(cmd, opts = {}) {
	return execSync(cmd, { encoding: "utf8", ...opts }).trim();
}

function run(cmd) {
	console.log(`$ ${cmd}`);
	execSync(cmd, { stdio: "inherit" });
}

function fail(message) {
	console.error(`\nRelease aborted: ${message}`);
	process.exit(1);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, data) {
	writeFileSync(path, JSON.stringify(data, null, "\t") + "\n", "utf8");
}

function parseSemver(v) {
	return v.split(".").map(Number);
}

function isGreaterSemver(next, current) {
	const [nMajor, nMinor, nPatch] = parseSemver(next);
	const [cMajor, cMinor, cPatch] = parseSemver(current);
	if (nMajor !== cMajor) return nMajor > cMajor;
	if (nMinor !== cMinor) return nMinor > cMinor;
	return nPatch > cPatch;
}

// Reuses the same stored credential "git push" already uses (macOS Keychain,
// or whatever git's own credential helper resolves to) — no separate token
// setup needed, and no risk of pasting a token where it could get logged.
function getGithubToken() {
	const output = capture("git credential fill", { input: "protocol=https\nhost=github.com\n\n" });
	const match = output.match(/^password=(.*)$/m);
	if (!match) {
		fail('could not retrieve a stored GitHub credential via "git credential fill" (protocol=https, host=github.com).');
	}
	return match[1];
}

function parseOwnerRepo(remoteUrl) {
	const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
	if (!match) fail(`couldn't parse a GitHub owner/repo out of origin's URL: ${remoteUrl}`);
	return [match[1], match[2]];
}

async function createRelease(owner, repo, token, tagName, notes) {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
		method: "POST",
		headers: {
			Authorization: `token ${token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ tag_name: tagName, name: tagName, body: notes, draft: false, prerelease: false }),
	});
	if (!res.ok) fail(`GitHub release creation failed (${res.status}): ${await res.text()}`);
	return res.json();
}

async function uploadAsset(uploadUrlTemplate, token, filePath, contentType) {
	const name = filePath.split("/").pop();
	const url = uploadUrlTemplate.replace("{?name,label}", `?name=${encodeURIComponent(name)}`);
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `token ${token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": contentType,
		},
		body: readFileSync(filePath),
	});
	if (!res.ok) fail(`Uploading ${name} failed (${res.status}): ${await res.text()}`);
	return res.json();
}

// --- 1. Parse and validate the version argument ---

const version = process.argv[2];
const notesArg = process.argv[3];

if (!version) fail('missing version argument. Usage: node release.mjs <version> ["release notes"]');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
	fail(`"${version}" isn't a plain x.y.z version (no "v" prefix, no pre-release suffix).`);
}

// --- 2. Verify preconditions ---

const currentBranch = capture("git rev-parse --abbrev-ref HEAD");
if (currentBranch !== REQUIRED_BRANCH) {
	fail(`must be run from "${REQUIRED_BRANCH}" (currently on "${currentBranch}").`);
}

const dirty = capture("git status --porcelain");
if (dirty) fail(`working tree isn't clean — commit, stash, or discard pending changes first:\n${dirty}`);

run("git fetch origin");

const behindCount = capture("git rev-list --count dev..origin/dev");
if (behindCount !== "0") fail(`"dev" is behind "origin/dev" by ${behindCount} commit(s) — pull first.`);

const localTags = capture("git tag -l").split("\n").filter(Boolean);
if (localTags.includes(version)) fail(`tag "${version}" already exists locally.`);

const remoteTagLines = capture("git ls-remote --tags origin").split("\n").filter(Boolean);
if (remoteTagLines.some((line) => line.endsWith(`refs/tags/${version}`))) {
	fail(`tag "${version}" already exists on origin.`);
}

const manifest = readJson(MANIFEST_PATH);
if (manifest.version === version) fail(`manifest.json is already at version ${version}.`);
if (!isGreaterSemver(version, manifest.version)) {
	fail(`${version} is not greater than the current manifest.json version (${manifest.version}).`);
}

const previousVersion = manifest.version;
console.log(`\nReleasing ${previousVersion} -> ${version}\n`);

// --- 3. Bump the version everywhere ---

const minAppVersion = manifest.minAppVersion;
manifest.version = version;
writeJson(MANIFEST_PATH, manifest);

const pkg = readJson(PACKAGE_PATH);
pkg.version = version;
writeJson(PACKAGE_PATH, pkg);

const versions = readJson(VERSIONS_PATH);
versions[version] = minAppVersion;
writeJson(VERSIONS_PATH, versions);

// --- 4. Build — verifies everything compiles and produces the release main.js ---

try {
	run("npm run build");
} catch {
	run(`git checkout -- ${MANIFEST_PATH} ${PACKAGE_PATH} ${VERSIONS_PATH}`);
	fail("build failed — version bump reverted, nothing committed.");
}

// --- 5. Commit, tag, push "dev" ---
// No "Co-Authored-By" trailer: this commit is you, running your own release
// script, not Claude.

run(`git add ${MANIFEST_PATH} ${PACKAGE_PATH} ${VERSIONS_PATH}`);
run(`git commit -m "Bump version to ${version}"`);
run(`git tag -a ${version} -m "${version}"`);
run("git push origin dev");
run(`git push origin ${version}`);

// --- 6. Fast-forward "main" to match "dev" (never force-pushed) ---

run("git push origin dev:main");
try {
	run("git fetch origin main:main");
} catch {
	console.warn('Could not update the local "main" ref — harmless, cosmetic only.');
}

// --- 7. GitHub release with the built artifacts ---

const [owner, repo] = parseOwnerRepo(capture("git remote get-url origin"));
const token = getGithubToken();
const notes = notesArg || `Release ${version}.\n\nFull history: https://github.com/${owner}/${repo}/compare/${previousVersion}...${version}`;

console.log("\nCreating GitHub release...");
const release = await createRelease(owner, repo, token, version, notes);

for (const [file, contentType] of RELEASE_ASSETS) {
	console.log(`Uploading ${file}...`);
	await uploadAsset(release.upload_url, token, file, contentType);
}

console.log(`\nDone: ${release.html_url}`);
