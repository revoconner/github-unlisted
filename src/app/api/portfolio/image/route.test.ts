// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	session: null as unknown,
	portfolios: new Map<string, Record<string, unknown>>(),
	images: new Map<string, unknown>(),
	fetch: vi.fn(),
}));

vi.mock("@/lib/session", async (orig) => ({
	...(await orig<typeof import("@/lib/session")>()),
	getSession: async () => mocks.session,
}));
vi.mock("@/lib/forge/safe-url", () => ({
	safeFetchFollowRedirects: (...a: unknown[]) => mocks.fetch(...a),
}));
vi.mock("@/lib/portfolio-store", () => ({
	getPortfolio: async (id: string) => mocks.portfolios.get(id) ?? null,
	getPortfolioImage: async (id: string) => mocks.images.get(id) ?? null,
	setPortfolioImage: async (id: string, img: unknown) => {
		if (!mocks.portfolios.has(id)) return null;
		mocks.images.set(id, img);
		return 123;
	},
	removePortfolioImage: async (id: string) => {
		mocks.images.delete(id);
	},
}));

import { DELETE, GET, POST } from "./route";

const be32 = (n: number) => [
	(n >>> 24) & 255,
	(n >>> 16) & 255,
	(n >>> 8) & 255,
	n & 255,
];
const PNG = Uint8Array.from([
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a,
	...be32(13),
	...[..."IHDR"].map((c) => c.charCodeAt(0)),
	...be32(64),
	...be32(64),
	8,
	6,
	0,
	0,
	0,
]);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

const post = (body: unknown) =>
	POST(
		new Request("https://app.test/api/portfolio/image", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	);

beforeEach(() => {
	mocks.fetch.mockReset();
	mocks.images.clear();
	mocks.portfolios.clear();
	mocks.portfolios.set("p1", {
		installationId: 7,
		label: "me",
		shareIds: ["s"],
	});
	mocks.portfolios.set("p2", {
		installationId: 99,
		label: "x",
		shareIds: ["s"],
	});
	mocks.session = {
		login: "me",
		userId: 1,
		installationIds: [7],
		connections: [],
		exp: 9e9,
	};
});

describe("POST /api/portfolio/image", () => {
	it("requires a session and ownership", async () => {
		mocks.session = null;
		expect((await post({ id: "p1", data: b64(PNG) })).status).toBe(401);
		mocks.session = {
			login: "me",
			userId: 1,
			installationIds: [7],
			connections: [],
			exp: 9e9,
		};
		expect((await post({ id: "p2", data: b64(PNG) })).status).toBe(403);
		expect(mocks.images.size).toBe(0);
	});

	it("stores an uploaded image after validating its bytes", async () => {
		const res = await post({ id: "p1", data: b64(PNG) });
		expect(res.status).toBe(200);
		expect(mocks.images.get("p1")).toMatchObject({ type: "image/png" });
	});

	it("refuses uploaded data that is not a supported image, whatever it claims", async () => {
		const svg = Buffer.from("<svg><script>1</script></svg>").toString("base64");
		const res = await post({ id: "p1", data: svg });
		expect(res.status).toBe(400);
		expect(mocks.images.size).toBe(0);
	});

	it("refuses malformed or oversized base64", async () => {
		expect((await post({ id: "p1", data: "not base64!!" })).status).toBe(400);
		expect((await post({ id: "p1", data: "A".repeat(500_000) })).status).toBe(
			400,
		);
		expect((await post({ id: "p1" })).status).toBe(400);
	});

	it("imports from a URL: fetched once by the server, with redirects allowed, then stored", async () => {
		mocks.fetch.mockResolvedValue(new Response(PNG, { status: 200 }));
		const res = await post({ id: "p1", url: "https://example.com/me.png" });
		expect(res.status).toBe(200);
		expect(mocks.fetch).toHaveBeenCalledTimes(1);
		expect(mocks.fetch.mock.calls[0][2]).toEqual({
			allowCrossOriginRedirect: true,
		});
		expect(mocks.images.get("p1")).toMatchObject({ type: "image/png" });
	});

	it("refuses non-https and credentialed URLs without fetching", async () => {
		for (const url of [
			"http://example.com/a.png",
			"ftp://x/a.png",
			"https://u:p@example.com/a.png",
			"nonsense",
		]) {
			expect((await post({ id: "p1", url })).status).toBe(400);
		}
		expect(mocks.fetch).not.toHaveBeenCalled();
	});

	it("does not reveal why a fetch failed (e.g. a blocked internal address)", async () => {
		mocks.fetch.mockRejectedValue(new Error("Address 10.0.0.5 is not allowed"));
		const res = await post({ id: "p1", url: "https://internal.example/a.png" });
		const body = await res.json();
		expect(res.status).toBe(400);
		expect(body.error).toBe("Could not download that URL");
		expect(JSON.stringify(body)).not.toContain("10.0.0.5");
	});

	it("refuses a URL that does not return an image, and one that is too big", async () => {
		mocks.fetch.mockResolvedValue(new Response("<html>", { status: 200 }));
		expect(
			(await post({ id: "p1", url: "https://example.com/a" })).status,
		).toBe(400);

		mocks.fetch.mockResolvedValue(new Response("x", { status: 404 }));
		expect(
			(await post({ id: "p1", url: "https://example.com/a" })).status,
		).toBe(400);

		mocks.fetch.mockResolvedValue(
			new Response(new Uint8Array(10), {
				status: 200,
				headers: { "content-length": "99999999" },
			}),
		);
		expect(
			(await post({ id: "p1", url: "https://example.com/a" })).status,
		).toBe(400);

		// No Content-Length: the cap must still hold while streaming.
		const big = new ReadableStream<Uint8Array>({
			pull(c) {
				c.enqueue(new Uint8Array(100_000));
			},
		});
		mocks.fetch.mockResolvedValue(new Response(big, { status: 200 }));
		expect(
			(await post({ id: "p1", url: "https://example.com/a" })).status,
		).toBe(400);
		expect(mocks.images.size).toBe(0);
	});
});

describe("DELETE /api/portfolio/image", () => {
	const del = (id: string) =>
		DELETE(
			new Request(`https://app.test/api/portfolio/image?id=${id}`, {
				method: "DELETE",
			}),
		);

	it("removes the picture of an owned portfolio only", async () => {
		mocks.images.set("p1", {});
		mocks.images.set("p2", {});
		expect((await del("p2")).status).toBe(403);
		expect(mocks.images.has("p2")).toBe(true);
		expect((await del("p1")).status).toBe(200);
		expect(mocks.images.has("p1")).toBe(false);
	});
});

describe("GET /api/portfolio/image", () => {
	const get = (id: string) =>
		GET(new Request(`https://app.test/api/portfolio/image?p=${id}`));

	it("serves the stored bytes with headers that stop a browser treating them as anything else", async () => {
		mocks.images.set("p1", { type: "image/png", data: b64(PNG) });
		const res = await get("p1");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-security-policy")).toContain("sandbox");
		expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG))).toBe(
			true,
		);
	});

	it("404s when there is no portfolio or no picture", async () => {
		expect((await get("p1")).status).toBe(404);
		expect((await get("missing")).status).toBe(404);
		expect((await get("")).status).toBe(404);
	});
});
