import { Octokit } from "octokit";

// GitHub App user-to-server OAuth: used only to confirm who is creating a
// share link and which installations they control. The user token is used
// transiently and never persisted.

function clientCreds() {
	const clientId = process.env.GITHUB_APP_CLIENT_ID;
	const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error(
			"OAuth not configured: set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET",
		);
	}
	return { clientId, clientSecret };
}

export function authorizeUrl(redirectUri: string, state: string): string {
	const { clientId } = clientCreds();
	const u = new URL("https://github.com/login/oauth/authorize");
	u.searchParams.set("client_id", clientId);
	u.searchParams.set("redirect_uri", redirectUri);
	u.searchParams.set("state", state);
	return u.toString();
}

export async function exchangeCodeForUserToken(
	code: string,
): Promise<string | null> {
	const { clientId, clientSecret } = clientCreds();
	const res = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({
			client_id: clientId,
			client_secret: clientSecret,
			code,
		}),
	});
	if (!res.ok) return null;
	const data = (await res.json()) as { access_token?: string };
	return data.access_token ?? null;
}

export async function getAuthedUser(
	userToken: string,
): Promise<{ login: string; id: number }> {
	const octokit = new Octokit({ auth: userToken });
	const { data } = await octokit.rest.users.getAuthenticated();
	return { login: data.login, id: data.id };
}

// Installations the authenticated user can administer/access. Verifying an
// installationId is in this list proves the user controls that installation.
export async function listUserInstallations(
	userToken: string,
): Promise<{ id: number; account: string }[]> {
	const octokit = new Octokit({ auth: userToken });
	const { data } = await octokit.request("GET /user/installations", {
		per_page: 100,
	});
	return data.installations.map((i) => ({
		id: i.id,
		account:
			(i.account && "login" in i.account ? i.account.login : i.account?.slug) ??
			"",
	}));
}
