import { FORGE_API_PROFILES, FORGE_CATALOG, FORGE_IDS } from "./catalog";
import {
	normalizeSafeOrigin,
	readJson,
	safeFetchFollowRedirects,
} from "./safe-url";
import {
	type ArchiveResponse,
	type Contents,
	type DirEntry,
	ForgeHttpError,
	type ForgeId,
} from "./types";

// Plumbing shared by the GitLab, Gitea and Gitee adapters. Everything that touches the network goes through createApiClient, which is the only place a stored token meets an outbound request, so the safety rules live here once instead of three times: the host is re-validated, every hop is resolved and checked by safe-url.ts, the token is dropped on any cross-origin redirect, and path pieces are validated before being spliced into a URL.

export type ConnectionForgeId = Exclude<ForgeId, "github">;

export type ForgeFetch = (
	url: string,
	init: RequestInit,
	options?: { allowCrossOriginRedirect?: boolean },
) => Promise<Response>;

export interface ForgeContext {
	forge: ConnectionForgeId;
	// Origin of the instance, already stored in normalised form. Re-checked here because it came out of Redis, not out of a trusted constant.
	host: string;
	// Plaintext access token, alive only for the duration of one request.
	token: string;
	authScheme?: "token" | "bearer";
	/** Decrypted only for the lifetime of this request; may carry provider-specific keys/secrets. */
	credentials?: Readonly<Record<string, string>>;
	// Injection point for tests. Production always uses the SSRF-guarded fetch below.
	fetch?: ForgeFetch;
}

// Hosted services whose address is not user-supplied. They still go through the same guarded fetch.
export const PUBLIC_HOSTS = Object.fromEntries(
	FORGE_IDS.flatMap((id) => {
		const definition = FORGE_CATALOG[id];
		return id !== "github" && definition.deployment !== "self-hosted" && definition.defaultHost
			? [[id, definition.defaultHost] as const]
			: [];
	}),
) as Partial<Record<ConnectionForgeId, string>>;

