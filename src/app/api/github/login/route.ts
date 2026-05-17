import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl } from "@/lib/github-oauth";

export async function GET(request: Request) {
	const origin = new URL(request.url).origin;
	const state = crypto.randomBytes(16).toString("hex");

	const store = await cookies();
	store.set("ur_oauth_state", state, {
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
