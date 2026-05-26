"use client";

import * as React from "react";
import { createPortal } from "react-dom";

interface Props {
	signedIn: boolean;
	active?: "faq" | "privacy" | "status" | "dashboard" | null;
}

export function SiteDrawer({ signedIn, active = null }: Props) {
	const [open, setOpen] = React.useState(false);
	const [mounted, setMounted] = React.useState(false);

	React.useEffect(() => {
		setMounted(true);
	}, []);

	React.useEffect(() => {
		if (!open) {
			document.body.removeAttribute("data-drawer");
			return;
		}
		document.body.setAttribute("data-drawer", "open");
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.removeAttribute("data-drawer");
		};
	}, [open]);

	const overlay = (
		<>
			{open && (
				<button
					type="button"
					className="drawer-backdrop"
					aria-label="Close menu"
					onClick={() => setOpen(false)}
				/>
			)}
			<aside
				id="site-drawer-panel"
				className="drawer-panel"
				data-open={open || undefined}
				role="dialog"
				aria-modal="true"
				aria-label="Site navigation"
				aria-hidden={!open}
			>
				<div className="drawer-panel__head">
					<button
						type="button"
						className="drawer-panel__close"
						aria-label="Close menu"
						onClick={() => setOpen(false)}
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
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>
				</div>
				<nav className="drawer-panel__links" aria-label="Primary">
					<a
						href="/faq"
						className={active === "faq" ? "is-active" : undefined}
						aria-current={active === "faq" ? "page" : undefined}
					>
						FAQ
					</a>
					<a
						href="/privacy"
						className={active === "privacy" ? "is-active" : undefined}
						aria-current={active === "privacy" ? "page" : undefined}
					>
						Privacy
					</a>
					<a
						href="/status"
						className={active === "status" ? "is-active" : undefined}
						aria-current={active === "status" ? "page" : undefined}
					>
						Status
					</a>
					{signedIn ? (
						<>
							{active !== "dashboard" && (
								<a href="/app" className="is-cta">
									Dashboard
								</a>
							)}
							<a href="/api/github/logout">Sign out</a>
						</>
					) : (
						<a href="/api/github/login" className="is-cta">
							Sign in
						</a>
					)}
				</nav>
			</aside>
		</>
	);

	return (
		<>
			<button
				type="button"
				className="hamburger"
				aria-label={open ? "Close menu" : "Open menu"}
				aria-expanded={open}
				aria-controls="site-drawer-panel"
				onClick={() => setOpen((v) => !v)}
			>
				{open ? (
					<svg
						viewBox="0 0 24 24"
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
				) : (
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
				)}
			</button>
			{/* Portal so the backdrop + panel escape any stacking context
			    created by the surrounding nav (the dashboard topbar has
			    backdrop-filter which traps fixed children otherwise). */}
			{mounted && createPortal(overlay, document.body)}
		</>
	);
}
