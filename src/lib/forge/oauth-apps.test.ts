// @vitest-environment node
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
	const kv = new Map<string, string>();
	return { kv };
});

vi.mock("@upstash/redis", () => ({
	Redis: class {
		async set(key: string, value: unknown) {
			fake.kv.set(key, JSON.stringify(value));
			return "OK";
		}
		async get<T>(key: string): Promise<T | null> {
			const v = fake.kv.get(key);
			return v === undefined ? null : (JSON.parse(v) as T);
		}
		async del(...keys: string[]) {
			for (const k of keys) fake.kv.delete(k);
			return keys.length;
		}
	},
}));

const posted = vi.hoisted(() => ({ calls: [] as Array<{ url: string; form: Record<string, string> }> }));

vi.mock("./safe-url", async (orig) => ({
	...(await orig<typeof import("./safe-url")>()),
	safePostForm: async (url: string, form: Record<string, string>) => {
		posted.calls.push({ url, form });
		return new Response(JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 7200 }));
	},
}));

import {
	checkAdminToken,
	deleteOAuthApp,
	getOAuthApp,
	listOAuthAppStatus,
	requireOAuthApp,
	saveOAuthApp,
} from "./oauth-apps";
import { consumeOAuthState, exchangeOAuthCode, startPublicOAuth } from "./oauth";

const ENV_KEYS = [
	"GITLAB_APP_CLIENT_ID",
	"GITLAB_APP_CLIENT_SECRET",
	"CODEBERG_APP_CLIENT_ID",
	"CODEBERG_APP_CLIENT_SECRET",
	"FORGE_ADMIN_TOKEN",
];

beforeEach(() => {
	fake.kv.clear();
	for (const k of ENV_KEYS) delete process.env[k];
	process.env.KV_REST_API_URL = "https://redis.test";
	process.env.KV_REST_API_TOKEN = "t";
	process.env.FORGE_TOKEN_KEY = crypto.randomBytes(32).toString("base64");
});

describe("OAuth app credentials", () => {
	it("is unconfigured by default and reports a clear error", async () => {
		expect(await getOAuthApp("gitlab")).toBeNull();
		await expect(requireOAuthApp("gitlab")).rejects.toThrow(/^OAuth configuration missing: GitLab/);
	});

	it("stores the secret encrypted and returns it only through getOAuthApp", async () => {
		await saveOAuthApp("gitlab", { clientId: " app-id ", clientSecret: "super-secret-value" });
		const raw = [...fake.kv.values()].join("");
		expect(raw).not.toContain("super-secret-value");
		expect(await getOAuthApp("gitlab")).toEqual({
			clientId: "app-id",
			clientSecret: "super-secret-value",
			source: "site",
		});
		const status = await listOAuthAppStatus();
		expect(JSON.stringify(status)).not.toContain("super-secret-value");
		expect(status.find((s) => s.provider === "gitlab")).toMatchObject({
			configured: true,
			source: "site",
			clientId: "app-id",
		});
	});

	it("falls back to environment variables and lets site values win", async () => {
		process.env.CODEBERG_APP_CLIENT_ID = "env-id";
		process.env.CODEBERG_APP_CLIENT_SECRET = "env-secret";
		expect(await getOAuthApp("codeberg")).toMatchObject({ clientId: "env-id", source: "env" });
		await saveOAuthApp("codeberg", { clientId: "site-id", clientSecret: "site-secret" });
		expect(await getOAuthApp("codeberg")).toMatchObject({ clientId: "site-id", source: "site" });
		await deleteOAuthApp("codeberg");
		expect(await getOAuthApp("codeberg")).toMatchObject({ clientId: "env-id", source: "env" });
	});

	it("rejects empty or oversized values", async () => {
		await expect(saveOAuthApp("gitea", { clientId: "", clientSecret: "x" })).rejects.toThrow();
		await expect(saveOAuthApp("gitea", { clientId: "x", clientSecret: "y".repeat(3000) })).rejects.toThrow();
	});
});

describe("OAuth start from site-saved credentials", () => {
	it("builds the provider authorize URL with client_id, redirect_uri and state, without any env var", async () => {
		await saveOAuthApp("gitlab", { clientId: "gl-id", clientSecret: "gl-secret" });
		const { url, state } = await startPublicOAuth({
			provider: "gitlab",
			origin: "https://app.example",
			expiresAt: Date.now() + 86_400_000,
		});
		const u = new URL(url);
		expect(u.origin + u.pathname).toBe("https://gitlab.com/oauth/authorize");
		expect(u.searchParams.get("client_id")).toBe("gl-id");
		expect(u.searchParams.get("redirect_uri")).toBe("https://app.example/api/forge/callback");
		expect(u.searchParams.get("response_type")).toBe("code");
		expect(u.searchParams.get("state")).toBe(state);
		expect(state).toMatch(/^[0-9a-f]{64}$/);
		expect(url).not.toContain("gl-secret");
	});

	it("uses the Gitea-style endpoint for Codeberg", async () => {
		await saveOAuthApp("codeberg", { clientId: "cb", clientSecret: "s" });
		const { url } = await startPublicOAuth({
			provider: "codeberg",
			origin: "https://app.example",
			expiresAt: Date.now() + 86_400_000,
		});
		expect(url.startsWith("https://codeberg.org/login/oauth/authorize?")).toBe(true);
	});

	it("fails with the 'configuration missing' error when nothing is configured", async () => {
		await expect(
			startPublicOAuth({ provider: "gitee", origin: "https://app.example", expiresAt: Date.now() + 86_400_000 }),
		).rejects.toThrow(/^OAuth configuration missing: Gitee/);
	});
});

describe("token exchange with site-saved credentials", () => {
	it("posts the stored secret to the provider token endpoint and consumes the state once", async () => {
		posted.calls.length = 0;
		await saveOAuthApp("gitea", { clientId: "gt-id", clientSecret: "gt-secret" });
		const { state } = await startPublicOAuth({
			provider: "gitea",
			origin: "https://app.example",
			expiresAt: Date.now() + 86_400_000,
		});
		const pending = await consumeOAuthState(state);
		if (!pending) throw new Error("state was not stored");
		expect(await consumeOAuthState(state)).toBeNull();
		const tokens = await exchangeOAuthCode(state, pending, "the-code");
		expect(tokens.accessToken).toBe("tok");
		expect(tokens.refreshToken).toBe("ref");
		expect(posted.calls).toHaveLength(1);
		expect(posted.calls[0].url).toBe("https://gitea.com/login/oauth/access_token");
		expect(posted.calls[0].form).toMatchObject({
			client_id: "gt-id",
			client_secret: "gt-secret",
			code: "the-code",
			grant_type: "authorization_code",
			redirect_uri: "https://app.example/api/forge/callback",
		});
	});
});

describe("admin token", () => {
	it("is disabled without a sufficiently long FORGE_ADMIN_TOKEN", async () => {
		expect(await checkAdminToken("anything")).toBe("disabled");
		process.env.FORGE_ADMIN_TOKEN = "short";
		expect(await checkAdminToken("short")).toBe("disabled");
	});

	it("accepts the right token, rejects wrong or missing ones, and throttles repeated failures", async () => {
		process.env.FORGE_ADMIN_TOKEN = "a-long-random-admin-token";
		expect(await checkAdminToken("a-long-random-admin-token")).toBe("ok");
		expect(await checkAdminToken(null)).toBe("denied");
		for (let i = 0; i < 9; i++) expect(await checkAdminToken("wrong")).toBe("denied");
		expect(await checkAdminToken("a-long-random-admin-token")).toBe("throttled");
	});
});
