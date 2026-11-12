// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createGitLabAdapter, GITLAB_CAPABILITIES } from "./gitlab";
import { b64, fakeForge, json, status } from "./test-utils";

const HOST = "https://gitlab.test";
const make = (fetch: ReturnType<typeof fakeForge>["fetch"]) =>
	createGitLabAdapter({ forge: "gitlab", host: HOST, token: "TOK", fetch });

describe("identity", () => {
	it("is gitlab with its capabilities, and refuses another forge id", () => {
		const f = fakeForge(() => json({}));
		const a = make(f.fetch);
		expect(a.forge).toBe("gitlab");
		expect(a.host).toBe(HOST);
		expect(a.capabilities).toBe(GITLAB_CAPABILITIES);
		expect(a.capabilities).toEqual({
			releases: true,
			archive: true,
			recursiveTree: true,
			markdownApi: false,
		});
		expect(a.renderMarkdown).toBeUndefined();
		expect(() =>
			createGitLabAdapter({ forge: "gitea", host: HOST, token: "t" }),
		).toThrow();
	});
});

describe("project id", () => {
	it("uses the URL-encoded full path, subgroups included, and the PRIVATE-TOKEN header", async () => {
		const f = fakeForge(() =>
			json({
				path_with_namespace: "g/s/p",
				visibility: "private",
				default_branch: "main",
			}),
		);
		const meta = await make(f.fetch).getRepoMeta("g/s", "p");
		expect(f.calls[0].url).toBe(`${HOST}/api/v4/projects/g%2Fs%2Fp`);
		expect(f.calls[0].headers["private-token"]).toBe("TOK");
		expect(f.calls[0].url).not.toContain("TOK");
		// The credential appears in exactly one header and nowhere else.
		expect(Object.keys(f.calls[0].headers).sort()).toEqual([
			"accept",
			"private-token",
		]);
		expect(meta).toEqual({
			fullName: "g/s/p",
			private: true,
			defaultBranch: "main",
		});
	});

	it("treats only 'public' as non-private and rejects an empty repository", async () => {
		const pub = fakeForge(() =>
			json({
				path_with_namespace: "a/b",
				visibility: "public",
				default_branch: "main",
			}),
		);
		expect((await make(pub.fetch).getRepoMeta("a", "b")).private).toBe(false);
		const empty = fakeForge(() =>
			json({ path_with_namespace: "a/b", default_branch: null }),
		);
		await expect(make(empty.fetch).getRepoMeta("a", "b")).rejects.toMatchObject(
			{
				status: 404,
			},
		);
	});

	it("rejects path traversal in owner or repo before any request", async () => {
		const f = fakeForge(() => json({}));
		const a = make(f.fetch);
		await expect(a.getRepoMeta("..", "x")).rejects.toMatchObject({
			status: 400,
		});
		await expect(a.getRepoMeta("g", "..")).rejects.toMatchObject({
			status: 400,
		});
		await expect(a.listBranches("a/../b", "x")).rejects.toMatchObject({
			status: 400,
		});
		expect(f.calls).toHaveLength(0);
	});
});

describe("listRepos", () => {
	it("maps projects, splits nested owners and skips empty repositories", async () => {
		const f = fakeForge(() =>
			json([
				{
					path_with_namespace: "g/s/p",
					default_branch: "main",
					visibility: "internal",
				},
				{
					path_with_namespace: "me/pub",
					default_branch: "dev",
					visibility: "public",
				},
				{
					path_with_namespace: "me/empty",
					default_branch: null,
					visibility: "private",
				},
				{ default_branch: "main" },
			]),
		);
		const repos = await make(f.fetch).listRepos();
		expect(repos.map((r) => [r.owner, r.name, r.fullName, r.private])).toEqual([
			["g/s", "p", "g/s/p", true],
			["me", "pub", "me/pub", false],
		]);
		const url = new URL(f.calls[0].url);
		expect(url.searchParams.get("membership")).toBe("true");
		expect(url.searchParams.get("per_page")).toBe("100");
	});

	it("follows x-next-page but stops at the bound", async () => {
		const f = fakeForge(() =>
			json([{ path_with_namespace: "a/b", default_branch: "m" }], {
				headers: { "x-next-page": "9", "content-type": "application/json" },
			}),
		);
		await make(f.fetch).listRepos();
		expect(f.calls).toHaveLength(3);
	});
});

