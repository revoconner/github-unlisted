// Pure helpers shared by the dashboard editor (client) and the portfolio API
// (server). Nothing in here may import Redis or any server-only module: the
// dashboard bundles this file.

// A portfolio page fetches every repository's README on each visit (three
// upstream calls per repo), so the cap is what bounds that cost. Raise it only
// together with lazy-loaded previews.
export const MAX_PORTFOLIO_REPOS = 12;
export const MAX_PORTFOLIOS_PER_OWNER = 10;
export const MAX_TITLE_LENGTH = 80;
export const MAX_DESCRIPTION_LENGTH = 280;

// Share ids are crypto.randomUUID() values; anything longer is not one.
const MAX_SHARE_ID_LENGTH = 64;

// Control characters, plus the invisible and bidirectional-override code
// points that let a title read differently from what it contains (a classic
// spoofing trick on a page whose text the owner controls and strangers read).
const INVISIBLE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is being removed
	/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

function clampCodePoints(value: string, max: number): string {
	// Array.from walks code points, so an emoji at the boundary is never cut in half.
	const chars = Array.from(value);
	return chars.length <= max ? value : chars.slice(0, max).join("");
}

// A title is a single line: every kind of whitespace run collapses to one space.
export function cleanTitle(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = clampCodePoints(
		value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim(),
		MAX_TITLE_LENGTH,
	).trim();
	return text || undefined;
}

// A description keeps its line breaks (at most one blank line in a row) but
// is otherwise normalised the same way.
export function cleanDescription(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const text = clampCodePoints(
		value
			.replace(/\r\n?/g, "\n")
			.replace(INVISIBLE, "")
			.replace(/[^\S\n]+/g, " ")
			.replace(/ ?\n ?/g, "\n")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
		MAX_DESCRIPTION_LENGTH,
	).trim();
	return text || undefined;
}

// What a visitor sees when the owner did not choose a title.
export function defaultPortfolioTitle(label: string | undefined): string {
	const name = label?.trim();
	return name ? `Portfolio for ${name}` : "Portfolio";
}

// The ordered list of share ids from a request body. Order is the whole point
// of the field, so duplicates keep their first position rather than being
// sorted away. Returns an error string instead of silently truncating: a
// request over the cap is a client bug the owner should see.
export function parseShareIds(
	value: unknown,
): { ids: string[] } | { error: string } {
	if (!Array.isArray(value)) return { error: "Invalid repository list" };
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const item of value) {
		if (
			typeof item !== "string" ||
			!item ||
			item.length > MAX_SHARE_ID_LENGTH
		) {
			return { error: "Invalid repository list" };
		}
		if (seen.has(item)) continue;
		seen.add(item);
		ids.push(item);
	}
	if (ids.length === 0) {
		return { error: "Add at least one repository" };
	}
	if (ids.length > MAX_PORTFOLIO_REPOS) {
		return {
			error: `A portfolio can hold at most ${MAX_PORTFOLIO_REPOS} repositories`,
		};
	}
	return { ids };
}

// Returns a new array with the item at `from` moved to `to`. Out-of-range
// indexes return the list unchanged, so callers never have to bounds-check.
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
	const next = [...list];
	if (
		from === to ||
		from < 0 ||
		to < 0 ||
		from >= next.length ||
		to >= next.length
	) {
		return next;
	}
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}

// Where the public portfolio page lives. A query parameter rather than a path
// segment on purpose: any /{a}/{b} path is a repository link handled by the
// catch-all route, so a path-based portfolio URL could be shadowed by (or
// shadow) a real owner/repo.
export function portfolioPath(id: string): string {
	return `/portfolio?p=${encodeURIComponent(id)}`;
}

// Ten years. Generous, but a ceiling: a typo such as 99999999 must not quietly
// become "effectively never".
export const MAX_PORTFOLIO_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;

// The revoke window, in seconds from now. null is an explicit "never". Anything
// else that is not a sensible positive number is an ERROR rather than "never":
// this setting exists to take access away, so a malformed value must not
// silently grant it forever.
export function parsePortfolioTtl(
	value: unknown,
): { ttl: number | null } | { error: string } {
	if (value === null) return { ttl: null };
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return { error: "Invalid revoke date" };
	}
	const seconds = Math.floor(value);
	if (seconds < 1) return { error: "The revoke date must be in the future" };
	if (seconds > MAX_PORTFOLIO_TTL_SECONDS) {
		return { error: "The revoke date is too far away" };
	}
	return { ttl: seconds };
}

