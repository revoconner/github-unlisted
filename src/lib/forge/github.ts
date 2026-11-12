import {
	getInstallationOctokit,
	getInstallationToken,
	listInstallationRepos,
} from "@/lib/github-app";
import {
	getContents,
	getRepoMeta,
	getRepoTree,
	listBranches,
	listReleases,
} from "@/lib/github-repo";
import { renderMarkdownGitHub } from "@/lib/markdown-github";
import { isSafeRepoPath } from "@/lib/repo-path";
import {
	type ArchiveResponse,
	type ForgeAdapter,
	type ForgeCapabilities,
	ForgeHttpError,
} from "./types";

// The GitHub adapter is deliberately a thin shell over github-app.ts and github-repo.ts: the Octokit calls, the GitHub App auth and their behaviour are untouched, which is what keeps the existing GitHub flow regression-free. The only logic added here is the handful of raw REST calls that used to live inside routes (raw file, zipball, release asset), so that no GitHub endpoint string remains outside this file.

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "github-unlisted";

export const GITHUB_CAPABILITIES: ForgeCapabilities = {
	releases: true,
	archive: true,
	recursiveTree: true,
	markdownApi: true,
};

function encodeSegments(value: string): string {
	return value.split("/").map(encodeURIComponent).join("/");
}

function repoUrl(owner: string, repo: string): string {
	return `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export function createGitHubAdapter(installationId: number): ForgeAdapter {
	// Built on first use, so constructing the adapter never throws on a missing App configuration: the failure surfaces at the same point it always did, inside the call that needs GitHub.
	let cached: ReturnType<typeof getInstallationOctokit> | undefined;
	const octokit = () => {
		cached ??= getInstallationOctokit(installationId);
		return cached;
	};

	async function githubFetch(
		url: string,
		accept: string,
		init: RequestInit = {},
	): Promise<Response> {
		const token = await getInstallationToken(installationId);
		return fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: accept,
				"X-GitHub-Api-Version": API_VERSION,
				"User-Agent": USER_AGENT,
			},
		});
	}

	// GitHub answers archive and asset requests with a 302 to a signed, short-lived URL that needs no credentials. Forwarding it means no archive byte passes through this deployment and the installation token never leaves the server. Only https is forwarded: this value ends up in a Location header sent to a recipient's browser.
	async function signedRedirect(
		url: string,
		accept: string,
	): Promise<ArchiveResponse> {
		const res = await githubFetch(url, accept, { redirect: "manual" });
		const location = res.headers.get("location");
		if (!location?.startsWith("https://")) {
			throw new ForgeHttpError(res.status);
		}
		return { kind: "redirect", url: location };
	}

	return {
		forge: "github",
		host: "github.com",
		capabilities: GITHUB_CAPABILITIES,

		async listRepos() {
			const repos = await listInstallationRepos(installationId);
			return repos.map((r) => ({ ...r, capabilities: GITHUB_CAPABILITIES }));
		},

		getRepoMeta: (owner, repo) => getRepoMeta(octokit(), owner, repo),

		listBranches: (owner, repo) => listBranches(octokit(), owner, repo),

		getRepoTree: (owner, repo, ref) => getRepoTree(octokit(), owner, repo, ref),

		// GitHub's contents endpoint answers for both files and directories, so the tree/blob hint other forges need is ignored here.
		getContents: (owner, repo, path, ref) =>
			getContents(octokit(), owner, repo, path, ref),

		// Callers receive the raw upstream Response and decide how to map its status; the path is re-validated here as defence in depth, since it is interpolated into a URL.
		async getRawFile(owner, repo, path, ref) {
			if (!isSafeRepoPath(path)) throw new ForgeHttpError(400);
			return githubFetch(
				`${repoUrl(owner, repo)}/contents/${encodeSegments(path)}?ref=${encodeSegments(ref)}`,
				"application/vnd.github.raw+json",
			);
		},

		async getRawAttachment(assetId) {
			if (
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					assetId,
				)
			) {
				throw new ForgeHttpError(400);
			}
			// GitHub resolves this stable URL to the underlying image. For private
			// attachments the authenticated request is important; fetch removes the
			// Authorization header if GitHub redirects to its signed image host.
			return githubFetch(
				`https://github.com/user-attachments/assets/${assetId}`,
				"application/octet-stream",
			);
		},

		listReleases: (owner, repo) => listReleases(octokit(), owner, repo),

		archiveResponse: (owner, repo, ref) =>
			signedRedirect(
				`${repoUrl(owner, repo)}/zipball/${encodeSegments(ref)}`,
				"application/vnd.github+json",
			),

		async releaseDownloadResponse(owner, repo, assetId, tag) {
			if (assetId !== undefined) {
				if (!Number.isSafeInteger(assetId) || assetId <= 0) {
					throw new ForgeHttpError(400);
				}
				return signedRedirect(
					`${repoUrl(owner, repo)}/releases/assets/${assetId}`,
					"application/octet-stream",
				);
			}
			if (!tag) throw new ForgeHttpError(400);
			return signedRedirect(
				`${repoUrl(owner, repo)}/zipball/refs/tags/${encodeSegments(tag)}`,
				"application/vnd.github+json",
			);
		},

		renderMarkdown: (owner, repo, text) =>
			renderMarkdownGitHub(octokit(), owner, repo, text),
	};
}
