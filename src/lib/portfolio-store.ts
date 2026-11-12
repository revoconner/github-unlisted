import { isConnectionForge, isConnectionId } from "@/lib/forge/registry";
import type { ForgeId } from "@/lib/forge/types";
import { MAX_PORTFOLIO_REPOS } from "@/lib/portfolio";
import { getRedis, type ShareTarget } from "@/lib/share-store";

// A portfolio is an ordered list of share ids plus a title and description.
// It deliberately holds no repository content and no credential: every repo on
// the page is still served through its own share, with that share's branch
// lock, download and releases settings and its own auto-revoke window.
//
// One portfolio belongs to ONE account: a GitHub installation or a connected
// forge account. That is what lets it reuse the exact ownership rule shares
// already use (sessionOwnsTarget) and the same cleanup moments (uninstall,
// disconnect, sign-out with deletion), instead of inventing a second model for
// "who may edit a page that mixes accounts".

interface PortfolioBase {
	title?: string;
	description?: string;
	// Display order. Entries may point at shares that have since expired or been
	// revoked; readers skip those rather than treating them as an error.
	shareIds: string[];
	// Name used for the default title ("Portfolio for {label}"). Captured at
	// creation so the public page never needs the owner's session.
	label: string;
	// Set when the portfolio has a picture. The bytes live under their own key
	// so this record stays small; the number only busts browser caches.
	imageVersion?: number;
	// When the page (and every link it created) stops working. Mirrors the
	// Redis TTL on the record, which is what actually enforces it; kept here so
	// the dashboard can show the date and so a share added later can be given
	// the same moment.
	expiresAt?: number;
	createdAt: number;
	updatedAt: number;
}

export interface GitHubPortfolio extends PortfolioBase {
	forge?: "github";
	installationId: number;
	connectionId?: undefined;
}

export interface ConnectionPortfolio extends PortfolioBase {
	forge: Exclude<ForgeId, "github">;
	connectionId: string;
	installationId?: undefined;
}

export type Portfolio = GitHubPortfolio | ConnectionPortfolio;
export type PortfolioRecord = Portfolio & { id: string };

// What the caller supplies; timestamps are the store's business.
export type NewPortfolio =
	| Omit<GitHubPortfolio, "createdAt" | "updatedAt" | "expiresAt">
	| Omit<ConnectionPortfolio, "createdAt" | "updatedAt" | "expiresAt">;

export type PortfolioPatch = Partial<
	Pick<Portfolio, "title" | "description" | "shareIds" | "imageVersion">
>;

const KEY_PREFIX = "portfolio:";
const IMAGE_PREFIX = "portfolio-img:";

