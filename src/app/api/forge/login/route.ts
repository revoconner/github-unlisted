import { NextResponse } from "next/server";
import { startPublicOAuth, startSelfHostedOAuth } from "@/lib/forge/oauth";
import { isPublicOAuthProvider, isSelfHostedOAuthProvider } from "@/lib/forge/catalog";

function jsonError(message: string, status = 400) {
	return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const fail = (message: string) => {
  const target = new URL("/app", url.origin);
  target.searchParams.set("error", message);
  return NextResponse.redirect(target);
 };
 const provider = url.searchParams.get("provider") ?? "";
	if (!isPublicOAuthProvider(provider)) return fail("Unknown OAuth provider");
	const rawExpiry = url.searchParams.get("expiresAt");
 const expiresAt = rawExpiry ? Number(rawExpiry) : Date.now() + 30 * 86400000;
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 365 * 86400000) return fail("Invalid session expiration date");
	try {
		const result = await startPublicOAuth({
			provider,
			origin: url.origin,
			expiresAt,
		});
		const response = NextResponse.redirect(result.url);
		response.cookies.set("ur_forge_oauth_state", result.state, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 600,
		});
		return response;
	} catch (error) {
		// Missing app credentials is a configuration state, not a crash: show the message on the sign-in screen without a stack trace.
		if (error instanceof Error && error.message.startsWith("OAuth configuration missing:")) {
			return fail(error.message);
		}
		console.error("Public OAuth initialization failed", error);
		return fail("Could not initialize OAuth state. Check the server Redis configuration and logs.");
	}
}

export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonError("Invalid request body");
	}
	if (typeof body !== "object" || body === null) return jsonError("Invalid request body");
	const b = body as Record<string, unknown>;
	const provider = typeof b.provider === "string" ? b.provider : "";
	const host = typeof b.host === "string" ? b.host : "";
	const clientId = typeof b.clientId === "string" ? b.clientId : "";
	const clientSecret = typeof b.clientSecret === "string" ? b.clientSecret : "";
	const expiresAt = typeof b.expiresAt === "number" ? b.expiresAt : NaN;
	if (!isSelfHostedOAuthProvider(provider)) return jsonError("Unknown self-hosted OAuth provider");
	if (host.length > 2048 || clientId.length > 512 || clientSecret.length > 2048) {
		return jsonError("One of the supplied fields is too long");
	}
	if (!Number.isSafeInteger(expiresAt)) return jsonError("Invalid session expiration date");
	try {
		const result = await startSelfHostedOAuth({
			provider,
			host,
			clientId,
			clientSecret,
			origin: new URL(request.url).origin,
			expiresAt,
		});
		const response = NextResponse.json({ url: result.url });
		response.cookies.set("ur_forge_oauth_state", result.state, {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax",
			path: "/",
			maxAge: 600,
		});
		return response;
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : "Could not start OAuth", 400);
	}
}
