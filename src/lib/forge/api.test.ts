// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	assertSafeRef,
	assertSafeSegment,
	collectPages,
	createApiClient,
	encodeSegments,
	fileFromBase64,
	gitlabProjectId,
	hasNextPage,
	ownerRepoPath,
	sortEntries,
} from "./api";
import { b64, fakeForge, json, status } from "./test-utils";

describe("path pieces", () => {
	it("encodes a nested GitLab project path as one segment", () => {
		expect(gitlabProjectId("group/sub/deep", "project")).toBe(
			"group%2Fsub%2Fdeep%2Fproject",
		);
		expect(gitlabProjectId("me", "my project")).toBe("me%2Fmy%20project");
	});

	// encodeURIComponent leaves dots alone and URL parsing collapses them, so these would escape the API prefix.
	it.each(["..", ".", "", "a/b", "a\\b", "a\u0000b", "a\nb"])(
		"rejects the unsafe segment %j",
		(v) => {
			expect(() => assertSafeSegment(v)).toThrow("Invalid name");
		},
	);

	it("rejects dot segments in a GitLab owner or repo, and an empty owner", () => {
		expect(() => gitlabProjectId("a/../b", "r")).toThrow();
		expect(() => gitlabProjectId("a", "..")).toThrow();
		expect(() => gitlabProjectId("", "r")).toThrow();
		expect(() => gitlabProjectId("a//b", "r")).toThrow();
	});

	it("keeps Gitea/Gitee owner and repo to a single encoded segment each", () => {
		expect(ownerRepoPath("o", "my repo")).toBe("o/my%20repo");
		expect(() => ownerRepoPath("a/b", "r")).toThrow();
		expect(() => ownerRepoPath("..", "r")).toThrow();
	});

	it("accepts slashed refs but not empty or dot segments", () => {
		expect(assertSafeRef("feature/x")).toBe("feature/x");
		for (const bad of ["", "..", "a/../b", "a//b", "./a", "a\\b", "a\u0007"]) {
			expect(() => assertSafeRef(bad)).toThrow("Invalid ref");
		}
	});

	it("encodeSegments keeps separators and encodes the rest", () => {
		expect(encodeSegments("a b/c#d/é")).toBe("a%20b/c%23d/%C3%A9");
	});
});

describe("content helpers", () => {
	it("decodes text and flags binary by NUL byte", () => {
		expect(fileFromBase64("a.txt", b64("héllo"), 6)).toEqual({
			kind: "file",
			name: "a.txt",
			text: "héllo",
			isBinary: false,
			size: 6,
		});
		expect(
			fileFromBase64("x.bin", b64(Buffer.from([1, 0, 2])), 3),
		).toMatchObject({ text: null, isBinary: true });
	});

	it("tolerates line-wrapped base64", () => {
		const wrapped = `${b64("hello world").slice(0, 8)}\n${b64("hello world").slice(8)}`;
		expect(fileFromBase64("a", wrapped, 11)).toMatchObject({
			text: "hello world",
		});
	});

	it("sorts directories first, then by name", () => {
		const out = sortEntries([
			{ name: "b.ts", path: "b.ts", type: "file" },
			{ name: "z", path: "z", type: "dir" },
			{ name: "a.ts", path: "a.ts", type: "file" },
			{ name: "a", path: "a", type: "dir" },
		]);
		expect(out.map((e) => e.name)).toEqual(["a", "z", "a.ts", "b.ts"]);
	});
});