// Redis is outside the type system. A record that does not have exactly one
// coherent owner is treated as missing, which fails closed: the page reads as
// "invalid or expired" instead of guessing whose credential to use.
function isPortfolio(value: unknown): value is Portfolio {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	if (!Array.isArray(v.shareIds)) return false;
	if (v.shareIds.length > MAX_PORTFOLIO_REPOS) return false;
	if (!v.shareIds.every((s) => typeof s === "string" && s.length > 0)) {
		return false;
	}
	if (typeof v.label !== "string") return false;
	if (v.title !== undefined && typeof v.title !== "string") return false;
	if (v.imageVersion !== undefined && typeof v.imageVersion !== "number") {
		return false;
	}
	if (v.expiresAt !== undefined && typeof v.expiresAt !== "number") {
		return false;
	}
	if (v.description !== undefined && typeof v.description !== "string") {
		return false;
	}
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

// The single definition of "this share may appear in this portfolio": same
// account, same forge. Used when a portfolio is written AND when it is read, so
// a record edited out-of-band can never make one account's page serve another
// account's repository.
export function shareBelongsToOwner(
	owner: Pick<Portfolio, "forge" | "installationId" | "connectionId">,
	share: ShareTarget,
): boolean {
	if (owner.connectionId !== undefined) {
		return (
			share.connectionId === owner.connectionId && share.forge === owner.forge
		);
	}
	return (
		share.connectionId === undefined &&
		share.installationId === owner.installationId
	);
}

function installationIndex(installationId: number): string {
	return `inst:${installationId}:portfolios`;
}

function connectionIndex(connectionId: string): string {
	if (!isConnectionId(connectionId)) throw new Error("Invalid connection id");
	return `conn:${connectionId}:portfolios`;
}

function indexKey(
	owner: Pick<Portfolio, "installationId" | "connectionId">,
): string {
	return owner.connectionId === undefined
		? installationIndex(owner.installationId as number)
		: connectionIndex(owner.connectionId);
}

async function readPortfolio(id: string): Promise<Portfolio | null> {
	const value = await getRedis().get<unknown>(`${KEY_PREFIX}${id}`);
	return isPortfolio(value) ? value : null;
}

export async function getPortfolio(id: string): Promise<Portfolio | null> {
	return readPortfolio(id);
}

// ttlSeconds: a positive number sets the revoke window, null means never.
export async function createPortfolio(
	input: NewPortfolio,
	ttlSeconds: number | null = null,
): Promise<string> {
	const now = Date.now();
	const record = {
		...input,
		expiresAt: ttlSeconds ? now + ttlSeconds * 1000 : undefined,
		createdAt: now,
		updatedAt: now,
	} as Portfolio;
	if (!isPortfolio(record)) throw new Error("Invalid portfolio");
	const id = globalThis.crypto.randomUUID();
	const redis = getRedis();
	if (ttlSeconds) {
		await redis.set(`${KEY_PREFIX}${id}`, record, { ex: ttlSeconds });
	} else {
		await redis.set(`${KEY_PREFIX}${id}`, record);
	}
	await redis.sadd(indexKey(record), id);
	return id;
}

// Fields absent from the patch keep their value; an explicit undefined clears
// (JSON drops it). The owner never changes: it is not part of the patch type.
//
// Writing a Redis key without a TTL REMOVES its TTL, so every update re-applies
// the remaining window; otherwise renaming a portfolio would quietly make it
// permanent. Passing options.ttlSeconds replaces the window instead (null
// clears it), and the picture, which has its own key, follows it.
export async function updatePortfolio(
	id: string,
	patch: PortfolioPatch,
	options?: { ttlSeconds: number | null },
): Promise<Portfolio | null> {
	const redis = getRedis();
	const key = `${KEY_PREFIX}${id}`;
	const current = await readPortfolio(id);
	if (!current) return null;

	let ttl: number | null;
	let expiresAt = current.expiresAt;
	if (options) {
		ttl = options.ttlSeconds;
		expiresAt = ttl ? Date.now() + ttl * 1000 : undefined;
	} else {
		const remaining = await redis.ttl(key);
		ttl = remaining > 0 ? remaining : null;
	}

	const next = {
		...current,
		...patch,
		expiresAt,
		updatedAt: Date.now(),
	} as Portfolio;
	if (!isPortfolio(next)) throw new Error("Invalid portfolio");
	if (ttl) {
		await redis.set(key, next, { ex: ttl });
	} else {
		await redis.set(key, next);
	}

	if (options) {
		const imageKey = `${IMAGE_PREFIX}${id}`;
		const image = await redis.get<unknown>(imageKey);
		if (image) {
			if (ttl) {
				await redis.set(imageKey, image, { ex: ttl });
			} else {
				await redis.set(imageKey, image);
			}
		}
	}
	return next;
}

export async function deletePortfolio(id: string): Promise<Portfolio | null> {
	const redis = getRedis();
	const current = await readPortfolio(id);
	await redis.del(`${KEY_PREFIX}${id}`, `${IMAGE_PREFIX}${id}`);
	if (current) await redis.srem(indexKey(current), id);
	return current;
}

async function listByIndex(setKey: string): Promise<PortfolioRecord[]> {
	const redis = getRedis();
	const ids = await redis.smembers(setKey);
	const out: PortfolioRecord[] = [];
	for (const id of ids) {
		const p = await readPortfolio(id);
		if (p) {
			out.push({ id, ...p });
		} else {
			// Deleted or corrupt: prune the dangling index entry.
			await redis.srem(setKey, id);
		}
	}
	return out;
}

export async function countPortfoliosFor(
	owner: Pick<Portfolio, "installationId" | "connectionId">,
): Promise<number> {
	return (await getRedis().smembers(indexKey(owner))).length;
}

// Everything one signed-in owner can manage. As with listSharesForOwner, the
// ids must come from the verified session: this performs no authorization.
export async function listPortfoliosForOwner(owner: {
	installationIds: number[];
	connectionIds: string[];
}): Promise<PortfolioRecord[]> {
	const lists = await Promise.all([
		...owner.installationIds.map((id) => listByIndex(installationIndex(id))),
		...owner.connectionIds.map((id) => listByIndex(connectionIndex(id))),
	]);
	return lists.flat().sort((a, b) => a.createdAt - b.createdAt);
}

async function deleteByIndex(setKey: string): Promise<void> {
	const redis = getRedis();
	const ids = await redis.smembers(setKey);
	if (ids.length > 0) {
		await redis.del(
			...ids.flatMap((i) => [`${KEY_PREFIX}${i}`, `${IMAGE_PREFIX}${i}`]),
		);
	}
	await redis.del(setKey);
}

// Called wherever the matching deleteSharesFor* is: when the account goes away
// its portfolios must go with it, or an empty page would stay addressable.
export async function deletePortfoliosForInstallation(
	installationId: number,
): Promise<void> {
	await deleteByIndex(installationIndex(installationId));
}

export async function deletePortfoliosForConnection(
	connectionId: string,
): Promise<void> {
	await deleteByIndex(connectionIndex(connectionId));
}

// The picture itself, stored as base64 JSON (the Redis client serialises JSON).
// It is the owner's own content, kept only while the portfolio exists: it is
// removed with the portfolio and with the account.
export interface StoredImage {
	type: "image/png" | "image/jpeg" | "image/webp";
	data: string;
}

export async function setPortfolioImage(
	id: string,
	image: StoredImage,
): Promise<number | null> {
	const current = await readPortfolio(id);
	if (!current) return null;
	const redis = getRedis();
	// The picture must not outlive the portfolio it belongs to.
	const remaining = await redis.ttl(`${KEY_PREFIX}${id}`);
	if (remaining > 0) {
		await redis.set(`${IMAGE_PREFIX}${id}`, image, { ex: remaining });
	} else {
		await redis.set(`${IMAGE_PREFIX}${id}`, image);
	}
	const version = Date.now();
	await updatePortfolio(id, { imageVersion: version });
	return version;
}

export async function removePortfolioImage(id: string): Promise<void> {
	await getRedis().del(`${IMAGE_PREFIX}${id}`);
	await updatePortfolio(id, { imageVersion: undefined });
}

export async function getPortfolioImage(
	id: string,
): Promise<StoredImage | null> {
	const v = await getRedis().get<unknown>(`${IMAGE_PREFIX}${id}`);
	if (typeof v !== "object" || v === null) return null;
	const r = v as Record<string, unknown>;
	const okType =
		r.type === "image/png" ||
		r.type === "image/jpeg" ||
		r.type === "image/webp";
	return okType && typeof r.data === "string"
		? { type: r.type as StoredImage["type"], data: r.data }
		: null;
}
