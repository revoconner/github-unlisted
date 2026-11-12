import type { ForgeFetch } from "./api";

// Test helper: a scripted stand-in for the SSRF-guarded fetch, so adapter tests assert on the exact URLs and credentials an adapter produces without any network.
export interface RecordedCall {
	url: string;
	headers: Record<string, string>;
	allowCrossOrigin: boolean;
}

export function fakeForge(
	handler: (url: URL, call: RecordedCall) => Response | undefined,
) {
	const calls: RecordedCall[] = [];
	const fetch: ForgeFetch = async (raw, init, options) => {
		const call: RecordedCall = {
			url: raw,
			headers: Object.fromEntries(new Headers(init.headers).entries()),
			allowCrossOrigin: options?.allowCrossOriginRedirect === true,
		};
		calls.push(call);
		return (
			handler(new URL(raw), call) ?? new Response("unrouted", { status: 599 })
		);
	};
	return { fetch, calls };
}

export const json = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
		...init,
	});

export const status = (code: number) => new Response("{}", { status: code });

export const b64 = (text: string | Buffer) =>
	Buffer.from(text).toString("base64");
