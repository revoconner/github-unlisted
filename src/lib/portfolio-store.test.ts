// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
	kv: new Map<string, string>(),
	ttls: new Map<string, number>(),
	sets: new Map<string, Set<string>>(),
	reset() {
		this.kv.clear();
		this.ttls.clear();
		this.sets.clear();
	},
}));

vi.mock("@upstash/redis", () => ({
	Redis: class {
		async set(key: string, value: unknown, opts?: { ex?: number }) {
			fake.kv.set(key, JSON.stringify(value));
			// Like Redis: a plain SET drops any TTL the key had.
			if (opts?.ex) fake.ttls.set(key, opts.ex);
			else fake.ttls.delete(key);
			return "OK";
		}
		async ttl(key: string) {
			if (!fake.kv.has(key)) return -2;
			return fake.ttls.get(key) ?? -1;
		}
		async get<T>(key: string): Promise<T | null> {
			const v = fake.kv.get(key);
			return v === undefined ? null : (JSON.parse(v) as T);
		}
		async del(...keys: string[]) {
			for (const k of keys) {
				fake.kv.delete(k);
				fake.ttls.delete(k);
				fake.sets.delete(k);
			}
			return keys.length;
		}
		async sadd(key: string, member: string) {
			const s = fake.sets.get(key) ?? new Set<string>();
			s.add(member);
			fake.sets.set(key, s);
			return 1;
		}
		async srem(key: string, member: string) {
			fake.sets.get(key)?.delete(member);
			return 1;
		}
		async smembers(key: string) {
			return [...(fake.sets.get(key) ?? [])];
		}
	},
}));

import {
	countPortfoliosFor,
	createPortfolio,
	deletePortfolio,
	deletePortfoliosForConnection,
	deletePortfoliosForInstallation,
	getPortfolio,
	getPortfolioImage,
	listPortfoliosForOwner,
	removePortfolioImage,
	setPortfolioImage,
	shareBelongsToOwner,
	updatePortfolio,
} from "./portfolio-store";
import type { ShareTarget } from "./share-store";

const CONN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
	fake.reset();
	process.env.KV_REST_API_URL = "https://redis.test";
	process.env.KV_REST_API_TOKEN = "t";
});

