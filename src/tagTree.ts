import { setIcon } from "obsidian";

export interface TagTreeNode {
	segment: string;
	path: string;
	children: Map<string, TagTreeNode>;
}

function normalizeTag(tag: string): string {
	return tag.replace(/^#/, "");
}

export function tagMatchesFilter(tag: string, filter: string): boolean {
	const normalized = normalizeTag(tag);
	return normalized === filter || normalized.startsWith(`${filter}/`);
}

export function buildTagTree(tags: string[]): TagTreeNode {
	const root: TagTreeNode = { segment: "", path: "", children: new Map() };

	for (const rawTag of tags) {
		const segments = normalizeTag(rawTag).split("/");
		let node = root;
		let path = "";
		for (const segment of segments) {
			path = path ? `${path}/${segment}` : segment;
			let child = node.children.get(segment);
			if (!child) {
				child = { segment, path, children: new Map() };
				node.children.set(segment, child);
			}
			node = child;
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
	const children = Array.from(node.children.values()).sort((a, b) => a.segment.localeCompare(b.segment));

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
			text: child.segment,
			cls: "notes-tag-tree-label" + (child.path === selectedPath ? " is-selected" : ""),
		});
		label.addEventListener("click", () => onSelect(child.path));

		if (hasChildren) {
			renderChildren(item, child, selectedPath, collapsedPaths, onSelect, onToggleCollapse);
		}
	}
}
