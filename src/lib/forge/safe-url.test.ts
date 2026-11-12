// @vitest-environment node
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	lookup: vi.fn(),
	script: vi.fn(),
	requests: [] as Record<string, unknown>[],
}));

vi.mock("node:dns/promises", () => ({ default: { lookup: mocks.lookup } }));

// A fake https.request: records the options it was given and answers from mocks.script, so redirect handling and pinning can be tested without a network.
vi.mock("node:https", () => ({
	default: {
		request: (
			options: Record<string, unknown>,
			callback: (res: unknown) => void,
		) => {
			mocks.requests.push(options);
			const req = new EventEmitter() as EventEmitter & Record<string, unknown>;
			req.setTimeout = () => req;
			req.destroy = (error?: Error) => {
				if (error) req.emit("error", error);
				req.emit("close");
			};
			req.end = () => {
				const r = mocks.script(options) as {
					status: number;
					headers?: Record<string, string>;
					body?: string;
				};
				const res = Readable.from([Buffer.from(r.body ?? "")]) as Readable &
					Record<string, unknown>;
				res.statusCode = r.status;
				res.statusMessage = "msg";
				res.headers = r.headers ?? {};
				queueMicrotask(() => callback(res));
			};
			return req;
		},
	},
}));

import {
	isUnsafeIp,
	normalizeSafeOrigin,
	pinnedLookup,
	readJson,
	resolveSafeDestination,
	safeFetch,
	safeFetchFollowRedirects,
} from "./safe-url";

const PUBLIC = [{ address: "93.184.216.34", family: 4 }];

beforeEach(() => {
	mocks.lookup.mockReset();
	mocks.script.mockReset();
	mocks.requests.length = 0;
	mocks.lookup.mockResolvedValue(PUBLIC);
});

describe("isUnsafeIp", () => {
	it.each([
		"0.0.0.0",
		"127.0.0.1",
		"127.255.255.254",
		"10.0.0.1",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"100.127.255.255",
		"198.18.0.1",
		"192.0.2.1",
		"198.51.100.7",
		"203.0.113.9",
		"224.0.0.1",
		"255.255.255.255",
		"::",
		"::1",
		"fc00::1",
		"fd12:3456::1",
		"fe80::1",
		"fe80::1%eth0",
		"ff02::1",
		"::ffff:127.0.0.1",
		"::ffff:7f00:1",
		"::ffff:10.0.0.1",
		"::ffff:169.254.169.254",
		"64:ff9b::7f00:1",
		"2002:7f00:1::1",
		"2001:db8::1",
		"not-an-ip",
		"",
		"1.2.3",
		"999.1.1.1",
	])("blocks %s", (ip) => {
		expect(isUnsafeIp(ip)).toBe(true);
	});

	it.each([
		"93.184.216.34",
		"8.8.8.8",
		"1.1.1.1",
		"172.15.255.255",
		"172.32.0.1",
		"100.63.255.255",
		"100.128.0.1",
		"198.17.255.255",
		"198.20.0.1",
		"2606:4700:4700::1111",
		"2a00:1450:4001::200e",
		"::ffff:8.8.8.8",
	])("allows %s", (ip) => {
		expect(isUnsafeIp(ip)).toBe(false);
	});
});

describe("normalizeSafeOrigin", () => {
	it("returns only the origin, lower-cased", () => {
		expect(normalizeSafeOrigin(" https://GitLab.Example.com/ ")).toBe(
			"https://gitlab.example.com",
		);
	});

	it.each([
		["http://example.com", "HTTPS"],
		["ftp://example.com", "HTTPS"],
		["https://user:pw@example.com", "credentials"],
		["https://user@example.com", "credentials"],
		["https://example.com/?a=1", "query"],
		["https://example.com/#x", "query"],
		["https://example.com/gitlab", "without a path"],
		["https://example.com:80", "Port must be"],
		["https://example.com:22", "Port must be"],
		["https://example.com:1023", "Port must be"],
		["nonsense", "Invalid"],
		["", "Invalid"],
	])("rejects %s", (raw, message) => {
		expect(() => normalizeSafeOrigin(raw)).toThrow(message);
	});

	it("accepts an explicit :443 and normalizes it away", () => {
		expect(normalizeSafeOrigin("https://example.com:443")).toBe(
			"https://example.com",
		);
	});

	it("accepts a port from the unprivileged range typed in the URL, with no configuration", () => {
		expect(normalizeSafeOrigin("https://example.com:8443")).toBe(
			"https://example.com:8443",
		);
		expect(normalizeSafeOrigin("https://example.com:1024")).toBe(
			"https://example.com:1024",
		);
		expect(normalizeSafeOrigin("https://example.com:65535")).toBe(
			"https://example.com:65535",
		);
		expect(() => normalizeSafeOrigin("https://example.com:65536")).toThrow();
	});

	it("canonicalizes numeric hosts so they reach the IP check as dotted quads", () => {
		expect(normalizeSafeOrigin("https://2130706433")).toBe("https://127.0.0.1");
	});
});

