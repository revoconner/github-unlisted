import dns from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

// SSRF guard for self-hosted forges. The user supplies a hostname and the server then calls it with a stored token, so every outbound request must be proven to land on a public address, and the token must never follow a redirect off the instance. See the OWASP SSRF Prevention Cheat Sheet (allow-list the scheme and port, validate the resolved IP rather than the name, do not follow redirects blindly).
//
// Known limit, by design: instances reachable only through a VPN or a private network are unreachable from the hosted service. This module refuses them rather than offering an opt-out, because an opt-out is exactly the switch an attacker would flip.

const HEADERS_TIMEOUT_MS = 8_000;
const IDLE_TIMEOUT_MS = 8_000;
const JSON_TOTAL_TIMEOUT_MS = 12_000;
const JSON_LIMIT_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

// net.BlockList does the prefix arithmetic and, unlike a hand-written IPv6 parser, also maps ::ffff:a.b.c.d onto the IPv4 rules, so "::ffff:127.0.0.1" cannot slip past the loopback entry. Ranges follow the IANA special-purpose registries.
const BLOCKED = new net.BlockList();
const BLOCKED_V4: [string, number][] = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10], // CGNAT, often fronts provider-internal services
	["127.0.0.0", 8],
	["169.254.0.0", 16], // link-local, includes the 169.254.169.254 metadata service
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4], // multicast
	["240.0.0.0", 4], // reserved, includes the broadcast address
];
// NAT64 (64:ff9b::/96, 64:ff9b:1::/48), 6to4 (2002::/16) and Teredo (2001::/32) embed an IPv4 address that a gateway may translate to an internal host, so the whole prefixes are refused instead of unpacking them.
const BLOCKED_V6: [string, number][] = [
	["::", 96], // unspecified, loopback and deprecated IPv4-compatible
	["64:ff9b::", 96],
	["64:ff9b:1::", 48],
	["100::", 64],
	["2001::", 32],
	["2001:db8::", 32],
	["2002::", 16],
	["fc00::", 7], // unique local
	["fe80::", 10], // link-local
	["fec0::", 10], // deprecated site-local
	["ff00::", 8], // multicast
];
for (const [net4, prefix] of BLOCKED_V4)
	BLOCKED.addSubnet(net4, prefix, "ipv4");
for (const [net6, prefix] of BLOCKED_V6)
	BLOCKED.addSubnet(net6, prefix, "ipv6");

// Anything that is not a parseable IP is treated as unsafe: failing closed is the only safe answer for an input we cannot classify.
export function isUnsafeIp(value: string): boolean {
	const ip = value.split("%")[0]; // drop an IPv6 zone id
	const family = net.isIP(ip);
	if (family === 0) return true;
	return BLOCKED.check(ip, family === 4 ? "ipv4" : "ipv6");
}

// The port is part of the URL the user types in the web form, so no deployment setting is needed. 443 plus the unprivileged range is allowed; ports below 1024 other than 443 are refused, since those are where system services (ssh, smtp, databases) listen. This is safe because the request must complete a TLS handshake with a certificate valid for the typed hostname, and private addresses are blocked regardless of port: the server can only ever talk to a TLS service that the host's own owner presents.
function isAllowedPort(port: string): boolean {
	const n = Number(port);
	return Number.isInteger(n) && (n === 443 || (n >= 1024 && n <= 65535));
}

function portOf(url: URL): string {
	return url.port || "443";
}

// Validates a user-typed instance URL and returns the origin to store. Only the origin is persisted: a path, query or fragment would let a stored value smuggle a different endpoint into later requests. A non-root path is rejected rather than stripped, because a forge installed under a sub-path would otherwise fail later with a confusing 404 instead of a clear message now.
export function normalizeSafeOrigin(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		throw new Error("Invalid instance URL");
	}
	if (url.username || url.password) {
		throw new Error("Instance URL cannot contain credentials");
	}
	if (url.search || url.hash) {
		throw new Error("Instance URL cannot contain query or fragment");
	}
	if (url.pathname !== "/") {
		throw new Error("Instance URL must be the site root, without a path");
	}
	if (!isAllowedPort(portOf(url))) {
		throw new Error("Port must be 443 or between 1024 and 65535");
	}
	return url.origin;
}

export interface SafeDestination {
	url: URL;
	address: string;
	family: 4 | 6;
}

