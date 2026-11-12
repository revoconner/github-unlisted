// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createGiteeAdapter, GITEE_CAPABILITIES } from "./gitee";
import { b64, fakeForge, json, status } from "./test-utils";

const HOST = "https://gitee.test";
const make = (fetch: ReturnType<typeof fakeForge>["fetch"]) =>
	createGiteeAdapter({ forge: "gitee", host: HOST, token: "TOK", fetch });

describe("identity and auth", () => {
	it("is gitee, with no archive capability until the endpoint is confirmed", () => {
		const f = fakeForge(() => json({}));
		const a = make(f.fetch);
		expect(a.forge).toBe("gitee");
		expect(a.capabilities).toBe(GITEE_CAPABILITIES);
		expect(a.capabilities.archive).toBe(false);
		expect(a.renderMarkdown).toBeUndefined();
		expect(() =>
			createGiteeAdapter({ forge: "gitea", host: HOST, token: "t" }),
		).toThrow();
	});

	// The v5 API also accepts ?access_token=, which would put the credential in every proxy and CDN log.
	it("sends the token in a header and never as an access_token query parameter", async () => {
		const f = fakeForge(() =>
			json({ path: "r", default_branch: "master", private: true }),
		);
		await make(f.fetch).getRepoMeta("o", "r");
		expect(f.calls[0].headers.authorization).toBe("Bearer TOK");
		expect(Object.keys(f.calls[0].headers).sort()).toEqual([
			"accept",
			"authorization",
		]);
		expect(f.calls[0].url).toBe(`${HOST}/api/v5/repos/o/r`);
		expect(f.calls[0].url).not.toContain("access_token");
		expect(f.calls[0].url).not.toContain("TOK");
	});

	it("rejects traversal in owner or repo", async () => {
		const f = fakeForge(() => json({}));
		await expect(make(f.fetch).getRepoMeta("..", "r")).rejects.toMatchObject({
			status: 400,
		});
		await expect(make(f.fetch).listBranches("o", "a/b")).rejects.toMatchObject({
			status: 400,
		});
		expect(f.calls).toHaveLength(0);
	});
});

describe("repos", () => {
	it("builds owner and name from namespace.path and path, and skips repos without a default branch", async () => {
		const f = fakeForge(() =>
			json([
				{
					path: "r1",
					namespace: { path: "me" },
					private: true,
					default_branch: "master",
				},
				{
					path: "r2",
					full_name: "org/Display Name",
					public: true,
					default_branch: "main",
				},
				{ path: "r3", namespace: { path: "me" }, default_branch: null },
			]),
		);
		const repos = await make(f.fetch).listRepos();
		expect(repos.map((r) => [r.owner, r.name, r.fullName, r.private])).toEqual([
			["me", "r1", "me/r1", true],
			["org", "r2", "org/r2", false],
		]);
		expect(new URL(f.calls[0].url).searchParams.get("per_page")).toBe("100");
	});

	it("pages only while a page is full, bounded", async () => {
		const full = Array.from({ length: 100 }, (_, i) => ({
			path: `r${i}`,
			namespace: { path: "me" },
			default_branch: "m",
		}));
		const f = fakeForge(() => json(full));
		await make(f.fetch).listRepos();
		expect(f.calls).toHaveLength(3);
	});

	it("lists branches in one call", async () => {
		const f = fakeForge(() => json([{ name: "master" }, { name: "dev" }]));
		expect(await make(f.fetch).listBranches("o", "r")).toEqual([
			"master",
			"dev",
		]);
		expect(f.calls).toHaveLength(1);
	});
});

describe("getRepoTree", () => {
	it("maps entries and trusts an explicit truncated:false", async () => {
		const f = fakeForge(() =>
			json({
				tree: [
					{ path: "a", type: "tree" },
					{ path: "a/b.md", type: "blob" },
				],
				truncated: false,
			}),
		);
		expect(await make(f.fetch).getRepoTree("o", "r", "master")).toEqual({
			items: [
				{ path: "a", type: "dir" },
				{ path: "a/b.md", type: "file" },
			],
			truncated: false,
		});
		expect(new URL(f.calls[0].url).searchParams.get("recursive")).toBe("1");
	});

	// A silently partial tree that looks complete is worse than an obviously truncated one.
	it("treats a missing truncated flag as truncated", async () => {
		const f = fakeForge(() => json({ tree: [{ path: "a", type: "blob" }] }));
		expect((await make(f.fetch).getRepoTree("o", "r", "m"))?.truncated).toBe(
			true,
		);
	});

	it("returns null on failure", async () => {
		expect(
			await make(fakeForge(() => status(404)).fetch).getRepoTree("o", "r", "m"),
		).toBeNull();
	});
});

