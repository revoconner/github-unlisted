// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createGiteaAdapter, GITEA_CAPABILITIES } from "./gitea";
import { b64, fakeForge, json, status } from "./test-utils";

const HOST = "https://git.test";
const make = (
	fetch: ReturnType<typeof fakeForge>["fetch"],
	forge: "gitea" | "codeberg" = "gitea",
) => createGiteaAdapter({ forge, host: HOST, token: "TOK", fetch });

describe("identity and auth", () => {
	it("serves gitea and codeberg from one adapter and refuses other forges", () => {
		const f = fakeForge(() => json({}));
		expect(make(f.fetch).forge).toBe("gitea");
		expect(make(f.fetch, "codeberg").forge).toBe("codeberg");
		expect(make(f.fetch).capabilities).toBe(GITEA_CAPABILITIES);
		expect(make(f.fetch).renderMarkdown).toBeUndefined();
		expect(() =>
			createGiteaAdapter({ forge: "gitlab", host: HOST, token: "t" }),
		).toThrow();
	});

	it("authenticates with 'Authorization: token', never in the URL", async () => {
		const f = fakeForge(() =>
			json({ full_name: "o/r", private: false, default_branch: "main" }),
		);
		await make(f.fetch).getRepoMeta("o", "r");
		expect(f.calls[0].headers.authorization).toBe("token TOK");
		expect(f.calls[0].url).toBe(`${HOST}/api/v1/repos/o/r`);
		expect(Object.keys(f.calls[0].headers).sort()).toEqual([
			"accept",
			"authorization",
		]);
	});

	it("rejects traversal in owner or repo before any request", async () => {
		const f = fakeForge(() => json({}));
		const a = make(f.fetch);
		await expect(a.getRepoMeta("..", "r")).rejects.toMatchObject({
			status: 400,
		});
		await expect(a.getRepoMeta("o", "..")).rejects.toMatchObject({
			status: 400,
		});
		await expect(a.getRepoMeta("a/b", "r")).rejects.toMatchObject({
			status: 400,
		});
		expect(f.calls).toHaveLength(0);
	});
});

describe("repos and branches", () => {
	it("maps repos, skipping empty ones", async () => {
		const f = fakeForge(() =>
			json([
				{
					name: "a",
					owner: { login: "me" },
					private: true,
					default_branch: "main",
				},
				{
					name: "e",
					owner: { login: "me" },
					private: false,
					default_branch: "main",
					empty: true,
				},
				{
					name: "n",
					full_name: "org/n",
					private: false,
					default_branch: "dev",
				},
				{ name: "x", owner: { login: "me" }, private: false },
			]),
		);
		const repos = await make(f.fetch).listRepos();
		expect(repos.map((r) => r.fullName)).toEqual(["me/a", "org/n"]);
		expect(repos[0]).toMatchObject({ private: true, defaultBranch: "main" });
		const q = new URL(f.calls[0].url).searchParams;
		expect(q.get("limit")).toBe("50");
	});

	it("paginates by Link header and is bounded", async () => {
		const f = fakeForge(() =>
			json(
				[
					{
						name: "a",
						owner: { login: "m" },
						private: false,
						default_branch: "x",
					},
				],
				{
					headers: { link: '<https://git.test/x?page=2>; rel="next"' },
				},
			),
		);
		await make(f.fetch).listRepos();
		expect(f.calls).toHaveLength(3);
	});

	it("reads branches and stops on a short page", async () => {
		const f = fakeForge(() => json([{ name: "main" }, { name: "feat/x" }]));
		expect(await make(f.fetch).listBranches("o", "r")).toEqual([
			"main",
			"feat/x",
		]);
		expect(f.calls).toHaveLength(1);
	});

	it("rejects an empty repository", async () => {
		const f = fakeForge(() => json({ full_name: "o/r", private: false }));
		await expect(make(f.fetch).getRepoMeta("o", "r")).rejects.toMatchObject({
			status: 404,
		});
	});
});

