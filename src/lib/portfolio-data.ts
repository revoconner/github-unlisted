import { adapterForTarget } from "@/lib/forge/target";
import type { ForgeAdapter } from "@/lib/forge/types";
import { isMarkdown, renderMarkdown } from "@/lib/markdown";
import { defaultPortfolioTitle } from "@/lib/portfolio";
import { portfolioImagePath } from "@/lib/portfolio-image";
import {
	getPortfolio,
	type Portfolio,
	shareBelongsToOwner,
} from "@/lib/portfolio-store";
import { resolveShare, type ShareTarget } from "@/lib/share-store";

// Everything the public portfolio page renders, as plain serialisable data.
// Produced behind the BotID-protected /api/portfolio/view endpoint, exactly
// like ViewerPayload is for /api/view.

export interface PortfolioCard {
	shareId: string;
	owner: string;
	repo: string;
	fullName: string;
	// The branch the preview was read from: the share's locked branch, else the
	// repository default.
	refName: string;
	// When the owner created the repository's link, if the record knows.
	publishedAt: number | null;
	// Where the card leads: the repository's own share viewer.
	href: string;
	preview: {
		html: string;
		// Repository path of the README, needed to resolve its relative images.
		path: string;
		truncated: boolean;
	} | null;
}

export type PortfolioPayload =
	| { kind: "notice"; title: string; detail?: string }
	| {
			kind: "portfolio";
			title: string;
			description: string | null;
			// The owner's own picture, if they set one; null shows the default icon.
			imageUrl: string | null;
			cards: PortfolioCard[];
	  };

// The preview is a teaser, not the README: this bounds both the JSON that
// travels to the visitor and the time spent rendering up to
// MAX_PORTFOLIO_REPOS of them per visit.
export const PREVIEW_MAX_CHARS = 12_000;

// Cuts at a line boundary when one is reasonably close, so the preview does
// not end mid-sentence or mid-table-row. An unclosed code fence is harmless:
// markdown-it closes it at the end of input.
export function truncatePreview(
	text: string,
	max = PREVIEW_MAX_CHARS,
): { text: string; truncated: boolean } {
	if (text.length <= max) return { text, truncated: false };
	let cut = text.slice(0, max);
	const lastBreak = cut.lastIndexOf("\n");
	if (lastBreak > max / 2) {
		cut = cut.slice(0, lastBreak);
	} else {
		// No usable line break: at least do not strand half of a surrogate pair.
		const last = cut.charCodeAt(cut.length - 1);
		if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
	}
	return { text: cut, truncated: true };
}

const README_NAME = /^readme\./i;

// Same rule the repository viewer uses to decide what the bare repo link opens.
// Never throws: a README that cannot be read costs the card its preview, not
// the whole page.
async function loadPreview(
	adapter: ForgeAdapter,
	target: ShareTarget,
	ref: string,
): Promise<PortfolioCard["preview"]> {
	try {
		const root = await adapter.getContents(
			target.owner,
			target.repo,
			"",
			ref,
			"tree",
		);
		if (root.kind !== "dir") return null;
		const readme = root.entries.find(
			(e) =>
				e.type === "file" && README_NAME.test(e.name) && isMarkdown(e.name),
		);
		if (!readme) return null;

		const file = await adapter.getContents(
			target.owner,
			target.repo,
			readme.path,
			ref,
			"blob",
		);
		if (file.kind !== "file" || file.isBinary || !file.text) return null;

		const { text, truncated } = truncatePreview(file.text);
		// The local renderer, not the forge's Markdown API: that is one rate-limited
		// call per repository per visit, and anonymous visitors would be spending
		// the owner's quota. Relative and attachment images are repaired
		// client-side, as in the full viewer.
		return { html: renderMarkdown(text), path: readme.path, truncated };
	} catch {
		return null;
	}
}

async function buildCard(
	portfolio: Portfolio,
	shareId: string,
	getAdapter: (target: ShareTarget) => Promise<ForgeAdapter | null>,
): Promise<PortfolioCard | null> {
	const target = await resolveShare(shareId);
	// Expired, revoked, or not this account's: the card simply is not there.
	if (!target || !shareBelongsToOwner(portfolio, target)) return null;

	const adapter = await getAdapter(target);
	if (!adapter) return null;

	let meta: Awaited<ReturnType<ForgeAdapter["getRepoMeta"]>>;
	try {
		meta = await adapter.getRepoMeta(target.owner, target.repo);
	} catch {
		// The app lost access to this repository. Same outcome as a revoked share.
		return null;
	}

	const refName = target.ref ?? meta.defaultBranch;
	return {
		shareId,
		owner: target.owner,
		repo: target.repo,
		fullName: meta.fullName,
		refName,
		publishedAt: target.createdAt ?? null,
		href: `/${target.owner}/${target.repo}?s=${encodeURIComponent(shareId)}`,
		preview: await loadPreview(adapter, target, refName),
	};
}

export async function resolvePortfolioView(
	id: string,
): Promise<PortfolioPayload> {
	if (!id || id.length > 64) {
		return {
			kind: "notice",
			title: "A portfolio link is required",
			detail:
				"Open a portfolio link created from the dashboard (it includes ?p=…).",
		};
	}

	const portfolio = await getPortfolio(id);
	if (!portfolio) {
		return {
			kind: "notice",
			title: "Link invalid or expired",
			detail:
				"This portfolio link no longer works. Ask the owner for a new one.",
		};
	}

	// Every share in a portfolio belongs to one account, so one adapter serves
	// them all, and sharing it lets the GitHub installation token be reused
	// across the parallel reads below.
	let adapterPromise: Promise<ForgeAdapter | null> | null = null;
	const getAdapter = (target: ShareTarget) => {
		adapterPromise ??= adapterForTarget(target);
		return adapterPromise;
	};

	// Promise.all keeps the owner's chosen order regardless of which read
	// finishes first.
	const settled = await Promise.all(
		portfolio.shareIds.map((shareId) =>
			buildCard(portfolio, shareId, getAdapter).catch(() => null),
		),
	);
	const cards = settled.filter((c): c is PortfolioCard => c !== null);

	if (cards.length === 0) {
		return {
			kind: "notice",
			title: "Nothing to show",
			detail:
				"None of the repositories in this portfolio are available right now.",
		};
	}

	return {
		kind: "portfolio",
		title: portfolio.title ?? defaultPortfolioTitle(portfolio.label),
		description: portfolio.description ?? null,
		imageUrl: portfolio.imageVersion
			? portfolioImagePath(id, portfolio.imageVersion)
			: null,
		cards,
	};
}
