"use client";

import * as React from "react";
import { FORGE_CATALOG, PUBLIC_OAUTH_PROVIDER_IDS, type PublicOAuthProvider } from "@/lib/forge/catalog";

type Provider = PublicOAuthProvider;

const PROVIDERS = PUBLIC_OAUTH_PROVIDER_IDS.map((id) => ({
	id,
	label: FORGE_CATALOG[id].label,
	loginUrl: FORGE_CATALOG[id].loginUrl ?? FORGE_CATALOG[id].website ?? FORGE_CATALOG[id].defaultHost ?? "/",
}));

function providerMap<T>(factory: (provider: Provider) => T): Record<Provider, T> {
	return Object.fromEntries(PUBLIC_OAUTH_PROVIDER_IDS.map((provider) => [provider, factory(provider)])) as Record<Provider, T>;
}

export function ForgeOAuthSettings({ initialProvider }: { initialProvider?: string }) {
	const [configured, setConfigured] = React.useState<Record<Provider, boolean>>(() => providerMap(() => false));
	const [values, setValues] = React.useState<Record<Provider, { clientId: string; clientSecret: string }>>(() =>
		providerMap(() => ({ clientId: "", clientSecret: "" })),
	);
	const [busy, setBusy] = React.useState<Provider | null>(null);
	const [message, setMessage] = React.useState<string | null>(null);

	React.useEffect(() => {
		fetch("/api/forge/settings", { credentials: "same-origin" })
			.then(async (res) => {
				if (!res.ok) throw new Error("GitHub admin authentication required");
				const data = (await res.json()) as {
					configured: Record<Provider, boolean>;
				};
				setConfigured(data.configured);
			})
			.catch((error) =>
				setMessage(
					error instanceof Error ? error.message : "Could not load settings",
				),
			);
	}, []);

	const save = async (provider: Provider) => {
		setBusy(provider);
		setMessage(null);
		try {
			const res = await fetch("/api/forge/settings", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({ provider, ...values[provider] }),
			});
			const data = (await res.json().catch(() => null)) as {
				error?: string;
		} | null;
			if (!res.ok) throw new Error(data?.error ?? "Could not save settings");
			setConfigured((old) => ({ ...old, [provider]: true }));
			setValues((old) => ({
				...old,
				[provider]: { ...old[provider], clientSecret: "" },
			}));
			setMessage(
				`${PROVIDERS.find((p) => p.id === provider)?.label} OAuth configuration saved.`,
			);
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Could not save settings",
			);
		} finally {
			setBusy(null);
		}
	};

	const remove = async (provider: Provider) => {
		setBusy(provider);
		setMessage(null);
		try {
			const res = await fetch(
				`/api/forge/settings?provider=${encodeURIComponent(provider)}`,
				{ method: "DELETE", credentials: "same-origin" },
			);
			const data = (await res.json().catch(() => null)) as {
				error?: string;
			} | null;
			if (!res.ok) throw new Error(data?.error ?? "Could not remove settings");
			setConfigured((old) => ({ ...old, [provider]: false }));
			setValues((old) => ({
				...old,
				[provider]: { clientId: "", clientSecret: "" },
			}));
			setMessage(
				`${PROVIDERS.find((p) => p.id === provider)?.label} OAuth configuration removed.`,
			);
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Could not remove settings",
			);
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="forge-settings">
			<div className="forge-settings__intro">
				<h1>Forge OAuth settings</h1>
				<p>
					Sign in to the forge first, then create the ShareMyGit OAuth application
					and paste its Client ID and Client Secret here. The secret is encrypted
					before it is written to Redis.
				</p>
				<p>
					Callback:{" "}
					<code>
						{typeof window !== "undefined"
							? `${window.location.origin}/api/forge/callback`
							: "/api/forge/callback"}
					</code>
				</p>
			</div>

			{initialProvider && !configured[initialProvider as Provider] && (
				<div className="fp-warn">
					Configure {PROVIDERS.find((p) => p.id === initialProvider)?.label ?? initialProvider}{" "}
					OAuth here before connecting an account.
				</div>
			)}

			{message && (
				<p className="fp-error" role="alert">
					{message}
				</p>
			)}

			{PROVIDERS.map((provider) => (
				<section className="forge-settings__card" key={provider.id}>
					<div className="forge-settings__head">
						<div>
							<h2>{provider.label}</h2>
							<p>{configured[provider.id] ? "Configured" : "Not configured"}</p>
						</div>
						<a href={provider.loginUrl} target="_blank" rel="noreferrer">
							Open {provider.label} sign-in
						</a>
					</div>
					<div className="forge-settings__fields">
						<label className="fp-field">
							<span>Client ID</span>
							<input
								value={values[provider.id].clientId}
								onChange={(e) =>
									setValues((old) => ({
										...old,
										[provider.id]: {
											...old[provider.id],
											clientId: e.target.value,
										},
									}))
								}
								autoComplete="off"
							/>
						</label>
						<label className="fp-field">
							<span>Client Secret</span>
							<input
								type="password"
								value={values[provider.id].clientSecret}
								onChange={(e) =>
									setValues((old) => ({
										...old,
										[provider.id]: {
											...old[provider.id],
											clientSecret: e.target.value,
										},
									}))
								}
								autoComplete="new-password"
							/>
						</label>
					</div>
					<div className="forge-settings__actions">
						<button
							type="button"
							className="fp-submit"
							disabled={busy === provider.id}
							onClick={() => save(provider.id)}
						>
							{busy === provider.id ? "Saving…" : "Save OAuth credentials"}
						</button>
						{configured[provider.id] && (
							<button
								type="button"
								className="fp-self"
								disabled={busy === provider.id}
								onClick={() => remove(provider.id)}
							>
								Remove
							</button>
						)}
					</div>
				</section>
			))}
		</div>
	);
}
