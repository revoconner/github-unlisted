import { isSafeRepoPath } from "@/lib/repo-path";
import {
	type ApiClient,
	assertSafeRef,
	authHeadersFor,
	collectPages,
	createApiClient,
	type ForgeContext,
	fileFromBase64,
	gitlabProjectId,
	hasNextPage,
	isHttpsUrl,
	isNotFound,
	sortEntries,
} from "./api";
import {
	type ArchiveResponse,
	type Contents,
	type DirEntry,
	type ForgeAdapter,
	type ForgeCapabilities,
	ForgeHttpError,
	type Release,
	type TreeItem,
} from "./types";

// GitLab.com and self-managed share one adapter: the REST API v4 is the same, only the host differs. Endpoints follow https://docs.gitlab.com/api/ (repositories, repository_files, releases, projects).

export const GITLAB_CAPABILITIES: ForgeCapabilities = {
	releases: true,
	archive: true,
	recursiveTree: true,
	// GitLab's /markdown API renders GitLab-flavoured markdown, but the product only uses GitHub's. Everything else falls back to the local renderer.
	markdownApi: false,
};

const API = "/api/v4";
const PER_PAGE = 100;
const RELEASE_LIMIT = 50;
// Bounds for convenience listings. 3 x 100 repositories is more than a dashboard needs, and 10 x 100 branches covers any realistic repository.
const REPO_PAGES = 3;
const BRANCH_PAGES = 10;
const DIR_PAGES = 5;

interface GitLabProject {
	path_with_namespace?: string;
	default_branch?: string | null;
	visibility?: string;
}

interface GitLabTreeItem {
	name: string;
	path: string;
	type: string;
}

interface GitLabFile {
	file_name: string;
	size: number;
	content?: string;
	encoding?: string;
}

interface GitLabLink {
	id: number;
	name: string;
	url: string;
	direct_asset_url?: string;
}

interface GitLabRelease {
	tag_name: string;
	name?: string | null;
	description?: string | null;
	released_at?: string | null;
	upcoming_release?: boolean;
	assets?: { links?: GitLabLink[] };
}

// A project path split back into the owner and repo this product keys shares on. The owner keeps its slashes ("group/sub"), which is why shares store it whole.
function splitPath(full: string): { owner: string; repo: string } | null {
	const i = full.lastIndexOf("/");
	if (i <= 0 || i === full.length - 1) return null;
	return { owner: full.slice(0, i), repo: full.slice(i + 1) };
}

