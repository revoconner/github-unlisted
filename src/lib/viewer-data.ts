import type { RenderedRelease } from "@/components/releases-list";
import { adapterForTarget } from "@/lib/forge/target";
import type { Contents, DirEntry, TreeItem } from "@/lib/github-repo";
import { highlight } from "@/lib/highlight";
import { isMarkdown, renderMarkdown } from "@/lib/markdown";
import { rewriteGitHubAttachmentReferences } from "@/lib/repo-asset";
import {
	buildHref,
	parseView,
	resolveRef,
	splitRefFromBranches,
} from "@/lib/repo-path";
import { getSession } from "@/lib/session";
import { resolveShare } from "@/lib/share-store";

// Everything the viewer needs to render, as plain serializable data. Produced
// server-side behind the BotID-protected /api/view endpoint and rendered by the
// ViewerContent client component. Server-only rendering (Shiki, GitHub markdown)
// happens here and travels to the client as HTML strings, exactly as it did when
// the page was fully server-rendered.
export type ViewerPayload =
	| { kind: "notice"; title: string; detail?: string }
	// A redirect the client performs with router.replace (readme open, branch-lock).
	| { kind: "redirect"; href: string }
	| {
			kind: "releases";
			fullName: string;
			refName: string;
			signedIn: boolean;
			owner: string;
			repo: string;
			shareId: string;
			portfolioId?: string;
			releases: RenderedRelease[];
	  }
	| {
			kind: "view";
			fullName: string;
			refName: string;
			signedIn: boolean;
			owner: string;
			repo: string;
			shareId: string;
			portfolioId?: string;
			contents: Contents;
			codeHtml: string | null;
			mdHtml: string | null;
			fullTree: TreeItem[] | null;
			sidebarEntries: DirEntry[];
			crumbs: string[];
			path: string;
			branches: string[] | null;
			showReleases: boolean;
			allowDownload: boolean;
	  };

