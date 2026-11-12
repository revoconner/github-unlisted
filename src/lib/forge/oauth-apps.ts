import { FORGE_CATALOG, OAUTH_APP_PROVIDER_IDS, type OAuthAppProviderId } from "./catalog";
import { decryptToken, encryptToken } from "./crypto";
import { getRedis } from "@/lib/share-store";
import crypto from "node:crypto";

// Credentials of the OAuth applications the site owner registered on each hosted forge. 
// These are app credentials, never user passwords: users always sign in on the forge itself. 
// Values saved from the setup page are sealed with AES-256-GCM (same key derivation as forge tokens) 
// before reaching Redis; environment variables remain a fallback so existing deployments keep working.

export const OAUTH_APP_PROVIDERS = OAUTH_APP_PROVIDER_IDS;
export type OAuthAppProvider = OAuthAppProviderId;

export const OAUTH_APP_LABELS = Object.fromEntries(
	OAUTH_APP_PROVIDERS.map((provider) => [provider, FORGE_CATALOG[provider].label]),
) as Record<OAuthAppProvider, string>;

const ENV_PREFIX = Object.fromEntries(
	OAUTH_APP_PROVIDERS.map((provider) => [provider, FORGE_CATALOG[provider].oauth?.envPrefix ?? provider.toUpperCase()]),
) as Record<OAuthAppProvider, string>;

const KEY_PREFIX = "forge-oauth-app:";
const FAIL_KEY = "forge-oauth-admin-fail";
const FAIL_LIMIT = 10;
const FAIL_WINDOW_SECONDS = 15 * 60;
const MIN_ADMIN_TOKEN_LENGTH = 16;

export const MAX_CLIENT_ID_LENGTH = 512;
export const MAX_CLIENT_SECRET_LENGTH = 2048;

export interface OAuthAppCredentials {
	clientId: string;
	clientSecret: string;
	source: "site" | "env";
}

export interface OAuthAppStatus {
	provider: OAuthAppProvider;
	label: string;
	configured: boolean;
	source: "site" | "env" | null;
	clientId: string | null;
}

interface StoredApp {
	clientId: string;
	clientSecretEnc: string;
	updatedAt: number;
}

export function isOAuthAppProvider(value: unknown): value is OAuthAppProvider {
	return typeof value === "string" && (OAUTH_APP_PROVIDERS as readonly string[]).includes(value);
}

function storeKey(provider: OAuthAppProvider): string {
	return `${KEY_PREFIX}${provider}`;
}

function aad(provider: OAuthAppProvider): string {
	return `forge-oauth-app|${provider}`;
}

function envValue(names: string[]): string | undefined {
	for (const name of names) {
		const value = process.env[name]?.trim();
		if (value) return value;
	}
	return undefined;
}

function envApp(provider: OAuthAppProvider): { clientId: string; clientSecret: string } | null {
	const prefix = ENV_PREFIX[provider];
	const clientId = envValue([
		`${prefix}_CLIENT_ID`,
		`${prefix}_OAUTH_CLIENT_ID`,
		`${prefix}_APP_CLIENT_ID`,
		`AUTH_${prefix}_ID`,
	]);
	const clientSecret = envValue([
		`${prefix}_CLIENT_SECRET`,
		`${prefix}_OAUTH_CLIENT_SECRET`,
		`${prefix}_APP_CLIENT_SECRET`,
		`AUTH_${prefix}_SECRET`,
	]);
	return clientId && clientSecret ? { clientId, clientSecret } : null;
}

async function readStored(provider: OAuthAppProvider): Promise<StoredApp | null> {
	const value = await getRedis().get<unknown>(storeKey(provider));
	if (typeof value !== "object" || value === null) return null;
	const r = value as Record<string, unknown>;
	if (typeof r.clientId !== "string" || typeof r.clientSecretEnc !== "string") return null;
	return {
		clientId: r.clientId,
		clientSecretEnc: r.clientSecretEnc,
		updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
	};
}

// Site-saved credentials win over environment variables.
export async function getOAuthApp(provider: OAuthAppProvider): Promise<OAuthAppCredentials | null> {
	const stored = await readStored(provider);
	if (stored) {
		try {
			return {
				clientId: stored.clientId,
				clientSecret: decryptToken(stored.clientSecretEnc, aad(provider)),
				source: "site",
			};
		} catch {
			// Unreadable (e.g. SESSION_SECRET changed): fall through to the environment.
		}
	}
	const env = envApp(provider);
	return env ? { ...env, source: "env" } : null;
}

export async function requireOAuthApp(provider: OAuthAppProvider): Promise<OAuthAppCredentials> {
	const app = await getOAuthApp(provider);
	if (!app) {
		throw new Error(
			`${OAUTH_APP_LABELS[provider]} is not officially supported yet, contact the site owner. We apologize for the inconvenience`,
		);
	}
	return app;
}

export async function saveOAuthApp(
	provider: OAuthAppProvider,
	input: { clientId: string; clientSecret: string },
): Promise<void> {
	const clientId = input.clientId.trim();
	const clientSecret = input.clientSecret.trim();
	if (!clientId || !clientSecret) throw new Error("Client ID and client secret are required");
	if (clientId.length > MAX_CLIENT_ID_LENGTH || clientSecret.length > MAX_CLIENT_SECRET_LENGTH) {
		throw new Error("One of the supplied fields is too long");
	}
	const record: StoredApp = {
		clientId,
		clientSecretEnc: encryptToken(clientSecret, aad(provider)),
		updatedAt: Date.now(),
	};
	await getRedis().set(storeKey(provider), record);
}

export async function deleteOAuthApp(provider: OAuthAppProvider): Promise<void> {
	await getRedis().del(storeKey(provider));
}

// Never exposes secrets: only the public client id and where it came from.
export async function listOAuthAppStatus(): Promise<OAuthAppStatus[]> {
	return Promise.all(
		OAUTH_APP_PROVIDERS.map(async (provider): Promise<OAuthAppStatus> => {
			const stored = await readStored(provider);
			const env = envApp(provider);
			const clientId = stored?.clientId ?? env?.clientId ?? null;
			return {
				provider,
				label: OAUTH_APP_LABELS[provider],
				configured: Boolean(stored || env),
				source: stored ? "site" : env ? "env" : null,
				clientId,
			};
		}),
	);
}

export function adminConfigured(): boolean {
	return (process.env.FORGE_ADMIN_TOKEN?.trim().length ?? 0) >= MIN_ADMIN_TOKEN_LENGTH;
}

function digest(value: string): Buffer {
	return crypto.createHash("sha256").update(value).digest();
}

export type AdminCheck = "ok" | "disabled" | "denied" | "throttled";

// The setup page changes credentials that every visitor's login depends on, so it is gated by a secret only the site owner knows (FORGE_ADMIN_TOKEN). With no token configured the feature is off entirely: there is deliberately no "first visitor becomes admin" mode.
export async function checkAdminToken(provided: string | null | undefined): Promise<AdminCheck> {
	if (!adminConfigured()) return "disabled";
	const redis = getRedis();
	const failures = Number((await redis.get<number | string>(FAIL_KEY)) ?? 0);
	if (Number.isFinite(failures) && failures >= FAIL_LIMIT) return "throttled";
	const expected = digest(process.env.FORGE_ADMIN_TOKEN?.trim() ?? "");
	const given = digest(provided ?? "");
	if (crypto.timingSafeEqual(expected, given) && provided) return "ok";
	await redis.set(FAIL_KEY, (Number.isFinite(failures) ? failures : 0) + 1, {
		ex: FAIL_WINDOW_SECONDS,
	});
	return "denied";
}
