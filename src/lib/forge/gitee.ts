import { isSafeRepoPath } from "@/lib/repo-path";
import {
	type ApiClient,
	assertSafeRef,
	authHeadersFor,
	collectPages,
	createApiClient,
	encodeSegments,
	type ForgeContext,
	fileFromBase64,
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

// Gitee uses its v5 API (https://gitee.com/api/v5/swagger). The Swagger page refuses automated access, so endpoints below are those confirmed from the published operation list; anything that could not be confirmed is marked TODO(verify) and fails closed rather than guessing.

export const GITEE_CAPABILITIES: ForgeCapabilities = {
	releases: true,
	// TODO(verify): no repository archive endpoint could be confirmed, so none is offered. Enabling it is a one-line change here plus archiveResponse below.
	archive: false,
	recursiveTree: true,
	markdownApi: false,
};

const API = "/api/v5";
// per_page is documented with a maximum of 100.
const PER_PAGE = 100;
const REPO_PAGES = 3;

interface GiteeRepo {
	path: string;
	namespace?: { path?: string };
	full_name?: string;
	private?: boolean;
	public?: boolean;
	default_branch?: string | null;
}

interface GiteeContent {
	name: string;
	path: string;
	type: string;
	size?: number;
	content?: string | null;
	encoding?: string | null;
}

interface GiteeAsset {
	id?: number;
	name?: string;
	size?: number;
	browser_download_url?: string;
}

interface GiteeRelease {
	id: number;
	tag_name: string;
	name?: string | null;
	body?: string | null;
	prerelease?: boolean;
	created_at?: string | null;
	assets?: GiteeAsset[];
}

// Assets are not documented to carry an id, so a position-based one stands in when absent. Listing and download both go through this, so an id handed to the page resolves to the same file when it comes back.
function assetsOf(release: GiteeRelease): Required<GiteeAsset>[] {
	return (release.assets ?? [])
		.map((a, i) => ({
			id: a.id ?? release.id * 1000 + i + 1,
			name: a.name ?? a.browser_download_url?.split("/").pop() ?? "asset",
			size: a.size ?? 0,
			browser_download_url: a.browser_download_url ?? "",
		}))
		.filter((a) => a.browser_download_url !== "");
}

export function createGiteeAdapter(ctx: ForgeContext): ForgeAdapter {
	if (ctx.forge !== "gitee") {
		throw new Error("Gitee adapter requires forge 'gitee'");
	}
	// The token goes in a header, never in the `access_token` query string the API also accepts: a URL is logged by proxies and CDNs, a header is not. TODO(verify): Bearer is what third-party documentation reports for v5; if an instance rejects it, connecting fails with a clear 401 instead of silently falling back to the URL form.
	const api: ApiClient = createApiClient(ctx, authHeadersFor("gitee", ctx.authScheme));
	const repoBase = (owner: string, repo: string) =>
		`${API}/repos/${ownerRepoPath(owner, repo)}`;

	async function releasesRaw(owner: string, repo: string) {
		const { data } = await api.json<GiteeRelease[]>(
			`${repoBase(owner, repo)}/releases`,
			{ per_page: 50, direction: "desc" },
		);
		return data;
	}

	async function contentsRaw(
		owner: string,
		repo: string,
		path: string,
		ref: string,
	) {
		return api.json<GiteeContent | GiteeContent[]>(
			`${repoBase(owner, repo)}/contents${path ? `/${encodeSegments(path)}` : ""}`,
			{ ref },
		);
	}

	return {
		forge: "gitee",
		host: api.host,
		capabilities: GITEE_CAPABILITIES,

		async listRepos() {
			const repos = await collectPages(async (page) => {
				const { data } = await api.json<GiteeRepo[]>(`${API}/user/repos`, {
					per_page: PER_PAGE,
					page,
				});
				return { items: data, hasNext: data.length >= PER_PAGE };
			}, REPO_PAGES);
			const out = [];
			for (const r of repos) {
				// TODO(verify): `namespace.path` is the owner's URL path, which is what the URL scheme needs; `full_name` is the fallback.
				const owner = r.namespace?.path ?? r.full_name?.split("/")[0];
				if (!owner || !r.path || !r.default_branch) continue;
				out.push({
					owner,
					name: r.path,
					fullName: `${owner}/${r.path}`,
					private: r.private ?? r.public === false,
					defaultBranch: r.default_branch,
					capabilities: GITEE_CAPABILITIES,
				});
			}
			return out;
		},

		async getRepoMeta(owner, repo) {
			const { data } = await api.json<GiteeRepo>(repoBase(owner, repo));
			if (!data.default_branch) {
				throw new ForgeHttpError(404, "Repository is empty or unavailable");
			}
			return {
				fullName: `${owner}/${data.path ?? repo}`,
				private: data.private ?? data.public === false,
				defaultBranch: data.default_branch,
			};
		},

		// TODO(verify): the branches operation is documented without pagination parameters, so one call is made and its result used as is.
		async listBranches(owner, repo) {
			const { data } = await api.json<{ name: string }[]>(
				`${repoBase(owner, repo)}/branches`,
			);
			return data.map((b) => b.name);
		},

		// TODO(verify): `truncated` in the v5 response is assumed to mirror GitHub's. Without it a large repository returns a partial tree that looks complete, so absence is treated as truncated: the viewer then uses directory listings, which are always correct.
		async getRepoTree(owner, repo, ref) {
			try {
				assertSafeRef(ref);
				const { data } = await api.json<{
					tree?: { path: string; type: string }[] | null;
					truncated?: boolean;
				}>(`${repoBase(owner, repo)}/git/trees/${encodeURIComponent(ref)}`, {
					recursive: 1,
				});
				const items: TreeItem[] = [];
				for (const e of data.tree ?? []) {
					if (e.type === "tree") items.push({ path: e.path, type: "dir" });
					else if (e.type === "blob")
						items.push({ path: e.path, type: "file" });
				}
				return { items, truncated: data.truncated !== false };
			} catch {
				return null;
			}
		},

		// One contents endpoint serves files and directories, so the hint is not needed and there is no fallback request.
		async getContents(owner, repo, path, ref): Promise<Contents> {
			assertSafeRef(ref);
			if (path !== "" && !isSafeRepoPath(path)) return { kind: "notfound" };
			try {
				const { data } = await contentsRaw(owner, repo, path, ref);
				if (Array.isArray(data)) {
					const entries: DirEntry[] = [];
					for (const e of data) {
						if (e.type === "dir") {
							entries.push({ name: e.name, path: e.path, type: "dir" });
						} else if (e.type === "file") {
							entries.push({ name: e.name, path: e.path, type: "file" });
						}
					}
					return { kind: "dir", entries: sortEntries(entries) };
				}
				if (data.type === "file" && typeof data.content === "string") {
					return fileFromBase64(data.name, data.content, data.size ?? 0);
				}
				return { kind: "notfound" };
			} catch (error) {
				if (isNotFound(error)) return { kind: "notfound" };
				throw error;
			}
		},

		// Read through the contents endpoint and decoded, rather than a raw-file endpoint that could not be confirmed. Used for images in a README, which fit comfortably in a contents response. Failures come back as a Response with the upstream status, the same contract the other adapters have.
		async getRawFile(owner, repo, path, ref) {
			if (!isSafeRepoPath(path)) throw new ForgeHttpError(400);
			assertSafeRef(ref);
			try {
				const { data } = await contentsRaw(owner, repo, path, ref);
				if (
					Array.isArray(data) ||
					data.type !== "file" ||
					typeof data.content !== "string"
				) {
					return new Response(null, { status: 404 });
				}
				return new Response(Buffer.from(data.content, "base64"), {
					status: 200,
				});
			} catch (error) {
				if (error instanceof ForgeHttpError) {
					return new Response(null, { status: error.status });
				}
				throw error;
			}
		},

		async listReleases(owner, repo): Promise<Release[]> {
			return (await releasesRaw(owner, repo)).map((r) => ({
				id: r.id,
				tag: r.tag_name,
				name: r.name?.trim() || r.tag_name,
				body: r.body ?? "",
				prerelease: Boolean(r.prerelease),
				publishedUtc: r.created_at ?? null,
				assets: assetsOf(r).map((a) => ({
					id: a.id,
					name: a.name,
					size: a.size,
					contentType: "application/octet-stream",
				})),
			}));
		},

		async archiveResponse(): Promise<ArchiveResponse> {
			// TODO(verify): see GITEE_CAPABILITIES.archive.
			throw new ForgeHttpError(501, "Archive download is not available");
		},

		// Only uploaded assets are offered: a source archive by tag would need the archive endpoint above. The asset URL is handed to the recipient's browser, so the server fetches nothing from an address stored in release data.
		async releaseDownloadResponse(
			owner,
			repo,
			assetId,
		): Promise<ArchiveResponse> {
			if (assetId === undefined) {
				throw new ForgeHttpError(501, "Source archives are not available");
			}
			if (!Number.isSafeInteger(assetId) || assetId <= 0) {
				throw new ForgeHttpError(400);
			}
			const asset = (await releasesRaw(owner, repo))
				.flatMap(assetsOf)
				.find((a) => a.id === assetId);
			if (!asset || !isHttpsUrl(asset.browser_download_url)) {
				throw new ForgeHttpError(404);
			}
			return { kind: "redirect", url: asset.browser_download_url };
		},
	};
}
