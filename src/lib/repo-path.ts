// The views that address a ref and a path. Kept separate from ViewType so buildHref cannot be handed a view that has neither.
export type FileViewType = "tree" | "blob";
export type ViewType = FileViewType | "releases";

export interface ParsedView {
	owner: string;
	repo: string;
	viewType: ViewType;
	ref: string; // empty until resolved to the default branch
	path: string;
}

// URL shape: /{owner}/{repo}[/{tree|blob}/{ref}/{...path}] or /{owner}/{repo}/releases
export function parseView(slug: string[]): ParsedView | null {
	const seg = slug.filter(Boolean);
	if (seg.length < 2) return null;

	const [owner, repo, viewType, ref, ...rest] = seg;
	const isFileView = viewType === "tree" || viewType === "blob";

	return {
		owner,
		repo,
		viewType:
			viewType === "releases"
				? "releases"
				: viewType === "blob"
					? "blob"
					: "tree",
		ref: isFileView ? (ref ?? "") : "",
		path: isFileView ? rest.join("/") : "",
	};
}

export function buildReleasesHref(
	owner: string,
	repo: string,
	shareId: string,
): string {
	return `/${owner}/${repo}/releases?s=${encodeURIComponent(shareId)}`;
}

export interface RefResolution {
	// The ref the viewer should actually read from.
	ref: string;
	// The file path, re-split from the URL once the real ref is known.
	path: string;
	// Set when the URL names a different branch than the share is locked to. The caller must redirect, otherwise the lock is cosmetic and a recipient can browse any branch by editing the URL.
	redirectRef: string | null;
}

// lockedRef is ShareTarget.ref: undefined for every share created before branch locking, which keeps the original behaviour (URL ref wins, repo default as fallback, no redirect).
//
// Branch names may contain slashes ("ft/initialCommit"), which the URL shape cannot distinguish from the file path, so parseView always reports the first segment as the ref. For a locked share the branch is known, so the real ref/path boundary is recovered by matching the locked name against the leading segments. Without this, locking to a slashed branch redirects forever: the URL never looks like the branch it was just sent to.
export function resolveRef(
	lockedRef: string | undefined,
	urlRef: string,
	urlPath: string,
	defaultBranch: string,
): RefResolution {
	if (!lockedRef) {
		return { ref: urlRef || defaultBranch, path: urlPath, redirectRef: null };
	}

	const combined = urlPath ? `${urlRef}/${urlPath}` : urlRef;
	if (!combined || combined === lockedRef) {
		return { ref: lockedRef, path: "", redirectRef: null };
	}
	if (combined.startsWith(`${lockedRef}/`)) {
		return {
			ref: lockedRef,
			path: combined.slice(lockedRef.length + 1),
			redirectRef: null,
		};
	}
	// Some other branch. Keep the path as the URL described it: after the redirect the segments recombine cleanly, so this settles in one hop even when the locked name has slashes.
	return { ref: lockedRef, path: urlPath, redirectRef: lockedRef };
}

// The unlocked counterpart to the recombination inside resolveRef. With no locked branch there is nothing to match against, so a slashed branch name cannot be addressed by URL at all. Given the real branch list the boundary is recoverable: prefer the longest branch that matches the leading segments, so "ft/init" never swallows a URL that is really on "ft/init/deep". Returns null when no branch matches, leaving the caller on its existing fallback.
export function splitRefFromBranches(
	urlRef: string,
	urlPath: string,
	branches: string[],
): { ref: string; path: string } | null {
	const combined = urlPath ? `${urlRef}/${urlPath}` : urlRef;
	if (!combined) return null;

	let best: string | null = null;
	for (const b of branches) {
		if (combined === b || combined.startsWith(`${b}/`)) {
			if (best === null || b.length > best.length) best = b;
		}
	}
	if (best === null) return null;

	return {
		ref: best,
		path: combined === best ? "" : combined.slice(best.length + 1),
	};
}

export function buildHref(
	owner: string,
	repo: string,
	viewType: FileViewType,
	ref: string,
	path: string,
	shareId: string,
): string {
	const base = path
		? `/${owner}/${repo}/${viewType}/${ref}/${path}`
		: `/${owner}/${repo}/${viewType}/${ref}`;
	return `${base}?s=${encodeURIComponent(shareId)}`;
}