describe("listBranches", () => {
	it("collects names across pages", async () => {
		const f = fakeForge((u) =>
			u.searchParams.get("page") === "1"
				? json([{ name: "a" }], { headers: { "x-next-page": "2" } })
				: json([{ name: "b/c" }]),
		);
		expect(await make(f.fetch).listBranches("o", "r")).toEqual(["a", "b/c"]);
	});
});

describe("getRepoTree", () => {
	const items = [
		{ name: "src", path: "src", type: "tree" },
		{ name: "a.ts", path: "src/a.ts", type: "blob" },
		{ name: "sub", path: "sub", type: "commit" },
	];

	it("reads exactly one page and maps types, dropping submodules", async () => {
		const f = fakeForge(() => json(items));
		const out = await make(f.fetch).getRepoTree("o", "r", "main");
		expect(out).toEqual({
			items: [
				{ path: "src", type: "dir" },
				{ path: "src/a.ts", type: "file" },
			],
			truncated: false,
		});
		expect(f.calls).toHaveLength(1);
		const url = new URL(f.calls[0].url);
		expect(url.searchParams.get("recursive")).toBe("true");
		expect(url.searchParams.get("ref")).toBe("main");
	});

	it("marks a paginated tree truncated without requesting another page", async () => {
		const f = fakeForge(() => json(items, { headers: { "x-next-page": "2" } }));
		const out = await make(f.fetch).getRepoTree("o", "r", "main");
		expect(out?.truncated).toBe(true);
		expect(f.calls).toHaveLength(1);
	});

	it("returns null when the ref cannot be read or is unsafe", async () => {
		expect(
			await make(fakeForge(() => status(404)).fetch).getRepoTree("o", "r", "x"),
		).toBeNull();
		const f = fakeForge(() => json([]));
		expect(await make(f.fetch).getRepoTree("o", "r", "../x")).toBeNull();
		expect(f.calls).toHaveLength(0);
	});
});