describe("resolveSafeDestination", () => {
	it("returns the address the socket must be pinned to", async () => {
		const d = await resolveSafeDestination("https://example.com/x");
		expect(d.address).toBe("93.184.216.34");
		expect(d.family).toBe(4);
	});

	it("refuses a host that resolves to a private address", async () => {
		mocks.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
		await expect(
			resolveSafeDestination("https://internal.test"),
		).rejects.toThrow("blocked address");
	});

	it("refuses the metadata address", async () => {
		mocks.lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
		await expect(resolveSafeDestination("https://meta.test")).rejects.toThrow(
			"blocked address",
		);
	});

	it("refuses a host with a mix of public and private records (rebinding setup)", async () => {
		mocks.lookup.mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "127.0.0.1", family: 4 },
		]);
		await expect(resolveSafeDestination("https://mixed.test")).rejects.toThrow(
			"blocked address",
		);
	});

	it("refuses an IPv6 loopback and an IPv4-mapped one", async () => {
		for (const address of ["::1", "::ffff:127.0.0.1"]) {
			mocks.lookup.mockResolvedValue([{ address, family: 6 }]);
			await expect(resolveSafeDestination("https://v6.test")).rejects.toThrow();
		}
	});

	it("refuses IP-literal URLs that are private without needing DNS to lie", async () => {
		mocks.lookup.mockResolvedValue([{ address: "192.168.0.10", family: 4 }]);
		await expect(
			resolveSafeDestination("https://192.168.0.10/"),
		).rejects.toThrow();
	});

	it("refuses http, credentials, fragments and odd ports", async () => {
		await expect(
			resolveSafeDestination("http://example.com"),
		).rejects.toThrow();
		await expect(
			resolveSafeDestination("https://a:b@example.com"),
		).rejects.toThrow();
		await expect(
			resolveSafeDestination("https://example.com/#f"),
		).rejects.toThrow();
		await expect(
			resolveSafeDestination("https://example.com:25"),
		).rejects.toThrow("port");
	});

	it("refuses an origin different from the expected one", async () => {
		await expect(
			resolveSafeDestination("https://other.test/x", "https://example.com"),
		).rejects.toThrow("changed origin");
	});

	it("resolves on every call instead of caching", async () => {
		await resolveSafeDestination("https://example.com");
		await resolveSafeDestination("https://example.com");
		expect(mocks.lookup).toHaveBeenCalledTimes(2);
	});
});

describe("pinnedLookup", () => {
	// Regression: Node calls lookup with {all:true} under autoSelectFamily and rejects the single-address answer with ERR_INVALID_IP_ADDRESS.
	it("answers with an array when all:true is requested", () => {
		const cb = vi.fn();
		pinnedLookup("93.184.216.34", 4)("example.com", { all: true }, cb);
		expect(cb).toHaveBeenCalledWith(null, [
			{ address: "93.184.216.34", family: 4 },
		]);
	});

	it("answers with address and family otherwise", () => {
		const cb = vi.fn();
		pinnedLookup("2606:4700::1", 6)("example.com", {}, cb);
		expect(cb).toHaveBeenCalledWith(null, "2606:4700::1", 6);
	});
});

describe("safeFetch", () => {
	it("pins the socket to the validated address and keeps the hostname for TLS", async () => {
		mocks.script.mockReturnValue({ status: 200, body: "{}" });
		await safeFetch("https://example.com/api?x=1");
		const options = mocks.requests[0];
		expect(options.hostname).toBe("example.com");
		expect(options.path).toBe("/api?x=1");
		expect(options.rejectUnauthorized).toBe(true);
		expect(options.agent).toBe(false);
		const cb = vi.fn();
		(options.lookup as ReturnType<typeof pinnedLookup>)(
			"example.com",
			{ all: true },
			cb,
		);
		expect(cb).toHaveBeenCalledWith(null, [
			{ address: "93.184.216.34", family: 4 },
		]);
	});

	it("rejects methods that could carry a body", async () => {
		await expect(
			safeFetch("https://example.com", { method: "POST" }),
		).rejects.toThrow("GET and HEAD");
		await expect(
			safeFetch("https://example.com", { body: "x" }),
		).rejects.toThrow();
	});

	it("builds a valid Response for body-less statuses", async () => {
		mocks.script.mockReturnValue({ status: 204 });
		const res = await safeFetch("https://example.com");
		expect(res.status).toBe(204);
		expect(res.body).toBeNull();
	});

	it("refuses to connect at all when DNS answers privately", async () => {
		mocks.lookup.mockResolvedValue([{ address: "10.1.1.1", family: 4 }]);
		await expect(safeFetch("https://example.com")).rejects.toThrow();
		expect(mocks.requests).toHaveLength(0);
	});
});

