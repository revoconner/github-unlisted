import { getRedis } from "@/lib/share-store";
import { decryptToken, encryptToken } from "./crypto";
import { PUBLIC_OAUTH_PROVIDER_IDS, type PublicOAuthProvider } from "./catalog";

export const PUBLIC_OAUTH_PROVIDERS: readonly PublicOAuthProvider[] = PUBLIC_OAUTH_PROVIDER_IDS;

const PREFIX = "forge-oauth-config:";

function key(provider: PublicOAuthProvider): string {
	return `${PREFIX}${provider}`;
}

function aad(provider: PublicOAuthProvider, field: "client-id" | "client-secret"): string {
	return `${PREFIX}${provider}:${field}`;
}

interface StoredConfig {
	clientIdEnc: string;
	clientSecretEnc: string;
	updatedAt: number;
}

function isStoredConfig(value: unknown): value is StoredConfig {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.clientIdEnc === "string" &&
		typeof v.clientSecretEnc === "string" &&
		typeof v.updatedAt === "number"
	);
}

export async function getPublicOAuthConfig(
	provider: PublicOAuthProvider,
): Promise<{ clientId: string; clientSecret: string } | null> {
	const value = await getRedis().get<unknown>(key(provider));
	if (!isStoredConfig(value)) return null;
	try {
		return {
			clientId: decryptToken(value.clientIdEnc, aad(provider, "client-id")),
			clientSecret: decryptToken(value.clientSecretEnc, aad(provider, "client-secret")),
		};
	} catch {
		return null;
	}
}

export async function setPublicOAuthConfig(
	provider: PublicOAuthProvider,
	clientId: string,
	clientSecret: string,
): Promise<void> {
	const normalizedId = clientId.trim();
	const normalizedSecret = clientSecret.trim();
	if (!normalizedId || !normalizedSecret) throw new Error("Client ID and client secret are required");
	if (normalizedId.length > 512 || normalizedSecret.length > 2048) {
		throw new Error("One of the supplied credentials is too long");
	}
	const record: StoredConfig = {
		clientIdEnc: encryptToken(normalizedId, aad(provider, "client-id")),
		clientSecretEnc: encryptToken(normalizedSecret, aad(provider, "client-secret")),
		updatedAt: Date.now(),
	};
	await getRedis().set(key(provider), record);
}

export async function listPublicOAuthConfigStatus(): Promise<Record<PublicOAuthProvider, boolean>> {
	const result = {} as Record<PublicOAuthProvider, boolean>;
	await Promise.all(
		PUBLIC_OAUTH_PROVIDERS.map(async (provider) => {
			result[provider] = Boolean(await getPublicOAuthConfig(provider));
		}),
	);
	return result;
}
