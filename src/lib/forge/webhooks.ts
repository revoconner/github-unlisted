import type { ForgeId } from "./catalog";

export interface ForgeWebhookEvent {
	/** Provider-neutral event name, e.g. `installation.revoked`. */
	kind: string;
	deliveryId?: string;
	installationId?: number;
	repositories?: string[];
	/** Provider-specific data is retained for optional downstream extensions. */
	payload?: unknown;
}

export interface ForgeWebhookInput {
	headers: Headers;
	rawBody: string;
	secret: string;
}

/** Each provider owns its signature scheme and event-to-domain mapping. */
export interface ForgeWebhookAdapter {
	verify(input: ForgeWebhookInput): boolean | Promise<boolean>;
	parse(input: Pick<ForgeWebhookInput, "headers" | "rawBody">): ForgeWebhookEvent | null;
}

const webhookAdapters = new Map<ForgeId, ForgeWebhookAdapter>();

export function registerForgeWebhookAdapter(
	forge: ForgeId,
	adapter: ForgeWebhookAdapter,
): void {
	webhookAdapters.set(forge, adapter);
}

export function getForgeWebhookAdapter(forge: ForgeId): ForgeWebhookAdapter | undefined {
	return webhookAdapters.get(forge);
}

export function hasForgeWebhookAdapter(forge: ForgeId): boolean {
	return webhookAdapters.has(forge);
}

export type ForgeWebhookHandler = (
	event: ForgeWebhookEvent,
	forge: ForgeId,
) => void | Promise<void>;

const eventHandlers = new Map<string, ForgeWebhookHandler>();

export function registerForgeWebhookHandler(
	eventKind: string,
	handler: ForgeWebhookHandler,
): void {
	if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(eventKind)) {
		throw new Error(`Invalid Forge webhook event kind: ${eventKind}`);
	}
	// Idempotent registration keeps module reloads safe in development.
	eventHandlers.set(eventKind, handler);
}

export function hasForgeWebhookHandler(eventKind: string): boolean {
	return eventHandlers.has(eventKind);
}

export async function dispatchForgeWebhookEvent(
	forge: ForgeId,
	event: ForgeWebhookEvent,
): Promise<boolean> {
	const handler = eventHandlers.get(event.kind);
	if (!handler) return false;
	await handler(event, forge);
	return true;
}