describe("portfolio store", () => {
	it("round-trips a GitHub portfolio and indexes it under its installation", async () => {
		const id = await createPortfolio({
			installationId: 7,
			label: "me",
			title: "Work",
			shareIds: ["s2", "s1"],
		});
		expect(fake.sets.get("inst:7:portfolios")?.has(id)).toBe(true);
		const p = await getPortfolio(id);
		expect(p).toMatchObject({
			title: "Work",
			shareIds: ["s2", "s1"],
			label: "me",
		});
		expect(p?.createdAt).toBeTypeOf("number");
	});

	it("does not collide with the share index keys", async () => {
		await createPortfolio({ installationId: 7, label: "me", shareIds: ["a"] });
		expect(fake.sets.has("inst:7")).toBe(false);
	});

	it("indexes a connection portfolio under conn:{id}:portfolios", async () => {
		const id = await createPortfolio({
			forge: "gitlab",
			connectionId: CONN,
			label: "me",
			shareIds: ["a"],
		});
		expect(fake.sets.get(`conn:${CONN}:portfolios`)?.has(id)).toBe(true);
	});

	it("refuses to create a record with two owners or none", async () => {
		await expect(
			createPortfolio({
				installationId: 1,
				connectionId: CONN,
				forge: "gitlab",
				label: "x",
				shareIds: ["a"],
			} as never),
		).rejects.toThrow();
		await expect(
			createPortfolio({ label: "x", shareIds: ["a"] } as never),
		).rejects.toThrow();
	});

	it("treats a corrupt stored record as missing (fails closed)", async () => {
		fake.kv.set(
			"portfolio:bad",
			JSON.stringify({ shareIds: "nope", label: "x" }),
		);
		fake.kv.set(
			"portfolio:both",
			JSON.stringify({
				shareIds: ["a"],
				label: "x",
				installationId: 1,
				connectionId: CONN,
				forge: "gitlab",
			}),
		);
		expect(await getPortfolio("bad")).toBeNull();
		expect(await getPortfolio("both")).toBeNull();
		expect(await getPortfolio("absent")).toBeNull();
	});

	it("update keeps untouched fields and the owner, and can clear a field", async () => {
		const id = await createPortfolio({
			installationId: 7,
			label: "me",
			title: "Old",
			description: "desc",
			shareIds: ["a"],
		});
		await updatePortfolio(id, { shareIds: ["b", "a"] });
		expect(await getPortfolio(id)).toMatchObject({
			title: "Old",
			description: "desc",
			installationId: 7,
			shareIds: ["b", "a"],
		});
		await updatePortfolio(id, { title: undefined });
		expect((await getPortfolio(id))?.title).toBeUndefined();
		expect(await updatePortfolio("absent", { title: "x" })).toBeNull();
	});

	it("lists across installations and connections, oldest first, pruning dangling index entries", async () => {
		const a = await createPortfolio({
			installationId: 7,
			label: "a",
			shareIds: ["x"],
		});
		const b = await createPortfolio({
			forge: "gitea",
			connectionId: CONN,
			label: "b",
			shareIds: ["y"],
		});
		await createPortfolio({
			installationId: 8,
			label: "other",
			shareIds: ["z"],
		});
		fake.sets.get("inst:7:portfolios")?.add("ghost");

		const out = await listPortfoliosForOwner({
			installationIds: [7],
			connectionIds: [CONN],
		});
		expect(out.map((p) => p.id).sort()).toEqual([a, b].sort());
		expect(fake.sets.get("inst:7:portfolios")?.has("ghost")).toBe(false);
	});

	it("deletes one portfolio and its index entry", async () => {
		const id = await createPortfolio({
			installationId: 7,
			label: "a",
			shareIds: ["x"],
		});
		expect(await countPortfoliosFor({ installationId: 7 })).toBe(1);
		await deletePortfolio(id);
		expect(await getPortfolio(id)).toBeNull();
		expect(await countPortfoliosFor({ installationId: 7 })).toBe(0);
	});

	it("account cleanup removes only that account's portfolios", async () => {
		const mine = await createPortfolio({
			installationId: 7,
			label: "a",
			shareIds: ["x"],
		});
		const other = await createPortfolio({
			installationId: 8,
			label: "b",
			shareIds: ["y"],
		});
		const conn = await createPortfolio({
			forge: "gitlab",
			connectionId: CONN,
			label: "c",
			shareIds: ["z"],
		});
		await deletePortfoliosForInstallation(7);
		await deletePortfoliosForConnection(CONN);
		expect(await getPortfolio(mine)).toBeNull();
		expect(await getPortfolio(conn)).toBeNull();
		expect(await getPortfolio(other)).not.toBeNull();
	});
});

describe("portfolio picture", () => {
	const png = { type: "image/png" as const, data: "AAAA" };

	it("stores the bytes apart from the record and flags the record with a version", async () => {
		const id = await createPortfolio({
			installationId: 7,
			label: "a",
			shareIds: ["x"],
		});
		const version = await setPortfolioImage(id, png);
		expect(version).toBeTypeOf("number");
		expect(await getPortfolioImage(id)).toEqual(png);
		expect((await getPortfolio(id))?.imageVersion).toBe(version);
		expect(JSON.stringify(fake.kv.get(`portfolio:${id}`))).not.toContain(
			"AAAA",
		);
	});

	it("refuses to attach a picture to a portfolio that does not exist", async () => {
		expect(await setPortfolioImage("ghost", png)).toBeNull();
		expect(await getPortfolioImage("ghost")).toBeNull();
	});

	it("removes the bytes and the flag", async () => {
		const id = await createPortfolio({
			installationId: 7,
			label: "a",
			shareIds: ["x"],
		});
		await setPortfolioImage(id, png);
		await removePortfolioImage(id);
		expect(await getPortfolioImage(id)).toBeNull();
		expect((await getPortfolio(id))?.imageVersion).toBeUndefined();
	});

	it("ignores a corrupt stored picture", async () => {
		fake.kv.set(
			"portfolio-img:x",
			JSON.stringify({ type: "image/svg+xml", data: "<svg/>" }),
		);
		expect(await getPortfolioImage("x")).toBeNull();
	});

	it("is deleted with the portfolio and with the account", async () => {
		const a = await createPortfolio({
			installationId: 7,
			label: "a",
			shareIds: ["x"],
		});
		const b = await createPortfolio({
			installationId: 8,
			label: "b",
			shareIds: ["y"],
		});
		await setPortfolioImage(a, png);
		await setPortfolioImage(b, png);
		await deletePortfolio(a);
		expect(fake.kv.has(`portfolio-img:${a}`)).toBe(false);
		await deletePortfoliosForInstallation(8);
		expect(fake.kv.has(`portfolio-img:${b}`)).toBe(false);
	});
});