describe("getRepoTree", () => {
	it("reads one page and honours the server's truncated flag", async () => {
		const f = fakeForge(() =>
			json({
				tree: [
					{ path: "src", type: "tree" },
					{ path: "src/a.ts", type: "blob" },
					{ path: "mod", type: "commit" },
				],
				truncated: true,
			}),
		);
		const out = await make(f.fetch).getRepoTree("o", "r", "main");
		expect(out).toEqual({
			items: [
				{ path: "src", type: "dir" },
				{ path: "src/a.ts", type: "file" },
			],
			truncated: true,
		});
		expect(f.calls).toHaveLength(1);
		const url = new URL(f.calls[0].url);
		expect(url.pathname).toBe("/api/v1/repos/o/r/git/trees/main");
		expect(url.searchParams.get("recursive")).toBe("true");
		expect(url.searchParams.get("per_page")).toBe("1000");
	});

	it("tolerates a null tree and returns null on failure or an unsafe ref", async () => {
		expect(
			await make(fakeForge(() => json({ tree: null })).fetch).getRepoTree(
				"o",
				"r",
				"m",
			),
		).toEqual({ items: [], truncated: false });
		expect(
			await make(fakeForge(() => status(404)).fetch).getRepoTree("o", "r", "m"),
		).toBeNull();
		const f = fakeForge(() => json({}));
		expect(await make(f.fetch).getRepoTree("o", "r", "..")).toBeNull();
		expect(f.calls).toHaveLength(0);
	});
});

describe("getContents", () => {
	it("lists a directory with one request, ignoring the hint", async () => {
		const f = fakeForge(() =>
			json([
				{ name: "b.ts", path: "src/b.ts", type: "file" },
				{ name: "d", path: "src/d", type: "dir" },
				{ name: "m", path: "src/m", type: "submodule" },
				{ name: "l", path: "src/l", type: "symlink" },
			]),
		);
		const out = await make(f.fetch).getContents(
			"o",
			"r",
			"src",
			"main",
			"blob",
		);
		expect(out).toEqual({
			kind: "dir",
			entries: [
				{ name: "d", path: "src/d", type: "dir" },
				{ name: "b.ts", path: "src/b.ts", type: "file" },
			],
		});
		expect(f.calls).toHaveLength(1);
		expect(new URL(f.calls[0].url).pathname).toBe(
			"/api/v1/repos/o/r/contents/src",
		);
	});

	it("reads the root without a trailing path", async () => {
		const f = fakeForge(() => json([]));
		await make(f.fetch).getContents("o", "r", "", "main");
		expect(new URL(f.calls[0].url).pathname).toBe("/api/v1/repos/o/r/contents");
	});

	it("decodes a file, encoding each path segment", async () => {
		const f = fakeForge(() =>
			json({
				name: "a b.ts",
				path: "d/a b.ts",
				type: "file",
				size: 5,
				encoding: "base64",
				content: b64("hello"),
			}),
		);
		const out = await make(f.fetch).getContents("o", "r", "d/a b.ts", "feat/x");
		expect(out).toEqual({
			kind: "file",
			name: "a b.ts",
			text: "hello",
			isBinary: false,
			size: 5,
		});
		const url = new URL(f.calls[0].url);
		expect(url.pathname).toBe("/api/v1/repos/o/r/contents/d/a%20b.ts");
		expect(url.searchParams.get("ref")).toBe("feat/x");
	});

	it("answers notfound for 404, an unsafe path, or a non-file object; other errors propagate", async () => {
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
		expect(
			await make(
				fakeForge(() => json({ name: "l", type: "symlink" })).fetch,
			).getContents("o", "r", "l", "m"),
		).toEqual({ kind: "notfound" });
		await expect(
			make(fakeForge(() => status(500)).fetch).getContents("o", "r", "x", "m"),
		).rejects.toMatchObject({ status: 500 });
	});
});

describe("getRawFile", () => {
	it("uses the raw endpoint and returns the upstream response", async () => {
		const upstream = new Response("b");
		const f = fakeForge(() => upstream);
		expect(await make(f.fetch).getRawFile("o", "r", "img/a.png", "main")).toBe(
			upstream,
		);
		expect(new URL(f.calls[0].url).pathname).toBe(
			"/api/v1/repos/o/r/raw/img/a.png",
		);
	});

	it("rejects an unsafe path", async () => {
		const f = fakeForge(() => new Response("x"));
		await expect(
			make(f.fetch).getRawFile("o", "r", "a/../b", "main"),
		).rejects.toMatchObject({ status: 400 });
		expect(f.calls).toHaveLength(0);
	});
});

