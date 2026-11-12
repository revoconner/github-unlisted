"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import {
	dateInputValue,
	defaultPortfolioTitle,
	MAX_DESCRIPTION_LENGTH,
	MAX_PORTFOLIO_REPOS,
	MAX_PORTFOLIOS_PER_OWNER,
	MAX_TITLE_LENGTH,
	moveItem,
	portfolioPath,
	revokeSecondsFromDate,
} from "@/lib/portfolio";
import { resizeToAvatar } from "@/lib/resize-image";

export interface PortfolioItem {
	id: string;
	title?: string;
	description?: string;
	// Already filtered by the server to shares that still exist.
	shareIds: string[];
	label: string;
	installationId?: number;
	connectionId?: string;
	// Where the current picture is served from, if there is one.
	imageUrl?: string | null;
	// When the page and the links it created stop working, if ever.
	expiresAt?: number | null;
}

// Mirrors the dashboard's visibility filter.
export type VisibilityFilter = "all" | "private" | "public";

export interface ManagerShare {
	id: string;
	// Whether the repository is private. Unknown when the repo list does not
	// include it, in which case it only appears under "all".
	private?: boolean;
	forge?: string;
	owner: string;
	repo: string;
	installationId?: number;
	connectionId?: string;
	// Set when a portfolio created this link, rather than the owner on its own.
	managedBy?: string;
	showReleases?: boolean;
	allowDownload?: boolean;
	showBranches?: boolean;
}

// A repository the account can see, shared or not.
export interface ManagerRepo {
	forge: string;
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
	installationId?: number;
	connectionId?: string;
}

export interface ManagerConnection {
	id: string;
	forge: string;
	host: string;
	login: string;
}

// What the owner asked to do with the picture. Applied after the portfolio
// itself is saved, because a new portfolio has no id to attach it to until then.
type ImageChange =
	| { kind: "keep" }
	| { kind: "remove" }
	| { kind: "upload"; data: string; type: string }
	| { kind: "url"; url: string };

// One line of the ordered list. It is either a repository that already has a
// link, or one that does not and will get one when the portfolio is saved.
interface DraftItem {
	// The share id, or "new:<repo key>". Stable, so it is the React key and the
	// identity used for reordering.
	uid: string;
	shareId?: string;
	owner: string;
	repo: string;
	isPrivate?: boolean;
	// True for a link this portfolio creates or already created. Only these have
	// options here; a link the owner made keeps its own settings.
	managed: boolean;
	releases: boolean;
	download: boolean;
	branches: boolean;
}

interface Draft {
	// null while creating.
	id: string | null;
	accountKey: string;
	title: string;
	description: string;
	items: DraftItem[];
	image: ImageChange;
	// The picture as it is now on the server, for the preview.
	currentImage: string | null;
	// "" means never.
	revokeOn: string;
	revokeDirty: boolean;
}

interface Account {
	key: string;
	label: string;
	// What the create request must send to name this account.
	installationId?: number;
	connectionId?: string;
	// The name the default title falls back to, as the server computes it.
	titleLabel: string;
	shares: ManagerShare[];
	repos: ManagerRepo[];
}

// A portfolio belongs to one account, and a share or repository to exactly one,
// so the account is simply whichever of the two ids the record carries.
const accountKeyOf = (x: { installationId?: number; connectionId?: string }) =>
	x.connectionId ? `c:${x.connectionId}` : `i:${x.installationId}`;

// The same repository on two forges is two repositories.
const repoKeyOf = (forge: string | undefined, name: string) =>
	`${forge ?? "github"}:${name}`.toLowerCase();

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

