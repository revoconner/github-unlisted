import { NextResponse } from "next/server";
import { safeFetchFollowRedirects } from "@/lib/forge/safe-url";
import { inspectImage, MAX_IMAGE_BYTES } from "@/lib/portfolio-image";
import {
	getPortfolio,
	getPortfolioImage,
	removePortfolioImage,
	setPortfolioImage,
} from "@/lib/portfolio-store";
import { getSession, sessionOwnsTarget } from "@/lib/session";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 8000;
// base64 inflates by 4/3; the slack covers padding.
const MAX_BASE64_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8;

function bad(error: string, status = 400) {
	return NextResponse.json({ error }, { status });
}

// Reads at most MAX_IMAGE_BYTES and cancels the stream otherwise, so a hostile
// server cannot make this function buffer without bound or hold a socket open.
async function readCapped(res: Response): Promise<Uint8Array | null> {
	const declared = Number(res.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
		await res.body?.cancel().catch(() => {});
		return null;
	}
	const reader = res.body?.getReader();
	if (!reader) return null;
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > MAX_IMAGE_BYTES) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return out;
}

// The server fetches the URL ONCE, here, and keeps the bytes. The page never
// points visitors' browsers at an address the owner chose: that would hand the
// owner every visitor's IP address and a view counter.
async function importFromUrl(raw: string): Promise<Uint8Array | string> {
	if (raw.length > 2048) return "That URL is too long";
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return "That is not a valid URL";
	}
	if (url.protocol !== "https:") {
		return "The image URL must start with https://";
	}
	if (url.username || url.password) {
		return "The URL cannot contain credentials";
	}

	try {
		const res = await Promise.race([
			safeFetchFollowRedirects(
				url.toString(),
				{ headers: { Accept: "image/png,image/jpeg,image/webp" } },
				// Avatars commonly redirect to a CDN host (github.com/<user>.png does).
				// Every hop is still resolved and checked against private addresses.
				{ allowCrossOriginRedirect: true },
			),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("timeout")), FETCH_TIMEOUT_MS),
			),
		]);
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			return "That URL did not return an image";
		}
		const bytes = await readCapped(res);
		return (
			bytes ??
			`The image is larger than ${Math.round(MAX_IMAGE_BYTES / 1000)} KB`
		);
	} catch {
		// No detail on purpose: the reason (blocked address, DNS, TLS) would let
		// a signed-in user probe the network this server sits in.
		return "Could not download that URL";
	}
}

export async function POST(request: Request) {
	const session = await getSession();
	if (!session) return bad("Not signed in", 401);

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return bad("Invalid JSON");
	}
	const id = typeof body.id === "string" ? body.id : "";
	if (!id) return bad("Missing id");

	const portfolio = await getPortfolio(id);
	if (!portfolio) return bad("Not found", 404);
	if (!sessionOwnsTarget(session, portfolio)) return bad("Forbidden", 403);

	let bytes: Uint8Array;
	if (typeof body.url === "string") {
		const got = await importFromUrl(body.url);
		if (typeof got === "string") return bad(got);
		bytes = got;
	} else if (typeof body.data === "string") {
		if (body.data.length > MAX_BASE64_LENGTH) {
			return bad("The image is too large");
		}
		if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) {
			return bad("Invalid image data");
		}
		bytes = new Uint8Array(Buffer.from(body.data, "base64"));
	} else {
		return bad("Send either url or data");
	}

	// Type and size come from the bytes themselves, never from a header or name.
	const checked = inspectImage(bytes);
	if ("error" in checked) return bad(checked.error);

	const version = await setPortfolioImage(id, {
		type: checked.image.type,
		data: Buffer.from(bytes).toString("base64"),
	});
	if (version === null) return bad("Not found", 404);
	return NextResponse.json({ ok: true, version });
}

export async function DELETE(request: Request) {
	const session = await getSession();
	if (!session) return bad("Not signed in", 401);
	const id = new URL(request.url).searchParams.get("id") ?? "";
	if (!id) return bad("Missing id");

	const portfolio = await getPortfolio(id);
	if (!portfolio) return NextResponse.json({ ok: true });
	if (!sessionOwnsTarget(session, portfolio)) return bad("Forbidden", 403);

	await removePortfolioImage(id);
	return NextResponse.json({ ok: true });
}

// Public: an <img> cannot carry a BotID token, and this serves only the
// owner-chosen picture, never repository content. The bytes were validated as
// PNG/JPEG/WebP when stored; these headers make sure a browser treats them that
// way too (no sniffing, and no script even if the URL is opened directly).
export async function GET(request: Request) {
	const id = new URL(request.url).searchParams.get("p") ?? "";
	if (!id || id.length > 64) return bad("Not found", 404);

	const [portfolio, image] = await Promise.all([
		getPortfolio(id),
		getPortfolioImage(id),
	]);
	if (!portfolio || !image) return bad("Not found", 404);

	return new NextResponse(Buffer.from(image.data, "base64"), {
		headers: {
			"Content-Type": image.type,
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": "default-src 'none'; sandbox",
			"Cache-Control": "public, max-age=3600",
		},
	});
}