describe("pagination", () => {
	it("detects the next page from x-next-page or a Link header", () => {
		expect(hasNextPage(new Headers({ "x-next-page": "2" }))).toBe(true);
		expect(hasNextPage(new Headers({ "x-next-page": "" }))).toBe(false);
		expect(
			hasNextPage(new Headers({ link: '<https://h/x?page=2>; rel="next"' })),
		).toBe(true);
		expect(
			hasNextPage(new Headers({ link: '<https://h/x?page=1>; rel="prev"' })),
		).toBe(false);
		expect(hasNextPage(new Headers())).toBe(false);
	});

	it("never fetches more than the page bound, however long the server says to continue", async () => {
		let calls = 0;
		const items = await collectPages(async () => {
			calls++;
			return { items: [calls], hasNext: true };
		}, 3);
		expect(calls).toBe(3);
		expect(items).toEqual([1, 2, 3]);
	});

	it("stops at the first page without a next", async () => {
		let calls = 0;
		await collectPages(async () => {
			calls++;
			return { items: [], hasNext: false };
		}, 5);
		expect(calls).toBe(1);
	});
});

describe("createApiClient", () => {
	const ctx = (fetch: ReturnType<typeof fakeForge>["fetch"]) => ({
		forge: "gitlab" as const,
		host: "https://forge.test",
		token: "SECRET",
		fetch,
	});
	const auth = (t: string) => ({ "private-token": t });

	it("sends the token in a header and never in the URL", async () => {
		const f = fakeForge(() => json({ ok: 1 }));
		await createApiClient(ctx(f.fetch), auth).json("/api/x", {
			a: 1,
			b: "c d",
		});
		expect(f.calls[0].url).toBe("https://forge.test/api/x?a=1&b=c+d");
		expect(f.calls[0].url).not.toContain("SECRET");
		expect(f.calls[0].headers["private-token"]).toBe("SECRET");
	});

	it("omits undefined query values", async () => {
		const f = fakeForge(() => json({}));
		await createApiClient(ctx(f.fetch), auth).json("/p", {
			a: undefined,
			b: 2,
		});
		expect(f.calls[0].url).toBe("https://forge.test/p?b=2");
	});

	it("turns a non-2xx answer into a ForgeHttpError with the status and no body", async () => {
		const f = fakeForge(() => status(403));
		await expect(
			createApiClient(ctx(f.fetch), auth).json("/p"),
		).rejects.toMatchObject({ name: "ForgeHttpError", status: 403 });
	});

	it("reports invalid JSON as a 502 rather than leaking the parser error", async () => {
		const f = fakeForge(() => new Response("<html>", { status: 200 }));
		await expect(
			createApiClient(ctx(f.fetch), auth).json("/p"),
		).rejects.toMatchObject({ status: 502 });
	});

	it("re-validates a stored host and refuses a bad one", () => {
		const f = fakeForge(() => json({}));
		for (const host of [
			"http://forge.test",
			"https://u:p@forge.test",
			"https://forge.test/sub",
			"not a url",
		]) {
			expect(() => createApiClient({ ...ctx(f.fetch), host }, auth)).toThrow();
		}
	});

	it("streams without reading the body", async () => {
		const body = new ReadableStream({
			start: (c) => c.enqueue(new Uint8Array([1])),
		});
		const f = fakeForge(() => new Response(body, { status: 200 }));
		const out = await createApiClient(ctx(f.fetch), auth).stream("/a.zip");
		expect(out.kind).toBe("stream");
		if (out.kind === "stream") {
			expect(out.response.bodyUsed).toBe(false);
			expect(out.response.body).toBe(body);
		}
	});

	it("refuses to stream an absolute URL that is not on the instance", async () => {
		const f = fakeForge(() => new Response("x"));
		const api = createApiClient(ctx(f.fetch), auth);
		await expect(
			api.streamAbsolute("https://evil.test/a"),
		).rejects.toMatchObject({
			status: 404,
		});
		await expect(api.streamAbsolute("nonsense")).rejects.toMatchObject({
			status: 404,
		});
		await expect(
			api.streamAbsolute("https://forge.test:8443/a"),
		).rejects.toMatchObject({ status: 404 });
		expect(f.calls).toHaveLength(0);
	});

	it("allows cross-origin redirects only so the guarded fetch can strip the credential", async () => {
		const f = fakeForge(() => json({}));
		await createApiClient(ctx(f.fetch), auth).json("/p");
		expect(f.calls[0].allowCrossOrigin).toBe(true);
	});
});
