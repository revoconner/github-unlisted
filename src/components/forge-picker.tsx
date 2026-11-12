"use client";

import * as React from "react";
import { FORGE_CATALOG, PUBLIC_OAUTH_PROVIDER_IDS, SELF_HOSTED_OAUTH_PROVIDER_IDS, getForgeProviderDefinition, getSelfHostedOAuthProfile, type PublicOAuthProvider, type SelfHostedOAuthProvider } from "@/lib/forge/catalog";

type PublicForge = PublicOAuthProvider;
type SelfHostedType = SelfHostedOAuthProvider;

interface Provider {
	id: PublicForge;
	label: string;
	icon: React.ReactNode;
	iconClass: string;
}

const svgProps = {
	width: 18,
	height: 18,
	viewBox: "0 0 24 24",
	fill: "currentColor",
	"aria-hidden": true,
	focusable: false,
} as const;

const GitHubIcon = (
	<svg {...svgProps}>
		<path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
	</svg>
);

const GitLabIcon = (
	<svg {...svgProps}>
		<path d="M4.845.904c-.435 0-.82.28-.955.692C2.639 5.449 1.246 9.728.07 13.335a1.437 1.437 0 0 0 .522 1.607l11.071 8.045c.2.145.472.144.67-.004l11.073-8.04a1.436 1.436 0 0 0 .522-1.61c-1.285-3.942-2.683-8.256-3.817-11.746a1.004 1.004 0 0 0-.957-.684.987.987 0 0 0-.949.69l-2.405 7.408H8.203l-2.41-7.408a.987.987 0 0 0-.942-.69h-.006zm-.006 1.42 2.173 6.678H2.675zm14.326 0 2.168 6.678h-4.341zm-10.593 7.81h6.862c-1.142 3.52-2.288 7.04-3.434 10.559L8.572 10.135zm-5.514.005h4.321l3.086 9.5zm13.567 0h4.325c-2.467 3.17-4.95 6.328-7.411 9.502 1.028-3.167 2.059-6.334 3.086-9.502zM2.1 10.762l6.977 8.947-7.817-5.682a.305.305 0 0 1-.112-.341zm19.798 0 .952 2.922a.305.305 0 0 1-.11.341v.002l-7.82 5.68.026-.035z" />
	</svg>
);

const GiteeIcon = (
	<svg {...svgProps}>
		<path d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.592.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296Z" />
	</svg>
);

const GiteaIcon = (
	<svg {...svgProps}>
		<path d="M4.209 4.603c-.247 0-.525.02-.84.088-.333.07-1.28.283-2.054 1.027C-.403 7.25.035 9.685.089 10.052c.065.446.263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092s.462 1.103 1.168 2.119c.955 1.263 1.936 2.248 2.89 2.367 2.406 0 7.212-.004 7.212-.004s.458.004 1.08-.394c.535-.324 1.013-.893 1.013-.893s.492-.527 1.18-1.73c.21-.37.385-.729.538-1.068 0 0 2.107-4.471 2.107-8.823-.042-1.318-.367-1.55-.443-1.627-.156-.156-.366-.153-.366-.153s-4.475.252-6.792.306c-.508.011-1.012.023-1.512.027v4.474l-.634-.301c0-1.39-.004-4.17-.004-4.17-1.107.016-3.405-.084-3.405-.084s-5.399-.27-5.987-.324c-.187-.011-.401-.032-.648-.032zm.354 1.832h.111s.271 2.269.6 3.597C5.549 11.147 6.22 13 6.22 13s-.996-.119-1.641-.348c-.99-.324-1.409-.714-1.409-.714s-.73-.511-1.096-1.52C1.444 8.73 2.021 7.7 2.021 7.7s.32-.859 1.47-1.145c.395-.106.863-.12 1.072-.12zm8.33 2.554c.26.003.509.127.509.127l.868.422-.529 1.075a.686.686 0 0 0-.614.359.685.685 0 0 0 .072.756l-.939 1.924a.69.69 0 0 0-.66.527.687.687 0 0 0 .347.763.686.686 0 0 0 .867-.206.688.688 0 0 0-.069-.882l.916-1.874a.667.667 0 0 0 .237-.02.657.657 0 0 0 .271-.137 8.826 8.826 0 0 1 1.016.512.761.761 0 0 1 .286.282c.073.21-.073.569-.073.569-.087.29-.702 1.55-.702 1.55a.692.692 0 0 0-.676.477.681.681 0 1 0 1.157-.252c.073-.141.141-.282.214-.431.19-.397.515-1.16.515-1.16.035-.066.218-.394.103-.814-.095-.435-.48-.638-.48-.638-.467-.301-1.116-.58-1.116-.58s0-.156-.042-.27a.688.688 0 0 0-.148-.241l.516-1.062 2.89 1.401s.48.218.583.619c.073.282-.019.534-.069.657-.24.587-2.1 4.317-2.1 4.317s-.232.554-.748.588a1.065 1.065 0 0 1-.393-.045l-.202-.08-4.31-2.1s-.417-.218-.49-.596c-.083-.31.104-.691.104-.691l2.073-4.272s.183-.37.466-.497a.855.855 0 0 1 .35-.077z" />
	</svg>
);

