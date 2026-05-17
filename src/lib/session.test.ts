import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory cookie jar standing in for Next's request cookies.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
	cookies: async () => ({
		get: (k: string) =>
			jar.has(k) ? { value: jar.get(k) as string } : undefined,
		set: (k: string, v: string) => {
			jar.set(k, v);
		},
		delete: (k: string) => {
			jar.delete(k);
		},
	}),
}));

import {
	clearSession,
	getSession,
	serializeSession,
	setSession,
} from "./session";

beforeEach(() => {
	jar.clear();
	process.env.SESSION_SECRET = "test-secret";
	vi.useRealTimers();
});

describe("session", () => {
	it("serializeSession returns payload.signature", () => {
		const token = serializeSession({
			login: "x",
			userId: 1,
			installationIds: [2],
		});
		expect(token.split(".")).toHaveLength(2);
	});

	it("round-trips a set session", async () => {
		await setSession({ login: "alice", userId: 7, installationIds: [10, 11] });
		const s = await getSession();
		expect(s).toMatchObject({
			login: "alice",
			userId: 7,
			installationIds: [10, 11],
		});
		expect(s?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
	});

	it("returns null when no cookie is present", async () => {
		expect(await getSession()).toBeNull();
	});

	it("rejects a tampered cookie", async () => {
		await setSession({ login: "a", userId: 1, installationIds: [] });
		jar.set("ur_session", `${jar.get("ur_session")}x`);
		expect(await getSession()).toBeNull();
	});

	it("rejects a cookie signed with a different secret", async () => {
		await setSession({ login: "a", userId: 1, installationIds: [] });
		process.env.SESSION_SECRET = "other-secret";
		expect(await getSession()).toBeNull();
	});

	it("rejects an expired session", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
		await setSession({ login: "a", userId: 1, installationIds: [] });
		vi.setSystemTime(new Date("2025-01-09T00:00:00Z")); // +8 days, past 7d
		expect(await getSession()).toBeNull();
	});

	it("clearSession removes the session", async () => {
		await setSession({ login: "a", userId: 1, installationIds: [] });
		await clearSession();
		expect(await getSession()).toBeNull();
	});
});