// Per-repository options. Each is a tri-state on purpose: undefined means "do
// not touch what is already set", false means "turn it off".
export interface ItemOptions {
	showReleases?: boolean;
	allowDownload?: boolean;
	showBranches?: boolean;
}

// One entry of a portfolio's ordered list: either a repository that already
// has a share link, or one that does not yet and must get one.
export type PortfolioItemInput = ItemOptions &
	({ shareId: string } | { owner: string; repo: string });

export function isNewItem(
	item: PortfolioItemInput,
): item is ItemOptions & { owner: string; repo: string } {
	return "repo" in item;
}

const MAX_NAME_LENGTH = 200;

const bool = (v: unknown): boolean | undefined =>
	typeof v === "boolean" ? v : undefined;

// The ordered item list from a request body. Order is the point, so duplicates
// keep their first position. A list over the cap is refused, not truncated.
export function parseItems(
	value: unknown,
): { items: PortfolioItemInput[] } | { error: string } {
	if (!Array.isArray(value)) return { error: "Invalid repository list" };
	const seen = new Set<string>();
	const items: PortfolioItemInput[] = [];
	for (const raw of value) {
		if (typeof raw !== "object" || raw === null) {
			return { error: "Invalid repository list" };
		}
		const r = raw as Record<string, unknown>;
		const options: ItemOptions = {
			showReleases: bool(r.showReleases),
			allowDownload: bool(r.allowDownload),
			showBranches: bool(r.showBranches),
		};
		let key: string;
		let item: PortfolioItemInput;
		if (typeof r.shareId === "string") {
			if (!r.shareId || r.shareId.length > MAX_SHARE_ID_LENGTH) {
				return { error: "Invalid repository list" };
			}
			key = `s:${r.shareId}`;
			item = { shareId: r.shareId, ...options };
		} else if (typeof r.owner === "string" && typeof r.repo === "string") {
			if (
				!r.owner ||
				!r.repo ||
				r.owner.length > MAX_NAME_LENGTH ||
				r.repo.length > MAX_NAME_LENGTH
			) {
				return { error: "Invalid repository list" };
			}
			key = `r:${r.owner}/${r.repo}`.toLowerCase();
			item = { owner: r.owner, repo: r.repo, ...options };
		} else {
			return { error: "Invalid repository list" };
		}
		if (seen.has(key)) continue;
		seen.add(key);
		items.push(item);
	}
	if (items.length === 0) return { error: "Add at least one repository" };
	if (items.length > MAX_PORTFOLIO_REPOS) {
		return {
			error: `A portfolio can hold at most ${MAX_PORTFOLIO_REPOS} repositories`,
		};
	}
	return { items };
}

// Seconds left until a stored expiry, for giving a repository added later the
// same revoke moment as the rest. At least 1: a share with no time left would
// otherwise be created as "never expires".
export function secondsUntil(
	expiresAt: number | undefined,
	now = Date.now(),
): number | null {
	if (!expiresAt) return null;
	return Math.max(1, Math.ceil((expiresAt - now) / 1000));
}

// "YYYY-MM-DD" in the viewer's own time zone, for a date input.
export function dateInputValue(timestamp: number): string {
	const d = new Date(timestamp);
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${mm}-${dd}`;
}

// Seconds from `now` until the END of the chosen day (23:59:59 local time), or
// null for an empty field ("never"). Anything unusable, including a date that
// has already passed, is "invalid" so the editor refuses to send it: JSON turns
// NaN into null, which the server reads as "never".
export function revokeSecondsFromDate(
	value: string,
	now = Date.now(),
): number | null | "invalid" {
	if (!value) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!m) return "invalid";
	const end = new Date(
		Number(m[1]),
		Number(m[2]) - 1,
		Number(m[3]),
		23,
		59,
		59,
	);
	const seconds = Math.ceil((end.getTime() - now) / 1000);
	return Number.isFinite(seconds) && seconds >= 1 ? seconds : "invalid";
}
