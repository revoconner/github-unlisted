// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const kv = vi.hoisted(() => new Map<string, string>());

vi.mock("@upstash/redis", () => ({
	Redis: class {
		async set(key: string, value: unknown) {
			kv.set(key, JSON.stringify(value));
			return "OK";
		}
		async get<T>(key: string): Promise<T | null> {
			const v = kv.get(key);
			return v === undefined ? null : (JSON.parse(v) as T);
		}
		async del(...keys: string[]) {
			for (const k of keys) kv.delete(k);
			return keys.length;
		}
	},
}));

import { GET } from "./route";

beforeEach(() => {
	kv.clear();
	for (const k of ["GITLAB_APP_CLIENT_ID", "GITLAB_APP_CLIENT_SECRET", "GITEE_APP_CLIENT_ID", "GITEE_APP_CLIENT_SECRET"]) {
		delete process.env[k];
	}
	process.env.KV_REST_API_URL = "https://redis.test";
	process.env.KV_REST_API_TOKEN = "t";
	process.env.SESSION_SECRET = "a-long-random-session-secret-for-tests";
});

const exp = () => Date.now() + 86_400_000;

describe("/api/forge/login", () => {
	it("without a configured OAuth app, shows a clear message on the sign-in screen", async () => {
		const res = await GET(new Request(`https://app.example/api/forge/login?provider=gitlab&expiresAt=${exp()}`));
		const loc = new URL(res.headers.get("location") ?? "");
		expect(loc.origin + loc.pathname).toBe("https://app.example/app");
		expect(loc.searchParams.get("error")).toMatch(/^OAuth configuration missing: GitLab/);
		expect(loc.searchParams.get("connect")).toBeNull();
	});

	it("with a shared OAuth app, redirects straight to the forge authorize endpoint", async () => {
		process.env.GITLAB_APP_CLIENT_ID = "id";
		process.env.GITLAB_APP_CLIENT_SECRET = "secret";
		const res = await GET(new Request(`https://app.example/api/forge/login?provider=gitlab&expiresAt=${exp()}`));
		const loc = new URL(res.headers.get("location") ?? "");
		expect(loc.origin + loc.pathname).toBe("https://gitlab.com/oauth/authorize");
		expect(loc.searchParams.get("client_id")).toBe("id");
	});
});
