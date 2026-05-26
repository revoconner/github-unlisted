"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { SiteDrawer } from "@/components/site-drawer";

interface Repo {
	installationId: number;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
}
interface Share {
	id: string;
	owner: string;
	repo: string;
	createdAt?: number;
	expiresAt?: number;
}

type Filter = "all" | "shared" | "notshared" | "public" | "private";

type Unit = "days" | "weeks" | "months" | "years" | "never";

// Months/years use fixed 30d/365d windows — close enough for a revoke timer.
const UNIT_SECONDS: Record<Exclude<Unit, "never">, number> = {
	days: 86400,
	weeks: 604800,
	months: 2592000,
	years: 31536000,
};

interface TtlSel {
	amount: number;
	unit: Unit;
}

function ttlFor(sel: TtlSel): number | null {
	if (sel.unit === "never") return null;
	return Math.max(1, Math.floor(sel.amount)) * UNIT_SECONDS[sel.unit];
}

function until(ts: number): string {
	const s = Math.floor((ts - Date.now()) / 1000);
	if (s <= 0) return "soon";
	const m = s / 60;
	if (m < 60) return `in ${Math.ceil(m)}m`;
	const h = m / 60;
	if (h < 24) return `in ${Math.ceil(h)}h`;
	const d = h / 24;
	if (d < 14) return `in ${Math.ceil(d)}d`;
	const w = d / 7;
	if (w < 10) return `in ${Math.ceil(w)}w`;
	const mo = d / 30;
	if (mo < 24) return `in ${Math.ceil(mo)}mo`;
	return `in ${Math.ceil(d / 365)}y`;
}

function ExpiryControl({
	sel,
	disabled,
	onChange,
}: {
	sel: TtlSel;
	disabled?: boolean;
	onChange: (s: TtlSel) => void;
}) {
	const never = sel.unit === "never";
	return (
		<span className="ttl">
			<input
				type="number"
				min={1}
				className="ttl__num"
				aria-label="Auto-revoke amount"
				value={sel.amount}
				disabled={disabled || never}
				onChange={(e) =>
					onChange({
						...sel,
						amount: Math.max(1, Math.floor(Number(e.target.value) || 1)),
					})
				}
			/>
			<select
				className="ttl__unit"
				aria-label="Auto-revoke unit"
				value={sel.unit}
				disabled={disabled}
				onChange={(e) => onChange({ ...sel, unit: e.target.value as Unit })}
			>
				<option value="days">days</option>
				<option value="weeks">weeks</option>
				<option value="months">months</option>
				<option value="years">years</option>
				<option value="never">never revoke</option>
			</select>
		</span>
	);
}

