import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const jarOptions = new Map<string, Record<string, unknown> | undefined>();
vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
		set: (key: string, value: string, options?: Record<string, unknown>) => {
			jar.set(key, value);
			jarOptions.set(key, options);
		},
		delete: (key: string) => {
			jar.delete(key);
			jarOptions.delete(key);
		},
	}),
}));

import {
	addConnection,
	clearSession,
	getSession,
	ownsConnection,
	removeConnection,
	serializeSession,
	setSession,
	sessionOwnsTarget,
	updateSessionConnections,
} from "./session";

const DAY = 86400 * 1000;
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const conn = (id: string) => ({ id, forge: "gitlab" as const, host: "https://gitlab.com", login: "alice" });

function b64url(buf: Buffer): string {
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

beforeEach(() => {
	jar.clear();
	jarOptions.clear();
	process.env.SESSION_SECRET = "test-secret";
	vi.useRealTimers();
});

describe("session lifetime", () => {
	it("defaults to a 30 day session", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
		await setSession({ login: "a", userId: 1, installationIds: [] });
		const s = await getSession();
		expect(s?.exp).toBe(Math.floor(Date.now() / 1000) + 30 * 86400);
		expect(jarOptions.get("ur_session")?.maxAge).toBe(30 * 86400);
	});

	it("uses the exact selected expiration timestamp", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
		const expiresAt = Date.now() + 17 * DAY + 12_345;
		await setSession({ login: "a", userId: 1, installationIds: [], expiresAt });
		const s = await getSession();
		expect(s?.exp).toBe(Math.floor(expiresAt / 1000));
		expect(jarOptions.get("ur_session")?.maxAge).toBe(Math.floor(expiresAt / 1000) - Math.floor(Date.now() / 1000));
	});

	it("expires at or after the stored second", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
		const expiresAt = Date.now() + 3600_000;
		await setSession({ login: "a", userId: 1, installationIds: [], expiresAt });
		vi.setSystemTime(new Date(expiresAt));
		expect(await getSession()).toBeNull();
	});

	it("does not extend expiration when connections change", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
		const expiresAt = Date.now() + 10 * DAY;
		await setSession({ login: "a", userId: 1, installationIds: [], expiresAt });
		const first = await getSession();
		vi.setSystemTime(new Date("2026-10-10T00:00:00Z"));
		await updateSessionConnections(first as NonNullable<typeof first>, [conn(ID_A)]);
		expect((await getSession())?.exp).toBe(first?.exp);
	});

	it("round-trips and clears a session", async () => {
		await setSession({ login: "alice", userId: 7, installationIds: [10, 11], connections: [conn(ID_A)] });
		expect(await getSession()).toMatchObject({ login: "alice", userId: 7, connections: [conn(ID_A)] });
		await clearSession();
		expect(await getSession()).toBeNull();
	});
});

describe("session integrity", () => {
	it("uses HMAC-signed payloads", () => {
		const token = serializeSession({ login: "a", userId: 1, installationIds: [] });
		const [payload, signature] = token.split(".");
		const expected = b64url(crypto.createHmac("sha256", "test-secret").update(payload).digest());
		expect(signature).toBe(expected);
	});

	it("rejects tampering", async () => {
		await setSession({ login: "a", userId: 1, installationIds: [] });
		const token = jar.get("ur_session") as string;
		jar.set("ur_session", `${token}x`);
		expect(await getSession()).toBeNull();
	});

	it("keeps connection ownership scoped to the signed session", async () => {
		await setSession({ login: "a", userId: 1, installationIds: [], connections: [conn(ID_A)] });
		const s = await getSession();
		expect(ownsConnection(s, ID_A)).toBe(true);
		expect(ownsConnection(s, ID_B)).toBe(false);
		expect(sessionOwnsTarget(s, { forge: "gitlab", connectionId: ID_A })).toBe(true);
		expect(sessionOwnsTarget(s, { forge: "gitea", connectionId: ID_A })).toBe(false);
	});

	it("adds, replaces and removes connections", () => {
		const one = addConnection([], conn(ID_A));
		const replaced = addConnection(one, { ...conn(ID_A), login: "bob" });
		expect(replaced).toHaveLength(1);
		expect(replaced[0].login).toBe("bob");
		expect(removeConnection(replaced, ID_A)).toEqual([]);
	});
});