describe("portfolio revoke window", () => {
	const png = { type: "image/png" as const, data: "AAAA" };

	it("records the expiry and sets the Redis TTL when a window is given", async () => {
		const id = await createPortfolio(
			{ installationId: 7, label: "a", shareIds: ["x"] },
			3600,
		);
		expect(fake.ttls.get(`portfolio:${id}`)).toBe(3600);
		const p = await getPortfolio(id);
		expect(p?.expiresAt).toBeGreaterThan(Date.now() + 3_590_000);
	});

	it("has no expiry and no TTL by default", async () => {
		const id = await createPortfolio({
			installationId: 7,
			label: "a",
			shareIds: ["x"],
		});
		expect(fake.ttls.has(`portfolio:${id}`)).toBe(false);
		expect((await getPortfolio(id))?.expiresAt).toBeUndefined();
	});

	it("keeps the remaining window when an unrelated field is updated (a plain SET would drop it)", async () => {
		const id = await createPortfolio(
			{ installationId: 7, label: "a", shareIds: ["x"] },
			3600,
		);
		fake.ttls.set(`portfolio:${id}`, 1234); // time has passed
		await updatePortfolio(id, { title: "Renamed" });
		expect(fake.ttls.get(`portfolio:${id}`)).toBe(1234);
		expect((await getPortfolio(id))?.title).toBe("Renamed");
	});

	it("replaces the window when asked, and clears it with null", async () => {
		const id = await createPortfolio(
			{ installationId: 7, label: "a", shareIds: ["x"] },
			3600,
		);
		await updatePortfolio(id, {}, { ttlSeconds: 60 });
		expect(fake.ttls.get(`portfolio:${id}`)).toBe(60);
		expect((await getPortfolio(id))?.expiresAt).toBeLessThan(
			Date.now() + 61_000,
		);
		await updatePortfolio(id, {}, { ttlSeconds: null });
		expect(fake.ttls.has(`portfolio:${id}`)).toBe(false);
		expect((await getPortfolio(id))?.expiresAt).toBeUndefined();
	});

	it("makes the picture expire with the portfolio, including when the window changes", async () => {
		const id = await createPortfolio(
			{ installationId: 7, label: "a", shareIds: ["x"] },
			3600,
		);
		await setPortfolioImage(id, png);
		expect(fake.ttls.get(`portfolio-img:${id}`)).toBe(3600);
		await updatePortfolio(id, {}, { ttlSeconds: 120 });
		expect(fake.ttls.get(`portfolio-img:${id}`)).toBe(120);
		await updatePortfolio(id, {}, { ttlSeconds: null });
		expect(fake.ttls.has(`portfolio-img:${id}`)).toBe(false);
	});

	it("does not strip the window when the picture changes", async () => {
		const id = await createPortfolio(
			{ installationId: 7, label: "a", shareIds: ["x"] },
			3600,
		);
		await setPortfolioImage(id, png);
		expect(fake.ttls.get(`portfolio:${id}`)).toBe(3600);
	});
});

describe("shareBelongsToOwner", () => {
	const gh = (installationId: number): ShareTarget => ({
		installationId,
		owner: "o",
		repo: "r",
	});
	const cn = (
		forge: "gitlab" | "gitea",
		connectionId: string,
	): ShareTarget => ({
		forge,
		connectionId,
		owner: "o",
		repo: "r",
	});

	it("matches the same installation only", () => {
		expect(shareBelongsToOwner({ installationId: 7 }, gh(7))).toBe(true);
		expect(shareBelongsToOwner({ installationId: 7 }, gh(8))).toBe(false);
	});

	it("matches the same connection and forge only", () => {
		const owner = { forge: "gitlab" as const, connectionId: CONN };
		expect(shareBelongsToOwner(owner, cn("gitlab", CONN))).toBe(true);
		expect(shareBelongsToOwner(owner, cn("gitea", CONN))).toBe(false);
		expect(shareBelongsToOwner(owner, cn("gitlab", "other"))).toBe(false);
	});

	it("never mixes a GitHub share into a connection portfolio or the reverse", () => {
		expect(
			shareBelongsToOwner({ forge: "gitlab", connectionId: CONN }, gh(7)),
		).toBe(false);
		expect(shareBelongsToOwner({ installationId: 7 }, cn("gitlab", CONN))).toBe(
			false,
		);
	});
});
