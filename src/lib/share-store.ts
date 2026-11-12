import { Redis } from "@upstash/redis";
import { isConnectionForge, isConnectionId } from "@/lib/forge/registry";
import type { ForgeId } from "@/lib/forge/types";

// Maps an opaque shareId -> the repository it points at. No credential is ever stored in a share or placed in a URL: a GitHub share is minted a fresh installation token on demand, and a share on another forge points at a connection whose token stays encrypted in Redis (conn:{id}) and is decrypted server-side only while serving a request.

// The per-share options, identical for every forge.
interface ShareOptions {
	// Branch this link is locked to. Undefined (every share created before branch locking existed) means "not locked": the viewer resolves the ref from the URL and falls back to the repo default, exactly as before.
	ref?: string;
	// Opt-in branch switcher for an unlocked share. Undefined/false keeps every existing link exactly as it was: other branches stay reachable by URL but are never enumerated to the recipient, because branch names themselves leak information.
	showBranches?: boolean;
	// Opt-in whole-branch zip download. Undefined/false keeps every existing link as it was. The recipient can already read each file, so this grants no new access, but it turns reading into one-click bulk retrieval and that is the owner's call to make.
	allowDownload?: boolean;
	// Opt-in releases tab. Undefined/false keeps every existing link as it was. Releases are genuinely new surface: tags, publish dates, notes and uploaded binaries are not reachable through the file viewer at all.
	showReleases?: boolean;
}

interface ShareBase extends ShareOptions {
	// May contain slashes on GitLab ("group/subgroup"). Always compared whole, never split here.
	owner: string;
	repo: string;
	createdAt?: number;
	expiresAt?: number;
	// Set when the share was created BY a portfolio rather than by the owner on its own. Such a share lives and dies with that portfolio: it expires on the portfolio's revoke date, and is revoked when it is removed from the portfolio or the portfolio is deleted. Shares the owner made themselves never carry it, and a portfolio never touches them.
	portfolioId?: string;
}

// forge absent means github: every record written before multi-forge support has no forge field and must keep resolving unchanged.
export interface GitHubShareTarget extends ShareBase {
	forge?: "github";
	installationId: number;
	connectionId?: undefined;
}

export interface ConnectionShareTarget extends ShareBase {
	forge: Exclude<ForgeId, "github">;
	connectionId: string;
	installationId?: undefined;
}

// A discriminated union rather than two optional fields on one shape: a share has exactly one of installationId / connectionId, and making the type say so forces every caller to handle both instead of passing an undefined installation id into the GitHub client.
export type ShareTarget = GitHubShareTarget | ConnectionShareTarget;

// The per-share settings an owner can change after creation. Deliberately excludes the TTL, which has its own updater with different semantics.
export type ShareSettings = Pick<
	ShareTarget,
	"ref" | "showBranches" | "allowDownload" | "showReleases"
>;

export type ShareRecord = ShareTarget & { id: string };

const KEY_PREFIX = "share:";

export function shareForge(target: Pick<ShareTarget, "forge">): ForgeId {
	return target.forge ?? "github";
}

// Redis is outside the type system, and a record is trusted with a stored token's blast radius. Anything that does not have exactly one coherent owner identifier is treated as missing, which fails closed: the viewer shows "invalid or expired" rather than guessing which credential to use.
function isShareTarget(value: unknown): value is ShareTarget {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (typeof v.owner !== "string" || !v.owner) return false;
	if (typeof v.repo !== "string" || !v.repo) return false;
	if (v.forge === undefined || v.forge === "github") {
		return (
			typeof v.installationId === "number" &&
			Number.isSafeInteger(v.installationId) &&
			v.connectionId === undefined
		);
	}
	return (
		isConnectionForge(v.forge) &&
		isConnectionId(v.connectionId) &&
		v.installationId === undefined
	);
}

// Reverse index per owner: inst:{id} for GitHub installations (unchanged key, so existing data and the webhook keep working) and conn:{id}:shares for connections. It exists so cleanup can purge everything an owner had without scanning every share.
function installationIndex(installationId: number): string {
	return `inst:${installationId}`;
}

function connectionIndex(connectionId: string): string {
	if (!isConnectionId(connectionId)) throw new Error("Invalid connection id");
	return `conn:${connectionId}:shares`;
}

function indexKey(target: ShareTarget): string {
	return target.connectionId === undefined
		? installationIndex(target.installationId)
		: connectionIndex(target.connectionId);
}