describe("getContents and getRawFile", () => {
	const file = {
		name: "a.md",
		path: "a.md",
		type: "file",
		size: 2,
		content: b64("hi"),
		encoding: "base64",
	};

	it("lists a directory and decodes a file through one endpoint", async () => {
		const dir = fakeForge(() =>
			json([
				{ name: "z", path: "z", type: "dir" },
				{ name: "a", path: "a", type: "file" },
			]),
		);
		expect(await make(dir.fetch).getContents("o", "r", "", "master")).toEqual({
			kind: "dir",
			entries: [
				{ name: "z", path: "z", type: "dir" },
				{ name: "a", path: "a", type: "file" },
			],
		});
		expect(new URL(dir.calls[0].url).pathname).toBe(
			"/api/v5/repos/o/r/contents",
		);
		const one = fakeForge(() => json(file));
		expect(
			await make(one.fetch).getContents("o", "r", "a.md", "master", "tree"),
		).toEqual({
			kind: "file",
			name: "a.md",
			text: "hi",
			isBinary: false,
			size: 2,
		});
		expect(one.calls).toHaveLength(1);
	});

	it("answers notfound for 404 and unsafe paths", async () => {
		expect(
			await make(fakeForge(() => status(404)).fetch).getContents(
				"o",
				"r",
				"x",
				"m",
			),
		).toEqual({
			kind: "notfound",
		});
		const f = fakeForge(() => json({}));
		expect(await make(f.fetch).getContents("o", "r", "../x", "m")).toEqual({
			kind: "notfound",
		});
		expect(f.calls).toHaveLength(0);
	});

	it("serves a raw file by decoding the contents response", async () => {
		const f = fakeForge(() =>
			json({ ...file, content: b64(Buffer.from([1, 2, 3])) }),
		);
		const res = await make(f.fetch).getRawFile("o", "r", "img.png", "master");
		expect(res.status).toBe(200);
		expect(Buffer.from(await res.arrayBuffer())).toEqual(
			Buffer.from([1, 2, 3]),
		);
	});

	it("reports upstream failures and non-files as a Response status, like the other adapters", async () => {
		expect(
			(
				await make(fakeForge(() => status(404)).fetch).getRawFile(
					"o",
					"r",
					"x.png",
					"m",
				)
			).status,
		).toBe(404);
		expect(
			(
				await make(fakeForge(() => json([])).fetch).getRawFile(
					"o",
					"r",
					"dir",
					"m",
				)
			).status,
		).toBe(404);
		await expect(
			make(fakeForge(() => json({})).fetch).getRawFile("o", "r", "../x", "m"),
		).rejects.toMatchObject({
			status: 400,
		});
	});
});

describe("releases and archive", () => {
	const releases = [
		{
			id: 3,
			tag_name: "v1",
			name: "",
			body: "b",
			prerelease: false,
			created_at: "2025-01-01T00:00:00Z",
			assets: [
				{
					name: "a.zip",
					browser_download_url:
						"https://gitee.test/o/r/releases/download/v1/a.zip",
				},
				{
					id: 77,
					name: "b.zip",
					size: 9,
					browser_download_url: "https://gitee.test/b.zip",
				},
				{ name: "http", browser_download_url: "http://gitee.test/c.zip" },
				{ name: "none" },
			],
		},
	];

	it("lists releases with stable asset ids and drops assets without a URL", async () => {
		const f = fakeForge(() => json(releases));
		const out = await make(f.fetch).listReleases("o", "r");
		expect(out[0]).toMatchObject({
			tag: "v1",
			name: "v1",
			publishedUtc: "2025-01-01T00:00:00Z",
		});
		expect(out[0].assets.map((a) => a.name)).toEqual([
			"a.zip",
			"b.zip",
			"http",
		]);
		expect(out[0].assets[1]).toMatchObject({ id: 77, size: 9 });
		const again = await make(
			fakeForge(() => json(releases)).fetch,
		).listReleases("o", "r");
		expect(again[0].assets.map((a) => a.id)).toEqual(
			out[0].assets.map((a) => a.id),
		);
	});

	it("redirects the browser to an https asset and never fetches it server-side", async () => {
		const f = fakeForge(() => json(releases));
		const a = make(f.fetch);
		expect(await a.releaseDownloadResponse("o", "r", 77)).toEqual({
			kind: "redirect",
			url: "https://gitee.test/b.zip",
		});
		expect(f.calls).toHaveLength(1);
		const id = (await a.listReleases("o", "r"))[0].assets[2].id;
		await expect(a.releaseDownloadResponse("o", "r", id)).rejects.toMatchObject(
			{ status: 404 },
		);
	});

	it("refuses tag archives, unknown assets and bad ids", async () => {
		const f = fakeForge(() => json(releases));
		const a = make(f.fetch);
		await expect(
			a.releaseDownloadResponse("o", "r", undefined, "v1"),
		).rejects.toMatchObject({ status: 501 });
		await expect(a.releaseDownloadResponse("o", "r", 5)).rejects.toMatchObject({
			status: 404,
		});
		await expect(a.releaseDownloadResponse("o", "r", -1)).rejects.toMatchObject(
			{ status: 400 },
		);
	});

	it("offers no archive", async () => {
		const f = fakeForge(() => json({}));
		await expect(
			make(f.fetch).archiveResponse("o", "r", "master"),
		).rejects.toMatchObject({ status: 501 });
		expect(f.calls).toHaveLength(0);
	});
});
