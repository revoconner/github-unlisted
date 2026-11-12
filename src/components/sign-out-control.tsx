"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

type Stage = "question" | "warning" | null;

export function SignOutControl({
	className = "nav-cta",
	label = "Sign Out",
}: {
	className?: string;
	label?: string;
}) {
	const [stage, setStage] = useState<Stage>(null);
	const [mounted, setMounted] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const titleId = useId();

	useEffect(() => setMounted(true), []);

	useEffect(() => {
		if (!stage) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !busy) {
				setStage(null);
				setError(null);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [stage, busy]);

	async function signOut(deleteStoredOauth: boolean) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const response = await fetch("/api/github/logout", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ deleteStoredOauth }),
			});
			const result = (await response.json().catch(() => null)) as
				| { error?: string }
				| null;
			if (!response.ok) {
				setError(result?.error ?? "Could not sign out. Please try again.");
				return;
			}
			window.location.assign("/app");
		} catch {
			setError("Network error. Please try again.");
		} finally {
			setBusy(false);
		}
	}

	const modal = stage ? (
		<>
			<button
				type="button"
				className="signout-backdrop"
				aria-label="Close sign-out dialog"
				disabled={busy}
				onClick={() => {
					setStage(null);
					setError(null);
				}}
			/>
			<section
				className="signout-modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<h2 id={titleId} className="signout-modal__title">
					{stage === "question"
						? "Delete OAuth from this server?"
						: "Remove saved account data?"}
				</h2>
				{stage === "question" ? (
					<>
						<p className="signout-modal__copy">
							Signing out will disconnect this browser session. If you keep the saved
							account, you can choose to use it again the next time you sign in.
						</p>
						<div className="signout-modal__actions">
							<button
								type="button"
								className="signout-modal__button"
								disabled={busy}
								onClick={() => void signOut(false)}
							>
								{busy ? "Signing out…" : "No, keep credentials"}
							</button>
							<button
								type="button"
								className="signout-modal__button signout-modal__button--danger"
								disabled={busy}
								onClick={() => {
									setError(null);
									setStage("warning");
								}}
							>
								Yes, delete them
							</button>
						</div>
					</>
				) : (
					<>
						<p className="signout-modal__copy">
							Deleting the saved account data <strong>permanently removes the credentials</strong> and
							access records linked to this sign-in from this server, and <strong>revokes every
							shared link</strong> created through them. You can reconnect later by authorizing
							again. This does not delete your actual GitHub or other forge account,
							uninstall the app, or revoke the provider-side authorization.
						</p>
						<div className="signout-modal__actions">
							<button
								type="button"
								className="signout-modal__button"
								disabled={busy}
								onClick={() => {
									setStage("question");
									setError(null);
								}}
							>
								Go back
							</button>
							<button
								type="button"
								className="signout-modal__button signout-modal__button--danger"
								disabled={busy}
								onClick={() => void signOut(true)}
							>
								{busy ? "Deleting…" : "Delete and Sign Out"}
							</button>
						</div>
					</>
				)}
				{error && (
					<p className="signout-modal__error" role="alert">
						{error}
					</p>
				)}
			</section>
		</>
	) : null;

	return (
		<>
			<button
				type="button"
				className={className}
				onClick={() => setStage("question")}
			>
				{label}
			</button>
			{mounted && modal && createPortal(modal, document.body)}
		</>
	);
}
