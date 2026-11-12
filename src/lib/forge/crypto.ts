import crypto from "node:crypto";

// Forge tokens are the only long-lived credentials this service stores, so they are sealed with AES-256-GCM before they reach Redis. GCM authenticates as well as encrypts: a flipped byte in storage fails decryption instead of yielding a garbled token.
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

// No extra configuration: the key is derived (HKDF-SHA256) from SESSION_SECRET, which every deployment already has. It is deliberately NOT generated and kept in Redis: the key would then sit next to the ciphertext it protects, and anyone who can read the database could decrypt every token. Derived from an environment secret, a leaked database alone yields nothing. Trade-off, stated plainly: changing SESSION_SECRET makes stored tokens unreadable (accounts must be reconnected), and a weak SESSION_SECRET gives a weak key, so it should be long and random. FORGE_TOKEN_KEY (base64, 32 bytes) remains as an optional override for deployments that want the two independent.
function key(): Buffer {
	const raw = process.env.FORGE_TOKEN_KEY?.trim();
	if (raw) {
		const value = Buffer.from(raw, "base64");
		if (value.length !== 32) {
			throw new Error("FORGE_TOKEN_KEY must be base64-encoded 32 bytes");
		}
		return value;
	}
	const secret = process.env.SESSION_SECRET;
	if (!secret) throw new Error("SESSION_SECRET is not set");
	return Buffer.from(
		crypto.hkdfSync(
			"sha256",
			secret,
			"github-unlisted/forge-token-salt",
			"github-unlisted/forge-token/v1",
			32,
		),
	);
}

// aad is authenticated but not stored. Callers bind it to `${connectionId}|${forge}|${host}`, which means a record whose host field was rewritten in Redis cannot be decrypted: without this, anyone able to edit that one field could redirect a valid token to a server they control by pointing the host at it. The same value must be passed back to decryptToken.
export function encryptToken(token: string, aad?: string): string {
	const iv = crypto.randomBytes(IV_BYTES);
	const cipher = crypto.createCipheriv(ALGORITHM, key(), iv, {
		authTagLength: TAG_BYTES,
	});
	if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
	const ciphertext = Buffer.concat([
		cipher.update(token, "utf8"),
		cipher.final(),
	]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
		"base64",
	);
}

export function decryptToken(encoded: string, aad?: string): string {
	const payload = Buffer.from(encoded, "base64");
	if (payload.length < IV_BYTES + TAG_BYTES) {
		throw new Error("Invalid encrypted token");
	}
	const iv = payload.subarray(0, IV_BYTES);
	const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
	const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);
	// authTagLength is pinned so a truncated tag cannot be accepted.
	const decipher = crypto.createDecipheriv(ALGORITHM, key(), iv, {
		authTagLength: TAG_BYTES,
	});
	if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
	decipher.setAuthTag(tag);
	return Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]).toString("utf8");
}
