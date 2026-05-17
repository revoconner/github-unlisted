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

export async function createShare(target: ShareTarget): Promise<string> {
	const id = globalThis.crypto.randomUUID();
	const ttl = getTtlSeconds();
	const key = `${KEY_PREFIX}${id}`;
	if (ttl) {
		await getRedis().set(key, target, { ex: ttl });
	} else {
		await getRedis().set(key, target);
	}
	return id;
}

export async function resolveShare(id: string): Promise<ShareTarget | null> {
	const value = await getRedis().get<ShareTarget>(`${KEY_PREFIX}${id}`);
	return value ?? null;
}
