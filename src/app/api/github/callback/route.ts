import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
	exchangeCodeForUserToken,
	getAuthedUser,
	listUserInstallations,
} from "@/lib/github-oauth";
import { getSession, setSession } from "@/lib/session";

const APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
	const url = new URL(request.url);
	const origin = url.origin;
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const store = await cookies();
	const expectedState = store.get("ur_oauth_state")?.value;
	const rawExpiry = store.get("ur_expires_at")?.value;
	store.delete("ur_oauth_state");
	store.delete("ur_expires_at");

	const fail = (msg: string) =>
		NextResponse.redirect(`${origin}/app?error=${encodeURIComponent(msg)}`);

	if (!expectedState || !state || state !== expectedState) return fail("Invalid OAuth state");
	if (!code) return fail("Missing authorization code");
	const expiresAt = Number(rawExpiry);
	if (
		!Number.isSafeInteger(expiresAt) ||
		expiresAt <= Date.now() ||
		expiresAt > Date.now() + MAX_EXPIRY_MS
	) {
		return fail("Invalid session expiration date");
	}

	const userToken = await exchangeCodeForUserToken(code);
	if (!userToken) return fail("Could not complete GitHub sign-in");
	try {
		const user = await getAuthedUser(userToken);
		const installations = await listUserInstallations(userToken);
		if (installations.length === 0) {
			const target = APP_SLUG
				? `https://github.com/apps/${APP_SLUG}/installations/new`
				: `${origin}/app?needs_install=1`;
			return NextResponse.redirect(target);
		}
		const existing = await getSession();
		await setSession({
			authProvider: "github",
			login: user.login,
			userId: user.id,
			installationIds: installations.map((i) => i.id),
			connections: existing?.connections,
			expiresAt,
		});
		return NextResponse.redirect(`${origin}/app`);
	} catch {
		return fail("Could not verify your GitHub installations");
	}
}
