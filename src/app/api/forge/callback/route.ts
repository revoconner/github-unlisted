import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
	consumeOAuthState,
	decryptPendingClientSecret,
	exchangeOAuthCode,
	getOAuthUser,
} from "@/lib/forge/oauth";
import {
	deleteConnection,
	newConnectionId,
	saveConnection,
} from "@/lib/forge/connections";
import {
	addConnection,
	findConnection,
	getSavedSession,
	getSession,
	setSession,
} from "@/lib/session";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const origin = url.origin;
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");
	const oauthError = url.searchParams.get("error");
	const store = await cookies();
	const expectedState = store.get("ur_forge_oauth_state")?.value;
	store.delete("ur_forge_oauth_state");
	const fail = (message: string) =>
		NextResponse.redirect(`${origin}/app?error=${encodeURIComponent(message)}`);

	if (oauthError) return fail("OAuth authorization was cancelled");
	if (!code || !state) return fail("Missing OAuth authorization code");
	if (!expectedState || state !== expectedState) return fail("Invalid OAuth state");
	try {
		const pending = await consumeOAuthState(state);
		if (
			!pending ||
			pending.expiresAt <= Date.now() ||
			pending.redirectUri !== `${origin}/api/forge/callback`
		) {
			return fail("Invalid or expired OAuth state");
		}
		const tokens = await exchangeOAuthCode(state, pending, code);
		const user = await getOAuthUser(pending, tokens.accessToken);
		const existingSession = await getSession();
		const savedSession = await getSavedSession();
		const existingConnection = findConnection(
			[
				...(existingSession?.connections ?? []),
				...(savedSession?.connections ?? []),
			],
			pending.forge,
			pending.host,
			user.login,
		);
		const replacingExisting = Boolean(existingConnection);
		const connectionId = existingConnection?.id ?? newConnectionId();
		const nextConnections = addConnection(existingSession?.connections ?? [], {
			id: connectionId,
			forge: pending.forge,
			host: pending.host,
			login: user.login,
		});
		const clientSecret = decryptPendingClientSecret(state, pending);
		await saveConnection(connectionId, {
			forge: pending.forge,
			host: pending.host,
			login: user.login,
			userId: user.id,
			token: tokens.accessToken,
			authScheme: "bearer",
			oauthProvider: pending.provider,
			oauthClientId: pending.clientId,
			oauthClientSecret: clientSecret,
			refreshToken: tokens.refreshToken,
			tokenExpiresAt: tokens.expiresAt,
		});
		try {
			await setSession({
				login: existingSession?.login ?? user.login,
				userId: existingSession?.userId ?? user.id,
				authProvider: existingSession?.authProvider ?? "forge",
				installationIds: existingSession?.installationIds ?? [],
				connections: nextConnections,
				expiresAt: pending.expiresAt,
			});
		} catch {
			if (!replacingExisting) await deleteConnection(connectionId).catch(() => {});
			throw new Error("Could not create the session");
		}
		return NextResponse.redirect(`${origin}/app`);
	} catch (error) {
		const message =
			error instanceof Error && /maximum|at most/i.test(error.message)
				? error.message
				: "Could not complete OAuth connection";
		return fail(message);
	}
}
