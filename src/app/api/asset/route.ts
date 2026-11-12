import { NextResponse } from "next/server";
import { adapterForTarget } from "@/lib/forge/target";
import { ForgeHttpError } from "@/lib/forge/types";
import { isSafeRepoPath } from "@/lib/repo-path";
import { resolveShare } from "@/lib/share-store";

export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
	".bmp": "image/bmp",
	".ico": "image/x-icon",
};

// Images in a README are small. Anything bigger is refused rather than relayed, so a repository cannot turn this route into a bandwidth pipe.
const MAX_ASSET_BYTES = 15 * 1024 * 1024;

function getImageContentType(path: string): string | null {
	const lower = path.toLowerCase();
	const dot = lower.lastIndexOf(".");

	if (dot === -1) return null;

	return MIME_TYPES[lower.slice(dot)] ?? null;
}

export async function GET(request: Request) {
	const searchParams = new URL(request.url).searchParams;

	const shareId = searchParams.get("s") ?? "";
	const ref = searchParams.get("ref") ?? "";
	const path = searchParams.get("path") ?? "";

	if (!shareId || !ref || !isSafeRepoPath(path)) {
		return NextResponse.json(
			{ error: "Invalid asset request" },
			{ status: 400 },
		);
	}

	const contentType = getImageContentType(path);

	if (!contentType) {
		return NextResponse.json(
			{ error: "Unsupported asset type" },
			{ status: 415 },
		);
	}

	const target = await resolveShare(shareId);

	if (!target) {
		return NextResponse.json(
			{ error: "Link invalid or expired" },
			{ status: 404 },
		);
	}

	// A locked share may only serve assets from its locked branch.
	if (target.ref && target.ref !== ref) {
		return NextResponse.json(
			{ error: "That branch is not available" },
			{ status: 403 },
		);
	}

	const adapter = await adapterForTarget(target);
	if (!adapter) {
		return NextResponse.json({ error: "Asset unavailable" }, { status: 404 });
	}

	try {
		// Only a path inside the shared repository reaches the forge: this route accepts no URL, so it cannot be pointed at any other host.
		const response = await adapter.getRawFile(
			target.owner,
			target.repo,
			path,
			ref,
		);

		if (!response.ok) {
			await response.body?.cancel().catch(() => {});
			return NextResponse.json(
				{
					error:
						response.status === 404 || response.status === 403
							? "Asset not available"
							: "Asset unavailable",
				},
				{
					status:
						response.status === 404 || response.status === 403 ? 404 : 502,
				},
			);
		}

		const declared = Number(response.headers.get("content-length"));
		if (Number.isFinite(declared) && declared > MAX_ASSET_BYTES) {
			await response.body?.cancel().catch(() => {});
			return NextResponse.json({ error: "Asset too large" }, { status: 413 });
		}

		return new NextResponse(response.body, {
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Disposition": "inline",
				"Content-Type": contentType,
				"X-Content-Type-Options": "nosniff",
				// A repository controls these bytes. Opening an SVG directly would otherwise run its scripts on this origin; sandboxed with no script allowance it still renders in an <img>.
				"Content-Security-Policy":
					"default-src 'none'; style-src 'unsafe-inline'; sandbox",
			},
		});
	} catch (error) {
		if (error instanceof ForgeHttpError && error.status === 400) {
			return NextResponse.json(
				{ error: "Invalid asset request" },
				{ status: 400 },
			);
		}
		return NextResponse.json({ error: "Asset unavailable" }, { status: 502 });
	}
}