function getTtlSeconds(): number | null {
	const raw = process.env.SHARE_LINK_TTL_SECONDS;
	if (!raw) return null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

let client: Redis | null = null;

// Accept the Vercel KV names or the native Upstash names. The read-only KV
// token can't write, so use KV_REST_API_TOKEN (read-write).
export function getRedis(): Redis {
	if (!client) {
		const url =
			process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
		const token =
			process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
		if (!url || !token) {
			throw new Error(
				"KV not configured: set KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN",
			);
		}
		client = new Redis({ url, token });
	}
	return client;
}

async function readShare(id: string): Promise<ShareTarget | null> {
	const value = await getRedis().get<unknown>(`${KEY_PREFIX}${id}`);
	return isShareTarget(value) ? value : null;
}

// ttlSeconds: a positive number sets an auto-revoke window, null means never
// expire, undefined falls back to the global SHARE_LINK_TTL_SECONDS env.
export async function createShare(
	target: ShareTarget,
	ttlSeconds?: number | null,
): Promise<string> {
	if (!isShareTarget(target)) throw new Error("Invalid share target");
	const id = globalThis.crypto.randomUUID();
	const ttl = ttlSeconds === undefined ? getTtlSeconds() : ttlSeconds;
	const key = `${KEY_PREFIX}${id}`;
	const redis = getRedis();
	const now = Date.now();
	const record: ShareTarget = {
		...target,
		createdAt: now,
		expiresAt: ttl ? now + ttl * 1000 : undefined,
	};
	if (ttl) {
		await redis.set(key, record, { ex: ttl });
	} else {
		await redis.set(key, record);
	}
	// Reverse index so cleanup (webhook, Disconnect) can purge an owner's links.
	await redis.sadd(indexKey(target), id);
	return id;
}

// Reset an existing share's auto-revoke window. null clears it (never expires).
export async function updateShareTtl(
	id: string,
	ttlSeconds: number | null,
): Promise<ShareTarget | null> {
	const redis = getRedis();
	const key = `${KEY_PREFIX}${id}`;
	const current = await readShare(id);
	if (!current) return null;
	const next: ShareTarget = {
		...current,
		expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
	};
	if (ttlSeconds) {
		await redis.set(key, next, { ex: ttlSeconds });
	} else {
		await redis.set(key, next);
	}
	return next;
}

// Change stored settings. Unlike updateShareTtl this must NOT restart the auto-revoke window, so the remaining TTL is read back and re-applied. redis.ttl returns -1 for a key with no expiry and -2 for a missing key. Keys absent from the patch keep their current value; an explicit undefined clears (JSON drops it).
export async function updateShareSettings(
	id: string,
	patch: Partial<ShareSettings>,
): Promise<ShareTarget | null> {
	const redis = getRedis();
	const key = `${KEY_PREFIX}${id}`;
	const current = await readShare(id);
	if (!current) return null;
	const remaining = await redis.ttl(key);
	const next = { ...current, ...patch } as ShareTarget;
	if (remaining > 0) {
		await redis.set(key, next, { ex: remaining });
	} else {
		await redis.set(key, next);
	}
	return next;
}

export async function resolveShare(id: string): Promise<ShareTarget | null> {
	return readShare(id);
}

async function deleteByIndex(setKey: string): Promise<void> {
	const redis = getRedis();
	const ids = await redis.smembers(setKey);
	if (ids.length > 0) {
		await redis.del(...ids.map((i) => `${KEY_PREFIX}${i}`));
	}
	await redis.del(setKey);
}

async function listByIndex(setKey: string): Promise<ShareRecord[]> {
	const redis = getRedis();
	const ids = await redis.smembers(setKey);
	const out: ShareRecord[] = [];
	for (const id of ids) {
		const t = await readShare(id);
		if (t) {
			out.push({ id, ...t });
		} else {
			// Expired/missing: prune the dangling index entry.
			await redis.srem(setKey, id);
		}
	}
	return out;
}

// Best-effort cleanup. Access is already enforced at read time (the
// installation token fails if access was revoked); this just keeps KV tidy.
export async function deleteSharesForInstallation(
	installationId: number,
): Promise<void> {
	await deleteByIndex(installationIndex(installationId));
}

// Called when a connection is disconnected. Unlike the GitHub cleanup this is not just tidiness: the token is gone, so every share on it would be a dead link, and leaving the records would keep a repository's owner/name addressable for nothing.
export async function deleteSharesForConnection(
	connectionId: string,
): Promise<void> {
	await deleteByIndex(connectionIndex(connectionId));
}

export async function listSharesForInstallation(
	installationId: number,
): Promise<ShareRecord[]> {
	return listByIndex(installationIndex(installationId));
}

export async function listSharesForConnection(
	connectionId: string,
): Promise<ShareRecord[]> {
	return listByIndex(connectionIndex(connectionId));
}

// Everything one signed-in owner can manage, across GitHub installations and forge connections. The ids must come from the verified session, never from a request: this function performs no authorization of its own.
export async function listSharesForOwner(owner: {
	installationIds: number[];
	connectionIds: string[];
}): Promise<ShareRecord[]> {
	const lists = await Promise.all([
		...owner.installationIds.map(listSharesForInstallation),
		...owner.connectionIds.map(listSharesForConnection),
	]);
	return lists.flat();
}

export async function deleteShare(id: string): Promise<ShareTarget | null> {
	const redis = getRedis();
	const t = await readShare(id);
	await redis.del(`${KEY_PREFIX}${id}`);
	if (t) await redis.srem(indexKey(t), id);
	return t;
}

export async function deleteSharesForRepos(
	installationId: number,
	fullNames: string[],
): Promise<void> {
	if (fullNames.length === 0) return;
	const redis = getRedis();
	const setKey = installationIndex(installationId);
	const ids = await redis.smembers(setKey);
	const want = new Set(fullNames.map((f) => f.toLowerCase()));
	for (const id of ids) {
		const t = await readShare(id);
		if (t && want.has(`${t.owner}/${t.repo}`.toLowerCase())) {
			await redis.del(`${KEY_PREFIX}${id}`);
			await redis.srem(setKey, id);
		}
	}
}
