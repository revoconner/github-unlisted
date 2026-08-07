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

type ShareFilter = "shared" | "notshared";
type VisFilter = "public" | "private";

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
	return `${Math.floor(d / 7)}w ago`;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// A switch, not a checkbox: the knob position states on/off without relying
// on the accent fill alone.
function Toggle({
	checked,
	disabled,
	onChange,
	label,
}: {
	checked: boolean;
	disabled?: boolean;
	onChange: (v: boolean) => void;
	label: string;
}) {
	return (
		<label className="toggle">
			<input
				type="checkbox"
				checked={checked}
				disabled={disabled}
				aria-label={label}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span className="toggle__track" aria-hidden="true">
				<span className="toggle__knob" />
			</span>
		</label>
	);
}

// Empty value means "any branch": the link is not locked and the recipient
// can reach every branch by URL, which is how every share behaved before
// locking existed.
function BranchSelect({
	repo,
	value,
	disabled,
	onChange,
}: {
	repo: Repo;
	value: string;
	disabled?: boolean;
	onChange: (ref: string) => void;
}) {
	const [branches, setBranches] = React.useState<string[] | null>(null);
	const [loading, setLoading] = React.useState(false);

	// Loaded on first interaction rather than for every row up front, which
	// would be one GitHub call per repo on every dashboard render.
	const load = async () => {
		if (branches || loading) return;
		setLoading(true);
		try {
			const qs = new URLSearchParams({
				installationId: String(repo.installationId),
				owner: repo.owner,
				repo: repo.name,
			});
			const res = await fetch(`/api/repo/branches?${qs}`);
			if (!res.ok) throw new Error();
			const data = (await res.json()) as { branches: string[] };
			setBranches(data.branches);
		} catch {
			setBranches([]);
		} finally {
			setLoading(false);
		}
	};

	// A locked branch that has since been deleted would otherwise vanish from
	// the list and silently reset the row to "any branch".
	const options = React.useMemo(() => {
		const base = branches ?? [];
		return value && !base.includes(value) ? [value, ...base] : base;
	}, [branches, value]);

	return (
		<select
			className="select"
			aria-label="Branch to share"
			value={value}
			disabled={disabled}
			onFocus={load}
			onPointerDown={load}
			onChange={(e) => onChange(e.target.value)}
		>
			<option value="">Any branch</option>
			{options.map((b) => (
				<option key={b} value={b}>
					{b}
				</option>
			))}
			{loading && <option disabled>Loading branches</option>}
		</select>
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
	const [shareFilter, setShareFilter] = React.useState<ShareFilter | null>(
		null,
	);
	const [visFilter, setVisFilter] = React.useState<VisFilter | null>(null);
	const [alphaOpen, setAlphaOpen] = React.useState(false);
	const [selected, setSelected] = React.useState<string | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [copied, setCopied] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	// Draft state per repo. Each falls back to whatever the share already
	// stores, so an existing lock or flag shows up without the owner touching
	// the control.
	const [ttlSel, setTtlSel] = React.useState<Record<string, TtlSel>>({});
	const [refSel, setRefSel] = React.useState<Record<string, string>>({});

	const listRef = React.useRef<HTMLDivElement | null>(null);
	const rowRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});

	const shareByRepo = React.useMemo(() => {
		const m = new Map<string, Share>();
		for (const s of shares) m.set(`${s.owner}/${s.repo}`.toLowerCase(), s);
		return m;
	}, [shares]);

	// The owner prefix is the same on nearly every row, so it is dropped from
	// the list label. It stays searchable, and the panel header still shows
	// the full owner/name.
	const visible = React.useMemo(
		() =>
			repos.filter((r) => {
				const isShared = shareByRepo.has(r.fullName.toLowerCase());
				if (shareFilter === "shared" && !isShared) return false;
				if (shareFilter === "notshared" && isShared) return false;
				if (visFilter === "public" && r.private) return false;
				if (visFilter === "private" && !r.private) return false;
				if (query) {
					const q = query.toLowerCase();
					if (
						!r.name.toLowerCase().includes(q) &&
						!r.fullName.toLowerCase().includes(q)
					)
						return false;
				}
				return true;
			}),
		[repos, shareByRepo, shareFilter, visFilter, query],
	);

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

	// Which initials the quick-nav can actually jump to, keyed off the repo
	// name (not the owner, which is identical on nearly every row).
	const availableLetters = React.useMemo(() => {
		const set = new Set<string>();
		for (const r of visible) set.add(r.name[0]?.toUpperCase() ?? "");
		return set;
	}, [visible]);

	// Keep a valid selection as filters narrow the list under it.
	const active =
		visible.find((r) => r.fullName === selected) ?? visible[0] ?? null;
	const activeShare = active
		? shareByRepo.get(active.fullName.toLowerCase())
		: undefined;

	const getSel = (key: string): TtlSel =>
		ttlSel[key] ?? { amount: 1, unit: "never" };
	const setSel = (key: string, s: TtlSel) =>
		setTtlSel((prev) => ({ ...prev, [key]: s }));
	const getRef = (key: string, share?: Share): string =>
		refSel[key] ?? share?.ref ?? "";
	const setRef = (key: string, v: string) =>
		setRefSel((prev) => ({ ...prev, [key]: v }));

	const jumpTo = (letter: string) => {
		const target = visible.find(
			(r) => (r.name[0]?.toUpperCase() ?? "") === letter,
		);
		setAlphaOpen(false);
		if (!target) return;
		setSelected(target.fullName);
		rowRefs.current[target.fullName]?.scrollIntoView({
			block: "nearest",
			behavior: "smooth",
		});
	};

	const failure = async (res: Response, fallback: string) => {
		const data = (await res.json().catch(() => null)) as {
			error?: string;
		} | null;
		setError(data?.error ?? fallback);
	};

	// Only the keys that changed go in the body. The API leaves any key it
	// does not receive alone, which is what keeps a toggle from silently
	// restarting the auto-revoke window.
	const patch = async (share: Share, body: Record<string, unknown>) => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/share", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ id: share.id, ...body }),
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
					ttlSeconds: ttlFor(getSel(r.fullName)),
					ref: getRef(r.fullName) || null,
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

	// Two independent groups, each exclusive within itself.
	const GROUPS: {
		label: string;
		items: {
			key: ShareFilter | VisFilter;
			label: string;
			n: number;
			on: boolean;
			toggle: () => void;
		}[];
	}[] = [
		{
			label: "Sharing state",
			items: [
				{
					key: "shared",
					label: "Shared",
					n: counts.shared,
					on: shareFilter === "shared",
					toggle: () =>
						setShareFilter((v) => (v === "shared" ? null : "shared")),
				},
				{
					key: "notshared",
					label: "Not shared",
					n: counts.notshared,
					on: shareFilter === "notshared",
					toggle: () =>
						setShareFilter((v) => (v === "notshared" ? null : "notshared")),
				},
			],
		},
		{
			label: "Visibility",
			items: [
				{
					key: "public",
					label: "Public",
					n: counts.public,
					on: visFilter === "public",
					toggle: () => setVisFilter((v) => (v === "public" ? null : "public")),
				},
				{
					key: "private",
					label: "Private",
					n: counts.private,
					on: visFilter === "private",
					toggle: () =>
						setVisFilter((v) => (v === "private" ? null : "private")),
				},
			],
		},
	];

	const lockedRef = active ? getRef(active.fullName, activeShare) : "";
	const switcherOn = Boolean(!lockedRef && activeShare?.showBranches);

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

				<div className="topbar__right">
					<a className="nav-cta" href="/api/github/logout">
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

			<main className="dash">
				<div className="dash__inner">
					<section className="dash__list" aria-label="Your repositories">
						<div className="dash__listhead">
							<div className="dash__searchrow">
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

								{/* Quick nav: expands into the initials present in the
								    current list, so a long list is one click from any
								    letter. */}
								<button
									type="button"
									className="bento"
									aria-label="Jump to a letter"
									aria-expanded={alphaOpen}
									onClick={() => setAlphaOpen((v) => !v)}
								>
									<span className="bento__grid" aria-hidden="true">
										{Array.from({ length: 9 }, (_, i) => (
											// biome-ignore lint/suspicious/noArrayIndexKey: fixed 3x3 decorative grid
											<span className="bento__dot" key={i} />
										))}
									</span>
								</button>
							</div>

							{alphaOpen && (
								<nav className="alpha" aria-label="Jump to a letter">
									{LETTERS.map((l) => {
										const has = availableLetters.has(l);
										return (
											<button
												type="button"
												key={l}
												className={`alpha__item${has ? "" : " is-empty"}`}
												disabled={!has}
												onClick={() => jumpTo(l)}
											>
												{l}
											</button>
										);
									})}
								</nav>
							)}

							{/* Two filter pairs plus a clear. Each pair is exclusive
							    within itself; clicking an active one turns it off. */}
							{/* One row: two segmented controls sharing a track each, then
							    the clear. Each group is exclusive within itself; clicking
							    an active segment turns it off, and the cross clears both.
							    There is no "All" segment, cleared IS all. */}
							<div className="dash__filters">
								{GROUPS.map((g) => (
									<fieldset
										className="segmented"
										aria-label={g.label}
										key={g.label}
									>
										{g.items.map((f) => (
											<button
												key={f.key}
												type="button"
												className="segmented__item"
												aria-pressed={f.on}
												onClick={f.toggle}
											>
												{f.label}
												<span className="segmented__count">{f.n}</span>
											</button>
										))}
									</fieldset>
								))}
								<button
									type="button"
									className="filter-clear"
									aria-label="Clear all filters"
									title="Clear all filters"
									disabled={!shareFilter && !visFilter}
									onClick={() => {
										setShareFilter(null);
										setVisFilter(null);
									}}
								>
									<svg
										viewBox="0 0 24 24"
										width="14"
										height="14"
										fill="none"
										stroke="currentColor"
										strokeWidth="2.4"
										strokeLinecap="round"
										aria-hidden="true"
									>
										<line x1="18" y1="6" x2="6" y2="18" />
										<line x1="6" y1="6" x2="18" y2="18" />
									</svg>
								</button>
							</div>
						</div>

						<div className="dash__scroll" ref={listRef}>
							{visible.length === 0 && (
								<p className="dash__empty">No repositories match.</p>
							)}
							{visible.map((r) => {
								const share = shareByRepo.get(r.fullName.toLowerCase());
								const isActive = active?.fullName === r.fullName;
								return (
									<button
										type="button"
										key={r.fullName}
										ref={(el) => {
											rowRefs.current[r.fullName] = el;
										}}
										className={`repo-item${isActive ? " is-active" : ""}`}
										aria-current={isActive}
										onClick={() => setSelected(r.fullName)}
									>
										<span className="repo-item__name">{r.name}</span>
										<span className="repo-item__meta">
											<span
												className={
													r.private ? "tag tag--accent" : "tag tag--plain"
												}
											>
												{r.private ? "private" : "public"}
											</span>
											<span
												className={share ? "tag tag--accent" : "tag tag--plain"}
											>
												{share ? "shared" : "unshared"}
											</span>
										</span>
									</button>
								);
							})}
						</div>
					</section>

					<aside className="dash__panel" aria-label="Share settings">
						{!active ? (
							<p className="dash__empty">
								Select a repository to configure its link.
							</p>
						) : (
							<>
								<div className="panel__head">
									<h1 className="panel__title">{active.name}</h1>
									<p className="panel__sub">
										{active.owner} / {active.name}
									</p>
								</div>

								{error && (
									<p className="panel__error" role="alert">
										{error}
									</p>
								)}

								<div className="panel__rows">
									<div className="setting-row">
										<span className="setting-row__label">Lock to a branch</span>
										<div className="setting-row__control">
											<BranchSelect
												repo={active}
												value={lockedRef}
												disabled={busy}
												onChange={(v) => {
													setRef(active.fullName, v);
													if (activeShare)
														patch(activeShare, { ref: v || null });
												}}
											/>
										</div>
									</div>

									<div className="setting-row">
										<span className="setting-row__label">
											Recipient can switch branches
											{lockedRef && (
												<span className="setting-row__note">
													Unavailable while the link is locked to a branch
												</span>
											)}
										</span>
										<div className="setting-row__control">
											<Toggle
												label="Recipient can switch branches"
												checked={switcherOn}
												disabled={busy || !activeShare || Boolean(lockedRef)}
												onChange={(v) =>
													activeShare && patch(activeShare, { showBranches: v })
												}
											/>
										</div>
									</div>

									<div className="setting-row">
										<span className="setting-row__label">
											Allow zip download
										</span>
										<div className="setting-row__control">
											<Toggle
												label="Allow zip download"
												checked={Boolean(activeShare?.allowDownload)}
												disabled={busy || !activeShare}
												onChange={(v) =>
													activeShare &&
													patch(activeShare, { allowDownload: v })
												}
											/>
										</div>
									</div>

									<div className="setting-row">
										<span className="setting-row__label">Show releases</span>
										<div className="setting-row__control">
											<Toggle
												label="Show releases"
												checked={Boolean(activeShare?.showReleases)}
												disabled={busy || !activeShare}
												onChange={(v) =>
													activeShare && patch(activeShare, { showReleases: v })
												}
											/>
										</div>
									</div>

									{/* The one control that cannot commit on every keystroke: the
									    unit commits on change and the amount on blur, because each
									    write restarts the revoke window server-side. */}
									<div className="setting-row">
										<span className="setting-row__label">
											Auto-revoke after
											{activeShare && (
												<span className="setting-row__note">
													Changing this restarts the window
												</span>
											)}
										</span>
										<div className="setting-row__control">
											<select
												className="select"
												aria-label="Auto-revoke unit"
												value={getSel(active.fullName).unit}
												disabled={busy}
												onChange={(e) => {
													const next: TtlSel = {
														...getSel(active.fullName),
														unit: e.target.value as Unit,
													};
													setSel(active.fullName, next);
													if (activeShare)
														patch(activeShare, { ttlSeconds: ttlFor(next) });
												}}
											>
												<option value="never">Never</option>
												<option value="days">Days</option>
												<option value="weeks">Weeks</option>
												<option value="months">Months</option>
												<option value="years">Years</option>
											</select>
											{getSel(active.fullName).unit !== "never" && (
												<input
													type="number"
													min={1}
													className="numfield"
													aria-label="Auto-revoke amount"
													value={getSel(active.fullName).amount}
													disabled={busy}
													onChange={(e) =>
														setSel(active.fullName, {
															...getSel(active.fullName),
															amount: Math.max(
																1,
																Math.floor(Number(e.target.value) || 1),
															),
														})
													}
													onBlur={() => {
														if (activeShare)
															patch(activeShare, {
																ttlSeconds: ttlFor(getSel(active.fullName)),
															});
													}}
												/>
											)}
										</div>
									</div>

									{activeShare && (
										<div className="setting-row">
											<span className="setting-row__label">Link</span>
											<div className="setting-row__control setting-row__control--pair">
												<button
													type="button"
													className="btn btn--quiet btn--compact"
													onClick={() => copy(activeShare)}
												>
													{copied ? "Copied" : "Copy"}
												</button>
												<a
													className="btn btn--quiet btn--compact"
													href={`/${active.owner}/${active.name}?s=${activeShare.id}`}
													target="_blank"
													rel="noopener"
												>
													Open
												</a>
											</div>
										</div>
									)}

									{activeShare && (
										<p className="panel__status">
											{activeShare.createdAt &&
												`Created ${ago(activeShare.createdAt)}. `}
											{activeShare.expiresAt
												? `Revokes ${until(activeShare.expiresAt)}.`
												: "No auto-revoke set."}
										</p>
									)}
								</div>

								<div className="panel__foot">
									{activeShare ? (
										<button
											type="button"
											className="btn btn--destructive panel__action"
											disabled={busy}
											onClick={() => revoke(activeShare)}
										>
											<svg
												viewBox="0 0 24 24"
												width="15"
												height="15"
												fill="none"
												stroke="currentColor"
												strokeWidth="2.4"
												strokeLinecap="round"
												aria-hidden="true"
											>
												<line x1="18" y1="6" x2="6" y2="18" />
												<line x1="6" y1="6" x2="18" y2="18" />
											</svg>
											Revoke
										</button>
									) : (
										<button
											type="button"
											className="btn btn--primary panel__action"
											disabled={busy}
											onClick={() => create(active)}
										>
											Share
										</button>
									)}
								</div>
							</>
						)}
					</aside>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
