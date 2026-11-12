// @vitest-environment node
import { describe, expect, it } from "vitest";
import { validateForgeScopedCredentials } from "./app-credentials";

describe("Forge app credential schema", () => {
	it("accepts the application-level fields declared by the catalog", () => {
		expect(validateForgeScopedCredentials("github", "application", {
			appId: "123456",
			appPrivateKey: "-----BEGIN PRIVATE KEY-----",
		})).toEqual({ appId: "123456", appPrivateKey: "-----BEGIN PRIVATE KEY-----" });
	});

	it("requires declared required fields and rejects undeclared fields", () => {
		expect(() => validateForgeScopedCredentials("github", "application", { appId: "123" })).toThrow("Missing required");
		expect(() => validateForgeScopedCredentials("github", "webhook", { privateKey: "not-declared" })).toThrow("Undeclared");
	});

	it("enforces declared webhook-secret fields separately from application keys", () => {
		expect(validateForgeScopedCredentials("github", "webhook", { webhookSecret: "secret" })).toEqual({ webhookSecret: "secret" });
		expect(() => validateForgeScopedCredentials("github", "webhook", {})).toThrow("Missing required");
	});
});
