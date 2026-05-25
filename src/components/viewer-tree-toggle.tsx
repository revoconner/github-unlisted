"use client";

import * as React from "react";

export function ViewerTreeToggle() {
	const [open, setOpen] = React.useState(false);

	React.useEffect(() => {
		if (!open) {
			document.body.removeAttribute("data-viewer-tree");
			return;
		}
		document.body.setAttribute("data-viewer-tree", "open");
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.removeAttribute("data-viewer-tree");
		};
	}, [open]);

	return (
		<>
			<button
				type="button"
				className="viewer__tree-toggle"
				aria-label={open ? "Hide file tree" : "Show file tree"}
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<line x1="3" y1="6" x2="21" y2="6" />
					<line x1="3" y1="12" x2="21" y2="12" />
					<line x1="3" y1="18" x2="21" y2="18" />
				</svg>
				Files
			</button>
			<button
				type="button"
				className="viewer__tree-backdrop"
				aria-label="Close file tree"
				tabIndex={open ? 0 : -1}
				onClick={() => setOpen(false)}
			/>
		</>
	);
}
