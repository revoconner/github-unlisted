import { Redis } from "@upstash/redis";

// Maps an opaque shareId -> the install/repo it points at. No credential is
// ever stored or placed in a URL; the installation token is minted on demand.

export interface ShareTarget {
	installationId: number;
	owner: string;
	repo: string;
}

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

export async function createShare(target: ShareTarget): Promise<string> {
	const id = globalThis.crypto.randomUUID();
	const ttl = getTtlSeconds();
	const key = `${KEY_PREFIX}${id}`;
	const redis = getRedis();
	if (ttl) {
		await redis.set(key, target, { ex: ttl });
	} else {
		await redis.set(key, target);
	}
	// Reverse index so webhook cleanup can purge an installation's links.
	await redis.sadd(instKey(target.installationId), id);
	return id;
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
