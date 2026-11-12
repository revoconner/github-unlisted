import { readJson, safeFetchFollowRedirects } from "./safe-url";

// Tells Gitea/Forgejo apart from everything else with ONE public, unauthenticated call. Both answer GET /api/v1/version with {"version": "..."} without a token. GitLab has no public equivalent (its /api/v4/version needs authentication), so anything that is not a Gitea-style answer is reported as "unknown" and the user picks the type, rather than the server probing more paths on a host it does not control. No credential is sent, so a wrong guess leaks nothing.
export async function detectForge(
	origin: string,
	fetchImpl?: (url: string) => Promise<Response>,
): Promise<"gitea" | null> {
	const doFetch =
		fetchImpl ??
		((url: string) =>
			safeFetchFollowRedirects(
				url,
				{ headers: { Accept: "application/json" } },
				{ expectedOrigin: origin },
			));
	try {
		const data = await readJson<{ version?: unknown }>(
			await doFetch(`${origin}/api/v1/version`),
		);
		return typeof data.version === "string" && data.version ? "gitea" : null;
	} catch {
		return null;
	}
}
