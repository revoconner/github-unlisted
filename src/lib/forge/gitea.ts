import { isSafeRepoPath } from "@/lib/repo-path";
import {
	type ApiClient,
	assertSafeRef,
	authHeadersFor,
	collectPages,
	createApiClient,
	encodeSegments,
	type ConnectionForgeId,
	type ForgeContext,
	fileFromBase64,
	hasNextPage,
	isHttpsUrl,
	isNotFound,
	ownerRepoPath,
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

// Gitea, Forgejo, Codeberg and self-hosted instances of either share this adapter: Forgejo keeps Gitea's /api/v1 surface. Endpoints follow the instance's own Swagger (/api/swagger, /swagger.v1.json) and https://forgejo.org/docs/latest/user/api-usage/.

const GITEA_FAMILY_FORGES: readonly ConnectionForgeId[] = ["gitea", "codeberg", "forgejo", "gogs"];

export const GITEA_CAPABILITIES: ForgeCapabilities = {
	releases: true,
	archive: true,
	recursiveTree: true,
	markdownApi: false,
};

const API = "/api/v1";
// Forgejo documents a default maximum of 50 items per page (max_response_items) and lets an instance lower it, so asking for more is pointless and 50 is the safe request.
const LIMIT = 50;
const TREE_PER_PAGE = 1000;
const REPO_PAGES = 3;
const BRANCH_PAGES = 20;

interface GiteaRepo {
	name: string;
	full_name?: string;
	owner?: { login?: string };
	private: boolean;
	default_branch?: string;
	empty?: boolean;
}

interface GiteaContent {
	name: string;
	path: string;
	type: string;
	size?: number;
	content?: string | null;
	encoding?: string | null;
}

interface GiteaTree {
	tree?: { path: string; type: string }[] | null;
	truncated?: boolean;
}

interface GiteaAsset {
	id: number;
	name: string;
	size?: number;
	browser_download_url?: string;
}

interface GiteaRelease {
	id: number;
	tag_name: string;
	name?: string;
	body?: string;
	draft?: boolean;
	prerelease?: boolean;
	published_at?: string | null;
	created_at?: string | null;
	assets?: GiteaAsset[];
}

export function createGiteaAdapter(ctx: ForgeContext): ForgeAdapter {
	if (!GITEA_FAMILY_FORGES.includes(ctx.forge)) {
		throw new Error("Gitea-compatible adapter received an unsupported forge identity");
	}
	// "token <value>" is the documented header form; Bearer is reserved for OAuth2 tokens.
	const api: ApiClient = createApiClient(ctx, authHeadersFor(ctx.forge, ctx.authScheme));
	const repoBase = (owner: string, repo: string) =>
		`${API}/repos/${ownerRepoPath(owner, repo)}`;

	async function releasesRaw(owner: string, repo: string) {
		const { data } = await api.json<GiteaRelease[]>(
			`${repoBase(owner, repo)}/releases`,
			{ draft: false, limit: LIMIT },
		);
		// The server is asked to skip drafts, but the filter is repeated: a draft must never reach a recipient even if an older instance ignores the parameter.
		return data.filter((r) => !r.draft);
	}

	return {
		forge: ctx.forge,
		host: api.host,
		capabilities: GITEA_CAPABILITIES,

		async listRepos() {
			const repos = await collectPages(async (page) => {
				const { data, headers } = await api.json<GiteaRepo[]>(
					`${API}/user/repos`,
					{ limit: LIMIT, page },
				);
				return {
					items: data,
					hasNext: hasNextPage(headers) || data.length >= LIMIT,
				};
			}, REPO_PAGES);
			const out = [];
			for (const r of repos) {
				const owner = r.owner?.login ?? r.full_name?.split("/")[0];
				if (!owner || !r.default_branch || r.empty) continue;
				out.push({
					owner,
					name: r.name,
					fullName: `${owner}/${r.name}`,
					private: r.private,
					defaultBranch: r.default_branch,
					capabilities: GITEA_CAPABILITIES,
				});
			}
			return out;
		},

		async getRepoMeta(owner, repo) {
			const { data } = await api.json<GiteaRepo>(repoBase(owner, repo));
			if (!data.default_branch) {
				throw new ForgeHttpError(404, "Repository is empty or unavailable");
			}
			return {
				fullName: data.full_name ?? `${owner}/${repo}`,
				private: data.private,
				defaultBranch: data.default_branch,
			};
		},

		async listBranches(owner, repo) {
			const branches = await collectPages(async (page) => {
				const { data, headers } = await api.json<{ name: string }[]>(
					`${repoBase(owner, repo)}/branches`,
					{ limit: LIMIT, page },
				);
				return {
					items: data,
					hasNext: hasNextPage(headers) || data.length >= LIMIT,
				};
			}, BRANCH_PAGES);
			return branches.map((b) => b.name);
		},

		// One page of up to 1000 entries; `truncated` is the server's own statement that more pages exist, and no further page is requested. The ref is sent where the API expects a sha: Gitea resolves branch names there. TODO(verify): a slashed branch name is sent percent-encoded as one segment and may not resolve on every version; a failure returns null and the viewer falls back to directory listings.
		async getRepoTree(owner, repo, ref) {
			try {
				assertSafeRef(ref);
				const { data } = await api.json<GiteaTree>(
					`${repoBase(owner, repo)}/git/trees/${encodeURIComponent(ref)}`,
					{ recursive: true, per_page: TREE_PER_PAGE, page: 1 },
				);
				const items: TreeItem[] = [];
				for (const e of data.tree ?? []) {
					if (e.type === "tree") items.push({ path: e.path, type: "dir" });
					else if (e.type === "blob")
						items.push({ path: e.path, type: "file" });
				}
				return { items, truncated: Boolean(data.truncated) };
			} catch {
				return null;
			}
		},

		// The contents endpoint answers for files and directories alike, so the tree/blob hint other forges need has nothing to decide here and there is no fallback request to make. 404 is notfound.
		async getContents(owner, repo, path, ref): Promise<Contents> {
			assertSafeRef(ref);
			if (path !== "" && !isSafeRepoPath(path)) return { kind: "notfound" };
			try {
				const { data } = await api.json<GiteaContent | GiteaContent[]>(
					`${repoBase(owner, repo)}/contents${path ? `/${encodeSegments(path)}` : ""}`,
					{ ref },
				);
				if (Array.isArray(data)) {
					const entries: DirEntry[] = [];
					for (const e of data) {
						if (e.type === "dir") {
							entries.push({ name: e.name, path: e.path, type: "dir" });
						} else if (e.type === "file") {
							entries.push({ name: e.name, path: e.path, type: "file" });
						}
						// Submodules and symlinks have nothing to open.
					}
					return { kind: "dir", entries: sortEntries(entries) };
				}
				if (
					data.type === "file" &&
					typeof data.content === "string" &&
					(data.encoding ?? "base64") === "base64"
				) {
					return fileFromBase64(data.name, data.content, data.size ?? 0);
				}
				return { kind: "notfound" };
			} catch (error) {
				if (isNotFound(error)) return { kind: "notfound" };
				throw error;
			}
		},

		async getRawFile(owner, repo, path, ref) {
			if (!isSafeRepoPath(path)) throw new ForgeHttpError(400);
			assertSafeRef(ref);
			return api.request(
				`${repoBase(owner, repo)}/raw/${encodeSegments(path)}`,
				{ ref },
			);
		},

		async listReleases(owner, repo): Promise<Release[]> {
			return (await releasesRaw(owner, repo)).map((r) => ({
				id: r.id,
				tag: r.tag_name,
				name: r.name?.trim() || r.tag_name,
				body: r.body ?? "",
				prerelease: Boolean(r.prerelease),
				publishedUtc: r.published_at ?? r.created_at ?? null,
				assets: (r.assets ?? []).map((a) => ({
					id: a.id,
					name: a.name,
					size: a.size ?? 0,
					// The API does not report a content type for attachments.
					contentType: "application/octet-stream",
				})),
			}));
		},

		// TODO(verify): the archive name is `{ref}.zip` with slashes kept as path separators; confirmed for simple names, to be checked for slashed branch names on each Gitea/Forgejo major.
		async archiveResponse(owner, repo, ref) {
			assertSafeRef(ref);
			return api.stream(
				`${repoBase(owner, repo)}/archive/${encodeSegments(ref)}.zip`,
			);
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
				return api.stream(
					`${repoBase(owner, repo)}/archive/${encodeSegments(tag)}.zip`,
				);
			}
			if (!Number.isSafeInteger(assetId) || assetId <= 0) {
				throw new ForgeHttpError(400);
			}
			const asset = (await releasesRaw(owner, repo))
				.flatMap((r) => r.assets ?? [])
				.find((a) => a.id === assetId);
			const url = asset?.browser_download_url;
			if (!url || !isHttpsUrl(url)) throw new ForgeHttpError(404);
			// TODO(verify): whether an attachment on a private repository accepts the API token on this web route differs between versions. If it does not, the stream answers 404/401 and the recipient sees "unavailable", never a leaked token.
			if (new URL(url).origin === api.host) return api.streamAbsolute(url);
			return { kind: "redirect", url };
		},
	};
}