// One definition of how each forge wants its token presented, used by the adapters and by the connect-time identity check, so the two can never disagree. GitLab: PRIVATE-TOKEN works for personal, project and group tokens. Gitea/Forgejo: "token <value>" (Bearer is for OAuth2). Gitee: see the TODO(verify) in gitee.ts.
export function authHeadersFor(
	forge: ConnectionForgeId,
	authScheme: "token" | "bearer" = "token",
): (token: string) => Record<string, string> {
	const profile = FORGE_API_PROFILES[forge];
	if (authScheme === "bearer") {
		return (token) => ({ [profile.auth.bearerHeader]: `${profile.auth.bearerPrefix}${token}` });
	}
	return (token) => ({ [profile.auth.tokenHeader]: `${profile.auth.tokenPrefix}${token}` });
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface ApiClient {
	readonly host: string;
	json<T>(path: string, query?: Query): Promise<{ data: T; headers: Headers }>;
	// Raw upstream response, status unchecked. The caller decides what a non-2xx means.
	request(path: string, query?: Query): Promise<Response>;
	// Streams the upstream body to the caller. Never buffered: an archive can be hundreds of megabytes and this runs in a function with a memory ceiling.
	stream(path: string, query?: Query): Promise<ArchiveResponse>;
	// Same, for an absolute URL that must already be on this instance. Anything else is refused so a link stored in release data can never make the server send the token elsewhere.
	streamAbsolute(url: string): Promise<ArchiveResponse>;
}

function queryString(query?: Query): string {
	if (!query) return "";
	const params = new URLSearchParams();
	for (const [k, v] of Object.entries(query)) {
		if (v !== undefined) params.set(k, String(v));
	}
	const s = params.toString();
	return s ? `?${s}` : "";
}

export function createApiClient(
	ctx: ForgeContext,
	authHeaders: (token: string) => Record<string, string>,
): ApiClient {
	const host = normalizeSafeOrigin(ctx.host);
	const doFetch: ForgeFetch =
		ctx.fetch ??
		((url, init, options) =>
			safeFetchFollowRedirects(url, init, {
				expectedOrigin: host,
				allowCrossOriginRedirect: options?.allowCrossOriginRedirect,
			}));

	const send = (url: string, accept: string) =>
		doFetch(
			url,
			{ headers: { Accept: accept, ...authHeaders(ctx.token) } },
			// A release asset may legitimately live on a CDN. The guarded fetch re-validates that hop and strips the credential before following it.
			{ allowCrossOriginRedirect: true },
		);

	async function okOrThrow(res: Response): Promise<Response> {
		if (res.ok) return res;
		await res.body?.cancel().catch(() => {});
		throw new ForgeHttpError(res.status);
	}

	const client: ApiClient = {
		host,
		async json<T>(path: string, query?: Query) {
			const res = await okOrThrow(
				await send(`${host}${path}${queryString(query)}`, "application/json"),
			);
			try {
				return { data: await readJson<T>(res), headers: res.headers };
			} catch (error) {
				if (error instanceof SyntaxError) {
					throw new ForgeHttpError(502, "Invalid JSON from forge");
				}
				throw error;
			}
		},
		request: (path, query) =>
			send(`${host}${path}${queryString(query)}`, "*/*"),
		async stream(path, query) {
			const res = await okOrThrow(await client.request(path, query));
			return { kind: "stream", response: res };
		},
		async streamAbsolute(url) {
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				throw new ForgeHttpError(404);
			}
			if (parsed.origin !== host) throw new ForgeHttpError(404);
			const res = await okOrThrow(await send(parsed.toString(), "*/*"));
			return { kind: "stream", response: res };
		},
	};
	return client;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is being rejected
const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/;

// A name that lands in a URL path position. "." and ".." matter most: encodeURIComponent leaves dots alone and URL parsing then collapses them, so an owner called ".." would turn /repos/{owner}/x into a path outside the API prefix and reach an endpoint the caller never named.
export function assertSafeSegment(value: string): string {
	if (
		!value ||
		value === "." ||
		value === ".." ||
		value.includes("/") ||
		UNSAFE_CHARS.test(value)
	) {
		throw new ForgeHttpError(400, "Invalid name");
	}
	return value;
}

// Branch and tag names may contain slashes but never empty or dot segments. Checked even where the ref only travels in a query string, so the rule does not depend on which forge puts it where.
export function assertSafeRef(ref: string): string {
	if (
		!ref ||
		UNSAFE_CHARS.test(ref) ||
		ref.split("/").some((s) => s === "" || s === "." || s === "..")
	) {
		throw new ForgeHttpError(400, "Invalid ref");
	}
	return ref;
}

export function encodeSegments(value: string): string {
	return value.split("/").map(encodeURIComponent).join("/");
}

// GitLab addresses a project by its full path, URL-encoded as a single segment, subgroups included: group/sub/project -> group%2Fsub%2Fproject.
export function gitlabProjectId(owner: string, repo: string): string {
	const parts = [...owner.split("/"), repo];
	for (const p of parts) assertSafeSegment(p);
	return encodeURIComponent(parts.join("/"));
}

// Gitea and Gitee owners are a single account or organisation name.
export function ownerRepoPath(owner: string, repo: string): string {
	return `${encodeURIComponent(assertSafeSegment(owner))}/${encodeURIComponent(assertSafeSegment(repo))}`;
}

export function sortEntries(entries: DirEntry[]): DirEntry[] {
	return [...entries].sort((a, b) =>
		a.type === b.type
			? a.name.localeCompare(b.name)
			: a.type === "dir"
				? -1
				: 1,
	);
}

export function fileFromBase64(
	name: string,
	content: string,
	size: number,
): Contents {
	const buf = Buffer.from(content, "base64");
	const isBinary = buf.includes(0);
	return {
		kind: "file",
		name,
		text: isBinary ? null : buf.toString("utf8"),
		isBinary,
		size,
	};
}

export function hasNextPage(headers: Headers): boolean {
	const next = headers.get("x-next-page");
	if (next?.trim()) return true;
	return /rel="?next"?/i.test(headers.get("link") ?? "");
}

// Bounded on purpose: a listing is a convenience, and an unbounded loop against an instance we do not control is a way to be held open or to pull far more than a dashboard needs.
export async function collectPages<T>(
	fetchPage: (page: number) => Promise<{ items: T[]; hasNext: boolean }>,
	maxPages: number,
): Promise<T[]> {
	const out: T[] = [];
	for (let page = 1; page <= maxPages; page++) {
		const { items, hasNext } = await fetchPage(page);
		out.push(...items);
		if (!hasNext) break;
	}
	return out;
}

export function isNotFound(error: unknown): boolean {
	return error instanceof ForgeHttpError && error.status === 404;
}

export function isHttpsUrl(url: string): boolean {
	try {
		return new URL(url).protocol === "https:";
	} catch {
		return false;
	}
}
