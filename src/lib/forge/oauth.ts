import crypto from "node:crypto";
import { getRedis } from "@/lib/share-store";
import { decryptToken, encryptToken } from "./crypto";
import {
	getPublicOAuthProfile,
	getSelfHostedOAuthProfile,
	isPublicOAuthProvider,
	isSelfHostedOAuthProvider,
	type OAuthEndpointProfile,
	type OAuthProviderId,
	type PublicOAuthProvider,
	type SelfHostedOAuthProvider,
} from "./catalog";
import { requireOAuthApp } from "./oauth-apps";
import { normalizeSafeOrigin, readJson, safeFetch, safePostForm } from "./safe-url";

export type { PublicOAuthProvider, SelfHostedOAuthProvider } from "./catalog";
export type OAuthProvider = OAuthProviderId;

export interface OAuthTokenSet {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
}

type ProviderConfig = OAuthEndpointProfile & { host: string };

interface PendingOAuth {
	kind: "public" | "selfhosted";
	provider: OAuthProvider;
	forge: OAuthProvider;
	host: string;
	clientId: string;
	clientSecretEnc?: string;
	expiresAt: number;
	redirectUri: string;
}

const STATE_TTL = 10 * 60;
const OAUTH_STATE_PREFIX = "oauth-state:";
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

function publicConfig(provider: PublicOAuthProvider): ProviderConfig {
	const profile = getPublicOAuthProfile(provider);
	if (!profile.host) throw new Error(`Public OAuth host is missing for ${provider}`);
	return { ...profile, host: profile.host };
}

function selfHostedConfig(provider: SelfHostedOAuthProvider): OAuthEndpointProfile {
	return getSelfHostedOAuthProfile(provider);
}

function providerConfig(
	provider: OAuthProvider,
	kind: "public" | "selfhosted",
	host: string,
): ProviderConfig {
	if (kind === "public") {
		if (!isPublicOAuthProvider(provider)) throw new Error("Invalid public OAuth provider");
		const config = publicConfig(provider);
		if (host !== config.host) throw new Error("Invalid OAuth state");
		return config;
	}
	return { ...selfHostedConfig(provider as SelfHostedOAuthProvider), host };
}

function forgeForProvider(provider: OAuthProvider): OAuthProvider {
	// Keep the selected provider as the persistent identity; adapterForge in the
	// catalog only controls which API implementation will serve the connection.
	return provider;
}

function validateExpiry(expiresAt: number): number {
	if (!Number.isFinite(expiresAt) || !Number.isInteger(expiresAt)) {
		throw new Error("Invalid session expiration date");
	}
	const now = Date.now();
	if (expiresAt <= now || expiresAt > now + MAX_EXPIRY_MS) {
		throw new Error("Invalid session expiration date");
	}
	return expiresAt;
}

function stateKey(state: string): string {
	return `${OAUTH_STATE_PREFIX}${state}`;
}

function encryptStateSecret(state: string, secret: string): string {
	return encryptToken(secret, stateKey(state));
}

export function decryptPendingClientSecret(state: string, pending: PendingOAuth): string | undefined {
	if (!pending.clientSecretEnc) return undefined;
	return decryptToken(pending.clientSecretEnc, stateKey(state));
}

async function savePending(state: string, pending: PendingOAuth): Promise<void> {
	await getRedis().set(stateKey(state), pending, { ex: STATE_TTL });
}

export async function consumeOAuthState(state: string): Promise<PendingOAuth | null> {
	if (!/^[0-9a-f]{64}$/i.test(state)) return null;
	const redis = getRedis();
	const pending = await redis.get<unknown>(stateKey(state));
	if (!pending || typeof pending !== "object") return null;
	await redis.del(stateKey(state));
	return pending as PendingOAuth;
}

function newState(): string {
	return crypto.randomBytes(32).toString("hex");
}

