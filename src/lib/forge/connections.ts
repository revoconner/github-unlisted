import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/share-store";
import { FORGE_API_PROFILES, isPublicOAuthProvider, isSelfHostedOAuthProvider } from "./catalog";
import {
	authHeadersFor,
	type ConnectionForgeId,
	createApiClient,
	type ForgeContext,
} from "./api";
import { decryptToken, encryptToken } from "./crypto";
import { decryptCredentialMap, encryptCredentialMap } from "./vault";
import { runForgeOperation } from "./extensions";
import "./adapters";
import { createForgeAdapter } from "./registry";
import { refreshOAuthToken, refreshSettings } from "./oauth";
import { isConnectionForge, isConnectionId } from "./registry";
import {
	type ForgeAdapter,
	type ForgeConnectionRecord,
	ForgeHttpError,
} from "./types";

function key(id: string): string {
	if (!isConnectionId(id)) throw new Error("Invalid connection id");
	return `conn:${id}`;
}

export function connectionAad(id: string, forge: string, host: string): string {
	return `${id}|${forge}|${host}`;
}

export async function saveConnection(
	id: string,
	input: {
		forge: ConnectionForgeId;
		host: string;
		login: string;
		userId: number;
		token: string;
		/** Additional provider-specific secrets; each value is encrypted on write. */
		credentials?: Record<string, string>;
		authScheme?: "token" | "bearer";
		oauthProvider?: ForgeConnectionRecord["oauthProvider"];
		oauthClientId?: string;
		oauthClientSecret?: string;
		refreshToken?: string;
		tokenExpiresAt?: number;
	},
): Promise<void> {
	const aad = connectionAad(id, input.forge, input.host);
	const record: ForgeConnectionRecord = {
		forge: input.forge,
		host: input.host,
		login: input.login,
		userId: input.userId,
		tokenEnc: encryptToken(input.token, aad),
		credentialsEnc: encryptCredentialMap(input.credentials, aad),
		authScheme: input.authScheme ?? "token",
		oauthProvider: input.oauthProvider,
		oauthClientId: input.oauthClientId,
		oauthClientSecretEnc: input.oauthClientSecret
			? encryptToken(input.oauthClientSecret, `${aad}|oauth-client-secret`)
			: undefined,
		refreshTokenEnc: input.refreshToken
			? encryptToken(input.refreshToken, `${aad}|refresh-token`)
			: undefined,
		tokenExpiresAt: input.tokenExpiresAt,
		createdAt: Date.now(),
	};
	await getRedis().set(key(id), record);
}

export async function getConnection(
	id: string,
): Promise<ForgeConnectionRecord | null> {
	const v = await getRedis().get<unknown>(key(id));
	if (typeof v !== "object" || v === null) return null;
	const r = v as Record<string, unknown>;
	if (
		!isConnectionForge(r.forge) ||
		typeof r.host !== "string" ||
		typeof r.login !== "string" ||
		typeof r.userId !== "number" ||
		typeof r.tokenEnc !== "string"
	) {
		return null;
	}
	if (r.authScheme !== undefined && r.authScheme !== "token" && r.authScheme !== "bearer") {
		return null;
	}
	if (
		r.oauthProvider !== undefined &&
		!isPublicOAuthProvider(r.oauthProvider) &&
		!isSelfHostedOAuthProvider(r.oauthProvider)
	) {
		return null;
	}
	for (const field of ["oauthClientId", "oauthClientSecretEnc", "refreshTokenEnc"]) {
		if (r[field] !== undefined && typeof r[field] !== "string") return null;
	}
	if (r.credentialsEnc !== undefined) {
		if (typeof r.credentialsEnc !== "object" || r.credentialsEnc === null || Array.isArray(r.credentialsEnc)) return null;
		if (Object.entries(r.credentialsEnc as Record<string, unknown>).some(([name, secret]) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name) || typeof secret !== "string")) return null;
	}
	if (r.tokenExpiresAt !== undefined && typeof r.tokenExpiresAt !== "number") return null;
	return r as unknown as ForgeConnectionRecord;
}

