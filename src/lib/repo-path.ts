export type ViewType = "tree" | "blob";

export interface ParsedView {
	owner: string;
	repo: string;
	viewType: ViewType;
	ref: string; // empty until resolved to the default branch
	path: string;
}

// URL shape: /{owner}/{repo}[/{tree|blob}/{ref}/{...path}]
export function parseView(slug: string[]): ParsedView | null {
	const seg = slug.filter(Boolean);
	if (seg.length < 2) return null;

	const [owner, repo, viewType, ref, ...rest] = seg;
	const isView = viewType === "tree" || viewType === "blob";

	return {
		owner,
		repo,
		viewType: viewType === "blob" ? "blob" : "tree",
		ref: isView ? (ref ?? "") : "",
		path: isView ? rest.join("/") : "",
	};
}

export function buildHref(
	owner: string,
	repo: string,
	viewType: ViewType,
	ref: string,
	path: string,
	shareId: string,
): string {
	const base = path
		? `/${owner}/${repo}/${viewType}/${ref}/${path}`
		: `/${owner}/${repo}/${viewType}/${ref}`;
	return `${base}?s=${encodeURIComponent(shareId)}`;
}