export function createGitLabAdapter(ctx: ForgeContext): ForgeAdapter {
	if (ctx.forge !== "gitlab") {
		throw new Error("GitLab adapter requires forge 'gitlab'");
	}
	// PRIVATE-TOKEN is accepted for personal, project and group access tokens. The guarded fetch strips it before following any cross-origin redirect.
	const api: ApiClient = createApiClient(ctx, authHeadersFor("gitlab", ctx.authScheme));
	const project = (owner: string, repo: string) =>
		`${API}/projects/${gitlabProjectId(owner, repo)}`;

	async function releasesRaw(owner: string, repo: string) {
		const { data } = await api.json<GitLabRelease[]>(
			`${project(owner, repo)}/releases`,
			{ per_page: RELEASE_LIMIT },
		);
		return data;
	}

	async function readTree(
		owner: string,
		repo: string,
		path: string,
		ref: string,
	): Promise<Contents | null> {
		if (path !== "" && !isSafeRepoPath(path)) return null;
		try {
			const items = await collectPages(async (page) => {
				const { data, headers } = await api.json<GitLabTreeItem[]>(
					`${project(owner, repo)}/repository/tree`,
					{ ref, path: path || undefined, per_page: PER_PAGE, page },
				);
				return { items: data, hasNext: hasNextPage(headers) };
			}, DIR_PAGES);
			// A path that is a file can answer an empty list instead of a 404 on some versions. Under the root that is a genuinely empty repository, anywhere else it means "not a directory".
			if (items.length === 0 && path !== "") return null;
			const entries: DirEntry[] = [];
			for (const e of items) {
				if (e.type === "tree") {
					entries.push({ name: e.name, path: e.path, type: "dir" });
				} else if (e.type === "blob") {
					entries.push({ name: e.name, path: e.path, type: "file" });
				}
				// "commit" entries are submodules, which have nothing to browse.
			}
			return { kind: "dir", entries: sortEntries(entries) };
		} catch (error) {
			if (isNotFound(error)) return null;
			throw error;
		}
	}

	async function readBlob(
		owner: string,
		repo: string,
		path: string,
		ref: string,
	): Promise<Contents | null> {
		if (!isSafeRepoPath(path)) return null;
		try {
			const { data } = await api.json<GitLabFile>(
				`${project(owner, repo)}/repository/files/${encodeURIComponent(path)}`,
				{ ref },
			);
			if (typeof data.content !== "string" || data.encoding !== "base64") {
				return null;
			}
			return fileFromBase64(data.file_name, data.content, data.size);
		} catch (error) {
			if (isNotFound(error)) return null;
			throw error;
		}
	}

	return {
		forge: "gitlab",
		host: api.host,
		capabilities: GITLAB_CAPABILITIES,

		async listRepos() {
			const projects = await collectPages(async (page) => {
				const { data, headers } = await api.json<GitLabProject[]>(
					`${API}/projects`,
					{
						membership: true,
						archived: false,
						order_by: "last_activity_at",
						per_page: PER_PAGE,
						page,
					},
				);
				return { items: data, hasNext: hasNextPage(headers) };
			}, REPO_PAGES);
			const out = [];
			for (const p of projects) {
				const parts = p.path_with_namespace
					? splitPath(p.path_with_namespace)
					: null;
				// An empty repository has no default branch and nothing to share.
				if (!parts || !p.default_branch) continue;
				out.push({
					owner: parts.owner,
					name: parts.repo,
					fullName: p.path_with_namespace as string,
					private: p.visibility !== "public",
					defaultBranch: p.default_branch,
					capabilities: GITLAB_CAPABILITIES,
				});
			}
			return out;
		},

		async getRepoMeta(owner, repo) {
			const { data } = await api.json<GitLabProject>(project(owner, repo));
			if (!data.path_with_namespace || !data.default_branch) {
				throw new ForgeHttpError(404, "Repository is empty or unavailable");
			}
			return {
				fullName: data.path_with_namespace,
				private: data.visibility !== "public",
				defaultBranch: data.default_branch,
			};
		},

		async listBranches(owner, repo) {
			const branches = await collectPages(async (page) => {
				const { data, headers } = await api.json<{ name: string }[]>(
					`${project(owner, repo)}/repository/branches`,
					{ per_page: PER_PAGE, page },
				);
				return { items: data, hasNext: hasNextPage(headers) };
			}, BRANCH_PAGES);
			return branches.map((b) => b.name);
		},

		// One page only, by design. A repository bigger than a page reports truncated:true and the viewer falls back to per-directory listings, which is cheaper than walking a recursive tree page by page on an instance we do not control.
		async getRepoTree(owner, repo, ref) {
			try {
				assertSafeRef(ref);
				const { data, headers } = await api.json<GitLabTreeItem[]>(
					`${project(owner, repo)}/repository/tree`,
					{ ref, recursive: true, per_page: PER_PAGE },
				);
				const items: TreeItem[] = [];
				for (const e of data) {
					if (e.type === "tree") items.push({ path: e.path, type: "dir" });
					else if (e.type === "blob")
						items.push({ path: e.path, type: "file" });
				}
				return { items, truncated: hasNextPage(headers) };
			} catch {
				return null;
			}
		},

		// GitLab has separate endpoints for directories and files, so the caller's hint picks which to try first. A 404 on it falls back to the other exactly once; 404 on both is notfound. The root is always a directory, so it never tries a file.
		async getContents(owner, repo, path, ref, hint) {
			assertSafeRef(ref);
			const first = hint ?? (path === "" ? "tree" : "blob");
			const order =
				path === ""
					? [readTree]
					: first === "tree"
						? [readTree, readBlob]
						: [readBlob, readTree];
			for (const read of order) {
				const found = await read(owner, repo, path, ref);
				if (found) return found;
			}
			return { kind: "notfound" };
		},

		async getRawFile(owner, repo, path, ref) {
			if (!isSafeRepoPath(path)) throw new ForgeHttpError(400);
			assertSafeRef(ref);
			return api.request(
				`${project(owner, repo)}/repository/files/${encodeURIComponent(path)}/raw`,
				{ ref },
			);
		},

		// GitLab releases are never drafts, and have no numeric id of their own, so the position in the list stands in. Upcoming releases are flagged as prereleases.
		async listReleases(owner, repo): Promise<Release[]> {
			const releases = await releasesRaw(owner, repo);
			return releases.map((r, i) => ({
				id: i + 1,
				tag: r.tag_name,
				name: r.name?.trim() || r.tag_name,
				body: r.description ?? "",
				prerelease: Boolean(r.upcoming_release),
				publishedUtc: r.released_at ?? null,
				assets: (r.assets?.links ?? []).map((l) => ({
					id: l.id,
					name: l.name,
					// Release assets on GitLab are links, not uploaded files, so no size is known.
					size: 0,
					contentType: "application/octet-stream",
				})),
			}));
		},

		// The token stays on the server and the body is streamed, never buffered. TODO(verify): `sha` is documented as a commit SHA, but GitLab has accepted branch and tag names there for years; the viewer validates the ref against the real branch list first, so a wrong guess fails as a 404, not as a wrong archive.
		async archiveResponse(owner, repo, ref) {
			assertSafeRef(ref);
			return api.stream(`${project(owner, repo)}/repository/archive.zip`, {
				sha: ref,
			});
		},

		async releaseDownloadResponse(
			owner,
			repo,
			assetId,
			tag,
		): Promise<ArchiveResponse> {
			if (assetId === undefined) {
				if (!tag) throw new ForgeHttpError(400);
				assertSafeRef(tag);
				return api.stream(`${project(owner, repo)}/repository/archive.zip`, {
					sha: tag,
				});
			}
			if (!Number.isSafeInteger(assetId) || assetId <= 0) {
				throw new ForgeHttpError(400);
			}
			const link = (await releasesRaw(owner, repo))
				.flatMap((r) => r.assets?.links ?? [])
				.find((l) => l.id === assetId);
			const url = link?.direct_asset_url || link?.url;
			if (!url || !isHttpsUrl(url)) throw new ForgeHttpError(404);
			// A link on this instance needs the token, so the server streams it. A link anywhere else is an arbitrary third-party URL: it is handed to the recipient's browser instead of fetched here, so the server never makes a request to an address a project maintainer typed.
			if (new URL(url).origin === api.host) return api.streamAbsolute(url);
			return { kind: "redirect", url };
		},
	};
}
