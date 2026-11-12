import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/github-oauth";

const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
	const url = new URL(request.url);
	const origin = url.origin;
	const rawExpiry = url.searchParams.get("expiresAt");
	const expiresAt = rawExpiry
		? Number(rawExpiry)
		: Date.now() + 30 * 24 * 60 * 60 * 1000;
	const validExpiry =
		Number.isSafeInteger(expiresAt) &&
		expiresAt > Date.now() &&
		expiresAt <= Date.now() + MAX_EXPIRY_MS;
	if (!validExpiry) {
		return NextResponse.redirect(`${origin}/app?error=${encodeURIComponent("Invalid session expiration date")}`);
	}

	const state = crypto.randomBytes(16).toString("hex");
	const store = await cookies();
	store.set("ur_oauth_state", state, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 600,
	});
	store.set("ur_expires_at", String(expiresAt), {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: 600,
	});
	return NextResponse.redirect(
		authorizeUrl(`${origin}/api/github/callback`, state),
	);
}