describe("getContents", () => {
	const dir = [
		{ name: "b.ts", path: "src/b.ts", type: "blob" },
		{ name: "d", path: "src/d", type: "tree" },
	];
	const file = {
		file_name: "a.ts",
		size: 5,
		encoding: "base64",
		content: b64("hello"),
	};

	function router(opts: { tree?: () => Response; blob?: () => Response }) {
		return fakeForge((u) => {
			if (u.pathname.endsWith("/repository/tree")) return opts.tree?.();
			if (u.pathname.includes("/repository/files/")) return opts.blob?.();
			return undefined;
		});
	}

	it("tries the tree endpoint first for a tree hint and sorts dirs first", async () => {
		const f = router({ tree: () => json(dir) });
		const out = await make(f.fetch).getContents(
			"o",
			"r",
			"src",
			"main",
			"tree",
		);
		expect(out).toEqual({
			kind: "dir",
			entries: [
				{ name: "d", path: "src/d", type: "dir" },
				{ name: "b.ts", path: "src/b.ts", type: "file" },
			],
		});
		expect(f.calls).toHaveLength(1);
		expect(new URL(f.calls[0].url).searchParams.get("path")).toBe("src");
	});

	it("tries the file endpoint first for a blob hint, with the path as one encoded segment", async () => {
		const f = router({ blob: () => json(file) });
		const out = await make(f.fetch).getContents(
			"o",
			"r",
			"src/a b.ts",
			"main",
			"blob",
		);
		expect(out).toEqual({
			kind: "file",
			name: "a.ts",
			text: "hello",
			isBinary: false,
			size: 5,
		});
		expect(f.calls).toHaveLength(1);
		expect(new URL(f.calls[0].url).pathname).toBe(
			"/api/v4/projects/o%2Fr/repository/files/src%2Fa%20b.ts",
		);
	});

	it("falls back to the other endpoint exactly once on a 404", async () => {
		const f = router({ tree: () => status(404), blob: () => json(file) });
		const out = await make(f.fetch).getContents(
			"o",
			"r",
			"a.ts",
			"main",
			"tree",
		);
		expect(out.kind).toBe("file");
		expect(f.calls).toHaveLength(2);
	});

	it("answers notfound after two 404s and never makes a third request", async () => {
		const f = router({ tree: () => status(404), blob: () => status(404) });
		expect(
			await make(f.fetch).getContents("o", "r", "x", "main", "blob"),
		).toEqual({
			kind: "notfound",
		});
		expect(f.calls).toHaveLength(2);
	});

	it("makes at most two requests after a tree hint as well", async () => {
		const f = router({ tree: () => status(404), blob: () => status(404) });
		expect(
			await make(f.fetch).getContents("o", "r", "x", "main", "tree"),
		).toEqual({
			kind: "notfound",
		});
		expect(f.calls).toHaveLength(2);
	});

	it("does not mask a non-404 failure as notfound", async () => {
		const f = router({ blob: () => status(500) });
		await expect(
			make(f.fetch).getContents("o", "r", "x", "main", "blob"),
		).rejects.toMatchObject({ status: 500 });
		expect(f.calls).toHaveLength(1);
	});

	it("guesses blob for a path and tree for the root when there is no hint", async () => {
		const g = router({ blob: () => json(file) });
		await make(g.fetch).getContents("o", "r", "a.ts", "main");
		expect(g.calls[0].url).toContain("/repository/files/");
		const h = router({ tree: () => json(dir) });
		await make(h.fetch).getContents("o", "r", "", "main");
		expect(h.calls).toHaveLength(1);
		expect(new URL(h.calls[0].url).searchParams.has("path")).toBe(false);
	});

	it("never asks for a file at the root", async () => {
		const f = router({ tree: () => status(404) });
		expect(await make(f.fetch).getContents("o", "r", "", "main")).toEqual({
			kind: "notfound",
		});
		expect(f.calls).toHaveLength(1);
	});

	it("treats an empty listing under a non-root path as 'not a directory' and falls back", async () => {
		const f = router({ tree: () => json([]), blob: () => json(file) });
		const out = await make(f.fetch).getContents(
			"o",
			"r",
			"a.ts",
			"main",
			"tree",
		);
		expect(out.kind).toBe("file");
	});

	it("flags a binary file", async () => {
		const bin = { ...file, content: b64(Buffer.from([0, 1, 2])) };
		const f = router({ blob: () => json(bin) });
		expect(
			await make(f.fetch).getContents("o", "r", "a.png", "main", "blob"),
		).toMatchObject({
			isBinary: true,
			text: null,
		});
	});

	it("returns notfound for an unsafe path without any request", async () => {
		const f = router({});
		for (const p of ["../x", "a/../b", "/abs", "a//b"]) {
			expect(
				await make(f.fetch).getContents("o", "r", p, "main", "blob"),
			).toEqual({
				kind: "notfound",
			});
		}
		expect(f.calls).toHaveLength(0);
	});

	it("rejects an unsafe ref", async () => {
		const f = router({});
		await expect(
			make(f.fetch).getContents("o", "r", "a", "..", "blob"),
		).rejects.toMatchObject({
			status: 400,
		});
	});
});

describe("getRawFile", () => {
	it("requests the raw endpoint with ref in the query and returns the response unchanged", async () => {
		const upstream = new Response("bytes");
		const f = fakeForge(() => upstream);
		const res = await make(f.fetch).getRawFile(
			"o",
			"r",
			"img/a b.png",
			"feat/x",
		);
		expect(res).toBe(upstream);
		const url = new URL(f.calls[0].url);
		expect(url.pathname).toBe(
			"/api/v4/projects/o%2Fr/repository/files/img%2Fa%20b.png/raw",
		);
		expect(url.searchParams.get("ref")).toBe("feat/x");
	});

	it("rejects an unsafe path with no request", async () => {
		const f = fakeForge(() => new Response("x"));
		await expect(
			make(f.fetch).getRawFile("o", "r", "../etc", "main"),
		).rejects.toMatchObject({
			status: 400,
		});
		expect(f.calls).toHaveLength(0);
	});
});

const RELEASES = [
	{
		tag_name: "v2",
		name: "",
		description: "notes",
		released_at: "2025-01-02T00:00:00Z",
		upcoming_release: true,
		assets: {
			links: [
				{ id: 7, name: "setup.exe", url: "https://cdn.other.test/setup.exe" },
				{
					id: 8,
					name: "local.zip",
					url: "https://gitlab.test/-/pkg/1",
					direct_asset_url: "https://gitlab.test/api/v4/pkg/1",
				},
				{ id: 9, name: "bad", url: "http://insecure.test/x" },
			],
		},
	},
	{ tag_name: "v1", name: "One", released_at: null, assets: {} },
];

