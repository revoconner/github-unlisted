// @vitest-environment node
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptCredentialMap, encryptCredentialMap } from "./vault";

beforeEach(() => {
	process.env.FORGE_TOKEN_KEY = crypto.randomBytes(32).toString("base64");
});

describe("Forge credential vault", () => {
	it("encrypts each named secret and restores it for the same connection context", () => {
		const credentials = { appPrivateKey: "-----BEGIN PRIVATE KEY-----", webhookSecret: "private-webhook-secret" };
		const encrypted = encryptCredentialMap(credentials, "connection|gitea|https://forge.test");
		expect(encrypted).toBeDefined();
		expect(JSON.stringify(encrypted)).not.toContain("private-webhook-secret");
		expect(decryptCredentialMap(encrypted, "connection|gitea|https://forge.test")).toEqual(credentials);
	});

	it("binds the encrypted secret to its connection and field", () => {
		const encrypted = encryptCredentialMap({ webhookSecret: "secret" }, "connection-a|gitea|https://forge.test");
		expect(() => decryptCredentialMap(encrypted, "connection-b|gitea|https://forge.test")).toThrow();
		expect(() => decryptCredentialMap(encrypted, "connection-a|gitea|https://other.test")).toThrow();
	});

	it("rejects invalid names and excessive values", () => {
		expect(() => encryptCredentialMap({ "bad key": "secret" }, "ctx")).toThrow("Invalid Forge credential name");
		expect(() => encryptCredentialMap({ secret: "x".repeat(32_769) }, "ctx")).toThrow("Invalid Forge credential value");
	});
});