export function PortfolioManager({
	portfolios,
	shares,
	repos = [],
	connections,
	login,
	visibility = "all",
}: {
	visibility?: VisibilityFilter;
	portfolios: PortfolioItem[];
	shares: ManagerShare[];
	repos?: ManagerRepo[];
	connections: ManagerConnection[];
	login: string;
}) {
	const router = useRouter();
	const [draft, setDraft] = React.useState<Draft | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	const [copied, setCopied] = React.useState<string | null>(null);
	// Where an in-flight drag started and where it currently hovers.
	const [drag, setDrag] = React.useState<{ from: number; over: number } | null>(
		null,
	);
	// Screen-reader feedback for reorders, which are otherwise silent.
	const [announce, setAnnounce] = React.useState("");
	const [urlInput, setUrlInput] = React.useState("");
	const fileInput = React.useRef<HTMLInputElement>(null);

	const shareById = React.useMemo(
		() => new Map(shares.map((s) => [s.id, s])),
		[shares],
	);
	const sharedKeys = React.useMemo(
		() =>
			new Set(shares.map((s) => repoKeyOf(s.forge, `${s.owner}/${s.repo}`))),
		[shares],
	);

	// The dashboard's Private/Public tab. It narrows what is SHOWN here, never
	// what is stored: a repository hidden by the tab stays in its portfolio, in
	// its place, and is still saved. Dropping hidden ones on save would silently
	// delete them.
	const visible = React.useCallback(
		(isPrivate: boolean | undefined) =>
			visibility === "all" ||
			(isPrivate !== undefined && (visibility === "private") === isPrivate),
		[visibility],
	);
	const shareVisible = (id: string) => visible(shareById.get(id)?.private);

	const visibleItems = draft
		? draft.items.filter((i) => visible(i.isPrivate))
		: [];
	const hiddenCount = draft ? draft.items.length - visibleItems.length : 0;

	// An account can host a portfolio as soon as it has a repository, shared or
	// not: repositories without a link get one when the portfolio is saved.
	const accounts = React.useMemo(() => {
		const map = new Map<string, Account>();
		const ensure = (
			x: { installationId?: number; connectionId?: string },
			owner: string,
		) => {
			const key = accountKeyOf(x);
			let acc = map.get(key);
			if (!acc) {
				const conn = x.connectionId
					? connections.find((c) => c.id === x.connectionId)
					: undefined;
				acc = {
					key,
					installationId: x.installationId,
					connectionId: x.connectionId,
					label: conn
						? `${conn.forge} · ${conn.host.replace(/^https?:\/\//, "")} · ${conn.login}`
						: `github · ${owner}`,
					titleLabel: conn ? conn.login : login,
					shares: [],
					repos: [],
				};
				map.set(key, acc);
			}
			return acc;
		};
		for (const s of shares) ensure(s, s.owner).shares.push(s);
		for (const r of repos) ensure(r, r.owner).repos.push(r);
		return map;
	}, [shares, repos, connections, login]);

	const draftAccount = draft ? accounts.get(draft.accountKey) : undefined;

	// What the "Add" menu offers: links that already exist (and are not tied to
	// some other portfolio), then repositories that have none yet.
	const addable = React.useMemo(() => {
		if (!draft || !draftAccount) return { shared: [], fresh: [] };
		const taken = new Set(draft.items.map((i) => i.uid));
		const shared = draftAccount.shares.filter(
			(s) =>
				!taken.has(s.id) &&
				(!s.managedBy || s.managedBy === draft.id) &&
				visible(s.private),
		);
		const fresh = draftAccount.repos.filter(
			(r) =>
				!sharedKeys.has(repoKeyOf(r.forge, r.fullName)) &&
				!taken.has(`new:${repoKeyOf(r.forge, r.fullName)}`) &&
				visible(r.private),
		);
		return { shared, fresh };
	}, [draft, draftAccount, sharedKeys, visible]);

	// What the preview shows: a freshly picked file, else what is stored now,
	// else nothing. A pending URL has no preview: showing it would mean the
	// owner's browser fetching an address we are about to fetch ourselves.
	const pictureSrc = !draft
		? null
		: draft.image.kind === "upload"
			? `data:${draft.image.type};base64,${draft.image.data}`
			: draft.image.kind === "keep"
				? draft.currentImage
				: null;

	const nameOf = (i: DraftItem) => `${i.owner}/${i.repo}`;

	const itemFromShare = (
		s: ManagerShare,
		portfolioId: string | null,
	): DraftItem => ({
		uid: s.id,
		shareId: s.id,
		owner: s.owner,
		repo: s.repo,
		isPrivate: s.private,
		managed: portfolioId !== null && s.managedBy === portfolioId,
		releases: s.showReleases === true,
		download: s.allowDownload === true,
		branches: s.showBranches === true,
	});

	const startNew = () => {
		const first = [...accounts.values()][0];
		if (!first) return;
		setUrlInput("");
		setError(null);
		setDraft({
			id: null,
			accountKey: first.key,
			title: "",
			description: "",
			items: [],
			image: { kind: "keep" },
			currentImage: null,
			revokeOn: "",
			revokeDirty: false,
		});
	};

	const startEdit = (p: PortfolioItem) => {
		setUrlInput("");
		setError(null);
		setDraft({
			id: p.id,
			accountKey: accountKeyOf(p),
			title: p.title ?? "",
			description: p.description ?? "",
			items: p.shareIds
				.map((id) => shareById.get(id))
				.filter((s): s is ManagerShare => s !== undefined)
				.map((s) => itemFromShare(s, p.id)),
			image: { kind: "keep" },
			currentImage: p.imageUrl ?? null,
			revokeOn: p.expiresAt ? dateInputValue(p.expiresAt) : "",
			revokeDirty: false,
		});
	};

	const close = () => {
		setDraft(null);
		setDrag(null);
		setError(null);
	};

	const update = (patch: Partial<Draft>) =>
		setDraft((d) => (d ? { ...d, ...patch } : d));

	const updateItem = (uid: string, patch: Partial<DraftItem>) =>
		setDraft((d) =>
			d
				? {
						...d,
						items: d.items.map((i) => (i.uid === uid ? { ...i, ...patch } : i)),
					}
				: d,
		);

	// Indexes are positions among the repositories currently shown. They are
	// mapped back to the full list so hidden ones keep their place.
	const reorder = (from: number, to: number) => {
		if (!draft || from === to) return;
		const a = visibleItems[from];
		const b = visibleItems[to];
		if (!a || !b) return;
		const ids = draft.items.map((i) => i.uid);
		const moved = moveItem(ids, ids.indexOf(a.uid), ids.indexOf(b.uid));
		const byUid = new Map(draft.items.map((i) => [i.uid, i]));
		update({ items: moved.map((uid) => byUid.get(uid) as DraftItem) });
		setAnnounce(
			`${nameOf(a)} moved to position ${to + 1} of ${visibleItems.length}`,
		);
	};

	const addValue = (value: string) => {
		if (!draft || !draftAccount || !value) return;
		if (value.startsWith("s:")) {
			const s = shareById.get(value.slice(2));
			if (s) update({ items: [...draft.items, itemFromShare(s, draft.id)] });
			return;
		}
		const r = draftAccount.repos.find(
			(x) => repoKeyOf(x.forge, x.fullName) === value.slice(2),
		);
		if (!r) return;
		update({
			items: [
				...draft.items,
				{
					uid: `new:${repoKeyOf(r.forge, r.fullName)}`,
					owner: r.owner,
					repo: r.name,
					isPrivate: r.private,
					managed: true,
					// Everything off until the owner chooses otherwise.
					releases: false,
					download: false,
					branches: false,
				},
			],
		});
	};

	// Returns an error message, or null on success.
	const applyImage = async (
		id: string,
		change: ImageChange,
	): Promise<string | null> => {
		if (change.kind === "keep") return null;
		const res =
			change.kind === "remove"
				? await fetch(`/api/portfolio/image?id=${encodeURIComponent(id)}`, {
						method: "DELETE",
					})
				: await fetch("/api/portfolio/image", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(
							change.kind === "url"
								? { id, url: change.url }
								: { id, data: change.data },
						),
					});
		if (res.ok) return null;
		const data = (await res.json().catch(() => null)) as {
			error?: string;
		} | null;
		return data?.error ?? "Unknown error";
	};

	const pickFile = async (file: File | undefined) => {
		if (!file || !draft) return;
		setError(null);
		try {
			const out = await resizeToAvatar(file);
			update({ image: { kind: "upload", data: out.data, type: out.type } });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not use that image");
		}
	};

	const save = async () => {
		if (!draft || !draftAccount || busy) return;

		// A bad date must stop here. NaN would serialise to null, and null means
		// "never revoke": the opposite of what a mistyped date was meant to do.
		const ttl = revokeSecondsFromDate(draft.revokeOn);
		if (ttl === "invalid") {
			setError("Pick a revoke date that is today or later");
			return;
		}

		setBusy(true);
		setError(null);
		try {
			const items = draft.items.map((i) => {
				if (!i.shareId) {
					return {
						owner: i.owner,
						repo: i.repo,
						showReleases: i.releases,
						allowDownload: i.download,
						showBranches: i.branches,
					};
				}
				return i.managed
					? {
							shareId: i.shareId,
							showReleases: i.releases,
							allowDownload: i.download,
							showBranches: i.branches,
						}
					: { shareId: i.shareId };
			});
			const payload = {
				title: draft.title,
				description: draft.description,
				items,
			};
			const res = await fetch("/api/portfolio", {
				method: draft.id ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(
					draft.id
						? {
								id: draft.id,
								...payload,
								// Only when the date was touched: re-sending an untouched
								// one would round it to the end of that day.
								...(draft.revokeDirty ? { ttlSeconds: ttl } : {}),
							}
						: {
								...(draftAccount.connectionId
									? { connectionId: draftAccount.connectionId }
									: { installationId: draftAccount.installationId }),
								...payload,
								ttlSeconds: ttl,
							},
				),
			});
			if (!res.ok) {
				const data = (await res.json().catch(() => null)) as {
					error?: string;
				} | null;
				setError(data?.error ?? "Could not save the portfolio");
				return;
			}
			const saved = (await res.json().catch(() => null)) as {
				id?: string;
			} | null;
			const portfolioId = draft.id ?? saved?.id;
			if (portfolioId) {
				const imageError = await applyImage(portfolioId, draft.image);
				if (imageError) {
					// The portfolio and its links are saved. Close the editor: its list
					// still describes repositories as "new", and saving it again would
					// try to create their links a second time. Reopening shows the real
					// state.
					close();
					setError(`Saved, but the picture could not be set: ${imageError}`);
					router.refresh();
					return;
				}
			}
			close();
			router.refresh();
		} catch {
			setError("Could not save the portfolio");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id: string) => {
		const p = portfolios.find((x) => x.id === id);
		const managed = p
			? p.shareIds.filter((sid) => shareById.get(sid)?.managedBy === id).length
			: 0;
		const note =
			managed > 0
				? `${managed} repository ${managed === 1 ? "link" : "links"} created by this portfolio will be revoked too. Links you shared yourself are NOT revoked.`
				: "The individual repository links are NOT revoked: anyone who already has one can still use it until you revoke it below.";
		if (!confirm(`Delete this portfolio page?\n\n${note}`)) return;
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/portfolio?id=${encodeURIComponent(id)}`, {
				method: "DELETE",
			});
			if (!res.ok) throw new Error();
			close();
			router.refresh();
		} catch {
			setError("Could not delete the portfolio");
		} finally {
			setBusy(false);
		}
	};

	const copy = async (id: string) => {
		await navigator.clipboard.writeText(
			`${window.location.origin}${portfolioPath(id)}`,
		);
		setCopied(id);
		setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
	};

	const shownPortfolios = portfolios
		.map((p) => ({ p, shown: p.shareIds.filter(shareVisible).length }))
		// Under a Private/Public tab, a portfolio with nothing of that kind in it
		// is not part of what the tab is showing.
		.filter(({ shown }) => visibility === "all" || shown > 0);
	const hiddenPortfolios = portfolios.length - shownPortfolios.length;

	const canCreate =
		accounts.size > 0 && portfolios.length < MAX_PORTFOLIOS_PER_OWNER;

	const addCount = addable.shared.length + addable.fresh.length;

	return (
		<section className="dash-portfolios" aria-label="Portfolios">
			<div className="pfm-head">
				<div>
					<h2 className="pfm-title">Portfolios</h2>
					<p className="pfm-sub">
						One link that shows several repositories, in the order you choose.
					</p>
				</div>
				{!draft && (
					<button
						type="button"
						className="dash-btn dash-btn--accent pfm-new"
						disabled={!canCreate}
						onClick={startNew}
					>
						New portfolio
					</button>
				)}
			</div>

			{!draft && accounts.size === 0 && (
				<p className="pfm-note">
					No repositories are available yet. Connect an account first.
				</p>
			)}

			{!draft && shownPortfolios.length > 0 && (
				<ul className="pfm-list">
					{shownPortfolios.map(({ p, shown }) => (
						<li className="pfm-row" key={p.id}>
							<div className="pfm-row__copy">
								<span className="pfm-row__name">
									{p.title ?? defaultPortfolioTitle(p.label)}
								</span>
								<span className="pfm-row__meta">
									{shown} {shown === 1 ? "repository" : "repositories"}
									{shown < p.shareIds.length &&
										` (+${p.shareIds.length - shown} not ${visibility})`}
									{p.expiresAt ? ` · revokes ${DATE.format(p.expiresAt)}` : ""}
								</span>
							</div>
							<div className="pfm-row__actions">
								<button
									type="button"
									className="dash-btn"
									disabled={busy}
									onClick={() => startEdit(p)}
								>
									Edit
								</button>
								<button
									type="button"
									className="dash-btn"
									onClick={() => copy(p.id)}
								>
									{copied === p.id ? "Copied" : "Copy Link"}
								</button>
								<a
									className="dash-btn"
									href={portfolioPath(p.id)}
									target="_blank"
									rel="noopener"
								>
									Visit
								</a>
							</div>
						</li>
					))}
				</ul>
			)}

			{!draft && hiddenPortfolios > 0 && (
				<p className="pfm-note">
					{hiddenPortfolios}{" "}
					{hiddenPortfolios === 1 ? "portfolio has" : "portfolios have"} no{" "}
					{visibility} repositories and {hiddenPortfolios === 1 ? "is" : "are"}{" "}
					hidden. Switch the filter to All to see{" "}
					{hiddenPortfolios === 1 ? "it" : "them"}.
				</p>
			)}

			{draft && draftAccount && (
				<div className="pfm-editor">
					{accounts.size > 1 && !draft.id && (
						<label className="pfm-field">
							<span className="pfm-field__label">Account</span>
							<select
								className="pfm-input"
								value={draft.accountKey}
								disabled={busy}
								onChange={(e) =>
									// A portfolio holds one account's repositories only, so
									// switching account starts the list over.
									update({ accountKey: e.target.value, items: [] })
								}
							>
								{[...accounts.values()].map((a) => (
									<option key={a.key} value={a.key}>
										{a.label}
									</option>
								))}
							</select>
						</label>
					)}

					<label className="pfm-field">
						<span className="pfm-field__label">Title</span>
						<input
							className="pfm-input"
							type="text"
							maxLength={MAX_TITLE_LENGTH}
							value={draft.title}
							disabled={busy}
							placeholder={defaultPortfolioTitle(draftAccount.titleLabel)}
							onChange={(e) => update({ title: e.target.value })}
						/>
						<span className="pfm-field__hint">
							Leave empty to show &ldquo;
							{defaultPortfolioTitle(draftAccount.titleLabel)}&rdquo;.
						</span>
					</label>

					<label className="pfm-field">
						<span className="pfm-field__label">Description</span>
						<textarea
							className="pfm-input pfm-textarea"
							rows={3}
							maxLength={MAX_DESCRIPTION_LENGTH}
							value={draft.description}
							disabled={busy}
							placeholder="Optional. A sentence or two shown under the title."
							onChange={(e) => update({ description: e.target.value })}
						/>
						<span className="pfm-field__hint">
							{draft.description.length}/{MAX_DESCRIPTION_LENGTH}
						</span>
					</label>

					<div className="pfm-field">
						<span className="pfm-field__label">Picture</span>
						<div className="pfm-pic">
							<span className="pfm-pic__frame" aria-hidden="true">
								{pictureSrc ? (
									// biome-ignore lint/performance/noImgElement: a local preview of the owner's own picture
									<img src={pictureSrc} alt="" />
								) : null}
							</span>
							<div className="pfm-pic__ctl">
								<input
									ref={fileInput}
									type="file"
									className="pfm-sr"
									accept="image/png,image/jpeg,image/webp,image/gif"
									aria-label="Upload a picture"
									tabIndex={-1}
									onChange={(e) => {
										pickFile(e.target.files?.[0]);
										e.target.value = "";
									}}
								/>
								<button
									type="button"
									className="dash-btn"
									disabled={busy}
									onClick={() => fileInput.current?.click()}
								>
									Upload image
								</button>
								{pictureSrc && (
									<button
										type="button"
										className="dash-btn"
										disabled={busy}
										onClick={() => {
											setUrlInput("");
											update({ image: { kind: "remove" } });
										}}
									>
										Remove
									</button>
								)}
							</div>
						</div>
						<div className="pfm-url">
							<input
								className="pfm-input"
								type="url"
								inputMode="url"
								placeholder="…or paste an image URL (https://…)"
								aria-label="Image URL"
								value={urlInput}
								disabled={busy}
								onChange={(e) => setUrlInput(e.target.value)}
							/>
							<button
								type="button"
								className="dash-btn"
								disabled={busy || !urlInput.trim()}
								onClick={() =>
									update({ image: { kind: "url", url: urlInput.trim() } })
								}
							>
								Use URL
							</button>
						</div>
						<span className="pfm-field__hint">
							{draft.image.kind === "url"
								? "The image will be downloaded when you save."
								: "PNG, JPEG or WebP. It is copied and stored once, so visitors never load it from the original address. Without one, a briefcase icon is shown."}
						</span>
					</div>

					<div className="pfm-field">
						<label className="pfm-field__label" htmlFor="pfm-revoke">
							Revoke date
						</label>
						<div className="pfm-url">
							<input
								id="pfm-revoke"
								className="pfm-input"
								type="date"
								min={dateInputValue(Date.now())}
								value={draft.revokeOn}
								disabled={busy}
								onChange={(e) =>
									update({ revokeOn: e.target.value, revokeDirty: true })
								}
							/>
							<button
								type="button"
								className="dash-btn"
								disabled={busy || !draft.revokeOn}
								onClick={() => update({ revokeOn: "", revokeDirty: true })}
							>
								Never
							</button>
						</div>
						<span className="pfm-field__hint">
							{draft.revokeOn
								? "At the end of that day (your time zone) this page and every link it created stop working."
								: "Never. This page and the links it creates stay active until you delete them."}{" "}
							Links you shared yourself keep their own expiry.
						</span>
					</div>

					<div className="pfm-field">
						<span className="pfm-field__label" id="pfm-order-label">
							Repositories (
							{hiddenCount > 0
								? `${visibleItems.length} ${visibility} · ${draft.items.length}/${MAX_PORTFOLIO_REPOS} in total`
								: `${draft.items.length}/${MAX_PORTFOLIO_REPOS}`}
							)
						</span>
						<span className="pfm-field__hint">
							Drag to reorder, or use the arrows. The first one is shown first.
							Removing a repository this portfolio shared for you also revokes
							its link.
						</span>

						{visibleItems.length === 0 ? (
							<p className="pfm-note">
								{hiddenCount > 0
									? `No ${visibility} repositories in this portfolio.`
									: "No repositories added yet."}
							</p>
						) : (
							<ol className="pfm-order" aria-labelledby="pfm-order-label">
								{visibleItems.map((item, i) => {
									const name = nameOf(item);
									const dragging = drag?.from === i;
									const over =
										drag !== null && drag.over === i && drag.from !== i;
									return (
										<li
											key={item.uid}
											className="pfm-order__row"
											data-dragging={dragging || undefined}
											data-over={over || undefined}
											draggable={!busy}
											onDragStart={(e) => {
												e.dataTransfer?.setData("text/plain", item.uid);
												if (e.dataTransfer)
													e.dataTransfer.effectAllowed = "move";
												setDrag({ from: i, over: i });
											}}
											onDragOver={(e) => {
												// Only react to our own drags, not files or text dragged in from outside.
												if (!drag) return;
												e.preventDefault();
												if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
												if (drag.over !== i) setDrag({ ...drag, over: i });
											}}
											onDrop={(e) => {
												e.preventDefault();
												if (drag) reorder(drag.from, i);
												setDrag(null);
											}}
											onDragEnd={() => setDrag(null)}
										>
											<span className="pfm-order__grip" aria-hidden="true">
												⋮⋮
											</span>
											<span className="pfm-order__pos">{i + 1}</span>
											<span className="pfm-order__name">
												{name}
												{!item.shareId && (
													<span className="pfm-badge">gets a new link</span>
												)}
											</span>
											<span className="pfm-order__ctl">
												<button
													type="button"
													className="pfm-icon-btn"
													aria-label={`Move ${name} up`}
													disabled={busy || i === 0}
													onClick={() => reorder(i, i - 1)}
												>
													↑
												</button>
												<button
													type="button"
													className="pfm-icon-btn"
													aria-label={`Move ${name} down`}
													disabled={busy || i === visibleItems.length - 1}
													onClick={() => reorder(i, i + 1)}
												>
													↓
												</button>
												<button
													type="button"
													className="pfm-icon-btn"
													aria-label={`Remove ${name} from the portfolio`}
													disabled={busy}
													onClick={() =>
														update({
															items: draft.items.filter(
																(x) => x.uid !== item.uid,
															),
														})
													}
												>
													✕
												</button>
											</span>

											{item.managed ? (
												<fieldset className="pfm-opts">
													<legend className="pfm-sr">Options for {name}</legend>
													<label className="pfm-opt">
														<input
															type="checkbox"
															checked={item.releases}
															disabled={busy}
															aria-label={`Show releases for ${name}`}
															onChange={(e) =>
																updateItem(item.uid, {
																	releases: e.target.checked,
																})
															}
														/>
														Releases
													</label>
													<label className="pfm-opt">
														<input
															type="checkbox"
															checked={item.download}
															disabled={busy}
															aria-label={`Allow zip download for ${name}`}
															onChange={(e) =>
																updateItem(item.uid, {
																	download: e.target.checked,
																})
															}
														/>
														Zip download
													</label>
													<label className="pfm-opt">
														<input
															type="checkbox"
															checked={item.branches}
															disabled={busy}
															aria-label={`Show branches for ${name}`}
															onChange={(e) =>
																updateItem(item.uid, {
																	branches: e.target.checked,
																})
															}
														/>
														Branches
													</label>
												</fieldset>
											) : (
												<span className="pfm-opts pfm-opts--own">
													Uses the settings of its own link
												</span>
											)}
										</li>
									);
								})}
							</ol>
						)}

						{hiddenCount > 0 && (
							<p className="pfm-note">
								{hiddenCount}{" "}
								{hiddenCount === 1 ? "repository is" : "repositories are"}{" "}
								hidden by the {visibility} filter. They stay in the portfolio
								and keep their place.
							</p>
						)}

						<label className="pfm-field pfm-add">
							<span className="pfm-field__label">Add a repository</span>
							<select
								className="pfm-input"
								value=""
								disabled={
									busy ||
									addCount === 0 ||
									draft.items.length >= MAX_PORTFOLIO_REPOS
								}
								onChange={(e) => addValue(e.target.value)}
							>
								<option value="">
									{addCount === 0
										? visibility === "all"
											? "No other repositories"
											: `No other ${visibility} repositories`
										: "Choose a repository…"}
								</option>
								{addable.shared.length > 0 && (
									<optgroup label="Already shared">
										{addable.shared.map((s) => (
											<option key={s.id} value={`s:${s.id}`}>
												{s.owner}/{s.repo}
											</option>
										))}
									</optgroup>
								)}
								{addable.fresh.length > 0 && (
									<optgroup label="Not shared yet (gets a link)">
										{addable.fresh.map((r) => (
											<option
												key={repoKeyOf(r.forge, r.fullName)}
												value={`r:${repoKeyOf(r.forge, r.fullName)}`}
											>
												{r.fullName}
											</option>
										))}
									</optgroup>
								)}
							</select>
						</label>
					</div>

					<p className="pfm-note">
						A repository you already shared keeps its own link settings (branch,
						download, releases, auto-revoke). One added here gets a new link
						with the options you choose above, and it expires on the revoke
						date. A link that is revoked or expires disappears from the
						portfolio by itself.
					</p>

					{error && (
						<div className="signin-error" role="alert">
							{error}
						</div>
					)}

					<div className="pfm-actions">
						{draft.id && (
							<button
								type="button"
								className="dash-btn dash-btn--danger"
								disabled={busy}
								onClick={() => draft.id && remove(draft.id)}
							>
								Delete
							</button>
						)}
						<button
							type="button"
							className="dash-btn"
							disabled={busy}
							onClick={close}
						>
							Cancel
						</button>
						<button
							type="button"
							className="dash-btn dash-btn--set"
							disabled={busy || draft.items.length === 0}
							onClick={save}
						>
							{busy ? "Working" : draft.id ? "Save" : "Create"}
						</button>
					</div>
				</div>
			)}

			{!draft && error && (
				<div className="signin-error" role="alert">
					{error}
				</div>
			)}

			<p className="pfm-sr" role="status" aria-live="polite">
				{announce}
			</p>
		</section>
	);
}
