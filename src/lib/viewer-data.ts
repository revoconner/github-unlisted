import type { RenderedRelease } from "@/components/releases-list";
import { getInstallationOctokit } from "@/lib/github-app";
import {
	type Contents,
	type DirEntry,
	getContents,
	getRepoMeta,
	getRepoTree,
	listBranches,
	listReleases,
	type TreeItem,
} from "@/lib/github-repo";
import { highlight } from "@/lib/highlight";
import { isMarkdown, renderMarkdown } from "@/lib/markdown";
import { renderMarkdownGitHub } from "@/lib/markdown-github";
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
): Promise<ViewerPayload> {
	const parsed = parseView(slug);
	if (!parsed) return { kind: "notice", title: "Not found" };

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
	if (target.owner !== parsed.owner || target.repo !== parsed.repo) {
		return {
			kind: "notice",
			title: "This link does not match this repository",
		};
	}

	const octokit = getInstallationOctokit(target.installationId);
	let meta: Awaited<ReturnType<typeof getRepoMeta>>;
	try {
		meta = await getRepoMeta(octokit, target.owner, target.repo);
	} catch {
		return {
			kind: "notice",
			title: "Access revoked",
			detail: "The app no longer has access to this repository.",
		};
	}

	const isReleases = parsed.viewType === "releases";
	if (isReleases && target.showReleases !== true) {
		return {
			kind: "notice",
			title: "Releases are not available for this link",
			detail: "The owner has not turned on the releases view for this share.",
		};
	}

	// Only for an unlocked share whose owner opted in. A locked share must never enumerate branches, which is the point of locking. The releases view addresses no ref, so it never shows the switcher.
	const switcherOn = !isReleases && !target.ref && target.showBranches === true;
	const branches = switcherOn
		? await listBranches(octokit, target.owner, target.repo)
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
			await listReleases(octokit, target.owner, target.repo)
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
			releases,
		};
	}

	const contents = await getContents(
		octokit,
		target.owner,
		target.repo,
		path,
		ref,
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
	const tree = await getRepoTree(octokit, target.owner, target.repo, ref);
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
		const parent = await getContents(
			octokit,
			target.owner,
			target.repo,
			parentPath,
			ref,
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
			mdHtml =
				(await renderMarkdownGitHub(
					octokit,
					target.owner,
					target.repo,
					contents.text,
				)) ?? renderMarkdown(contents.text);
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
		contents,
		codeHtml,
		mdHtml,
		fullTree,
		sidebarEntries,
		crumbs,
		path,
		branches,
		showReleases: Boolean(target.showReleases),
		allowDownload: Boolean(target.allowDownload),
	};
}