function authorizationUrl(
	host: string,
	config: Omit<ProviderConfig, "host">,
	clientId: string,
	redirectUri: string,
	state: string,
): string {
	const url = new URL(config.authorizePath, host);
	url.searchParams.set("client_id", clientId);
	url.searchParams.set("redirect_uri", redirectUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("scope", config.scope);
	url.searchParams.set("state", state);
	return url.toString();
}

export async function startPublicOAuth(input: {
	provider: PublicOAuthProvider;
	origin: string;
	expiresAt: number;
}): Promise<{ url: string; state: string }> {
	const config = publicConfig(input.provider);
	const { clientId } = await requireOAuthApp(input.provider);
	const state = newState();
	const expiresAt = validateExpiry(input.expiresAt);
	const redirectUri = `${input.origin}/api/forge/callback`;
	await savePending(state, {
		kind: "public",
		provider: input.provider,
		forge: forgeForProvider(input.provider),
		host: config.host,
		clientId,
		expiresAt,
		redirectUri,
	});
	return {
		url: authorizationUrl(
			config.host,
			config,
			clientId,
			redirectUri,
			state,
		),
		state,
	};
}

export async function startSelfHostedOAuth(input: {
	provider: SelfHostedOAuthProvider;
	host: string;
	clientId: string;
	clientSecret: string;
	origin: string;
	expiresAt: number;
}): Promise<{ url: string; state: string }> {
	if (!input.clientId.trim() || !input.clientSecret.trim()) {
		throw new Error("Client ID and client secret are required");
	}
	const host = normalizeSafeOrigin(input.host);
	const config = selfHostedConfig(input.provider);
	const state = newState();
	const expiresAt = validateExpiry(input.expiresAt);
	const redirectUri = `${input.origin}/api/forge/callback`;
	await savePending(state, {
		kind: "selfhosted",
		provider: input.provider,
		forge: forgeForProvider(input.provider),
		host,
		clientId: input.clientId.trim(),
		clientSecretEnc: encryptStateSecret(state, input.clientSecret.trim()),
		expiresAt,
		redirectUri,
	});
	return {
		url: authorizationUrl(
			host,
			config,
			input.clientId.trim(),
			redirectUri,
			state,
		),
		state,
	};
}

function configForPending(pending: PendingOAuth): ProviderConfig {
	return providerConfig(pending.provider, pending.kind, pending.host);
}

async function tokenResponse(
	url: string,	host: string,	form: Record<string, string>,
): Promise<OAuthTokenSet> {
	const res = await safePostForm(url, form, { expectedOrigin: host });
	const data = await readJson<Record<string, unknown>>(res);
	const accessToken = typeof data.access_token === "string" ? data.access_token : null;
	if (!accessToken) throw new Error("OAuth provider returned no access token");
	const expiresIn =
		typeof data.expires_in === "number"
			? data.expires_in
			: typeof data.expires_in === "string"
				? Number(data.expires_in)
				: NaN;
	return {
		accessToken,
		refreshToken:
			typeof data.refresh_token === "string" ? data.refresh_token : undefined,
		expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
	};
}

export async function exchangeOAuthCode(
	state: string,
	pending: PendingOAuth,
	code: string,
): Promise<OAuthTokenSet> {
	const config = configForPending(pending);
	const clientSecret =
		pending.kind === "public"
			? (await requireOAuthApp(pending.provider as PublicOAuthProvider)).clientSecret
			: decryptPendingClientSecret(state, pending);
	if (!clientSecret) throw new Error("OAuth client secret is unavailable");
	return tokenResponse(`${pending.host}${config.tokenPath}`, pending.host, {
		client_id: pending.clientId,
		client_secret: clientSecret,
		code,
		grant_type: "authorization_code",
		redirect_uri: pending.redirectUri,
	});
}

export async function getOAuthUser(
	pending: PendingOAuth,
	accessToken: string,
): Promise<{ login: string; id: number }> {
	const config = configForPending(pending);
	const res = await safeFetch(
		`${pending.host}${config.userPath}`,
		{
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
		},
		{ expectedOrigin: pending.host },
	);
	const data = await readJson<Record<string, unknown>>(res);
	const login =
		typeof data.login === "string"
			? data.login
			: typeof data.username === "string"
				? data.username
				: typeof data.name === "string"
					? data.name
					: null;
	const id =
		typeof data.id === "number"
			? data.id
			: typeof data.id === "string" && /^\d+$/.test(data.id)
				? Number(data.id)
				: NaN;
	if (!login || !Number.isSafeInteger(id) || id <= 0) {
		throw new Error("OAuth provider returned an invalid user");
	}
	return { login, id };
}

export async function refreshSettings(provider: NonNullable<OAuthProvider>): Promise<{
	tokenPath: string;
	host: string | null;
	clientId?: string;
	clientSecret?: string;
}> {
	if (isPublicOAuthProvider(provider)) {
		const config = publicConfig(provider);
		const { clientId, clientSecret } = await requireOAuthApp(provider);
		return { tokenPath: config.tokenPath, host: config.host, clientId, clientSecret };
	}
	const config = selfHostedConfig(provider as SelfHostedOAuthProvider);
	return { tokenPath: config.tokenPath, host: null };
}

export async function refreshOAuthToken(input: {
	provider: NonNullable<OAuthProvider>;
	host: string;
	clientId: string;
	clientSecret: string;
	refreshToken: string;
}): Promise<OAuthTokenSet> {
	let config: ProviderConfig;
	if (isPublicOAuthProvider(input.provider) && publicConfig(input.provider).host === input.host) {
		config = publicConfig(input.provider);
	} else if (isSelfHostedOAuthProvider(input.provider)) {
		config = { ...selfHostedConfig(input.provider), host: input.host };
	} else {
		throw new Error(`OAuth host does not match the configured provider: ${input.provider}`);
	}
	return tokenResponse(`${input.host}${config.tokenPath}`, input.host, {
		client_id: input.clientId,
		client_secret: input.clientSecret,
		refresh_token: input.refreshToken,
		grant_type: "refresh_token",
	});
}
