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
// "origin/dev".
//
// Safe to re-run with the same version after a failure partway through
// (e.g. a transient "remote rejected ... (failed)" from GitHub on a push):
// if the version bump commit and/or tag already exist, the script verifies
// they're the ones it would have made (tag on HEAD, HEAD being the "Bump
// version to x.y.z" commit) and skips straight to the remaining steps. Every
// later step is idempotent too — pushes are no-ops when already done, and an
// existing GitHub release for the tag is reused, with its assets replaced by
// the freshly built ones. Every commit/tag/push this script makes uses your own git
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GitHub occasionally rejects a perfectly valid push with a bare
// "! [remote rejected] <ref> (failed)" and no reason; retrying the very same
// push a few seconds later goes through. Only used for pushes, which are
// idempotent.
async function runWithRetry(cmd, attempts = 3, delayMs = 5000) {
	for (let attempt = 1; ; attempt++) {
		try {
			run(cmd);
			return;
		} catch (err) {
			if (attempt >= attempts) throw err;
			console.warn(`Attempt ${attempt}/${attempts} failed, retrying in ${delayMs / 1000}s...`);
			await sleep(delayMs);
		}
	}
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

function githubHeaders(token, extra = {}) {
	return { Authorization: `token ${token}`, Accept: "application/vnd.github+json", ...extra };
}

// null when no release exists for the tag yet (404).
async function findRelease(owner, repo, token, tagName) {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tagName)}`, {
		headers: githubHeaders(token),
	});
	if (res.status === 404) return null;
	if (!res.ok) fail(`looking up the GitHub release for ${tagName} failed (${res.status}): ${await res.text()}`);
	return res.json();
}

async function createRelease(owner, repo, token, tagName, notes) {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
		method: "POST",
		headers: githubHeaders(token, { "Content-Type": "application/json" }),
		body: JSON.stringify({ tag_name: tagName, name: tagName, body: notes, draft: false, prerelease: false }),
	});
	if (!res.ok) fail(`GitHub release creation failed (${res.status}): ${await res.text()}`);
	return res.json();
}

async function deleteAsset(owner, repo, token, assetId) {
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${assetId}`, {
		method: "DELETE",
		headers: githubHeaders(token),
	});
	if (!res.ok && res.status !== 404) fail(`deleting release asset ${assetId} failed (${res.status}): ${await res.text()}`);
}

async function uploadAsset(uploadUrlTemplate, token, filePath, contentType) {
	const name = filePath.split("/").pop();
	const url = uploadUrlTemplate.replace("{?name,label}", `?name=${encodeURIComponent(name)}`);
	const res = await fetch(url, {
		method: "POST",
		headers: githubHeaders(token, { "Content-Type": contentType }),
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

// Also fetches tags, so a tag pushed by an earlier, interrupted run is
// visible locally even from a fresh clone.
run("git fetch origin --tags");

function tagCommit(tag) {
	try {
		return capture(`git rev-parse --verify --quiet "refs/tags/${tag}^{commit}"`);
	} catch {
		return null;
	}
}

const head = capture("git rev-parse HEAD");
const bumpSubject = `Bump version to ${version}`;
const headIsBump = capture("git log -1 --format=%s") === bumpSubject;
const existingTagCommit = tagCommit(version);
const manifest = readJson(MANIFEST_PATH);

if (existingTagCommit && existingTagCommit !== head) {
	fail(`tag "${version}" already exists but points at ${existingTagCommit}, not HEAD (${head}). Delete or move it by hand if that's intended.`);
}
// Resuming: the bump commit (and possibly the tag) was already made by an
// earlier run that failed at a later step.
const resuming = Boolean(existingTagCommit) || (headIsBump && manifest.version === version);
if (resuming && !(headIsBump && manifest.version === version)) {
	fail(`tag "${version}" is on HEAD, but HEAD isn't the "${bumpSubject}" commit with manifest.json at ${version}.`);
}

const versions = readJson(VERSIONS_PATH);
let previousVersion;

if (resuming) {
	previousVersion = Object.keys(versions)
		.filter((v) => /^\d+\.\d+\.\d+$/.test(v) && isGreaterSemver(version, v))
		.sort((x, y) => (isGreaterSemver(x, y) ? -1 : 1))[0];
	console.log(`\nResuming release ${version} (bump commit${existingTagCommit ? " and tag" : ""} already made)\n`);
} else {
	if (manifest.version === version) fail(`manifest.json is already at version ${version}, but HEAD isn't its "${bumpSubject}" commit.`);
	if (!isGreaterSemver(version, manifest.version)) {
		fail(`${version} is not greater than the current manifest.json version (${manifest.version}).`);
	}
	previousVersion = manifest.version;
	console.log(`\nReleasing ${previousVersion} -> ${version}\n`);

	// --- 3. Bump the version everywhere ---

	manifest.version = version;
	writeJson(MANIFEST_PATH, manifest);

	const pkg = readJson(PACKAGE_PATH);
	pkg.version = version;
	writeJson(PACKAGE_PATH, pkg);

	versions[version] = manifest.minAppVersion;
	writeJson(VERSIONS_PATH, versions);
}

// --- 4. Build — verifies everything compiles and produces the release main.js ---
// Always runs, resuming or not: main.js isn't committed, so the release
// assets have to be built from this exact (tagged) commit either way.

try {
	run("npm run build");
} catch {
	if (!resuming) run(`git checkout -- ${MANIFEST_PATH} ${PACKAGE_PATH} ${VERSIONS_PATH}`);
	fail(resuming ? "build failed." : "build failed — version bump reverted, nothing committed.");
}

// --- 5. Commit, tag, push "dev" ---
// No "Co-Authored-By" trailer: this commit is you, running your own release
// script, not Claude.

if (!resuming) {
	run(`git add ${MANIFEST_PATH} ${PACKAGE_PATH} ${VERSIONS_PATH}`);
	run(`git commit -m "${bumpSubject}"`);
}
if (!existingTagCommit) run(`git tag -a ${version} -m "${version}"`);
// --atomic: "dev" and the tag land together or not at all, so a failure can't
// leave one pushed without the other. Both are no-ops if already on origin.
await runWithRetry(`git push --atomic origin dev refs/tags/${version}`);

// --- 6. Fast-forward "main" to match "dev" (never force-pushed) ---

await runWithRetry("git push origin dev:main");
try {
	run("git fetch origin main:main");
} catch {
	console.warn('Could not update the local "main" ref — harmless, cosmetic only.');
}

// --- 7. GitHub release with the built artifacts ---

const [owner, repo] = parseOwnerRepo(capture("git remote get-url origin"));
const token = getGithubToken();
const notes = notesArg || `Release ${version}.\n\nFull history: https://github.com/${owner}/${repo}/compare/${previousVersion}...${version}`;

let release = await findRelease(owner, repo, token, version);
if (release) {
	console.log("\nGitHub release already exists — reusing it, replacing its assets.");
} else {
	console.log("\nCreating GitHub release...");
	release = await createRelease(owner, repo, token, version, notes);
}

for (const [file, contentType] of RELEASE_ASSETS) {
	const existing = (release.assets ?? []).find((asset) => asset.name === file);
	if (existing) await deleteAsset(owner, repo, token, existing.id);
	console.log(`Uploading ${file}...`);
	await uploadAsset(release.upload_url, token, file, contentType);
}

console.log(`\nDone: ${release.html_url}`);
