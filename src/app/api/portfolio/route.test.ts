// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONN = "11111111-1111-4111-8111-111111111111";

const mocks = vi.hoisted(() => ({
	session: null as unknown,
	shares: new Map<string, Record<string, unknown>>(),
	portfolios: new Map<string, Record<string, unknown>>(),
	createdPortfolio: [] as { input: unknown; ttl: unknown }[],
	createdShares: [] as { target: Record<string, unknown>; ttl: unknown }[],
	deletedShares: [] as string[],
	deletedPortfolios: [] as string[],
	ttlUpdates: [] as { id: string; ttl: unknown }[],
	settingUpdates: [] as { id: string; patch: unknown }[],
	portfolioUpdates: [] as {
		patch: Record<string, unknown>;
		options: unknown;
	}[],
	failShareAt: -1,
	caps: { releases: true, archive: true },
	repos: [] as { owner: string; name: string }[],
}));

vi.mock("@/lib/session", async (orig) => ({
	...(await orig<typeof import("@/lib/session")>()),
	getSession: async () => mocks.session,
}));
vi.mock("@/lib/share-store", () => ({
	resolveShare: async (id: string) => mocks.shares.get(id) ?? null,
	listSharesForOwner: async () =>
		[...mocks.shares.entries()].map(([id, s]) => ({ id, ...s })),
	createShare: async (target: Record<string, unknown>, ttl: unknown) => {
		if (mocks.createdShares.length === mocks.failShareAt) {
			throw new Error("redis down");
		}
		const id = `new-share-${mocks.createdShares.length + 1}`;
		mocks.createdShares.push({ target, ttl });
		mocks.shares.set(id, target);
		return id;
	},
	deleteShare: async (id: string) => {
		mocks.deletedShares.push(id);
		mocks.shares.delete(id);
	},
	updateShareTtl: async (id: string, ttl: unknown) => {
		mocks.ttlUpdates.push({ id, ttl });
	},
	updateShareSettings: async (id: string, patch: unknown) => {
		mocks.settingUpdates.push({ id, patch });
	},
}));
vi.mock("@/lib/forge/github", () => ({
	createGitHubAdapter: () => ({
		capabilities: mocks.caps,
		listRepos: async () => mocks.repos,
	}),
}));
vi.mock("@/lib/forge/target", () => ({
	adapterForTarget: async () => ({ capabilities: mocks.caps }),
}));
vi.mock("@/lib/forge/connections", () => ({
	adapterForConnection: async () => ({
		capabilities: mocks.caps,
		listRepos: async () => mocks.repos,
	}),
}));
vi.mock("@/lib/portfolio-store", async (orig) => ({
	...(await orig<typeof import("@/lib/portfolio-store")>()),
	countPortfoliosFor: async () => mocks.portfolios.size,
	createPortfolio: async (input: unknown, ttl: unknown) => {
		mocks.createdPortfolio.push({ input, ttl });
		mocks.portfolios.set("new-id", { ...(input as object) });
		return "new-id";
	},
	getPortfolio: async (id: string) => mocks.portfolios.get(id) ?? null,
	updatePortfolio: async (
		id: string,
		patch: Record<string, unknown>,
		options: unknown,
	) => {
		mocks.portfolioUpdates.push({ patch, options });
		const next = { ...mocks.portfolios.get(id), ...patch };
		mocks.portfolios.set(id, next);
		return next;
	},
	deletePortfolio: async (id: string) => {
		mocks.deletedPortfolios.push(id);
		mocks.portfolios.delete(id);
	},
}));

import { DELETE, PATCH, POST } from "./route";

const req = (
	method: string,
	body?: unknown,
	url = "https://app.test/api/portfolio",
) =>
	new Request(url, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});

const gh = (installationId: number, repo = "r", extra: object = {}) => ({
	installationId,
	owner: "me",
	repo,
	...extra,
});

