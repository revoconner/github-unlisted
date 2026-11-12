"use client";

import * as React from "react";
import type { OAuthAppProviderId } from "@/lib/forge/catalog";

type Provider = OAuthAppProviderId;

interface Status {
	provider: Provider;
	label: string;
	configured: boolean;
	source: "site" | "env" | null;
	clientId: string | null;
}

const REGISTER_HINT: Partial<Record<Provider, string>> = {
	gitlab: "GitLab → User settings → Applications. Scope: read_api. Tick Confidential.",
	gitee: "Gitee → Settings → Third-party applications → Create application. Permission: projects.",
	gitea: "Gitea → Settings → Applications → Manage OAuth2 applications. Tick Confidential client.",
	codeberg: "Codeberg → Settings → Applications → Manage OAuth2 applications. Tick Confidential client.",
};

const HEADER = "x-forge-admin-token";

export function ForgeAdmin() {
	const [token, setToken] = React.useState("");
	const [unlocked, setUnlocked] = React.useState(false);
	const [providers, setProviders] = React.useState<Status[]>([]);
	const [callbackUri, setCallbackUri] = React.useState("");
	const [drafts, setDrafts] = React.useState<Record<string, { id: string; secret: string }>>({});
	const [busy, setBusy] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [notice, setNotice] = React.useState<string | null>(null);

	async function call(method: "GET" | "PUT" | "DELETE", query = "", body?: unknown) {
		const res = await fetch(`/api/forge/config${query}`, {
			method,
			headers: {
				[HEADER]: token,
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			credentials: "same-origin",
			body: body ? JSON.stringify(body) : undefined,
		});
		const data = (await res.json().catch(() => null)) as {
			error?: string;
			providers?: Status[];
			callbackUri?: string;
		} | null;
		if (!res.ok) throw new Error(data?.error ?? "Request failed");
		return data ?? {};
	}

	async function unlock(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) return;
		setBusy("unlock");
		setError(null);
		try {
			const data = await call("GET");
			setProviders(data.providers ?? []);
			setCallbackUri(data.callbackUri ?? "");
			setUnlocked(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Request failed");
		} finally {
			setBusy(null);
		}
	}

	async function save(provider: Provider) {
		const draft = drafts[provider];
		if (!draft?.id.trim() || !draft.secret.trim() || busy) return;
		setBusy(provider);
		setError(null);
		setNotice(null);
		try {
			const data = await call("PUT", "", {
				provider,
				clientId: draft.id.trim(),
				clientSecret: draft.secret.trim(),
			});
			setProviders(data.providers ?? providers);
			setDrafts((d) => ({ ...d, [provider]: { id: "", secret: "" } }));
			setNotice(`${provider} saved.`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Request failed");
		} finally {
			setBusy(null);
		}
	}

	async function remove(provider: Provider) {
		if (busy) return;
		setBusy(provider);
		setError(null);
		setNotice(null);
		try {
			const data = await call("DELETE", `?provider=${encodeURIComponent(provider)}`);
			setProviders(data.providers ?? providers);
			setNotice(`${provider} removed.`);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Request failed");
		} finally {
			setBusy(null);
		}
	}

	if (!unlocked) {
		return (
			<form className="fp-panel" onSubmit={unlock} autoComplete="off">
				<p className="fp-self-hosted-note">Enter the site admin token to manage the OAuth applications.</p>
				<label className="fp-field">
					<span>Admin token</span>
					<input
						type="password"
						value={token}
						onChange={(event) => setToken(event.target.value)}
						autoComplete="off"
						required
					/>
				</label>
				{error && (
					<p className="fp-error" role="alert">
						{error}
					</p>
				)}
				<button type="submit" className="fp-submit" disabled={busy !== null || !token}>
					{busy === "unlock" ? "Checking…" : "Unlock"}
				</button>
			</form>
		);
	}

	return (
		<div className="fp-panel">
			<p className="fp-self-hosted-note">
				Register one OAuth application per forge with this redirect URI, then paste its credentials. Users sign in on
				the forge itself; these are the app credentials, not user passwords.
			</p>
			<p className="fp-help">
				<code>{callbackUri}</code>
			</p>
			{error && (
				<p className="fp-error" role="alert">
					{error}
				</p>
			)}
			{notice && <p className="fp-help">{notice}</p>}
			{providers.map((p) => {
				const draft = drafts[p.provider] ?? { id: "", secret: "" };
				return (
					<div key={p.provider} className="fp-setup">
						<strong>{p.label}</strong>
						<p className="fp-help">
							{p.configured
								? `Configured (${p.source === "site" ? "saved on the site" : "environment variable"}), Client ID ${p.clientId}`
								: "Not configured"}
						</p>
						<p className="fp-help">{REGISTER_HINT[p.provider] ?? "Create an OAuth application in this forge and configure the callback URI shown above."}</p>
						<label className="fp-field">
							<span>{`${p.label} Client ID`}</span>
							<input
								type="text"
								value={draft.id}
								onChange={(event) =>
									setDrafts((d) => ({ ...d, [p.provider]: { ...draft, id: event.target.value } }))
								}
								autoComplete="off"
							/>
						</label>
						<label className="fp-field">
							<span>{`${p.label} Client Secret`}</span>
							<input
								type="password"
								value={draft.secret}
								onChange={(event) =>
									setDrafts((d) => ({ ...d, [p.provider]: { ...draft, secret: event.target.value } }))
								}
								autoComplete="new-password"
							/>
						</label>
						<button
							type="button"
							className="fp-submit"
							disabled={busy !== null || !draft.id.trim() || !draft.secret.trim()}
							onClick={() => save(p.provider)}
						>
							{busy === p.provider ? "Saving…" : `Save ${p.label}`}
						</button>
						{p.source === "site" && (
							<button type="button" className="fp-self" disabled={busy !== null} onClick={() => remove(p.provider)}>
								{`Remove saved ${p.label} credentials`}
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}