function ago(ts?: number): string {
	if (!ts) return "";
	const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d ago`;
	const w = Math.floor(d / 7);
	return `${w}w ago`;
}

export function DashboardClient({
	repos,
	shares,
	login,
}: {
	repos: Repo[];
	shares: Share[];
	login: string;
}) {
	const router = useRouter();
	const [query, setQuery] = React.useState("");
	const [filter, setFilter] = React.useState<Filter>("all");
	const [busy, setBusy] = React.useState<string | null>(null);
	const [copied, setCopied] = React.useState<string | null>(null);
	const [ttlSel, setTtlSel] = React.useState<Record<string, TtlSel>>({});

	const getSel = (key: string): TtlSel =>
		ttlSel[key] ?? { amount: 1, unit: "never" };
	const setSel = (key: string, s: TtlSel) =>
		setTtlSel((prev) => ({ ...prev, [key]: s }));

	const shareByRepo = React.useMemo(() => {
		const m = new Map<string, Share>();
		for (const s of shares) m.set(`${s.owner}/${s.repo}`.toLowerCase(), s);
		return m;
	}, [shares]);

	const counts = React.useMemo(() => {
		let shared = 0;
		let pub = 0;
		for (const r of repos) {
			if (shareByRepo.has(r.fullName.toLowerCase())) shared++;
			if (!r.private) pub++;
		}
		return {
			all: repos.length,
			shared,
			notshared: repos.length - shared,
			public: pub,
			private: repos.length - pub,
		};
	}, [repos, shareByRepo]);

	const visible = repos.filter((r) => {
		const isShared = shareByRepo.has(r.fullName.toLowerCase());
		if (filter === "shared" && !isShared) return false;
		if (filter === "notshared" && isShared) return false;
		if (filter === "public" && r.private) return false;
		if (filter === "private" && !r.private) return false;
		if (query && !r.fullName.toLowerCase().includes(query.toLowerCase()))
			return false;
		return true;
	});

	const create = async (r: Repo) => {
		setBusy(r.fullName);
		try {
			const res = await fetch("/api/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					installationId: r.installationId,
					owner: r.owner,
					repo: r.name,
					ttlSeconds: ttlFor(getSel(r.fullName)),
				}),
			});
			if (!res.ok) throw new Error();
			router.refresh();
		} finally {
			setBusy(null);
		}
	};

	const applyTtl = async (r: Repo, s: Share) => {
		setBusy(r.fullName);
		try {
			const res = await fetch("/api/share", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: s.id,
					ttlSeconds: ttlFor(getSel(r.fullName)),
				}),
			});
			if (!res.ok) throw new Error();
			router.refresh();
		} finally {
			setBusy(null);
		}
	};

	const revoke = async (s: Share) => {
		if (!confirm(`Revoke the link to ${s.owner}/${s.repo}?`)) return;
		setBusy(`${s.owner}/${s.repo}`);
		try {
			const res = await fetch(`/api/share?id=${encodeURIComponent(s.id)}`, {
				method: "DELETE",
			});
			if (!res.ok) throw new Error();
			router.refresh();
		} finally {
			setBusy(null);
		}
	};

	const copy = async (s: Share) => {
		const url = `${window.location.origin}/${s.owner}/${s.repo}?s=${s.id}`;
		await navigator.clipboard.writeText(url);
		setCopied(s.id);
		setTimeout(() => setCopied(null), 1500);
	};

	const pills: { key: Filter; label: string; n: number }[] = [
		{ key: "all", label: "All", n: counts.all },
		{ key: "shared", label: "Shared", n: counts.shared },
		{ key: "notshared", label: "Not shared", n: counts.notshared },
		{ key: "public", label: "Public", n: counts.public },
		{ key: "private", label: "Private", n: counts.private },
	];

	return (
		<div className="app-shell">
			<header className="topbar">
				<a className="wordmark" href="/" aria-label="github unlisted home">
					<span className="mark" aria-hidden="true">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<title>unlisted</title>
							<line
								x1="2"
								y1="11"
								x2="11"
								y2="2"
								stroke="#ff38ae"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
							<line
								x1="5"
								y1="14"
								x2="14"
								y2="5"
								stroke="#ff38ae"
								strokeWidth="1.6"
								strokeLinecap="round"
								opacity="0.55"
							/>
							<line
								x1="8"
								y1="17"
								x2="17"
								y2="8"
								stroke="#ff38ae"
								strokeWidth="1.6"
								strokeLinecap="round"
								opacity="0.25"
							/>
						</svg>
					</span>
					<span className="word">
						<span className="pre">github</span>{" "}
						<span className="post">unlisted</span>
					</span>
				</a>

				<nav className="nav-links" aria-label="Primary">
					<a href="/faq">FAQ</a>
					<a href="/privacy">PRIVACY</a>
					<a href="/status">STATUS</a>
				</nav>

				<div className="topbar__right">
					<a className="btn btn--ghost btn--sm" href="/api/github/logout">
						Sign out
					</a>
					<span
						className="avatar"
						role="img"
						aria-label={`Signed in as @${login}`}
					>
						{login.slice(0, 2).toUpperCase()}
					</span>
					<SiteDrawer signedIn={true} active="dashboard" />
				</div>
			</header>

			<main className="dashboard">
				<div className="dashboard__head">
					<h1 className="dashboard__title">Your repositories</h1>
					<div className="dashboard__meta">
						Signed in as <b>@{login}</b>
					</div>
				</div>

				<div className="dashboard__stats">
					<span>
						<b>{counts.all}</b> repos
					</span>
					<span className="dot">·</span>
					<span>
						<span className="accent">{counts.shared}</span> shared
					</span>
				</div>

				<div className="dashboard__filters">
					<div className="dashboard__searchrow">
						<label className="field">
							<span className="field__icon" aria-hidden="true">
								<svg
									width="15"
									height="15"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<circle cx="11" cy="11" r="7" />
									<line x1="21" y1="21" x2="16.65" y2="16.65" />
								</svg>
							</span>
							<input
								type="search"
								placeholder="Search repositories"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
							/>
						</label>
					</div>

					{/* Desktop: button row. Tablet/phone: native select (below).
					    Visibility is swapped by media query in app.css. */}
					<div
						className="dashboard__pills"
						role="tablist"
						aria-label="Filter repositories"
					>
						{pills.map((p) => (
							<button
								key={p.key}
								type="button"
								className="pill"
								role="tab"
								aria-selected={filter === p.key}
								onClick={() => setFilter(p.key)}
							>
								{p.label} <span className="pill__count">{p.n}</span>
							</button>
						))}
					</div>

					<select
						className="dashboard__pills-select"
						aria-label="Filter repositories"
						value={filter}
						onChange={(e) => setFilter(e.target.value as Filter)}
					>
						{pills.map((p) => (
							<option key={p.key} value={p.key}>
								{p.label} ({p.n})
							</option>
						))}
					</select>
				</div>

				<div className="repo-list">
					{visible.length === 0 && (
						<div className="repo-row__empty" style={{ padding: "20px" }}>
							No repositories match.
						</div>
					)}
					{visible.map((r) => {
						const share = shareByRepo.get(r.fullName.toLowerCase());
						const rowBusy = busy === r.fullName;
						return (
							<article className="repo-row" key={r.fullName}>
								<div className="repo-row__main">
									<div className="repo-row__head">
										<span className="repo-row__name">
											<span className="owner">{r.owner}/</span>
											{r.name}
										</span>
										<span
											className={`chip ${r.private ? "chip--private" : "chip--public"}`}
										>
											{r.private ? "private" : "public"}
										</span>
										{share && <span className="chip chip--shared">shared</span>}
									</div>
									{share ? (
										<div
											className={`repo-row__link${share.expiresAt ? "" : " repo-row__link--idle"}`}
										>
											{share.createdAt && (
												<>
													<span className="created">
														created {ago(share.createdAt)}
													</span>
													<span className="sep">·</span>
												</>
											)}
											<span className="created">
												{share.expiresAt
													? `revokes ${until(share.expiresAt)}`
													: "no auto-revoke"}
											</span>
										</div>
									) : (
										<div className="repo-row__empty">not shared</div>
									)}
								</div>
								<div className="repo-row__actions">
									{share ? (
										<>
											<a
												className="btn btn--ghost btn--sm"
												href={`/${r.owner}/${r.name}?s=${share.id}`}
												target="_blank"
												rel="noopener"
											>
												Visit
											</a>
											<button
												type="button"
												className="btn btn--ghost btn--sm"
												onClick={() => copy(share)}
											>
												{copied === share.id ? "Copied" : "Copy"}
											</button>
											<ExpiryControl
												sel={getSel(r.fullName)}
												disabled={rowBusy}
												onChange={(s) => setSel(r.fullName, s)}
											/>
											<button
												type="button"
												className="btn btn--secondary btn--sm"
												disabled={rowBusy}
												onClick={() => applyTtl(r, share)}
											>
												{rowBusy ? "…" : "Set"}
											</button>
											<button
												type="button"
												className="btn btn--danger btn--sm"
												disabled={rowBusy}
												onClick={() => revoke(share)}
											>
												{rowBusy ? "…" : "Revoke"}
											</button>
										</>
									) : (
										<>
											<ExpiryControl
												sel={getSel(r.fullName)}
												disabled={rowBusy}
												onChange={(s) => setSel(r.fullName, s)}
											/>
											<button
												type="button"
												className="btn btn--accent btn--sm"
												disabled={rowBusy}
												onClick={() => create(r)}
											>
												{rowBusy ? "Creating…" : "Share link"}
											</button>
										</>
									)}
								</div>
							</article>
						);
					})}
				</div>
			</main>
		</div>
	);
}
