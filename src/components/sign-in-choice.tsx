"use client";

import * as React from "react";
import { ForgePicker } from "@/components/forge-picker";

interface SavedConnectionLabel {
	id: string;
	label: string;
}

export function SignInChoice({
	login,
	connections,
	installationCount,
	installUrl,
}: {
	login: string;
	connections: SavedConnectionLabel[];
	installationCount: number;
	installUrl: string | null;
}) {
	const [mode, setMode] = React.useState<"choice" | "other">("choice");
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	async function useSavedAccount() {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const response = await fetch("/api/session/restore", {
				method: "POST",
				credentials: "same-origin",
			});
			const result = (await response.json().catch(() => null)) as
				| { error?: string }
				| null;
			if (!response.ok) {
				setError(result?.error ?? "Could not restore the saved account.");
				return;
			}
			window.location.assign("/app");
		} catch {
			setError("Network error. Please try again.");
		} finally {
			setBusy(false);
		}
	}

	if (mode === "other") {
		return (
			<div className="signin-choice">
				<p className="signin-choice__intro">
					Choose a forge below and authorize the account you want to use. If the
					provider is already signed in with another user, switch accounts on its
					authorization page first. Your previously saved account stays on this server
					unless you choose to delete it when signing out.
				</p>
				<ForgePicker />
				{installUrl && (
					<a className="signin-alt" href={installUrl}>
						Install the GitHub App or choose its repositories
					</a>
				)}
				<button
					type="button"
					className="signin-choice__back"
					onClick={() => {
						setMode("choice");
					setError(null);
					}}
				>
					Back to saved account
				</button>
			</div>
		);
	}

	return (
		<div className="signin-choice">
			<h2 className="signin-choice__title">Choose how to sign in</h2>
			<p className="signin-choice__intro">
				Your previous account is signed out, but its access details are still saved
				on this server. Reuse them, or sign in with a different account or forge.
			</p>
			<div className="signin-choice__saved">
				<p>
					<span className="signin-choice__label">Previously used account</span>
					<strong>{login}</strong>
				</p>
				{connections.length > 0 && (
					<div>
						<span className="signin-choice__label">Saved forge accounts</span>
						<ul>
							{connections.map((connection) => (
								<li key={connection.id}>{connection.label}</li>
							))}
						</ul>
					</div>
				)}
				{installationCount > 0 && (
					<p>
						<span className="signin-choice__label">GitHub App installations</span>
						<strong>{installationCount}</strong>
					</p>
				)}
			</div>
			{error && <p className="signin-error" role="alert">{error}</p>}
			<button
				type="button"
				className="signin-choice__primary"
				disabled={busy}
				onClick={() => void useSavedAccount()}
			>
				{busy ? "Restoring account…" : "Use saved account"}
			</button>
			<button
				type="button"
				className="signin-choice__secondary"
				disabled={busy}
				onClick={() => setMode("other")}
			>
				Sign in with a different account or forge
			</button>
		</div>
	);
}
