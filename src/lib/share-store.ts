import { Redis } from "@upstash/redis";

// Maps an opaque shareId -> the install/repo it points at. No credential is
// ever stored or placed in a URL; the installation token is minted on demand.

export interface ShareTarget {
	installationId: number;
	owner: string;
	repo: string;
	createdAt?: number;
	expiresAt?: number;
	// Branch this link is locked to. Undefined (every share created before branch locking existed) means "not locked": the viewer resolves the ref from the URL and falls back to the repo default, exactly as before.
	ref?: string;
	// Opt-in branch switcher for an unlocked share. Undefined/false keeps every existing link exactly as it was: other branches stay reachable by URL but are never enumerated to the recipient, because branch names themselves leak information.
	showBranches?: boolean;
}

// The per-share settings an owner can change after creation. Deliberately excludes the TTL, which has its own updater with different semantics.
export type ShareSettings = Pick<ShareTarget, "ref" | "showBranches">;

const KEY_PREFIX = "share:";

function getTtlSeconds(): number | null {
	const raw = process.env.SHARE_LINK_TTL_SECONDS;
	if (!raw) return null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

let client: Redis | null = null;

// Accept the Vercel KV names or the native Upstash names. The read-only KV
// token can't write, so use KV_REST_API_TOKEN (read-write).
function getRedis(): Redis {
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

function instKey(installationId: number): string {
	return `inst:${installationId}`;
}

// ttlSeconds: a positive number sets an auto-revoke window, null means never
// expire, undefined falls back to the global SHARE_LINK_TTL_SECONDS env.
export async function createShare(
	target: ShareTarget,
	ttlSeconds?: number | null,
): Promise<string> {
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
	// Reverse index so webhook cleanup can purge an installation's links.
	await redis.sadd(instKey(target.installationId), id);
	return id;
}

// Reset an existing share's auto-revoke window. null clears it (never expires).
export async function updateShareTtl(
	id: string,
	ttlSeconds: number | null,
): Promise<ShareTarget | null> {
	const redis = getRedis();
	const key = `${KEY_PREFIX}${id}`;
	const current = await redis.get<ShareTarget>(key);
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
	const current = await redis.get<ShareTarget>(key);
	if (!current) return null;
	const remaining = await redis.ttl(key);
	const next: ShareTarget = { ...current, ...patch };
	if (remaining > 0) {
		await redis.set(key, next, { ex: remaining });
	} else {
		await redis.set(key, next);
	}
	return next;
}

export async function resolveShare(id: string): Promise<ShareTarget | null> {
	const value = await getRedis().get<ShareTarget>(`${KEY_PREFIX}${id}`);
	return value ?? null;
}

// Best-effort cleanup. Access is already enforced at read time (the
// installation token fails if access was revoked); this just keeps KV tidy.
export async function deleteSharesForInstallation(
	installationId: number,
): Promise<void> {
	const redis = getRedis();
	const setKey = instKey(installationId);
	const ids = await redis.smembers(setKey);
	if (ids.length > 0) {
		await redis.del(...ids.map((i) => `${KEY_PREFIX}${i}`));
	}
	await redis.del(setKey);
}

export interface ShareRecord extends ShareTarget {
	id: string;
}

export async function listSharesForInstallation(
	installationId: number,
): Promise<ShareRecord[]> {
	const redis = getRedis();
	const setKey = instKey(installationId);
	const ids = await redis.smembers(setKey);
	const out: ShareRecord[] = [];
	for (const id of ids) {
		const t = await redis.get<ShareTarget>(`${KEY_PREFIX}${id}`);
		if (t) {
			out.push({ id, ...t });
		} else {
			// Expired/missing: prune the dangling index entry.
			await redis.srem(setKey, id);
		}
	}
	return out;
}

export async function deleteShare(id: string): Promise<ShareTarget | null> {
	const redis = getRedis();
	const t = await redis.get<ShareTarget>(`${KEY_PREFIX}${id}`);
	await redis.del(`${KEY_PREFIX}${id}`);
	if (t) await redis.srem(instKey(t.installationId), id);
	return t ?? null;
}

export async function deleteSharesForRepos(
	installationId: number,
	fullNames: string[],
): Promise<void> {
	if (fullNames.length === 0) return;
	const redis = getRedis();
	const setKey = instKey(installationId);
	const ids = await redis.smembers(setKey);
	const want = new Set(fullNames.map((f) => f.toLowerCase()));
	for (const id of ids) {
		const t = await redis.get<ShareTarget>(`${KEY_PREFIX}${id}`);
		if (t && want.has(`${t.owner}/${t.repo}`.toLowerCase())) {
			await redis.del(`${KEY_PREFIX}${id}`);
			await redis.srem(setKey, id);
		}
	}
}
