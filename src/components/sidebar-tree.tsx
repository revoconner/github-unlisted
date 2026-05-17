"use client";

import Link from "next/link";
import * as React from "react";
import { buildHref } from "@/lib/repo-path";

interface Entry {
	name: string;
	path: string;
	type: "dir" | "file";
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

export function SidebarTree({
	entries,
	owner,
	repo,
	refName,
	shareId,
	parentPath,
	showParent,
}: {
	entries: Entry[];
	owner: string;
	repo: string;
	refName: string;
	shareId: string;
	parentPath: string;
	showParent: boolean;
}) {
	const [q, setQ] = React.useState("");
	const query = q.trim().toLowerCase();
	const visible = query
		? entries.filter((e) => e.name.toLowerCase().includes(query))
		: entries;

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
				{showParent && !query && (
					<div className="tree__row">
						<Link
							href={buildHref(
								owner,
								repo,
								"tree",
								refName,
								parentPath,
								shareId,
							)}
						>
							<span className="chev" aria-hidden="true">
								..
							</span>
							parent directory
						</Link>
					</div>
				)}
				{visible.length === 0 && (
					<div className="tree__empty">
						{query ? "No matches." : "No files here."}
					</div>
				)}
				{visible.map((e) => (
					<div className="tree__row" key={e.path}>
						<Link
							href={buildHref(
								owner,
								repo,
								e.type === "dir" ? "tree" : "blob",
								refName,
								e.path,
								shareId,
							)}
						>
							{e.type === "dir" ? <FolderIcon /> : <FileIcon />}
							{e.name}
						</Link>
					</div>
				))}
			</div>
		</>
	);
}
