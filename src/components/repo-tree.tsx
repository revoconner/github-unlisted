"use client";

import Link from "next/link";
import * as React from "react";
import { buildHref } from "@/lib/repo-path";

interface Item {
	path: string;
	type: "dir" | "file";
}

interface Node {
	name: string;
	path: string;
	type: "dir" | "file";
	children: Map<string, Node>;
}

function FolderIcon() {
	return (
		<span className="icon-d" aria-hidden="true">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
			</svg>
		</span>
	);
}
function FileIcon() {
	return (
		<span className="icon-f" aria-hidden="true">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
			</svg>
		</span>
	);
}

function Chevron({ open }: { open: boolean }) {
	return (
		<span className={`tree__chev${open ? " is-open" : ""}`} aria-hidden="true">
			<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
				<polyline points="9 6 15 12 9 18" />
			</svg>
		</span>
	);
}

function buildTree(items: Item[]): Node {
	const root: Node = {
		name: "",
		path: "",
		type: "dir",
		children: new Map(),
	};
	for (const it of items) {
		const parts = it.path.split("/");
		let cur = root;
		let acc = "";
		for (let i = 0; i < parts.length; i++) {
			acc = acc ? `${acc}/${parts[i]}` : parts[i];
			const isLast = i === parts.length - 1;
			let child = cur.children.get(parts[i]);
			if (!child) {
				child = {
					name: parts[i],
					path: acc,
					type: isLast ? it.type : "dir",
					children: new Map(),
				};
				cur.children.set(parts[i], child);
			} else if (isLast) {
				child.type = it.type;
			}
			cur = child;
		}
	}
	return root;
}

function sortedChildren(node: Node): Node[] {
	return [...node.children.values()].sort((a, b) =>
		a.type === b.type
			? a.name.localeCompare(b.name)
			: a.type === "dir"
				? -1
				: 1,
	);
}

function ancestorsOf(path: string): string[] {
	if (!path) return [];
	const parts = path.split("/");
	const out: string[] = [];
	let acc = "";
	for (let i = 0; i < parts.length - 1; i++) {
		acc = acc ? `${acc}/${parts[i]}` : parts[i];
		out.push(acc);
	}
	return out;
}

export function RepoTree({
	items,
	owner,
	repo,
	refName,
	shareId,
	activePath,
}: {
	items: Item[];
	owner: string;
	repo: string;
	refName: string;
	shareId: string;
	activePath: string;
}) {
	const root = React.useMemo(() => buildTree(items), [items]);

	const [expanded, setExpanded] = React.useState<Set<string>>(
		() => new Set(ancestorsOf(activePath)),
	);

	// Re-open the path to the active file after navigation without collapsing
	// folders the user opened manually.
	React.useEffect(() => {
		setExpanded((prev) => {
			const next = new Set(prev);
			for (const a of ancestorsOf(activePath)) next.add(a);
			return next;
		});
	}, [activePath]);

	const [q, setQ] = React.useState("");
	const query = q.trim().toLowerCase();

	const matches = React.useMemo(() => {
		if (!query) return null;
		return items
			.filter(
				(it) =>
					it.type === "file" &&
					it.path.split("/").pop()?.toLowerCase().includes(query),
			)
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 200);
	}, [items, query]);

	const toggle = (path: string) =>
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});

	const renderNodes = (nodes: Node[], depth: number): React.ReactNode =>
		nodes.map((n) => {
			const pad = { paddingLeft: 12 + depth * 14 };
			if (n.type === "dir") {
				const open = expanded.has(n.path);
				return (
					<div key={n.path}>
						<button
							type="button"
							className="tree__row tree__btn"
							style={pad}
							aria-expanded={open}
							onClick={() => toggle(n.path)}
						>
							<Chevron open={open} />
							<FolderIcon />
							{n.name}
						</button>
						{open && renderNodes(sortedChildren(n), depth + 1)}
					</div>
				);
			}
			return (
				<div
					className="tree__row"
					key={n.path}
					style={pad}
					aria-current={n.path === activePath}
				>
					<Link
						href={buildHref(owner, repo, "blob", refName, n.path, shareId)}
					>
						<FileIcon />
						{n.name}
					</Link>
				</div>
			);
		});

	return (
		<>
			<div className="viewer__sidebar-search">
				<label className="field">
					<span className="field__icon" aria-hidden="true">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<circle cx="11" cy="11" r="7" />
							<line x1="21" y1="21" x2="16.65" y2="16.65" />
						</svg>
					</span>
					<input
						type="search"
						placeholder="Find a file"
						value={q}
						onChange={(e) => setQ(e.target.value)}
					/>
				</label>
			</div>
			<div className="tree">
				{matches ? (
					matches.length === 0 ? (
						<div className="tree__empty">No matches.</div>
					) : (
						matches.map((it) => (
							<div
								className="tree__row"
								key={it.path}
								aria-current={it.path === activePath}
							>
								<Link
									href={buildHref(
										owner,
										repo,
										"blob",
										refName,
										it.path,
										shareId,
									)}
								>
									<FileIcon />
									{it.path}
								</Link>
							</div>
						))
					)
				) : root.children.size === 0 ? (
					<div className="tree__empty">No files here.</div>
				) : (
					renderNodes(sortedChildren(root), 0)
				)}
			</div>
		</>
	);
}