beforeEach(() => {
	for (const k of [
		"createdPortfolio",
		"createdShares",
		"deletedShares",
		"deletedPortfolios",
		"ttlUpdates",
		"settingUpdates",
		"portfolioUpdates",
	] as const) {
		mocks[k].length = 0;
	}
	mocks.failShareAt = -1;
	mocks.caps = { releases: true, archive: true };
	mocks.repos = [
		{ owner: "me", name: "fresh" },
		{ owner: "me", name: "fresh2" },
		{ owner: "me", name: "a" },
	];
	mocks.shares.clear();
	mocks.portfolios.clear();
	mocks.session = {
		login: "me",
		userId: 1,
		installationIds: [7],
		connections: [],
		exp: 9e9,
	};
	mocks.shares.set("s1", gh(7, "a"));
	mocks.shares.set("s2", gh(7, "b"));
	mocks.shares.set("foreign", gh(99, "x"));
});

describe("POST /api/portfolio", () => {
	it("requires a session", async () => {
		mocks.session = null;
		expect((await POST(req("POST", {}))).status).toBe(401);
	});

	it("creates a portfolio from existing shares, keeping order and cleaning the title", async () => {
		const res = await POST(
			req("POST", {
				installationId: 7,
				title: "  My \n work ",
				description: "hi",
				shareIds: ["s2", "s1"],
			}),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			id: "new-id",
			url: "https://app.test/portfolio?p=new-id",
		});
		expect(mocks.createdPortfolio[0].input).toMatchObject({
			installationId: 7,
			label: "me",
			title: "My work",
			description: "hi",
		});
		expect(mocks.portfolioUpdates[0].patch).toEqual({ shareIds: ["s2", "s1"] });
		// Nothing was created: both were already shared.
		expect(mocks.createdShares).toHaveLength(0);
	});

	it("refuses an installation the session does not hold", async () => {
		const res = await POST(
			req("POST", { installationId: 8, shareIds: ["s1"] }),
		);
		expect(res.status).toBe(403);
		expect(mocks.createdPortfolio).toHaveLength(0);
	});

	it("refuses a share that belongs to someone else's account", async () => {
		const res = await POST(
			req("POST", { installationId: 7, shareIds: ["s1", "foreign"] }),
		);
		expect(res.status).toBe(403);
		expect(mocks.createdPortfolio).toHaveLength(0);
	});

	it("refuses to mix two accounts the session holds in one portfolio", async () => {
		mocks.session = {
			login: "me",
			userId: 1,
			installationIds: [7, 8],
			connections: [],
			exp: 9e9,
		};
		mocks.shares.set("other-account", gh(8, "z"));
		const res = await POST(
			req("POST", { installationId: 7, shareIds: ["s1", "other-account"] }),
		);
		expect(res.status).toBe(403);
	});

	it("refuses a share that no longer exists", async () => {
		expect(
			(await POST(req("POST", { installationId: 7, shareIds: ["gone"] })))
				.status,
		).toBe(400);
	});

	it("validates the list and the per-account cap", async () => {
		expect(
			(await POST(req("POST", { installationId: 7, shareIds: [] }))).status,
		).toBe(400);
		expect((await POST(req("POST", { installationId: 7 }))).status).toBe(400);
		for (let i = 0; i < 10; i++) mocks.portfolios.set(`p${i}`, {});
		expect(
			(await POST(req("POST", { installationId: 7, shareIds: ["s1"] }))).status,
		).toBe(400);
	});

	it("creates a connection portfolio only for a connection in the session", async () => {
		mocks.session = {
			login: "me",
			userId: 1,
			installationIds: [],
			connections: [
				{
					id: CONN,
					forge: "gitlab",
					host: "https://gitlab.com",
					login: "gl-me",
				},
			],
			exp: 9e9,
		};
		mocks.shares.set("c1", {
			forge: "gitlab",
			connectionId: CONN,
			owner: "g",
			repo: "r",
		});
		expect(
			(await POST(req("POST", { connectionId: CONN, shareIds: ["c1"] })))
				.status,
		).toBe(200);
		expect(mocks.createdPortfolio[0].input).toMatchObject({
			forge: "gitlab",
			connectionId: CONN,
			label: "gl-me",
		});
		const other = "22222222-2222-4222-8222-222222222222";
		expect(
			(await POST(req("POST", { connectionId: other, shareIds: ["c1"] })))
				.status,
		).toBe(403);
	});
});

