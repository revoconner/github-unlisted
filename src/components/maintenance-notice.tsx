"use client";

import * as React from "react";

export function MaintenanceNotice() {
	const [open, setOpen] = React.useState(true);

	React.useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	if (!open) return null;

	return (
		<div
			className="maint-overlay"
			role="dialog"
			aria-modal="true"
			aria-labelledby="maint-title"
		>
			<button
				type="button"
				className="maint-backdrop"
				aria-label="Close notice"
				onClick={() => setOpen(false)}
			/>
			<div className="maint-card">
				<button
					type="button"
					className="maint-close"
					aria-label="Close notice"
					onClick={() => setOpen(false)}
				>
					<svg
						viewBox="0 0 24 24"
						width="14"
						height="14"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
				<p id="maint-title" className="maint-body">
					We are currently doing maintenance work on the dashboard. While
					unlikely, you may encounter problems in operations.
				</p>
				<p className="maint-eta">
					We expect to be fully operational by 01:43 UTC, 26th.
				</p>
			</div>
		</div>
	);
}