// Resolves the hostname NOW and returns the address the connection will be pinned to. Called on every request and every redirect hop: a check done once at connect time is defeated by DNS rebinding, where the name answers with a public IP when validated and a private one when used. If ANY returned address is unsafe the host is refused outright; a legitimate public host never mixes in private records, and a mixed answer is how rebinding is usually staged.
export async function resolveSafeDestination(
	raw: string,
	expectedOrigin?: string,
): Promise<SafeDestination> {
	const url = new URL(raw);
	if (url.protocol !== "https:" || url.username || url.password || url.hash) {
		throw new Error("Unsafe remote URL");
	}
	if (!isAllowedPort(portOf(url))) throw new Error("Unsafe remote port");
	if (expectedOrigin && url.origin !== expectedOrigin) {
		throw new Error("Remote URL changed origin");
	}
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const addresses = await dns.lookup(host, { all: true, verbatim: true });
	if (addresses.length === 0) throw new Error("Remote host did not resolve");
	if (addresses.some((a) => isUnsafeIp(a.address))) {
		throw new Error("Remote host resolves to a blocked address");
	}
	const first = addresses[0];
	return { url, address: first.address, family: first.family === 6 ? 6 : 4 };
}

// Node's net layer calls a custom lookup with {all: true} when autoSelectFamily is on (the default since Node 20) and then expects an ARRAY. Answering with the single-address form makes every request fail with ERR_INVALID_IP_ADDRESS, so both shapes are served. Exported so a test can pin that contract.
export function pinnedLookup(address: string, family: 4 | 6) {
	return (
		_hostname: string,
		options: { all?: boolean },
		callback: (
			error: Error | null,
			address: string | { address: string; family: number }[],
			family?: number,
		) => void,
	): void => {
		if (options?.all) callback(null, [{ address, family }]);
		else callback(null, address, family);
	};
}

export interface SafeFetchOptions {
	// Origin the first hop must match. Used for API calls to the connected instance.
	expectedOrigin?: string;
}

// GET/HEAD only, so there is no request body to leak and no method-rewriting rules to get wrong on redirects. TLS verification stays on, SNI and the Host header carry the original name, and the socket is pinned to the validated address so the name is never resolved a second time by the HTTP stack. agent:false avoids a keep-alive pool whose reuse key is the hostname, not the pinned address.
export async function safeFetch(
	raw: string,
	init: RequestInit = {},
	options: SafeFetchOptions = {},
): Promise<Response> {
	const method = (init.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") {
		throw new Error("safeFetch only supports GET and HEAD");
	}
	if (init.body) throw new Error("safeFetch does not send request bodies");

	const { url, address, family } = await resolveSafeDestination(
		raw,
		options.expectedOrigin,
	);
	const headers = new Headers(init.headers);
	if (!headers.has("user-agent")) headers.set("user-agent", "github-unlisted");
	// Compressed bodies would reach the JSON reader undecoded.
	headers.set("accept-encoding", "identity");

	return await new Promise<Response>((resolve, reject) => {
		const request = https.request(
			{
				protocol: "https:",
				hostname: url.hostname.replace(/^\[|\]$/g, ""),
				port: Number(portOf(url)),
				path: `${url.pathname}${url.search}`,
				method,
				headers: Object.fromEntries(headers.entries()),
				agent: false,
				lookup: pinnedLookup(address, family),
				rejectUnauthorized: true,
			},
			(response: IncomingMessage) => {
				clearTimeout(headersTimer);
				const responseHeaders = new Headers();
				for (const [name, value] of Object.entries(response.headers)) {
					if (typeof value === "string") responseHeaders.set(name, value);
					else if (Array.isArray(value)) {
						responseHeaders.set(name, value.join(", "));
					}
				}
				const status = response.statusCode ?? 502;
				// A Response with a body is a TypeError for these statuses.
				const bodyless = NULL_BODY_STATUSES.has(status) || method === "HEAD";
				if (bodyless) response.resume();
				resolve(
					new Response(
						bodyless
							? null
							: (Readable.toWeb(response) as unknown as ReadableStream),
						{
							status,
							statusText: response.statusMessage,
							headers: responseHeaders,
						},
					),
				);
			},
		);
		// The idle timeout covers connect and stalls; the headers timer bounds the whole wait for a response so a host that trickles bytes cannot pin a function open.
		const headersTimer = setTimeout(
			() => request.destroy(new Error("Remote request timed out")),
			HEADERS_TIMEOUT_MS,
		);
		request.setTimeout(IDLE_TIMEOUT_MS, () =>
			request.destroy(new Error("Remote request timed out")),
		);
		const onAbort = () => request.destroy(new Error("Request aborted"));
		init.signal?.addEventListener("abort", onAbort, { once: true });
		request.once("close", () => {
			clearTimeout(headersTimer);
			init.signal?.removeEventListener("abort", onAbort);
		});
		request.once("error", reject);
		request.end();
	});
}