describe("safeFetchFollowRedirects", () => {
	it("re-resolves DNS for every hop and blocks a redirect into a private host", async () => {
		mocks.lookup.mockImplementation(async (host: string) =>
			host === "internal.test" ? [{ address: "10.0.0.7", family: 4 }] : PUBLIC,
		);
		mocks.script.mockReturnValue({
			status: 302,
			headers: { location: "https://internal.test/secret" },
		});
		await expect(
			safeFetchFollowRedirects(
				"https://example.com/a",
				{},
				{
					allowCrossOriginRedirect: true,
				},
			),
		).rejects.toThrow("blocked address");
		expect(mocks.requests).toHaveLength(1);
	});

	it("blocks a redirect to plain http or to a metadata IP literal", async () => {
		for (const location of [
			"http://example.com/x",
			"https://169.254.169.254/latest/meta-data",
		]) {
			mocks.script.mockReturnValueOnce({ status: 302, headers: { location } });
			await expect(
				safeFetchFollowRedirects(
					"https://example.com/a",
					{},
					{
						allowCrossOriginRedirect: true,
					},
				),
			).rejects.toThrow();
		}
	});

	it("refuses cross-origin redirects by default, so an API call never leaves the instance", async () => {
		mocks.script.mockReturnValue({
			status: 302,
			headers: { location: "https://elsewhere.test/x" },
		});
		await expect(
			safeFetchFollowRedirects("https://example.com/a", {
				headers: { authorization: "Bearer t" },
			}),
		).rejects.toThrow("another origin");
		expect(mocks.requests).toHaveLength(1);
	});

	it("drops the Authorization header once a redirect leaves the origin", async () => {
		mocks.script
			.mockReturnValueOnce({
				status: 302,
				headers: { location: "https://cdn.test/file" },
			})
			.mockReturnValueOnce({ status: 200, body: "ok" });
		const res = await safeFetchFollowRedirects(
			"https://example.com/a",
			{ headers: { authorization: "Bearer t", "private-token": "t" } },
			{ allowCrossOriginRedirect: true },
		);
		expect(res.status).toBe(200);
		const first = mocks.requests[0].headers as Record<string, string>;
		const second = mocks.requests[1].headers as Record<string, string>;
		expect(first.authorization).toBe("Bearer t");
		expect(second.authorization).toBeUndefined();
		expect(second["private-token"]).toBeUndefined();
	});

	it("keeps the token on a same-origin redirect", async () => {
		mocks.script
			.mockReturnValueOnce({
				status: 301,
				headers: { location: "/api/v2/x" },
			})
			.mockReturnValueOnce({ status: 200, body: "ok" });
		await safeFetchFollowRedirects("https://example.com/api/x", {
			headers: { authorization: "Bearer t" },
		});
		const second = mocks.requests[1].headers as Record<string, string>;
		expect(second.authorization).toBe("Bearer t");
		expect(mocks.requests[1].path).toBe("/api/v2/x");
	});

	it("gives up after the redirect limit", async () => {
		mocks.script.mockReturnValue({
			status: 302,
			headers: { location: "/loop" },
		});
		await expect(
			safeFetchFollowRedirects("https://example.com/loop"),
		).rejects.toThrow("Too many redirects");
	});
});

describe("readJson", () => {
	const json = (body: string, init: ResponseInit = {}) =>
		new Response(body, { status: 200, ...init });

	it("parses a small body", async () => {
		expect(await readJson<{ a: number }>(json('{"a":1}'))).toEqual({ a: 1 });
	});

	it("throws with the status for a non-2xx answer", async () => {
		await expect(readJson(json("{}", { status: 404 }))).rejects.toMatchObject({
			status: 404,
		});
	});

	it("refuses a body over the size cap, declared or streamed", async () => {
		const big = `"${"x".repeat(2 * 1024 * 1024 + 10)}"`;
		await expect(readJson(json(big))).rejects.toThrow("too large");
		await expect(
			readJson(json("{}", { headers: { "content-length": "99999999" } })),
		).rejects.toThrow("too large");
	});

	it("rejects invalid JSON", async () => {
		await expect(readJson(json("<html>"))).rejects.toThrow();
	});
});
