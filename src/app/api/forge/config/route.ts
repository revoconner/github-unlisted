import { NextResponse } from "next/server";
import {
	checkAdminToken,
	deleteOAuthApp,
	isOAuthAppProvider,
	listOAuthAppStatus,
	MAX_CLIENT_ID_LENGTH,
	MAX_CLIENT_SECRET_LENGTH,
	saveOAuthApp,
} from "@/lib/forge/oauth-apps";

// Admin-only management of the hosted-forge OAuth app credentials. Every call needs the FORGE_ADMIN_TOKEN in a custom header, which a cross-site form cannot set. Secrets are write-only: no response ever contains one.

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
	return NextResponse.json(body, { status, headers: NO_STORE });
}

async function authorize(request: Request): Promise<NextResponse | null> {
	const result = await checkAdminToken(request.headers.get("x-forge-admin-token"));
	if (result === "ok") return null;
	if (result === "disabled") {
		return json(
			{ error: "OAuth setup is disabled. Set FORGE_ADMIN_TOKEN (16+ characters) on the server to enable it." },
			503,
		);
	}
	if (result === "throttled") return json({ error: "Too many failed attempts. Try again later." }, 429);
	return json({ error: "Invalid admin token" }, 401);
}

export async function GET(request: Request) {
	try {
		const denied = await authorize(request);
		if (denied) return denied;
		return json({
			callbackUri: `${new URL(request.url).origin}/api/forge/callback`,
			providers: await listOAuthAppStatus(),
		});
	} catch (error) {
		console.error("OAuth config read failed", error);
		return json({ error: "Could not read the OAuth configuration. Check the Redis configuration." }, 500);
	}
}

export async function PUT(request: Request) {
	try {
		const denied = await authorize(request);
		if (denied) return denied;
		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return json({ error: "Invalid request body" }, 400);
		}
		if (typeof body !== "object" || body === null) return json({ error: "Invalid request body" }, 400);
		const b = body as Record<string, unknown>;
		if (!isOAuthAppProvider(b.provider)) return json({ error: "Unknown OAuth provider" }, 400);
		const clientId = typeof b.clientId === "string" ? b.clientId.trim() : "";
		const clientSecret = typeof b.clientSecret === "string" ? b.clientSecret.trim() : "";
		if (!clientId || !clientSecret) return json({ error: "Client ID and client secret are required" }, 400);
		if (clientId.length > MAX_CLIENT_ID_LENGTH || clientSecret.length > MAX_CLIENT_SECRET_LENGTH) {
			return json({ error: "One of the supplied fields is too long" }, 400);
		}
		await saveOAuthApp(b.provider, { clientId, clientSecret });
		return json({ ok: true, providers: await listOAuthAppStatus() });
	} catch (error) {
		console.error("OAuth config save failed", error);
		return json({ error: "Could not save the OAuth configuration. Check the server logs." }, 500);
	}
}

export async function DELETE(request: Request) {
	try {
		const denied = await authorize(request);
		if (denied) return denied;
		const provider = new URL(request.url).searchParams.get("provider");
		if (!isOAuthAppProvider(provider)) return json({ error: "Unknown OAuth provider" }, 400);
		await deleteOAuthApp(provider);
		return json({ ok: true, providers: await listOAuthAppStatus() });
	} catch (error) {
		console.error("OAuth config delete failed", error);
		return json({ error: "Could not delete the OAuth configuration. Check the server logs." }, 500);
	}
}
