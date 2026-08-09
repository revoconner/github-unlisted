"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { NavLinks } from "@/components/nav-links";
import { SiteDrawer } from "@/components/site-drawer";
import { SiteFooter } from "@/components/site-footer";

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
	ref?: string;
	showBranches?: boolean;
	allowDownload?: boolean;
	showReleases?: boolean;
}

type VisFilter = "all" | "private" | "public";
type ShareFilter = "all" | "shared" | "unshared";

type Unit = "days" | "weeks" | "months" | "years" | "never";

// Months/years use fixed 30d/365d windows, close enough for a revoke timer.
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

// "3 : 7" reduced by gcd; the shared:private stat reads as a proportion
// rather than two raw counts.
function ratioOf(shared: number, priv: number): string {
	if (priv === 0) return "n/a";
	const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
	const g = gcd(shared, priv) || 1;
	return `${shared / g} : ${priv / g}`;
}

// Segmented filter control styled like the nav pill bar: a bordered pill
// container whose active option fills with the accent.
function Seg<T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: { key: T; label: string }[];
	value: T;
	onChange: (v: T) => void;
}) {
	return (
		<div className="seg" role="tablist" aria-label={label}>
			{options.map((o) => (
				<button
					key={o.key}
					type="button"
					role="tab"
					className="seg__opt"
					aria-selected={value === o.key}
					onClick={() => onChange(o.key)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

// Yes/No toggle for the control panel, style cue taken from the viewer's
// markdown Preview/Code tabs: joined bordered buttons, active one filled.
function YesNo({
	label,
	hint,
	value,
	disabled,
	onChange,
}: {
	label: string;
	hint?: string;
	value: boolean;
	disabled?: boolean;
	onChange: (v: boolean) => void;
}) {
	return (
		<div className="dash-ctl">
			<span className="dash-ctl__label">
				{label}
				{hint && (
					<span className="dash-hint" title={hint}>
						?
					</span>
				)}
			</span>
			<div className="yesno" role="tablist" aria-label={label}>
				<button
					type="button"
					role="tab"
					className="yesno__opt"
					aria-selected={value}
					disabled={disabled}
					onClick={() => onChange(true)}
				>
					Yes
				</button>
				<button
					type="button"
					role="tab"
					className="yesno__opt"
					aria-selected={!value}
					disabled={disabled}
					onClick={() => onChange(false)}
				>
					No
				</button>
			</div>
		</div>
	);
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
	// Spec defaults: visibility starts on "private" (the repos people
	// actually share), the share filter starts wide open.
	const [visFilter, setVisFilter] = React.useState<VisFilter>("private");
	const [shareFilter, setShareFilter] = React.useState<ShareFilter>("all");
	const [selected, setSelected] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [copied, setCopied] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [ttlSel, setTtlSel] = React.useState<Record<string, TtlSel>>({});
	const [swSel, setSwSel] = React.useState<Record<string, boolean>>({});
	const [dlSel, setDlSel] = React.useState<Record<string, boolean>>({});
	const [relSel, setRelSel] = React.useState<Record<string, boolean>>({});

	const shareByRepo = React.useMemo(() => {
		const m = new Map<string, Share>();
		for (const s of shares) m.set(`${s.owner}/${s.repo}`.toLowerCase(), s);
		return m;
	}, [shares]);

	const stats = React.useMemo(() => {
		let shared = 0;
		let pub = 0;
		for (const r of repos) {
			if (shareByRepo.has(r.fullName.toLowerCase())) shared++;
			if (!r.private) pub++;
		}
		const priv = repos.length - pub;
		return { total: repos.length, pub, priv, shared };
	}, [repos, shareByRepo]);

	const visible = repos.filter((r) => {
		const isShared = shareByRepo.has(r.fullName.toLowerCase());
		if (visFilter === "private" && !r.private) return false;
		if (visFilter === "public" && r.private) return false;
		if (shareFilter === "shared" && !isShared) return false;
		if (shareFilter === "unshared" && isShared) return false;
		if (query && !r.fullName.toLowerCase().includes(query.toLowerCase()))
			return false;
		return true;
	});

	const selRepo = repos.find((r) => r.fullName === selected) ?? null;
	const selShare = selRepo
		? shareByRepo.get(selRepo.fullName.toLowerCase())
		: undefined;

	// Panel control values fall back to what is stored on the share, so an
	// existing link shows its real settings before the user touches anything.
	const key = selRepo?.fullName ?? "";
	const ttl = ttlSel[key] ?? { amount: 1, unit: "never" as Unit };
	const dl = dlSel[key] ?? selShare?.allowDownload ?? false;
	const rel = relSel[key] ?? selShare?.showReleases ?? false;
	const sw = swSel[key] ?? selShare?.showBranches ?? false;

	const failure = async (res: Response, fallback: string) => {
		const data = (await res.json().catch(() => null)) as {
			error?: string;
		} | null;
		setError(data?.error ?? fallback);
	};

	const create = async (r: Repo) => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/share", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					installationId: r.installationId,
					owner: r.owner,
					repo: r.name,
					ttlSeconds: ttlFor(ttl),
					ref: null,
					showBranches: sw,
					allowDownload: dl,
					showReleases: rel,
				}),
			});
			if (!res.ok) {
				await failure(res, "Could not create the link");
				return;
			}
			router.refresh();
		} catch {
			setError("Could not create the link");
		} finally {
			setBusy(false);
		}
	};

	// One "Set" applies every panel control. ttlSeconds is always sent, so
	// pressing Set restarts the auto-revoke window even when only a toggle
	// changed. The stored branch lock (ref) is preserved as-is: the panel
	// has no control for it anymore.
	const applySettings = async (s: Share) => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/share", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					id: s.id,
					ttlSeconds: ttlFor(ttl),
					ref: s.ref ?? null,
					showBranches: sw,
					allowDownload: dl,
					showReleases: rel,
				}),
			});
			if (!res.ok) {
				await failure(res, "Could not update the link");
				return;
			}
			router.refresh();
		} catch {
			setError("Could not update the link");
		} finally {
			setBusy(false);
		}
	};

	const revoke = async (s: Share) => {
		if (!confirm(`Revoke the link to ${s.owner}/${s.repo}?`)) return;
		setBusy(true);
		try {
			const res = await fetch(`/api/share?id=${encodeURIComponent(s.id)}`, {
				method: "DELETE",
			});
			if (!res.ok) throw new Error();
			router.refresh();
		} finally {
			setBusy(false);
		}
	};

	const copy = async (s: Share) => {
		const url = `${window.location.origin}/${s.owner}/${s.repo}?s=${s.id}`;
		await navigator.clipboard.writeText(url);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div className="page-shell">
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
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
							<line
								x1="5"
								y1="14"
								x2="14"
								y2="5"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
								opacity="0.55"
							/>
							<line
								x1="8"
								y1="17"
								x2="17"
								y2="8"
								stroke="currentColor"
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

				<NavLinks signedIn={true} active="dashboard" />

				<a className="nav-cta" href="/api/github/logout">
					Sign Out
				</a>

				<SiteDrawer signedIn={true} active="dashboard" />
			</header>

			<main className="dashboard">
				{/* Row 1: welcome */}
				<section className="dash-welcome">
					<p className="dash-welcome__hi">Welcome,</p>
					<h1 className="dash-welcome__name">{login}</h1>
				</section>

				{/* Row 2: stats */}
				<section className="dash-stats" aria-label="Your stats">
					<div className="dash-stat">
						<span className="dash-stat__label">Repositories</span>
						<span className="dash-stat__value">{stats.total}</span>
					</div>
					<div className="dash-stat">
						<span className="dash-stat__label">Public</span>
						<span className="dash-stat__value">{stats.pub}</span>
					</div>
					<div className="dash-stat">
						<span className="dash-stat__label">Private</span>
						<span className="dash-stat__value">{stats.priv}</span>
					</div>
					<div className="dash-stat">
						<span className="dash-stat__label">Shared</span>
						<span className="dash-stat__value">{stats.shared}</span>
					</div>
					<div className="dash-stat">
						<span className="dash-stat__label">Shared/Private</span>
						<span className="dash-stat__value">
							{ratioOf(stats.shared, stats.priv)}
						</span>
					</div>
				</section>

				{/* Row 3: search + the two filter toggles */}
				<section className="dash-filters">
					<label className="dash-search">
						<span className="dash-search__icon" aria-hidden="true">
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
					<Seg
						label="Filter by visibility"
						options={[
							{ key: "all", label: "All" },
							{ key: "private", label: "Private" },
							{ key: "public", label: "Public" },
						]}
						value={visFilter}
						onChange={setVisFilter}
					/>
					<Seg
						label="Filter by share state"
						options={[
							{ key: "all", label: "All" },
							{ key: "shared", label: "Shared" },
							{ key: "unshared", label: "Unshared" },
						]}
						value={shareFilter}
						onChange={setShareFilter}
					/>
				</section>

				{error && (
					<div className="signin-error" role="alert">
						{error}
					</div>
				)}

				{/* Row 4: selectable repo rows */}
				<section className="dash-repos" aria-label="Repositories">
					{visible.length === 0 && (
						<p className="dash-repos__empty">No repositories match.</p>
					)}
					{visible.map((r) => {
						const share = shareByRepo.get(r.fullName.toLowerCase());
						const isSel = selected === r.fullName;
						return (
							<button
								type="button"
								className="repo-card"
								key={r.fullName}
								aria-pressed={isSel}
								onClick={() => setSelected(isSel ? null : r.fullName)}
							>
								<span className="repo-card__name">{r.name}</span>
								{/* One line: share state left (the meta stats stand in for
								    "shared", since only one of the two can apply), repo
								    visibility pinned to the right. */}
								<span className="repo-card__state">
									{share ? (
										<span className="repo-card__meta">
											{share.createdAt && (
												<span>created {ago(share.createdAt)}</span>
											)}
											<span>
												{share.expiresAt
													? `revokes ${until(share.expiresAt)}`
													: "no auto-revoke"}
											</span>
											<span>
												{share.ref
													? `locked to ${share.ref}`
													: share.showBranches
														? "branch list shown"
														: "default branch"}
											</span>
											{share.allowDownload && <span>zip enabled</span>}
											{share.showReleases && <span>releases shown</span>}
										</span>
									) : (
										<span>unshared</span>
									)}
									<span className="repo-card__vis">
										{r.private ? "private" : "public"}
									</span>
								</span>
							</button>
						);
					})}
				</section>

				{/* Final row: sticky control panel for the selected repo */}
				<section className="dash-panel" aria-label="Share controls">
					{!selRepo ? (
						<p className="dash-panel__hint">
							Select a repository above to manage its share link.
						</p>
					) : (
						<>
							<p className="dash-panel__repo">
								{selRepo.name}
								<span className="sep">|</span>
								<span>{selShare ? "shared" : "unshared"}</span>
							</p>
							<div className="dash-panel__controls">
								<YesNo
									label="Viewers can download repo as a zip"
									value={dl}
									disabled={busy}
									onChange={(v) => setDlSel((p) => ({ ...p, [key]: v }))}
								/>
								<YesNo
									label="Show releases as well"
									value={rel}
									disabled={busy}
									onChange={(v) => setRelSel((p) => ({ ...p, [key]: v }))}
								/>
								<YesNo
									label="Let users see a list of branches"
									hint="Whatever is selected, the link opens on the default branch, and viewers can always edit the URL to reach another branch. The list just makes it easier."
									value={sw}
									disabled={busy}
									onChange={(v) => setSwSel((p) => ({ ...p, [key]: v }))}
								/>
								<div className="dash-ctl">
									<span className="dash-ctl__label">Revoke shared link</span>
									<span className="ttl">
										<input
											type="number"
											min={1}
											className="ttl__num"
											aria-label="Auto-revoke amount"
											value={ttl.amount}
											disabled={busy || ttl.unit === "never"}
											onChange={(e) =>
												setTtlSel((p) => ({
													...p,
													[key]: {
														...ttl,
														amount: Math.max(
															1,
															Math.floor(Number(e.target.value) || 1),
														),
													},
												}))
											}
										/>
										<select
											className="ttl__unit"
											aria-label="Auto-revoke unit"
											value={ttl.unit}
											disabled={busy}
											onChange={(e) =>
												setTtlSel((p) => ({
													...p,
													[key]: { ...ttl, unit: e.target.value as Unit },
												}))
											}
										>
											<option value="days">days</option>
											<option value="weeks">weeks</option>
											<option value="months">months</option>
											<option value="years">years</option>
											<option value="never">never revoke</option>
										</select>
									</span>
								</div>
							</div>
							<div className="dash-panel__actions">
								{selShare ? (
									<>
										<button
											type="button"
											className="dash-btn dash-btn--danger"
											disabled={busy}
											onClick={() => revoke(selShare)}
										>
											{busy ? "Working" : "Revoke"}
										</button>
										<button
											type="button"
											className="dash-btn"
											disabled={busy}
											onClick={() => applySettings(selShare)}
										>
											Set
										</button>
										<button
											type="button"
											className="dash-btn"
											onClick={() => copy(selShare)}
										>
											{copied ? "Copied" : "Copy Link"}
										</button>
										<a
											className="dash-btn"
											href={`/${selRepo.owner}/${selRepo.name}?s=${selShare.id}`}
											target="_blank"
											rel="noopener"
										>
											Visit
										</a>
									</>
								) : (
									<button
										type="button"
										className="dash-btn dash-btn--accent"
										disabled={busy}
										onClick={() => create(selRepo)}
									>
										{busy ? "Creating" : "Share"}
									</button>
								)}
							</div>
						</>
					)}
				</section>
			</main>
			<SiteFooter />
		</div>
	);
}
