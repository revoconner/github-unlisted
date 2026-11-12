import { getRedis } from "@/lib/share-store";
import { FORGE_CATALOG } from "./catalog";
import type { ForgeId } from "./catalog";
import { decryptCredentialMap, encryptCredentialMap } from "./vault";

export type ForgeCredentialScope = "application" | "webhook";

interface StoredForgeCredentials {
	version: 1;
	credentialsEnc?: Record<string, string>;
	updatedAt: number;
}

function storeKey(forge: ForgeId, scope: ForgeCredentialScope): string {
	return `forge-credentials:${forge}:${scope}`;
}

function associatedData(forge: ForgeId, scope: ForgeCredentialScope): string {
	return `forge-global-credentials|${forge}|${scope}`;
}

function declaredFields(forge: ForgeId, scope: ForgeCredentialScope) {
	const fields = FORGE_CATALOG[forge].credentials?.[scope];
	if (!fields?.length) throw new Error(`No ${scope} credentials are declared for ${forge}`);
	return fields;
}

/** Validate names and required fields against the catalog so UIs cannot invent arbitrary persisted fields. */
export function validateForgeScopedCredentials(
	forge: ForgeId,
	scope: ForgeCredentialScope,
	credentials: Readonly<Record<string, string>>,
): Record<string, string> {
	const fields = declaredFields(forge, scope);
	const allowed = new Map(fields.map((field) => [field.key, field]));
	const result: Record<string, string> = {};

	for (const [name, value] of Object.entries(credentials)) {
		if (!allowed.has(name)) throw new Error(`Undeclared ${scope} credential for ${forge}: ${name}`);
		if (typeof value !== "string" || value.length > 32_768) {
			throw new Error(`Invalid ${scope} credential value: ${name}`);
		}
		if (value.length > 0) result[name] = value;
	}

	for (const field of fields) {
		if (field.required && !result[field.key]) {
			throw new Error(`Missing required ${scope} credential for ${forge}: ${field.key}`);
		}
	}
	return result;
}

/** Save app-wide secrets separately from per-user connection credentials. Each field is encrypted with field- and scope-bound AAD. */
export async function saveForgeScopedCredentials(
	forge: ForgeId,
	scope: ForgeCredentialScope,
	credentials: Readonly<Record<string, string>>,
): Promise<void> {
	const validated = validateForgeScopedCredentials(forge, scope, credentials);
	const credentialsEnc = encryptCredentialMap(validated, associatedData(forge, scope));
	const record: StoredForgeCredentials = { version: 1, credentialsEnc, updatedAt: Date.now() };
	await getRedis().set(storeKey(forge, scope), record);
}

export async function getForgeScopedCredentials(
	forge: ForgeId,
	scope: ForgeCredentialScope,
): Promise<Record<string, string> | null> {
	const raw = await getRedis().get<unknown>(storeKey(forge, scope));
	if (raw === null || raw === undefined) return null;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`Invalid stored ${scope} credential record for ${forge}`);
	}
	const record = raw as Record<string, unknown>;
	if (record.version !== 1 || (record.credentialsEnc !== undefined && (typeof record.credentialsEnc !== "object" || record.credentialsEnc === null || Array.isArray(record.credentialsEnc)))) {
		throw new Error(`Invalid stored ${scope} credential record for ${forge}`);
	}
	const encrypted = (record.credentialsEnc ?? {}) as Record<string, string>;
	const decrypted = decryptCredentialMap(encrypted, associatedData(forge, scope));
	return validateForgeScopedCredentials(forge, scope, decrypted);
}

export async function getForgeScopedCredential(
	forge: ForgeId,
	scope: ForgeCredentialScope,
	field: string,
): Promise<string | undefined> {
	const values = await getForgeScopedCredentials(forge, scope);
	return values?.[field];
}

export async function deleteForgeScopedCredentials(
	forge: ForgeId,
	scope: ForgeCredentialScope,
): Promise<void> {
	await getRedis().del(storeKey(forge, scope));
}
