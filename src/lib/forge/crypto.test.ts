// @vitest-environment node
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./crypto";

const KEY_A = crypto.randomBytes(32).toString("base64");
const KEY_B = crypto.randomBytes(32).toString("base64");

beforeEach(() => {
	process.env.FORGE_TOKEN_KEY = KEY_A;
});

describe("forge token encryption", () => {
	it("round-trips a token, including non-ASCII", () => {
		const token = "glpat-abc_123-ünï";
		expect(decryptToken(encryptToken(token))).toBe(token);
	});

	it("never stores the plaintext in the encoded value", () => {
		const token = "super-secret-token-value";
		const enc = encryptToken(token);
		expect(enc).not.toContain(token);
		expect(Buffer.from(enc, "base64").toString("utf8")).not.toContain(token);
	});

	it("uses a fresh IV, so equal tokens encrypt differently", () => {
		expect(encryptToken("same")).not.toBe(encryptToken("same"));
	});

	it("rejects a tampered ciphertext", () => {
		const raw = Buffer.from(encryptToken("tok"), "base64");
		raw[raw.length - 1] ^= 0x01;
		expect(() => decryptToken(raw.toString("base64"))).toThrow();
	});

	it("rejects a tampered auth tag", () => {
		const raw = Buffer.from(encryptToken("tok"), "base64");
		raw[12] ^= 0x01; // first tag byte
		expect(() => decryptToken(raw.toString("base64"))).toThrow();
	});

	it("rejects a payload too short to hold IV and tag", () => {
		expect(() => decryptToken(Buffer.alloc(10).toString("base64"))).toThrow(
			"Invalid encrypted token",
		);
	});

	it("cannot be decrypted with a different key", () => {
		const enc = encryptToken("tok");
		process.env.FORGE_TOKEN_KEY = KEY_B;
		expect(() => decryptToken(enc)).toThrow();
	});

	it("binds the token to its AAD, so a rewritten host cannot decrypt it", () => {
		const aad = "conn-1|gitlab|https://gitlab.example.com";
		const enc = encryptToken("tok", aad);
		expect(decryptToken(enc, aad)).toBe("tok");
		expect(() =>
			decryptToken(enc, "conn-1|gitlab|https://evil.example.com"),
		).toThrow();
		expect(() => decryptToken(enc)).toThrow();
	});

	it("fails clearly when neither a key nor SESSION_SECRET exists, or the override is the wrong size", () => {
		delete process.env.FORGE_TOKEN_KEY;
		delete process.env.SESSION_SECRET;
		expect(() => encryptToken("x")).toThrow("SESSION_SECRET is not set");
		process.env.FORGE_TOKEN_KEY = Buffer.alloc(16).toString("base64");
		expect(() => encryptToken("x")).toThrow("32 bytes");
	});

	it("tolerates trailing whitespace in the env value", () => {
		process.env.FORGE_TOKEN_KEY = `${KEY_A}\n`;
		expect(decryptToken(encryptToken("tok"))).toBe("tok");
	});
});

describe("key derived from SESSION_SECRET (no extra configuration)", () => {
	beforeEach(() => {
		delete process.env.FORGE_TOKEN_KEY;
		process.env.SESSION_SECRET = "a-long-random-session-secret-value";
	});

	it("round-trips with no FORGE_TOKEN_KEY at all", () => {
		expect(decryptToken(encryptToken("tok", "aad"), "aad")).toBe("tok");
	});

	it("is stable across calls, so tokens survive a restart", () => {
		const enc = encryptToken("tok");
		process.env.SESSION_SECRET = "a-long-random-session-secret-value";
		expect(decryptToken(enc)).toBe("tok");
	});

	it("cannot be decrypted after SESSION_SECRET changes", () => {
		const enc = encryptToken("tok");
		process.env.SESSION_SECRET = "a-different-session-secret-value!";
		expect(() => decryptToken(enc)).toThrow();
	});

	// Pins the derivation. If these parameters ever change, every token already stored becomes unreadable, so a change must be a conscious, versioned migration and not a silent edit.
	it("derives a fixed key: sealed with an independently computed key, it decrypts", () => {
		const key = Buffer.from(
			crypto.hkdfSync(
				"sha256",
				"a-long-random-session-secret-value",
				"github-unlisted/forge-token-salt",
				"github-unlisted/forge-token/v1",
				32,
			),
		);
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
			authTagLength: 16,
		});
		cipher.setAAD(Buffer.from("aad"));
		const ct = Buffer.concat([
			cipher.update("known-token", "utf8"),
			cipher.final(),
		]);
		const sealed = Buffer.concat([iv, cipher.getAuthTag(), ct]).toString(
			"base64",
		);
		expect(decryptToken(sealed, "aad")).toBe("known-token");
	});

	it("is separated from the session HMAC: the derived key is not the secret", () => {
		const enc = encryptToken("tok");
		const raw = Buffer.from(enc, "base64");
		expect(
			raw.includes(Buffer.from(process.env.SESSION_SECRET as string)),
		).toBe(false);
	});

	it("an explicit FORGE_TOKEN_KEY takes precedence and is independent of the secret", () => {
		const enc = encryptToken("tok");
		process.env.FORGE_TOKEN_KEY = KEY_A;
		expect(() => decryptToken(enc)).toThrow();
		const sealed = encryptToken("tok");
		process.env.SESSION_SECRET = "something-else-entirely-here";
		expect(decryptToken(sealed)).toBe("tok");
	});
});
