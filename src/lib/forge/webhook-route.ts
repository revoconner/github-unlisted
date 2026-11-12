import { NextResponse } from "next/server";
import type { ForgeId } from "./catalog";
import type { ForgeWebhookEvent } from "./webhooks";
import { getForgeScopedCredential } from "./app-credentials";
import { dispatchForgeWebhookEvent, getForgeWebhookAdapter } from "./webhooks";

/** Shared HTTP ingress for all Forge webhook routes. Provider adapters own verification and parsing. */
export async function handleForgeWebhookRequest(
	request: Request,
	forge: ForgeId,
	options: { secretField: string; fallbackSecret?: string },
): Promise<NextResponse> {
	let secret: string | undefined;
	try {
		secret = await getForgeScopedCredential(forge, "webhook", options.secretField);
	} catch (error) {
		// Preserve env-based deployments if the optional database-backed secret is
		// unavailable; without either secret, fail closed below.
		if (!options.fallbackSecret) {
			console.error(`[webhook:${forge}] could not load configured secret`, error);
		}
	}
	secret = secret ?? options.fallbackSecret;
	if (!secret || secret.startsWith("FILL_ME")) {
		return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
	}

	const adapter = getForgeWebhookAdapter(forge);
	if (!adapter) return NextResponse.json({ error: "Webhook adapter not configured" }, { status: 500 });

	const rawBody = await request.text();
	if (!(await adapter.verify({ headers: request.headers, rawBody, secret }))) {
		return NextResponse.json({ error: "Bad signature" }, { status: 401 });
	}

	let event: ForgeWebhookEvent | null;
	try {
		event = adapter.parse({ headers: request.headers, rawBody });
	} catch {
		return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
	}
	if (!event) return NextResponse.json({ ok: true });

	try {
		await dispatchForgeWebhookEvent(forge, event);
	} catch (error) {
		// The signature is valid. Acknowledge to avoid provider retry storms; the
		// domain operation must remain idempotent and downstream reads re-check access.
		console.error(`[webhook:${forge}] event handler failed`, error);
	}

	return NextResponse.json({ ok: true });
}
