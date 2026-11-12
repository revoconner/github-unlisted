import { FORGE_CATALOG, FORGE_IDS } from "./catalog";
import type { ForgeAdapter, ForgeId } from "./types";

export type ForgeAdapterFactory<TContext = unknown> = (
	context: TContext,
) => ForgeAdapter | Promise<ForgeAdapter>;

const factories = new Map<ForgeId, ForgeAdapterFactory>();

export function registerForgeAdapter<TContext>(
	forge: ForgeId,
	factory: ForgeAdapterFactory<TContext>,
): void {
	factories.set(forge, factory as ForgeAdapterFactory);
}

export function hasForgeAdapter(forge: ForgeId): boolean {
	return factories.has(FORGE_CATALOG[forge].adapterForge);
}

export async function createForgeAdapter<TContext>(
	forge: ForgeId,
	context: TContext,
): Promise<ForgeAdapter> {
	const adapterForge = FORGE_CATALOG[forge].adapterForge;
	const factory = factories.get(adapterForge);
	if (!factory) {
		throw new Error(`No adapter registered for forge: ${forge} (adapter family: ${adapterForge})`);
	}
	return factory(context);
}

// The single place that decides whether a string from a cookie, a request body or Redis names a forge. Everything that narrows to ForgeId goes through here so an unknown value can never select an adapter.
export function isForgeId(value: unknown): value is ForgeId {
	return typeof value === "string" && (FORGE_IDS as readonly string[]).includes(value);
}

// Narrower guard for the connection-backed forges (everything except GitHub, which authenticates through the GitHub App instead of a stored token).
export function isConnectionForge(
	value: unknown,
): value is Exclude<ForgeId, "github"> {
	return isForgeId(value) && value !== "github";
}

const CONNECTION_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Connection ids are interpolated into Redis keys (`conn:{id}`, `conn:{id}:shares`). Accepting only the UUID shape we generate means a crafted id from a cookie or request body can never address a different key, for example one that merely ends in ":shares".
export function isConnectionId(value: unknown): value is string {
	return typeof value === "string" && CONNECTION_ID_RE.test(value);
}
