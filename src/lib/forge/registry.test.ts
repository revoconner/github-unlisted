// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	createForgeAdapter,
	hasForgeAdapter,
	isConnectionForge,
	isConnectionId,
	isForgeId,
	registerForgeAdapter,
} from "./registry";
import type { ForgeAdapter } from "./types";

describe("forge guards", () => {
	it("isForgeId accepts exactly the known forges", () => {
		for (const f of ["github", "gitlab", "gitee", "gitea", "codeberg", "forgejo", "gogs"]) {
			expect(isForgeId(f)).toBe(true);
		}
		for (const f of ["GitHub", "unknown-forge", "", null, undefined, 1, {}]) {
			expect(isForgeId(f)).toBe(false);
		}
	});

	it("isConnectionForge excludes github", () => {
		expect(isConnectionForge("gitlab")).toBe(true);
		expect(isConnectionForge("codeberg")).toBe(true);
		expect(isConnectionForge("forgejo")).toBe(true);
		expect(isConnectionForge("github")).toBe(false);
	});

	it("isConnectionId accepts only the UUID shape used in Redis keys", () => {
		expect(isConnectionId("11111111-1111-4111-8111-111111111111")).toBe(true);
		expect(isConnectionId(crypto.randomUUID())).toBe(true);
		for (const bad of [
			"",
			"abc",
			"11111111-1111-4111-8111-111111111111:shares",
			"11111111-1111-4111-8111-11111111111",
			"11111111-1111-4111-8111-111111111111\n",
			"../../etc",
			42,
			null,
		]) {
			expect(isConnectionId(bad)).toBe(false);
		}
	});
});

describe("adapter registry", () => {
	it("creates an adapter from the registered factory with its context", async () => {
		const adapter = { forge: "gitlab", host: "https://x" } as ForgeAdapter;
		registerForgeAdapter<{ id: string }>("gitlab", (ctx) => {
			expect(ctx.id).toBe("c1");
			return adapter;
		});
		expect(hasForgeAdapter("gitlab")).toBe(true);
		expect(await createForgeAdapter("gitlab", { id: "c1" })).toBe(adapter);
	});

	it("refuses a forge with no registered adapter", async () => {
		expect(hasForgeAdapter("gitee")).toBe(false);
		await expect(createForgeAdapter("gitee", {})).rejects.toThrow(
			"No adapter registered",
		);
	});
});