export async function deleteConnection(id: string): Promise<void> {
	await getRedis().del(key(id));
}

export async function createAdapter(ctx: ForgeContext): Promise<ForgeAdapter> {
	return createForgeAdapter(ctx.forge, ctx);
}

async function refreshIfNeeded(id: string, record: ForgeConnectionRecord): Promise<ForgeConnectionRecord> {
	if (
		record.authScheme !== "bearer" ||
		!record.oauthProvider ||
		!record.refreshTokenEnc ||
		!record.oauthClientId ||
		record.tokenExpiresAt === undefined ||
		record.tokenExpiresAt > Date.now() + 60_000
	) {
		return record;
	}

	const aad = connectionAad(id, record.forge, record.host);
	const refreshToken = decryptToken(record.refreshTokenEnc, `${aad}|refresh-token`);
	const storedClientSecret = record.oauthClientSecretEnc
		? decryptToken(record.oauthClientSecretEnc, `${aad}|oauth-client-secret`)
		: undefined;
	const clientSecret = storedClientSecret ?? (
		isPublicOAuthProvider(record.oauthProvider)
			? (await refreshSettings(record.oauthProvider)).clientSecret
			: undefined
		);
	if (!clientSecret) return record;
	const tokens = await refreshOAuthToken({
		provider: record.oauthProvider,
		host: record.host,
		clientId: record.oauthClientId,
		clientSecret,
		refreshToken,
	});
	const updated: ForgeConnectionRecord = {
		...record,
		tokenEnc: encryptToken(tokens.accessToken, aad),
		refreshTokenEnc: tokens.refreshToken
			? encryptToken(tokens.refreshToken, `${aad}|refresh-token`)
			: record.refreshTokenEnc,
		tokenExpiresAt: tokens.expiresAt,
	};
	await getRedis().set(key(id), updated);
	return updated;
}

export async function adapterForConnection(
	id: string,
	fetch?: ForgeContext["fetch"],
): Promise<ForgeAdapter | null> {
	if (!isConnectionId(id)) return null;
	let record = await getConnection(id);
	if (!record) return null;
	try {
		record = await refreshIfNeeded(id, record);
		const token = decryptToken(
			record.tokenEnc,
			connectionAad(id, record.forge, record.host),
		);
		const credentials = decryptCredentialMap(
			record.credentialsEnc,
			connectionAad(id, record.forge, record.host),
		);
		return await createAdapter({
			forge: record.forge,
			host: record.host,
			token,
			credentials,
			authScheme: record.authScheme,
			fetch,
		});
	} catch {
		return null;
	}
}

export async function whoAmI(
	ctx: ForgeContext,
): Promise<{ login: string; id: number }> {
	const api = createApiClient(ctx, authHeadersFor(ctx.forge, ctx.authScheme));
	const path = FORGE_API_PROFILES[ctx.forge].identityPath;
	const { data } = await api.json<{
		login?: string;
		username?: string;
		name?: string;
		id?: number;
	}>(path);
	const login = data.login ?? data.username ?? data.name;
	if (!login || !data.id || !Number.isSafeInteger(data.id)) {
		throw new ForgeHttpError(502, "Unexpected identity response");
	}
	return { login, id: data.id };
}

export function newConnectionId(): string {
	return randomUUID();
}


/** Run an optional provider-specific operation using decrypted connection credentials. */
export async function runConnectionForgeOperation<Input, Output>(
	connectionId: string,
	operationId: string,
	input: Input,
): Promise<Output> {
	if (!isConnectionId(connectionId)) throw new Error("Invalid connection id");
	let record = await getConnection(connectionId);
	if (!record) throw new Error("Forge connection not found");
	record = await refreshIfNeeded(connectionId, record);
	const aad = connectionAad(connectionId, record.forge, record.host);
	const accessToken = decryptToken(record.tokenEnc, aad);
	const credentials = decryptCredentialMap(record.credentialsEnc, aad);
	return runForgeOperation<Input, Output>(
		record.forge,
		operationId,
		{ host: record.host, connectionId, credentials, accessToken },
		input,
	);
}