describe("POST: repositories that are not shared yet", () => {
	const post = (items: unknown[], extra: object = {}) =>
		POST(req("POST", { installationId: 7, items, ...extra }));

	it("creates a link per new repository, in order, with the portfolio's id and the one revoke window", async () => {
		const res = await post(
			[
				{ shareId: "s1" },
				{
					owner: "me",
					repo: "fresh",
					showReleases: true,
					allowDownload: true,
					showBranches: true,
				},
				{ owner: "me", repo: "fresh2" },
			],
			{ ttlSeconds: 86400 },
		);
		expect(res.status).toBe(200);
		expect(mocks.createdPortfolio[0].ttl).toBe(86400);
		expect(mocks.createdShares).toHaveLength(2);
		expect(mocks.createdShares[0]).toMatchObject({
			ttl: 86400,
			target: {
				installationId: 7,
				owner: "me",
				repo: "fresh",
				portfolioId: "new-id",
				showReleases: true,
				allowDownload: true,
				showBranches: true,
			},
		});
		expect(mocks.createdShares[1].ttl).toBe(86400);
		// The list keeps the owner's order, mixing the existing and the new.
		expect(mocks.portfolioUpdates[0].patch).toEqual({
			shareIds: ["s1", "new-share-1", "new-share-2"],
		});
	});

	it("defaults every option to off", async () => {
		await post([{ owner: "me", repo: "fresh" }]);
		const t = mocks.createdShares[0].target;
		expect(t.showReleases).toBeUndefined();
		expect(t.allowDownload).toBeUndefined();
		expect(t.showBranches).toBeUndefined();
	});

	it("never stores an option the forge cannot honour", async () => {
		mocks.caps = { releases: false, archive: false };
		await post([
			{
				owner: "me",
				repo: "fresh",
				showReleases: true,
				allowDownload: true,
				showBranches: true,
			},
		]);
		const t = mocks.createdShares[0].target;
		expect(t.showReleases).toBeUndefined();
		expect(t.allowDownload).toBeUndefined();
		// Branch listing is not a forge capability, so it is kept.
		expect(t.showBranches).toBe(true);
	});

	it("uses no expiry only when 'never' is asked for explicitly", async () => {
		await post([{ owner: "me", repo: "fresh" }]);
		expect(mocks.createdPortfolio[0].ttl).toBeNull();
		expect(mocks.createdShares[0].ttl).toBeNull();
	});

	it("rejects a malformed or out-of-range revoke date instead of treating it as 'never'", async () => {
		// NaN is deliberately absent: JSON has no NaN, it serialises to null, which
		// is the explicit "never". The editor therefore has to refuse to send one.
		for (const ttlSeconds of [0, -5, "soon", 1e12, {}, [], true]) {
			const res = await post([{ owner: "me", repo: "fresh" }], { ttlSeconds });
			expect(res.status).toBe(400);
		}
		expect(mocks.createdPortfolio).toHaveLength(0);
		expect(mocks.createdShares).toHaveLength(0);
	});

	it("refuses a repository that is not in the account's listing, creating nothing", async () => {
		const res = await post([
			{ owner: "me", repo: "fresh" },
			{ owner: "me", repo: "not-mine" },
		]);
		expect(res.status).toBe(403);
		expect(mocks.createdPortfolio).toHaveLength(0);
		expect(mocks.createdShares).toHaveLength(0);
	});

	it("refuses a repository that already has a link, instead of duplicating access", async () => {
		const res = await post([{ owner: "me", repo: "a" }]);
		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/already shared/);
		expect(mocks.createdShares).toHaveLength(0);
	});

	it("refuses a link managed by another portfolio", async () => {
		mocks.shares.set("managed", gh(7, "m", { portfolioId: "other-portfolio" }));
		expect((await post([{ shareId: "managed" }])).status).toBe(400);
	});

	it("undoes everything if a link cannot be created: no orphan links, no empty page", async () => {
		mocks.failShareAt = 1; // the second creation fails
		const res = await post([
			{ owner: "me", repo: "fresh" },
			{ owner: "me", repo: "fresh2" },
		]);
		expect(res.status).toBe(502);
		expect(mocks.deletedShares).toEqual(["new-share-1"]);
		expect(mocks.deletedPortfolios).toEqual(["new-id"]);
	});
});

