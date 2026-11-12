// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	octokit: { sentinel: true },
	getInstallationOctokit: vi.fn(),
	getInstallationToken: vi.fn(),
	listInstallationRepos: vi.fn(),
	getContents: vi.fn(),
	getRepoMeta: vi.fn(),
	getRepoTree: vi.fn(),
	listBranches: vi.fn(),
	listReleases: vi.fn(),
	renderMarkdownGitHub: vi.fn(),
}));

vi.mock("@/lib/github-app", () => ({
	getInstallationOctokit: m.getInstallationOctokit,
	getInstallationToken: m.getInstallationToken,
	listInstallationRepos: m.listInstallationRepos,
}));
vi.mock("@/lib/github-repo", () => ({
	getContents: m.getContents,
	getRepoMeta: m.getRepoMeta,
	getRepoTree: m.getRepoTree,
	listBranches: m.listBranches,
	listReleases: m.listReleases,
}));
vi.mock("@/lib/markdown-github", () => ({
	renderMarkdownGitHub: m.renderMarkdownGitHub,
}));

import { createGitHubAdapter, GITHUB_CAPABILITIES } from "./github";
import { ForgeHttpError } from "./types";

const fetchMock = vi.fn();

function redirect(location: string | null, status = 302): Response {
	return new Response(null, {
		status,
		headers: location ? { location } : {},
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	m.getInstallationOctokit.mockReturnValue(m.octokit);
	m.getInstallationToken.mockResolvedValue("inst-token");
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset();
});

describe("identity and capabilities", () => {
	it("describes GitHub", () => {
		const a = createGitHubAdapter(5);
		expect(a.forge).toBe("github");
		expect(a.host).toBe("github.com");
		expect(a.capabilities).toEqual({
			releases: true,
			archive: true,
			recursiveTree: true,
			markdownApi: true,
		});
		expect(a.capabilities).toBe(GITHUB_CAPABILITIES);
	});

	it("does not touch the GitHub App until a call needs it", () => {
		createGitHubAdapter(5);
		expect(m.getInstallationOctokit).not.toHaveBeenCalled();
	});
});

describe("delegation to the existing helpers", () => {
	it("passes the installation Octokit and arguments through unchanged", async () => {
		const a = createGitHubAdapter(5);
		m.getRepoMeta.mockResolvedValue({ fullName: "o/r" });
		m.listBranches.mockResolvedValue(["main"]);
		m.getRepoTree.mockResolvedValue({ items: [], truncated: false });
		m.listReleases.mockResolvedValue([]);

		await a.getRepoMeta("o", "r");
		await a.listBranches("o", "r");
		await a.getRepoTree("o", "r", "main");
		await a.listReleases("o", "r");

		expect(m.getInstallationOctokit).toHaveBeenCalledWith(5);
		expect(m.getInstallationOctokit).toHaveBeenCalledTimes(1); // cached
		expect(m.getRepoMeta).toHaveBeenCalledWith(m.octokit, "o", "r");
		expect(m.listBranches).toHaveBeenCalledWith(m.octokit, "o", "r");
		expect(m.getRepoTree).toHaveBeenCalledWith(m.octokit, "o", "r", "main");
		expect(m.listReleases).toHaveBeenCalledWith(m.octokit, "o", "r");
	});

	it("getContents ignores the tree/blob hint", async () => {
		const a = createGitHubAdapter(5);
		m.getContents.mockResolvedValue({ kind: "notfound" });
		await a.getContents("o", "r", "src", "main", "tree");
		expect(m.getContents).toHaveBeenCalledWith(
			m.octokit,
			"o",
			"r",
			"src",
			"main",
		);
	});

	it("renderMarkdown uses GitHub's renderer", async () => {
		const a = createGitHubAdapter(5);
		m.renderMarkdownGitHub.mockResolvedValue("<p>x</p>");
		expect(await a.renderMarkdown?.("o", "r", "x")).toBe("<p>x</p>");
		expect(m.renderMarkdownGitHub).toHaveBeenCalledWith(
			m.octokit,
			"o",
			"r",
			"x",
		);
	});

	it("listRepos tags every repo with the GitHub capabilities", async () => {
		const a = createGitHubAdapter(5);
		m.listInstallationRepos.mockResolvedValue([
			{
				owner: "o",
				name: "r",
				fullName: "o/r",
				private: true,
				defaultBranch: "main",
			},
		]);
		expect(await a.listRepos()).toEqual([
			{
				owner: "o",
				name: "r",
				fullName: "o/r",
				private: true,
				defaultBranch: "main",
				capabilities: GITHUB_CAPABILITIES,
			},
		]);
		expect(m.listInstallationRepos).toHaveBeenCalledWith(5);
	});
});

describe("getRawFile", () => {
	it("requests the raw media type with the installation token", async () => {
		const upstream = new Response("bytes", { status: 200 });
		fetchMock.mockResolvedValue(upstream);
		const res = await createGitHubAdapter(5).getRawFile(
			"o",
			"r",
			"docs/a b.png",
			"feat/x y",
		);
		expect(res).toBe(upstream);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(
			"https://api.github.com/repos/o/r/contents/docs/a%20b.png?ref=feat/x%20y",
		);
		expect(init.headers).toMatchObject({
			Authorization: "Bearer inst-token",
			Accept: "application/vnd.github.raw+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "github-unlisted",
		});
	});

	it("encodes owner and repo", async () => {
		fetchMock.mockResolvedValue(new Response("x"));
		await createGitHubAdapter(5).getRawFile("a/b", "c d", "f.png", "main");
		expect(fetchMock.mock.calls[0][0]).toContain(
			"/repos/a%2Fb/c%20d/contents/",
		);
	});

	it("requests a GitHub user attachment through the installation token", async () => {
		const upstream = new Response("image", {
			status: 200,
			headers: { "content-type": "image/png" },
		});
		fetchMock.mockResolvedValue(upstream);
		const response = await createGitHubAdapter(5).getRawAttachment?.(
			"ac0d2c11-b338-43b1-ac55-37394abe6427",
		);
		expect(response).toBe(upstream);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(
			"https://github.com/user-attachments/assets/ac0d2c11-b338-43b1-ac55-37394abe6427",
		);
		expect(init.headers).toMatchObject({
			Authorization: "Bearer inst-token",
			Accept: "application/octet-stream",
		});
	});

	it("rejects malformed user-attachment IDs before any request", async () => {
		await expect(
			createGitHubAdapter(5).getRawAttachment?.("not-an-asset-id"),
		).rejects.toBeInstanceOf(ForgeHttpError);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(["", "..", "a/../b", "/abs", "a//b", "a\\b"])(
		"rejects the unsafe path %j before any request",
		async (path) => {
			await expect(
				createGitHubAdapter(5).getRawFile("o", "r", path, "main"),
			).rejects.toBeInstanceOf(ForgeHttpError);
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
});

describe("archiveResponse", () => {
	it("forwards GitHub's signed redirect instead of following it", async () => {
		fetchMock.mockResolvedValue(
			redirect("https://codeload.github.com/o/r/legacy.zip/abc"),
		);
		const out = await createGitHubAdapter(5).archiveResponse(
			"o",
			"r",
			"feat/x",
		);
		expect(out).toEqual({
			kind: "redirect",
			url: "https://codeload.github.com/o/r/legacy.zip/abc",
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.github.com/repos/o/r/zipball/feat/x");
		expect(init.redirect).toBe("manual");
		expect(init.headers.Accept).toBe("application/vnd.github+json");
	});

	it("surfaces the upstream status when there is no redirect", async () => {
		fetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
		await expect(
			createGitHubAdapter(5).archiveResponse("o", "r", "main"),
		).rejects.toMatchObject({ name: "ForgeHttpError", status: 404 });
		fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
		await expect(
			createGitHubAdapter(5).archiveResponse("o", "r", "main"),
		).rejects.toMatchObject({ status: 200 });
	});

	it("refuses to forward a non-https Location to a recipient's browser", async () => {
		for (const location of [
			"http://evil.test/x",
			"javascript:alert(1)",
			"//evil.test",
		]) {
			fetchMock.mockResolvedValue(redirect(location));
			await expect(
				createGitHubAdapter(5).archiveResponse("o", "r", "main"),
			).rejects.toBeInstanceOf(ForgeHttpError);
		}
	});
});

describe("releaseDownloadResponse", () => {
	it("resolves an uploaded asset by id", async () => {
		fetchMock.mockResolvedValue(redirect("https://objects.example/asset"));
		const out = await createGitHubAdapter(5).releaseDownloadResponse(
			"o",
			"r",
			123,
		);
		expect(out).toEqual({
			kind: "redirect",
			url: "https://objects.example/asset",
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://api.github.com/repos/o/r/releases/assets/123");
		expect(init.headers.Accept).toBe("application/octet-stream");
		expect(init.redirect).toBe("manual");
	});

	it("resolves a source archive by tag, encoding each segment", async () => {
		fetchMock.mockResolvedValue(redirect("https://codeload.github.com/z"));
		await createGitHubAdapter(5).releaseDownloadResponse(
			"o",
			"r",
			undefined,
			"rel/v1.0+1",
		);
		expect(fetchMock.mock.calls[0][0]).toBe(
			"https://api.github.com/repos/o/r/zipball/refs/tags/rel/v1.0%2B1",
		);
	});

	it.each([
		[Number.NaN, undefined],
		[0, undefined],
		[-3, undefined],
		[1.5, undefined],
		[undefined, undefined],
		[undefined, ""],
	])(
		"rejects asset %s / tag %j without calling GitHub",
		async (assetId, tag) => {
			await expect(
				createGitHubAdapter(5).releaseDownloadResponse("o", "r", assetId, tag),
			).rejects.toMatchObject({ status: 400 });
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

	it("maps a missing redirect to the upstream status", async () => {
		fetchMock.mockResolvedValue(redirect(null, 404));
		await expect(
			createGitHubAdapter(5).releaseDownloadResponse("o", "r", 1),
		).rejects.toMatchObject({ status: 404 });
	});
});
