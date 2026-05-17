import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
	exchangeCodeForUserToken,
	getAuthedUser,
	listUserInstallations,
} from "@/lib/github-oauth";
import { setSession } from "@/lib/session";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const origin = url.origin;
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");

	const store = await cookies();
	const expectedState = store.get("ur_oauth_state")?.value;
	store.delete("ur_oauth_state");

	const fail = (msg: string) =>
		NextResponse.redirect(`${origin}/app?error=${encodeURIComponent(msg)}`);

	// State is absent on the install-redirect path; only enforce it when we
	// initiated the flow ourselves (sign-in) and set the cookie.
	if (expectedState && state !== expectedState) {
		return fail("Invalid OAuth state");
	}
	if (!code) {
		return fail("Missing authorization code");
	}

	const userToken = await exchangeCodeForUserToken(code);
	if (!userToken) {
		return fail("Could not complete GitHub sign-in");
	}

	try {
		const user = await getAuthedUser(userToken);
		const installations = await listUserInstallations(userToken);
		if (installations.length === 0) {
			return NextResponse.redirect(`${origin}/app?needs_install=1`);
		}
		await setSession({
			login: user.login,
			userId: user.id,
			installationIds: installations.map((i) => i.id),
		});
		return NextResponse.redirect(`${origin}/app`);
	} catch {
		return fail("Could not verify your GitHub installations");
	}
}
