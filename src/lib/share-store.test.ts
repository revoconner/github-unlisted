// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// A small in-memory stand-in for the Upstash client, covering only what share-store calls. Values are JSON-cloned on the way in and out because the real client serialises them, which is also what drops `undefined` fields.
const fake = vi.hoisted(() => {
	const kv = new Map<string, string>();
	const sets = new Map<string, Set<string>>();
	const expiry = new Map<string, number>();
	return {
		kv,
		sets,
		expiry,
		reset() {
			kv.clear();
			sets.clear();
			expiry.clear();
		},
	};
});

vi.mock("@upstash/redis", () => ({
	Redis: class {
		async set(key: string, value: unknown, opts?: { ex?: number }) {
			fake.kv.set(key, JSON.stringify(value));
			if (opts?.ex) fake.expiry.set(key, opts.ex);
			else fake.expiry.delete(key);
			return "OK";
		}
		async get<T>(key: string): Promise<T | null> {
			const v = fake.kv.get(key);
			return v === undefined ? null : (JSON.parse(v) as T);
		}
		async ttl(key: string) {
			if (!fake.kv.has(key)) return -2;
			return fake.expiry.get(key) ?? -1;
		}
		async del(...keys: string[]) {
			for (const k of keys) {
				fake.kv.delete(k);
				fake.sets.delete(k);
				fake.expiry.delete(k);
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
	createShare,
	deleteShare,
	deleteSharesForConnection,
	deleteSharesForInstallation,
	deleteSharesForRepos,
	listSharesForConnection,
	listSharesForInstallation,
	listSharesForOwner,
	resolveShare,
	shareForge,
	updateShareSettings,
	updateShareTtl,
} from "./share-store";

const CONN_A = "11111111-1111-4111-8111-111111111111";
const CONN_B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
	fake.reset();
	process.env.KV_REST_API_URL = "https://redis.test";
	process.env.KV_REST_API_TOKEN = "t";
	delete process.env.UPSTASH_REDIS_REST_URL;
	delete process.env.UPSTASH_REDIS_REST_TOKEN;
	delete process.env.SHARE_LINK_TTL_SECONDS;
});

describe("GitHub shares keep their original storage", () => {
	it("indexes under inst:{id} and resolves without a forge field", async () => {
		const id = await createShare({ installationId: 7, owner: "o", repo: "r" });
		expect(fake.sets.get("inst:7")?.has(id)).toBe(true);
		const t = await resolveShare(id);
		expect(t).toMatchObject({ installationId: 7, owner: "o", repo: "r" });
		expect(t?.forge).toBeUndefined();
		expect(shareForge(t as NonNullable<typeof t>)).toBe("github");
	});

	it("still resolves a record written before multi-forge support", async () => {
		fake.kv.set(
			"share:legacy",
			JSON.stringify({ installationId: 9, owner: "a", repo: "b", ref: "main" }),
		);
		expect(await resolveShare("legacy")).toMatchObject({
			installationId: 9,
			ref: "main",
		});
	});

	it("lists and deletes through the installation index", async () => {
		const a = await createShare({ installationId: 7, owner: "o", repo: "r" });
		await createShare({ installationId: 8, owner: "o", repo: "x" });
		expect((await listSharesForInstallation(7)).map((s) => s.id)).toEqual([a]);
		await deleteSharesForInstallation(7);
		expect(await resolveShare(a)).toBeNull();
		expect(fake.sets.has("inst:7")).toBe(false);
		expect(fake.sets.get("inst:8")?.size).toBe(1);
	});

	it("deleteSharesForRepos removes only the named repositories", async () => {
		const keep = await createShare({
			installationId: 7,
			owner: "o",
			repo: "keep",
		});
		const drop = await createShare({
			installationId: 7,
			owner: "o",
			repo: "Drop",
		});
		await deleteSharesForRepos(7, ["o/drop"]);
		expect(await resolveShare(drop)).toBeNull();
		expect(await resolveShare(keep)).not.toBeNull();
	});
});

describe("connection shares", () => {
	it("index under conn:{id}:shares and never under inst:", async () => {
		const id = await createShare({
			forge: "gitlab",
			connectionId: CONN_A,
			owner: "group/sub",
			repo: "project",
		});
		expect(fake.sets.get(`conn:${CONN_A}:shares`)?.has(id)).toBe(true);
		expect([...fake.sets.keys()].some((k) => k.startsWith("inst:"))).toBe(
			false,
		);
		expect(await resolveShare(id)).toMatchObject({
			forge: "gitlab",
			connectionId: CONN_A,
			owner: "group/sub",
		});
	});

	it("lists per connection and across an owner's installations and connections", async () => {
		const gh = await createShare({ installationId: 7, owner: "o", repo: "r" });
		const a = await createShare({
			forge: "gitlab",
			connectionId: CONN_A,
			owner: "g",
			repo: "p",
		});
		const b = await createShare({
			forge: "gitea",
			connectionId: CONN_B,
			owner: "u",
			repo: "q",
		});
		expect((await listSharesForConnection(CONN_A)).map((s) => s.id)).toEqual([
			a,
		]);
		const all = await listSharesForOwner({
			installationIds: [7],
			connectionIds: [CONN_A, CONN_B],
		});
		expect(all.map((s) => s.id).sort()).toEqual([gh, a, b].sort());
		const onlyA = await listSharesForOwner({
			installationIds: [],
			connectionIds: [CONN_A],
		});
		expect(onlyA.map((s) => s.id)).toEqual([a]);
	});

	it("deleteSharesForConnection removes that connection's shares and nothing else", async () => {
		const a1 = await createShare({
			forge: "gitlab",
			connectionId: CONN_A,
			owner: "g",
			repo: "p",
		});
		const a2 = await createShare({
			forge: "gitlab",
			connectionId: CONN_A,
			owner: "g",
			repo: "p2",
		});
		const b = await createShare({
			forge: "gitea",
			connectionId: CONN_B,
			owner: "u",
			repo: "q",
		});
		const gh = await createShare({ installationId: 7, owner: "o", repo: "r" });
		await deleteSharesForConnection(CONN_A);
		expect(await resolveShare(a1)).toBeNull();
		expect(await resolveShare(a2)).toBeNull();
		expect(fake.sets.has(`conn:${CONN_A}:shares`)).toBe(false);
		expect(await resolveShare(b)).not.toBeNull();
		expect(await resolveShare(gh)).not.toBeNull();
	});

	it("deleteShare removes the record and its index entry for both kinds", async () => {
		const a = await createShare({
			forge: "gitlab",
			connectionId: CONN_A,
			owner: "g",
			repo: "p",
		});
		const gh = await createShare({ installationId: 7, owner: "o", repo: "r" });
		await deleteShare(a);
		await deleteShare(gh);
		expect(fake.sets.get(`conn:${CONN_A}:shares`)?.size).toBe(0);
		expect(fake.sets.get("inst:7")?.size).toBe(0);
	});

	it("prunes dangling index entries when listing", async () => {
		const id = await createShare({
			forge: "gitlab",
			connectionId: CONN_A,
			owner: "g",
			repo: "p",
		});
		fake.kv.delete(`share:${id}`); // as if the TTL elapsed
		expect(await listSharesForConnection(CONN_A)).toEqual([]);
		expect(fake.sets.get(`conn:${CONN_A}:shares`)?.size).toBe(0);
	});

	it("round-trips share options and the optional TTL", async () => {
		process.env.SHARE_LINK_TTL_SECONDS = "3600";
		const id = await createShare({
			forge: "gitea",
			connectionId: CONN_B,
			owner: "u",
			repo: "q",
			ref: "main",
			allowDownload: true,
			showReleases: true,
		});
		expect(fake.expiry.get(`share:${id}`)).toBe(3600);
		expect(await resolveShare(id)).toMatchObject({
			ref: "main",
			allowDownload: true,
			showReleases: true,
		});
	});
});

describe("record validation (fail closed)", () => {
	it.each([
		[
			"connection id with a key-injection suffix",
			{ forge: "gitlab", connectionId: "x:shares", owner: "o", repo: "r" },
		],
		[
			"connection forge without a connection id",
			{ forge: "gitlab", owner: "o", repo: "r" },
		],
		[
			"unknown forge",
			{ forge: "bitbucket", connectionId: CONN_A, owner: "o", repo: "r" },
		],
		[
			"github share without an installation",
			{ forge: "github", owner: "o", repo: "r" },
		],
		[
			"both identifiers",
			{
				forge: "gitlab",
				installationId: 1,
				connectionId: CONN_A,
				owner: "o",
				repo: "r",
			},
		],
		[
			"github share carrying a connection id",
			{ installationId: 1, connectionId: CONN_A, owner: "o", repo: "r" },
		],
		["missing repo", { installationId: 1, owner: "o" }],
		["not an object", "oops"],
	])("resolves %s as missing", async (_name, record) => {
		fake.kv.set("share:bad", JSON.stringify(record));
		expect(await resolveShare("bad")).toBeNull();
	});

	it("refuses to create a malformed share", async () => {
		await expect(
			createShare({ forge: "gitlab", owner: "o", repo: "r" } as never),
		).rejects.toThrow("Invalid share target");
		await expect(
			createShare({
				forge: "gitlab",
				connectionId: "../../x",
				owner: "o",
				repo: "r",
			}),
		).rejects.toThrow();
	});
});

describe("updates", () => {
	it("updateShareSettings keeps the running TTL instead of restarting it", async () => {
		const id = await createShare(
			{ forge: "gitlab", connectionId: CONN_A, owner: "g", repo: "p" },
			600,
		);
		fake.expiry.set(`share:${id}`, 120); // pretend time has passed
		const next = await updateShareSettings(id, { allowDownload: true });
		expect(next).toMatchObject({ allowDownload: true, connectionId: CONN_A });
		expect(fake.expiry.get(`share:${id}`)).toBe(120);
	});

	it("updateShareTtl resets or clears the window", async () => {
		const id = await createShare(
			{ installationId: 7, owner: "o", repo: "r" },
			600,
		);
		await updateShareTtl(id, 60);
		expect(fake.expiry.get(`share:${id}`)).toBe(60);
		await updateShareTtl(id, null);
		expect(fake.expiry.has(`share:${id}`)).toBe(false);
	});

	it("returns null when updating a share that does not exist or is malformed", async () => {
		expect(await updateShareSettings("missing", { ref: "x" })).toBeNull();
		fake.kv.set("share:bad", JSON.stringify({ nope: true }));
		expect(await updateShareTtl("bad", 10)).toBeNull();
	});
});
