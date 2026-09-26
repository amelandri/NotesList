import { setIcon } from "obsidian";

export interface TagTreeNode {
	segment: string;
	path: string;
	/** Number of distinct notes matching this tag or one of its nested sub-tags, counted across every note in scope (same semantics as tagMatchesFilter) — NOT narrowed by any currently active date/month filter, since the tag tree is meant to stay a stable reference point like the heatmap. Clicking a node combines with those filters via AND, so it can show fewer notes than this count when one is also active. */
	count: number;
	children: Map<string, TagTreeNode>;
}

function normalizeTag(tag: string): string {
	return tag.replace(/^#/, "");
}

// Obsidian treats tags case-insensitively (its own tag pane merges "#Project"
// and "#project" into one), so matching and grouping both compare on this
// lowercased form rather than the tag's literal casing.
export function tagMatchesFilter(tag: string, filter: string): boolean {
	const normalized = normalizeTag(tag).toLowerCase();
	const normalizedFilter = filter.toLowerCase();
	return normalized === normalizedFilter || normalized.startsWith(`${normalizedFilter}/`);
}

// Children are keyed by lowercased segment so "#Project" and "#project" merge
// into one node — whichever casing is seen first wins for display (segment)
// and for the node's own path (used as the filter value), and every later
// note contributing the same tag under different casing just adds to its count.
function getOrCreateChild(node: TagTreeNode, segment: string, path: string): TagTreeNode {
	const key = segment.toLowerCase();
	let child = node.children.get(key);
	if (!child) {
		child = { segment, path, count: 0, children: new Map() };
		node.children.set(key, child);
	}
	return child;
}

// perNoteTags is one tag array per note (not a flat, pre-merged list), so a
// note's contribution to each node's count can be deduped — a note tagged
// both "area" and "area/work" must still only count once towards "area".
export function buildTagTree(perNoteTags: string[][]): TagTreeNode {
	const root: TagTreeNode = { segment: "", path: "", count: 0, children: new Map() };

	for (const noteTags of perNoteTags) {
		// Every ancestor path this note reaches, deduped case-insensitively (keyed
		// by lowercased path, valued by the first-seen casing) — a note carrying
		// both "#Project" and "#project" is the same tag twice on the same note
		// and must still only count once towards it, not twice.
		const reachedPaths = new Map<string, string>();
		for (const rawTag of noteTags) {
			const segments = normalizeTag(rawTag).split("/");
			let path = "";
			for (const segment of segments) {
				path = path ? `${path}/${segment}` : segment;
				const key = path.toLowerCase();
				if (!reachedPaths.has(key)) reachedPaths.set(key, path);
			}
		}

		for (const path of reachedPaths.values()) {
			let node = root;
			let currentPath = "";
			for (const segment of path.split("/")) {
				currentPath = currentPath ? `${currentPath}/${segment}` : segment;
				node = getOrCreateChild(node, segment, currentPath);
			}
			node.count += 1;
		}
	}

	return root;
}

export function renderTagTree(
	container: HTMLElement,
	root: TagTreeNode,
	selectedPath: string | null,
	collapsedPaths: ReadonlySet<string>,
	onSelect: (path: string) => void,
	onToggleCollapse: (path: string) => void
): void {
	container.empty();

	if (root.children.size === 0) {
		container.createEl("p", { text: "No tags.", cls: "notes-tag-tree-empty" });
		return;
	}

	renderChildren(container, root, selectedPath, collapsedPaths, onSelect, onToggleCollapse);
}

function renderChildren(
	container: HTMLElement,
	node: TagTreeNode,
	selectedPath: string | null,
	collapsedPaths: ReadonlySet<string>,
	onSelect: (path: string) => void,
	onToggleCollapse: (path: string) => void
): void {
	const children = Array.from(node.children.values()).sort((a, b) =>
		a.segment.localeCompare(b.segment, undefined, { sensitivity: "base" })
	);

	const list = container.createEl("ul", { cls: "notes-tag-tree-list" });
	for (const child of children) {
		const hasChildren = child.children.size > 0;
		const isCollapsed = hasChildren && collapsedPaths.has(child.path);

		const item = list.createEl("li", {
			cls: "notes-tag-tree-item" + (isCollapsed ? " is-collapsed" : ""),
		});

		const row = item.createDiv({ cls: "notes-tag-tree-row" });

		const toggle = row.createSpan({ cls: "notes-tag-tree-toggle" });
		if (hasChildren) {
			setIcon(toggle, "chevron-down");
			toggle.addEventListener("click", () => onToggleCollapse(child.path));
		}

		const label = row.createEl("span", {
			cls: "notes-tag-tree-label" + (child.path === selectedPath ? " is-selected" : ""),
		});
		label.createSpan({ text: child.segment });
		label.createSpan({ text: ` (${child.count})`, cls: "notes-tag-tree-count" });
		label.addEventListener("click", () => onSelect(child.path));

		if (hasChildren) {
			renderChildren(item, child, selectedPath, collapsedPaths, onSelect, onToggleCollapse);
		}
	}
}