export async function safePostForm(
	raw: string,
	form: Record<string, string>,
	options: SafeFetchOptions = {},
): Promise<Response> {
	const body = new URLSearchParams(form).toString();
	if (body.length > 32_000) throw new Error("Request body is too large");
	const { url, address, family } = await resolveSafeDestination(
		raw,
		options.expectedOrigin,
	);
	const headers = new Headers({
		Accept: "application/json",
		"Content-Type": "application/x-www-form-urlencoded",
		"Content-Length": String(Buffer.byteLength(body)),
		"User-Agent": "github-unlisted",
		"Accept-Encoding": "identity",
	});

	return await new Promise<Response>((resolve, reject) => {
		const request = https.request(
			{
				protocol: "https:",
				hostname: url.hostname.replace(/^\[|\]$/g, ""),
				port: Number(portOf(url)),
				path: `${url.pathname}${url.search}`,
				method: "POST",
				headers: Object.fromEntries(headers.entries()),
				agent: false,
				lookup: pinnedLookup(address, family),
				rejectUnauthorized: true,
			},
			(response: IncomingMessage) => {
				clearTimeout(headersTimer);
				const responseHeaders = new Headers();
				for (const [name, value] of Object.entries(response.headers)) {
					if (typeof value === "string") responseHeaders.set(name, value);
					else if (Array.isArray(value)) responseHeaders.set(name, value.join(", "));
				}
				const status = response.statusCode ?? 502;
				const bodyless = NULL_BODY_STATUSES.has(status);
				if (bodyless) response.resume();
				resolve(
					new Response(
						bodyless
							? null
							: (Readable.toWeb(response) as unknown as ReadableStream),
						{ status, statusText: response.statusMessage, headers: responseHeaders },
					),
				);
			},
		);
		const headersTimer = setTimeout(
			() => request.destroy(new Error("Remote request timed out")),
			HEADERS_TIMEOUT_MS,
		);
		request.setTimeout(IDLE_TIMEOUT_MS, () =>
			request.destroy(new Error("Remote request timed out")),
		);
		request.once("close", () => clearTimeout(headersTimer));
		request.once("error", reject);
		request.write(body);
		request.end();
	});
}

export interface FollowOptions extends SafeFetchOptions {
	// Release assets on GitLab/Gitee are links that may point at another host. When true the redirect is followed (and re-validated) but the Authorization header is dropped for it. When false (the default) any cross-origin redirect is an error, which is what API calls want.
	allowCrossOriginRedirect?: boolean;
}

// Redirects are followed manually so each destination is re-validated (scheme, port, DNS, address) exactly like the first request. Letting the HTTP stack follow them would hand an attacker-controlled Location header the same trust as the user-entered host.
export async function safeFetchFollowRedirects(
	raw: string,
	init: RequestInit = {},
	options: FollowOptions = {},
): Promise<Response> {
	const startOrigin = new URL(raw).origin;
	let current = raw;
	let currentInit = init;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const response = await safeFetch(current, currentInit, {
			expectedOrigin: hop === 0 ? options.expectedOrigin : undefined,
		});
		if (response.status < 300 || response.status >= 400) return response;
		const location = response.headers.get("location");
		if (!location) return response;
		// Drain nothing: the body of a redirect is discarded unread.
		await response.body?.cancel().catch(() => {});

		const next = new URL(location, current);
		if (next.origin !== startOrigin) {
			if (!options.allowCrossOriginRedirect) {
				throw new Error("Remote redirected to another origin");
			}
			const headers = new Headers(currentInit.headers);
			headers.delete("authorization");
			headers.delete("private-token");
			currentInit = { ...currentInit, headers };
		}
		current = next.toString();
	}
	throw new Error("Too many redirects");
}

// Bounded JSON read: a hostile or broken instance must not be able to exhaust memory or hold the function open. The stream is cancelled on every exit so the socket is released instead of waiting for the idle timeout.
export async function readJson<T>(response: Response): Promise<T> {
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw Object.assign(
			new Error(`Remote request failed: ${response.status}`),
			{ status: response.status },
		);
	}
	if (!response.body) throw new Error("Remote response has no body");
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > JSON_LIMIT_BYTES) {
		await response.body.cancel().catch(() => {});
		throw new Error("Remote JSON response is too large");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	const deadline = Date.now() + JSON_TOTAL_TIMEOUT_MS;
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > JSON_LIMIT_BYTES) {
				throw new Error("Remote JSON response is too large");
			}
			if (Date.now() > deadline) throw new Error("Remote response too slow");
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel().catch(() => {});
		throw error;
	}
	return JSON.parse(
		new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c)))),
	) as T;
}