describe("PATCH /api/portfolio", () => {
	beforeEach(() => {
		mocks.portfolios.set("p1", {
			installationId: 7,
			label: "me",
			title: "Old",
			shareIds: ["s1"],
		});
	});

	it("only touches the fields that were sent", async () => {
		expect((await PATCH(req("PATCH", { id: "p1", title: "New" }))).status).toBe(
			200,
		);
		expect(mocks.portfolios.get("p1")).toMatchObject({
			title: "New",
			shareIds: ["s1"],
		});
		// No revoke date was sent, so the window must not be replaced.
		expect(mocks.portfolioUpdates[0].options).toBeUndefined();
	});

	it("reorders", async () => {
		await PATCH(req("PATCH", { id: "p1", shareIds: ["s2", "s1"] }));
		expect(mocks.portfolios.get("p1")?.shareIds).toEqual(["s2", "s1"]);
	});

	it("clears the title when sent empty", async () => {
		await PATCH(req("PATCH", { id: "p1", title: "   " }));
		expect(mocks.portfolios.get("p1")?.title).toBeUndefined();
	});

	it("is forbidden for a session that does not own the portfolio", async () => {
		mocks.portfolios.set("p2", {
			installationId: 99,
			label: "x",
			shareIds: ["foreign"],
		});
		expect((await PATCH(req("PATCH", { id: "p2", title: "pwn" }))).status).toBe(
			403,
		);
		expect(mocks.portfolios.get("p2")?.title).toBeUndefined();
	});

	it("refuses to add a foreign share to an owned portfolio", async () => {
		const res = await PATCH(
			req("PATCH", { id: "p1", shareIds: ["s1", "foreign"] }),
		);
		expect(res.status).toBe(403);
		expect(mocks.portfolios.get("p1")?.shareIds).toEqual(["s1"]);
	});

	it("404s an unknown id", async () => {
		expect((await PATCH(req("PATCH", { id: "nope" }))).status).toBe(404);
	});

	it("gives a repository added later what is left of the current revoke window", async () => {
		mocks.portfolios.set("p1", {
			installationId: 7,
			label: "me",
			shareIds: ["s1"],
			expiresAt: Date.now() + 3_600_000,
		});
		await PATCH(
			req("PATCH", {
				id: "p1",
				items: [{ shareId: "s1" }, { owner: "me", repo: "fresh" }],
			}),
		);
		const ttl = mocks.createdShares[0].ttl as number;
		expect(ttl).toBeGreaterThan(3590);
		expect(ttl).toBeLessThanOrEqual(3600);
		expect(mocks.createdShares[0].target.portfolioId).toBe("p1");
	});

	it("revokes a link the portfolio created when it is removed, but only detaches one the owner made", async () => {
		mocks.shares.set("managed", gh(7, "m", { portfolioId: "p1" }));
		mocks.portfolios.set("p1", {
			installationId: 7,
			label: "me",
			shareIds: ["s1", "managed", "s2"],
		});
		await PATCH(req("PATCH", { id: "p1", items: [{ shareId: "s1" }] }));
		expect(mocks.deletedShares).toEqual(["managed"]);
		expect(mocks.shares.has("s2")).toBe(true);
		expect(mocks.portfolios.get("p1")?.shareIds).toEqual(["s1"]);
	});

	it("changes the options of a managed link, clamped, and ignores them on one the owner made", async () => {
		mocks.shares.set("managed", gh(7, "m", { portfolioId: "p1" }));
		mocks.portfolios.set("p1", {
			installationId: 7,
			label: "me",
			shareIds: ["managed", "s1"],
		});
		mocks.caps = { releases: false, archive: true };
		await PATCH(
			req("PATCH", {
				id: "p1",
				items: [
					{
						shareId: "managed",
						showReleases: true,
						allowDownload: true,
						showBranches: false,
					},
					{ shareId: "s1", showReleases: true, allowDownload: true },
				],
			}),
		);
		expect(mocks.settingUpdates).toEqual([
			{
				id: "managed",
				patch: {
					showReleases: undefined,
					allowDownload: true,
					showBranches: undefined,
				},
			},
		]);
	});

	it("moves the revoke date of the page and of every link it manages, not of the owner's own", async () => {
		mocks.shares.set("managed", gh(7, "m", { portfolioId: "p1" }));
		mocks.portfolios.set("p1", {
			installationId: 7,
			label: "me",
			shareIds: ["s1", "managed"],
		});
		await PATCH(req("PATCH", { id: "p1", ttlSeconds: 7200 }));
		expect(mocks.portfolioUpdates[0].options).toEqual({ ttlSeconds: 7200 });
		expect(mocks.ttlUpdates).toEqual([{ id: "managed", ttl: 7200 }]);
	});

	it("can clear the revoke date with an explicit null", async () => {
		mocks.shares.set("managed", gh(7, "m", { portfolioId: "p1" }));
		mocks.portfolios.set("p1", {
			installationId: 7,
			label: "me",
			shareIds: ["managed"],
		});
		await PATCH(req("PATCH", { id: "p1", ttlSeconds: null }));
		expect(mocks.portfolioUpdates[0].options).toEqual({ ttlSeconds: null });
		expect(mocks.ttlUpdates).toEqual([{ id: "managed", ttl: null }]);
	});

	it("rejects a malformed revoke date without changing anything", async () => {
		const res = await PATCH(
			req("PATCH", { id: "p1", ttlSeconds: "never", title: "X" }),
		);
		expect(res.status).toBe(400);
		expect(mocks.portfolioUpdates).toHaveLength(0);
	});
});

describe("DELETE /api/portfolio", () => {
	const del = (id: string) =>
		DELETE(req("DELETE", undefined, `https://app.test/api/portfolio?id=${id}`));

	it("deletes an owned portfolio and the links it created, but not the owner's own", async () => {
		mocks.shares.set("managed", gh(7, "m", { portfolioId: "p1" }));
		mocks.portfolios.set("p1", {
			installationId: 7,
			label: "me",
			shareIds: ["s1", "managed"],
		});
		expect((await del("p1")).status).toBe(200);
		expect(mocks.portfolios.has("p1")).toBe(false);
		expect(mocks.deletedShares).toEqual(["managed"]);
		expect(mocks.shares.has("s1")).toBe(true);
	});

	it("is idempotent for a portfolio that is already gone", async () => {
		expect((await del("nope")).status).toBe(200);
	});

	it("is forbidden for someone else's portfolio, which stays intact", async () => {
		mocks.portfolios.set("p2", {
			installationId: 99,
			label: "x",
			shareIds: ["foreign"],
		});
		expect((await del("p2")).status).toBe(403);
		expect(mocks.portfolios.has("p2")).toBe(true);
		expect(mocks.deletedShares).toHaveLength(0);
	});
});