describe("releases", () => {
	it("maps releases, using the tag as fallback name and size 0 for links", async () => {
		const f = fakeForge(() => json(RELEASES));
		const out = await make(f.fetch).listReleases("o", "r");
		expect(out[0]).toMatchObject({
			tag: "v2",
			name: "v2",
			body: "notes",
			prerelease: true,
			publishedUtc: "2025-01-02T00:00:00Z",
		});
		expect(out[0].assets).toEqual([
			{
				id: 7,
				name: "setup.exe",
				size: 0,
				contentType: "application/octet-stream",
			},
			{
				id: 8,
				name: "local.zip",
				size: 0,
				contentType: "application/octet-stream",
			},
			{ id: 9, name: "bad", size: 0, contentType: "application/octet-stream" },
		]);
		expect(out[1]).toMatchObject({
			name: "One",
			prerelease: false,
			publishedUtc: null,
			assets: [],
		});
		expect(new Set(out.map((r) => r.id)).size).toBe(2);
	});

	it("hands an off-instance asset link to the browser instead of fetching it", async () => {
		const f = fakeForge(() => json(RELEASES));
		const out = await make(f.fetch).releaseDownloadResponse("o", "r", 7);
		expect(out).toEqual({
			kind: "redirect",
			url: "https://cdn.other.test/setup.exe",
		});
		expect(f.calls).toHaveLength(1); // only the releases listing; the asset was not fetched
	});

	it("streams an on-instance asset link with the token, preferring direct_asset_url", async () => {
		const f = fakeForge((u) =>
			u.pathname === "/api/v4/pkg/1" ? new Response("data") : json(RELEASES),
		);
		const out = await make(f.fetch).releaseDownloadResponse("o", "r", 8);
		expect(out.kind).toBe("stream");
		expect(f.calls[1].url).toBe("https://gitlab.test/api/v4/pkg/1");
		expect(f.calls[1].headers["private-token"]).toBe("TOK");
	});

	it("refuses non-https links, unknown ids and bad ids", async () => {
		const f = fakeForge(() => json(RELEASES));
		const a = make(f.fetch);
		await expect(a.releaseDownloadResponse("o", "r", 9)).rejects.toMatchObject({
			status: 404,
		});
		await expect(
			a.releaseDownloadResponse("o", "r", 404),
		).rejects.toMatchObject({ status: 404 });
		for (const bad of [0, -1, 1.5, Number.NaN]) {
			await expect(
				a.releaseDownloadResponse("o", "r", bad),
			).rejects.toMatchObject({ status: 400 });
		}
		await expect(a.releaseDownloadResponse("o", "r")).rejects.toMatchObject({
			status: 400,
		});
	});

	it("streams a tag archive", async () => {
		const f = fakeForge(() => new Response("zip"));
		const out = await make(f.fetch).releaseDownloadResponse(
			"o",
			"r",
			undefined,
			"v1.0",
		);
		expect(out.kind).toBe("stream");
		const url = new URL(f.calls[0].url);
		expect(url.pathname).toBe("/api/v4/projects/o%2Fr/repository/archive.zip");
		expect(url.searchParams.get("sha")).toBe("v1.0");
	});
});

describe("archiveResponse", () => {
	it("streams the zip with the token and does not read the body", async () => {
		const body = new ReadableStream({
			start: (c) => c.enqueue(new Uint8Array([1])),
		});
		const f = fakeForge(() => new Response(body));
		const out = await make(f.fetch).archiveResponse("g/s", "p", "feat/x");
		expect(out.kind).toBe("stream");
		if (out.kind === "stream") {
			expect(out.response.bodyUsed).toBe(false);
			expect(out.response.body).toBe(body);
		}
		const url = new URL(f.calls[0].url);
		expect(url.pathname).toBe(
			"/api/v4/projects/g%2Fs%2Fp/repository/archive.zip",
		);
		expect(url.searchParams.get("sha")).toBe("feat/x");
		expect(f.calls[0].headers["private-token"]).toBe("TOK");
	});

	it("rejects an unsafe ref as a rejected promise, not a synchronous throw", async () => {
		const f = fakeForge(() => new Response("x"));
		await expect(
			make(f.fetch).archiveResponse("o", "r", "../x"),
		).rejects.toMatchObject({
			status: 400,
		});
		expect(f.calls).toHaveLength(0);
	});

	it("maps an upstream failure to a ForgeHttpError", async () => {
		const f = fakeForge(() => status(404));
		await expect(
			make(f.fetch).archiveResponse("o", "r", "main"),
		).rejects.toMatchObject({
			status: 404,
		});
	});
});
