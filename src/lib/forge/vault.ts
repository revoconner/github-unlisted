import { decryptToken, encryptToken } from "./crypto";

const CREDENTIAL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MAX_CREDENTIAL_LENGTH = 32_768;
const MAX_CREDENTIALS = 64;

/**
 * Reusable encrypted vault for provider-specific connection secrets. The
 * AAD scopes every secret to one connection, Forge, host and field name, so
 * swapping records or field names makes decryption fail closed.
 */
export function encryptCredentialMap(
	credentials: Readonly<Record<string, string>> | undefined,
	aad: string,
): Record<string, string> | undefined {
	if (!credentials) return undefined;
	const entries = Object.entries(credentials);
	if (entries.length > MAX_CREDENTIALS) throw new Error("Too many Forge credentials");
	const output: Record<string, string> = {};
	for (const [name, value] of entries) {
		if (!CREDENTIAL_NAME.test(name)) throw new Error(`Invalid Forge credential name: ${name}`);
		if (typeof value !== "string" || value.length > MAX_CREDENTIAL_LENGTH) {
			throw new Error(`Invalid Forge credential value: ${name}`);
		}
		if (value.length > 0) output[name] = encryptToken(value, `${aad}|credential:${name}`);
	}
	return Object.keys(output).length ? output : undefined;
}

export function decryptCredentialMap(
	credentials: Readonly<Record<string, string>> | undefined,
	aad: string,
): Record<string, string> {
	if (!credentials) return {};
	const output: Record<string, string> = {};
	for (const [name, ciphertext] of Object.entries(credentials)) {
		if (!CREDENTIAL_NAME.test(name) || typeof ciphertext !== "string") {
			throw new Error("Invalid encrypted Forge credential record");
		}
		output[name] = decryptToken(ciphertext, `${aad}|credential:${name}`);
	}
	return output;
}
