import { getRedis } from "@/lib/share-store";
import { decryptToken, encryptToken } from "./crypto";
import { PUBLIC_OAUTH_PROVIDER_IDS, type PublicOAuthProvider } from "./catalog";

const PREFIX = "forge-oauth-config:";

export interface StoredPublicOAuthSettings {
	clientId: string;
	clientSecretEnc: string;
	updatedAt: number;
}

function key(provider: PublicOAuthProvider): string {
	return `${PREFIX}${provider}`;
}

export async function getPublicOAuthSettings(
	provider: PublicOAuthProvider,
): Promise<{ clientId: string; clientSecret: string } | null> {
	const raw = await getRedis().get<unknown>(key(provider));
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	if (typeof record.clientId !== "string" || !record.clientId.trim()) return null;
	if (typeof record.clientSecretEnc !== "string" || !record.clientSecretEnc) return null;
	try {
		return {
			clientId: record.clientId.trim(),
			clientSecret: decryptToken(record.clientSecretEnc, key(provider)),
		};
	} catch {
		return null;
	}
}

export async function hasPublicOAuthSettings(
	provider: PublicOAuthProvider,
): Promise<boolean> {
	const raw = await getRedis().get<unknown>(key(provider));
	if (typeof raw !== "object" || raw === null) return false;
	const record = raw as Record<string, unknown>;
	return typeof record.clientId === "string" &&
		record.clientId.trim().length > 0 &&
		typeof record.clientSecretEnc === "string" &&
		record.clientSecretEnc.length > 0;
}

export async function listPublicOAuthSettings(): Promise<Record<PublicOAuthProvider, boolean>> {
	const providers: readonly PublicOAuthProvider[] = PUBLIC_OAUTH_PROVIDER_IDS;
	const entries = await Promise.all(
		providers.map(async (provider) => [provider, await hasPublicOAuthSettings(provider)] as const),
	);
	return Object.fromEntries(entries) as Record<PublicOAuthProvider, boolean>;
}

export async function savePublicOAuthSettings(
	provider: PublicOAuthProvider,
	clientId: string,
	clientSecret: string,
): Promise<void> {
	const cleanId = clientId.trim();
	const cleanSecret = clientSecret.trim();
	if (!cleanId || !cleanSecret) throw new Error("Client ID and Client Secret are required");
	if (cleanId.length > 512 || cleanSecret.length > 2048) throw new Error("OAuth credentials are too long");
	const record: StoredPublicOAuthSettings = {
		clientId: cleanId,
		clientSecretEnc: encryptToken(cleanSecret, key(provider)),
		updatedAt: Date.now(),
	};
	await getRedis().set(key(provider), record);
}

export async function deletePublicOAuthSettings(provider: PublicOAuthProvider): Promise<void> {
	await getRedis().del(key(provider));
}