// Mirrors the old server component ViewPage: same branches, same order, same
// GitHub calls — it just returns data instead of JSX, and returns redirect
// intents instead of throwing Next's redirect().
export async function resolveViewer(
	slug: string[],
	shareId: string,
	appOrigin = "",
): Promise<ViewerPayload> {
	if (!shareId) {
		return {
			kind: "notice",
			title: "A share link is required",
			detail: "Open a link created from the dashboard (it includes ?s=…).",
		};
	}

	const target = await resolveShare(shareId);
	if (!target) {
		return {
			kind: "notice",
			title: "Link invalid or expired",
			detail: "This share link no longer works. Ask the owner for a new one.",
		};
	}
	// Parsed only now: how many leading segments are the repository (GitLab owners nest) is known only from the share record.
	const parsed = parseView(slug, target);
	if (!parsed) {
		return {
			kind: "notice",
			title: "This link does not match this repository",
		};
	}
	// GitHub shares and shares on connected forges are served through the same adapter interface; a connection that is gone or no longer decryptable reads as revoked access.
	const adapter = await adapterForTarget(target);
	const revoked: ViewerPayload = {
		kind: "notice",
		title: "Access revoked",
		detail: "The app no longer has access to this repository.",
	};
	if (!adapter) return revoked;
	let meta: Awaited<ReturnType<typeof adapter.getRepoMeta>>;
	try {
		meta = await adapter.getRepoMeta(target.owner, target.repo);
	} catch {
		return {
			kind: "notice",
			title: "Access revoked",
			detail: "The app no longer has access to this repository.",
		};
	}

	const isReleases = parsed.viewType === "releases";
	const releasesOn =
		target.showReleases === true && adapter.capabilities.releases;
	if (isReleases && !releasesOn) {
		return {
			kind: "notice",
			title: "Releases are not available for this link",
			detail: "The owner has not turned on the releases view for this share.",
		};
	}

	// Only for an unlocked share whose owner opted in. A locked share must never enumerate branches, which is the point of locking. The releases view addresses no ref, so it never shows the switcher.
	const switcherOn = !isReleases && !target.ref && target.showBranches === true;
	const branches = switcherOn
		? await adapter.listBranches(target.owner, target.repo)
		: null;

	// A locked share pins one branch. Redirect (rather than error) so deep links that predate the lock, or point at another branch, still land somewhere useful. path is re-split here because a slashed branch name occupies more than one URL segment.
	const resolved = resolveRef(
		target.ref,
		parsed.ref,
		parsed.path,
		meta.defaultBranch,
	);
	const { redirectRef } = resolved;
	let { ref, path } = resolved;

	// With the real branch list in hand, an unlocked share can address a slashed branch too, which is otherwise impossible because parseView can only treat the first segment as the ref.
	if (branches) {
		const split = splitRefFromBranches(parsed.ref, parsed.path, branches);
		if (split) {
			ref = split.ref;
			path = split.path;
		}
	}
	// The releases view addresses no ref, so it is never the target of a lock redirect. Checking the view type here (rather than isReleases) also narrows it to the file views buildHref accepts.
	if (redirectRef && parsed.viewType !== "releases") {
		return {
			kind: "redirect",
			href: buildHref(
				target.owner,
				target.repo,
				parsed.viewType,
				redirectRef,
				path,
				shareId,
			),
		};
	}

	// Owner viewing their own share is signed in; recipients are not. Drives whether the Dashboard nav item appears.
	const session = await getSession();
	const signedIn = Boolean(session);

	if (isReleases) {
		// Release notes go through markdown-it (html:false) rather than GitHub's renderer: one API call per release would be dozens per page, and the notes do not need issue/@user linking to read correctly.
		const releases: RenderedRelease[] = (
			await adapter.listReleases(target.owner, target.repo)
		).map((r) => ({
			...r,
			bodyHtml: r.body.trim() ? renderMarkdown(r.body) : null,
		}));

		return {
			kind: "releases",
			fullName: meta.fullName,
			refName: ref,
			signedIn,
			owner: target.owner,
			repo: target.repo,
			shareId,
			portfolioId: target.portfolioId,
			releases,
		};
	}

	const contents = await adapter.getContents(
		target.owner,
		target.repo,
		path,
		ref,
		parsed.viewType === "blob" ? "blob" : "tree",
	);

	// The bare repo link opens the README as a file (not a directory listing).
	if (contents.kind === "dir" && path === "") {
		const readme = contents.entries.find(
			(e) =>
				e.type === "file" && /^readme\./i.test(e.name) && isMarkdown(e.name),
		);
		if (readme) {
			return {
				kind: "redirect",
				href: buildHref(
					target.owner,
					target.repo,
					"blob",
					ref,
					readme.path,
					shareId,
				),
			};
		}
	}

	const crumbs = path ? path.split("/") : [];

	// Whole-repo tree for the sidebar (one recursive call). Falls back to the
	// current directory's listing if the ref can't be read or the tree is too
	// large for the API to return in full.
	const tree = await adapter.getRepoTree(target.owner, target.repo, ref);
	const fullTree =
		tree && !tree.truncated && tree.items.length > 0 ? tree.items : null;

	// A file view shows its containing folder in the sidebar so navigation
	// stays usable instead of an empty tree.
	let sidebarEntries: DirEntry[] = [];
	if (contents.kind === "dir") {
		sidebarEntries = contents.entries;
	} else if (contents.kind === "file") {
		const parentPath = path.includes("/")
			? path.slice(0, path.lastIndexOf("/"))
			: "";
		const parent = await adapter.getContents(
			target.owner,
			target.repo,
			parentPath,
			ref,
			"tree",
		);
		if (parent.kind === "dir") sidebarEntries = parent.entries;
	}

	let codeHtml: string | null = null;
	let mdHtml: string | null = null;
	if (contents.kind === "file" && !contents.isBinary && contents.text) {
		// Every text file gets highlighted source. A markdown file gets the
		// rendered preview AS WELL, so the client can offer Preview/Code tabs
		// (preview is the default; both present = show the tabs).
		codeHtml = await highlight(contents.text, contents.name);
		if (isMarkdown(contents.name)) {
			// Rewrite GitHub attachment URLs to this app's share-scoped endpoint.
			// IMPORTANT: do not send this rewritten Markdown to GitHub's Markdown API.
			// GitHub tries to proxy image URLs while rendering and may reject our own
			// endpoint with "Cannot proxy the given URL". Markdown containing these
			// attachments is therefore rendered locally; all other files retain
			// GitHub's renderer and its GFM-specific features.
			const markdownForPreview =
				adapter.forge === "github"
					? rewriteGitHubAttachmentReferences(
						contents.text,
						{ owner: target.owner, repo: target.repo, ref, filePath: path },
						shareId,
						appOrigin,
					)
					: contents.text;

			if (markdownForPreview !== contents.text) {
				// The local renderer preserves a restricted, sanitized set of <img>
				// attributes and therefore accepts the internal attachment endpoint
				// without exposing that URL to GitHub's image proxy.
				mdHtml = renderMarkdown(markdownForPreview);
			} else {
				// Only GitHub has a Markdown API; all other forges use markdown-it.
				// The local fallback allows sanitized <img> tags, not arbitrary HTML.
				mdHtml =
					(await adapter.renderMarkdown?.(
						target.owner,
						target.repo,
						contents.text,
					)) ?? renderMarkdown(contents.text);
			}
		}
	}

	return {
		kind: "view",
		fullName: meta.fullName,
		refName: ref,
		signedIn,
		owner: target.owner,
		repo: target.repo,
		shareId,
		portfolioId: target.portfolioId,
		contents,
		codeHtml,
		mdHtml,
		fullTree,
		sidebarEntries,
		crumbs,
		path,
		branches,
		showReleases: releasesOn,
		allowDownload:
			Boolean(target.allowDownload) && adapter.capabilities.archive,
	};
}