const CodebergIcon = (
	<svg {...svgProps}>
		<path d="M11.955.49A12 12 0 0 0 0 12.49a12 12 0 0 0 1.832 6.373L11.838 5.928a.187.14 0 0 1 .324 0l10.006 12.935A12 12 0 0 0 24 12.49a12 12 0 0 0-12-12 12 12 0 0 0-.045 0zm.375 6.467l4.416 16.553a12 12 0 0 0 5.137-4.213z" />
	</svg>
);

const PROVIDER_ICONS: Partial<Record<PublicForge, React.ReactNode>> = {
	gitlab: GitLabIcon,
	gitee: GiteeIcon,
	gitea: GiteaIcon,
	codeberg: CodebergIcon,
};

const PROVIDERS: Provider[] = PUBLIC_OAUTH_PROVIDER_IDS.map((id) => ({
	id,
	label: FORGE_CATALOG[id].label,
	icon: PROVIDER_ICONS[id] ?? <span aria-hidden="true">{FORGE_CATALOG[id].label.slice(0, 1)}</span>,
	iconClass: `fp-icon--${id}`,
}));

function formatDateInput(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function defaultExpiryDate(): string {
	const date = new Date();
	date.setDate(date.getDate() + 30);
	return formatDateInput(date);
}

function expiryTimestamp(dateValue: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
	if (!match) return null;
	const [, year, month, day] = match;
	const nextDay = new Date(Number(year), Number(month) - 1, Number(day) + 1, 0, 0, 0, 0);
	if (Number.isNaN(nextDay.getTime())) return null;
	return nextDay.getTime();
}

const SELF_HOSTED_LABELS = Object.fromEntries(
	SELF_HOSTED_OAUTH_PROVIDER_IDS.map((id) => [id, getForgeProviderDefinition(id).label]),
) as Record<SelfHostedType, string>;

// Hosted OAuth can fall back to a user-owned OAuth app whenever the provider
// exposes a compatible self-hosted/custom-app profile. The provider catalog
// controls the prefilled host and OAuth variant.
const HOSTED_PREFILL = Object.fromEntries(
	PUBLIC_OAUTH_PROVIDER_IDS.flatMap((id) => {
		const definition = FORGE_CATALOG[id];
		const type = definition.oauth?.selfHostedProvider as SelfHostedType | undefined;
		return type && definition.defaultHost
			? [[id, { type, host: definition.defaultHost, label: definition.label }] as const]
			: [];
	}),
) as Partial<Record<PublicForge, { type: SelfHostedType; host: string; label: string }>>;

const SCOPE_HINT = Object.fromEntries(
	SELF_HOSTED_OAUTH_PROVIDER_IDS.map((id) => [id, getSelfHostedOAuthProfile(id).scope]),
) as Record<SelfHostedType, string>;

export function ForgePicker() {
	const [expiresOn, setExpiresOn] = React.useState(defaultExpiryDate);
	const [selfHostedOpen, setSelfHostedOpen] = React.useState(false);
	const [host, setHost] = React.useState("");
	const [type, setType] = React.useState<SelfHostedType>("gitea");
	const [clientId, setClientId] = React.useState("");
	const [clientSecret, setClientSecret] = React.useState("");
	const [origin, setOrigin] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [hostedNotice, setHostedNotice] = React.useState<string | null>(null);

	React.useEffect(() => {
		setOrigin(window.location.origin);
		const connect = new URLSearchParams(window.location.search ?? "").get("connect");
		const prefill = connect && connect in HOSTED_PREFILL ? HOSTED_PREFILL[connect as PublicForge] : null;
		if (prefill) {
			setType(prefill.type);
			setHost(prefill.host);
			setSelfHostedOpen(true);
			setHostedNotice(
				`This site has no shared ${prefill.label} app yet. Register your own OAuth app on ${prefill.label}, paste its credentials, and you will sign in on ${prefill.label} itself.`,
			);
		}
	}, []);

	const today = formatDateInput(new Date());
	const expiry = expiryTimestamp(expiresOn);
	const callbackUri = `${origin || "https://your-domain.example"}/api/forge/callback`;

	function startPublic(provider: "github" | PublicForge) {
		if (!expiry) {
			setError("Choose a valid expiration date.");
			return;
		}
		const target =
			provider === "github"
				? `/api/github/login?expiresAt=${encodeURIComponent(String(expiry))}`
				: `/api/forge/login?provider=${encodeURIComponent(provider)}&expiresAt=${encodeURIComponent(String(expiry))}`;
		window.location.assign(target);
	}

	async function startSelfHosted(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy || !expiry) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/forge/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({
				provider: type,
				host: host.trim(),
				clientId: clientId.trim(),
				clientSecret,
				expiresAt: expiry,
			}),
			});
			const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
			if (!res.ok || !data?.url) {
				setError(data?.error ?? "Could not start authorization.");
				return;
			}
			setClientSecret("");
			window.location.assign(data.url);
		} catch {
			setError("Network error. Try again.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="fp">
			<button type="button" className="fp-btn fp-btn--wide" onClick={() => startPublic("github")}>
				<span className="fp-icon fp-icon--github">{GitHubIcon}</span>
				GitHub
			</button>

			<div className="fp-grid">
				{PROVIDERS.map((provider) => (
					<button
						key={provider.id}
						type="button"
						className="fp-btn"
						onClick={() => startPublic(provider.id)}
					>
						<span className={`fp-icon ${provider.iconClass}`}>{provider.icon}</span>
						{provider.label}
					</button>
				))}
			</div>

			<label className="fp-date">
				<span>Stay signed in until</span>
				<input
					type="date"
					value={expiresOn}
					min={today}
					onChange={(event) => {
						setError(null);
						setExpiresOn(event.target.value);
					}}
				/>
				<small>The session ends at 00:00 on the following day.</small>
			</label>

			{error && !selfHostedOpen && (
				<p className="fp-error" role="alert">
					{error}
				</p>
			)}

			<div className="fp-or" aria-hidden="true">
				<span>or</span>
			</div>

			<button
				type="button"
				className="fp-self"
				aria-expanded={selfHostedOpen}
				onClick={() => {
					setError(null);
					setSelfHostedOpen((open) => !open);
				}}
			>
				{selfHostedOpen ? "Hide self-hosted options" : "Your own self-hosted instance"}
			</button>

			<a className="signin-alt" href="/forge-setup">
				Site owner: configure OAuth apps
			</a>

			{selfHostedOpen && (
				<form className="fp-panel" onSubmit={startSelfHosted} autoComplete="off">
					<p className="fp-self-hosted-note">
						{hostedNotice ?? `${SELF_HOSTED_OAUTH_PROVIDER_IDS.map((id) => SELF_HOSTED_LABELS[id]).join(", ")} OAuth-compatible instances are supported.`}
					</p>

					<label className="fp-field">
						<span>Instance domain</span>
						<input
							type="url"
							inputMode="url"
							placeholder="https://git.example.com"
							value={host}
							onChange={(event) => setHost(event.target.value)}
							required
						/>
					</label>

					<label className="fp-field">
						<span>Instance type</span>
						<select value={type} onChange={(event) => setType(event.target.value as SelfHostedType)}>
							{SELF_HOSTED_OAUTH_PROVIDER_IDS.map((id) => (
								<option key={id} value={id}>
									{id === "gogs" ? `${SELF_HOSTED_LABELS[id]} (OAuth2-compatible)` : SELF_HOSTED_LABELS[id]}
								</option>
							))}
						</select>
					</label>

					<label className="fp-field">
						<span>Client ID</span>
						<input
							type="text"
							value={clientId}
							placeholder="Your OAuth Client ID"
							onChange={(event) => setClientId(event.target.value)}
						required
						/>
					</label>

					<label className="fp-field">
						<span>Client Secret</span>
						<input
							type="password"
							value={clientSecret}
							placeholder="Your OAuth Client Secret"
							onChange={(event) => setClientSecret(event.target.value)}
							autoComplete="new-password"
							required
						/>
					</label>

					<div className="fp-setup">
						<strong>First-time setup</strong>
						<ol style={{ listStyle: 'decimal', paddingLeft: '2rem' }}>
							<li>Go to <strong>Settings → Applications</strong> in your instance.</li>
							<li>Create a new OAuth2 Application.</li>
							<li>Set redirect URI to <code>{callbackUri.split("/").reduce<(string | React.ReactElement)[]>((acc, part, i) => { if (i > 0) acc.push(<wbr key={`wbr-${i}`} />); acc.push(part); return acc; }, [])}</code>.</li>
							<li>Enable <strong>Confidential Client</strong> if your instance offers it.</li>
							<li>Scope: <code>{SCOPE_HINT[type]}</code>.</li>
							<li>Paste the Client ID and Secret above.</li>
						</ol>
					</div>

					{error && (
						<p className="fp-error" role="alert">
							{error}
						</p>
					)}

					<button type="submit" className="fp-submit" disabled={busy || !expiry}>
						{busy ? "Starting authorization…" : `Connect & Authorize ${SELF_HOSTED_LABELS[type]}`}
					</button>
				</form>
			)}
		</div>
	);
}