const RELEASES = [
	{
		id: 5,
		tag_name: "v2",
		name: " ",
		body: "n",
		draft: false,
		prerelease: true,
		published_at: "2025-02-01T00:00:00Z",
		assets: [
			{
				id: 11,
				name: "a.zip",
				size: 10,
				browser_download_url: "https://git.test/o/r/releases/download/v2/a.zip",
			},
			{
				id: 12,
				name: "b.zip",
				size: 3,
				browser_download_url: "https://cdn.test/b.zip",
			},
		],
	},
	{
		id: 4,
		tag_name: "draft",
		draft: true,
		assets: [
			{
				id: 99,
				name: "secret",
				browser_download_url: "https://git.test/secret",
			},
		],
	},
];

describe("releases", () => {
	it("asks for non-drafts, and drops drafts even if the server returns them", async () => {
		const f = fakeForge(() => json(RELEASES));
		const out = await make(f.fetch).listReleases("o", "r");
		const q = new URL(f.calls[0].url).searchParams;
		expect(q.get("draft")).toBe("false");
		expect(q.get("limit")).toBe("50");
		expect(out.map((r) => r.tag)).toEqual(["v2"]);
		expect(out[0]).toMatchObject({
			id: 5,
			name: "v2",
			prerelease: true,
			publishedUtc: "2025-02-01T00:00:00Z",
		});
		expect(out[0].assets[0]).toEqual({
			id: 11,
			name: "a.zip",
			size: 10,
			contentType: "application/octet-stream",
		});
	});

	it("cannot download an asset that belongs to a draft", async () => {
		const f = fakeForge(() => json(RELEASES));
		await expect(
			make(f.fetch).releaseDownloadResponse("o", "r", 99),
		).rejects.toMatchObject({ status: 404 });
	});

	it("streams an on-instance asset with the token and redirects an off-instance one", async () => {
		const f = fakeForge((u) =>
			u.pathname.includes("/releases/download/")
				? new Response("data")
				: json(RELEASES),
		);
		const a = make(f.fetch);
		expect((await a.releaseDownloadResponse("o", "r", 11)).kind).toBe("stream");
		expect(f.calls[1].headers.authorization).toBe("token TOK");
		expect(await a.releaseDownloadResponse("o", "r", 12)).toEqual({
			kind: "redirect",
			url: "https://cdn.test/b.zip",
		});
	});

	it("validates asset ids and requires an asset or a tag", async () => {
		const f = fakeForge(() => json(RELEASES));
		const a = make(f.fetch);
		for (const bad of [0, -2, 2.5, Number.NaN]) {
			await expect(
				a.releaseDownloadResponse("o", "r", bad),
			).rejects.toMatchObject({ status: 400 });
		}
		await expect(a.releaseDownloadResponse("o", "r")).rejects.toMatchObject({
			status: 400,
		});
		await expect(
			a.releaseDownloadResponse("o", "r", 404),
		).rejects.toMatchObject({ status: 404 });
	});

	it("streams a tag archive", async () => {
		const f = fakeForge(() => new Response("zip"));
		const out = await make(f.fetch).releaseDownloadResponse(
			"o",
			"r",
			undefined,
			"rel/v1",
		);
		expect(out.kind).toBe("stream");
		expect(new URL(f.calls[0].url).pathname).toBe(
			"/api/v1/repos/o/r/archive/rel/v1.zip",
		);
	});
});

describe("archiveResponse", () => {
	it("streams without buffering", async () => {
		const body = new ReadableStream({
			start: (c) => c.enqueue(new Uint8Array([1])),
		});
		const f = fakeForge(() => new Response(body));
		const out = await make(f.fetch, "codeberg").archiveResponse(
			"o",
			"r",
			"feat/x y",
		);
		expect(out.kind).toBe("stream");
		if (out.kind === "stream") {
			expect(out.response.bodyUsed).toBe(false);
			expect(out.response.body).toBe(body);
		}
		expect(new URL(f.calls[0].url).pathname).toBe(
			"/api/v1/repos/o/r/archive/feat/x%20y.zip",
		);
		expect(f.calls[0].headers.authorization).toBe("token TOK");
	});

	it("rejects an unsafe ref and maps a 404", async () => {
		const f = fakeForge(() => status(404));
		await expect(
			make(f.fetch).archiveResponse("o", "r", "../x"),
		).rejects.toMatchObject({ status: 400 });
		await expect(
			make(f.fetch).archiveResponse("o", "r", "main"),
		).rejects.toMatchObject({ status: 404 });
	});
});
