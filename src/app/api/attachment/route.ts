import { NextResponse } from "next/server";
import { adapterForTarget } from "@/lib/forge/target";
import { ForgeHttpError } from "@/lib/forge/types";
import { isSafeRepoPath } from "@/lib/repo-path";
import { resolveShare } from "@/lib/share-store";

export const dynamic = "force-dynamic";

const ASSET_ID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ASSET_BYTES = 15 * 1024 * 1024;
const IMAGE_CONTENT_TYPES = new Set([
	"image/avif",
	"image/bmp",
	"image/gif",
	"image/jpeg",
	"image/png",
	"image/svg+xml",
	"image/webp",
	"image/x-icon",
]);

function imageContentType(response: Response): string | null {
	const value = response.headers.get("content-type")?.split(";", 1)[0];
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	return IMAGE_CONTENT_TYPES.has(normalized) ? normalized : null;
}

async function discard(response: Response | null | undefined): Promise<void> {
	await response?.body?.cancel().catch(() => {});
}

function extractRenderedImageUrl(html: string): string | null {
	const match = html.match(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i);
	if (!match) return null;
	return match[2]
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#(?:39|x27);/g, "'");
}

function isGitHubAttachmentUrl(value: string, assetId: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return false;
		if (
			url.hostname === "github.com" &&
			url.pathname === `/user-attachments/assets/${assetId}`
		) {
			return true;
		}
		// GitHub's Markdown API converts private attachment links into temporary
		// signed URLs on this host. Never accept an arbitrary URL from the README.
		if (url.hostname === "user-images.githubusercontent.com") return true;
		return (
			url.hostname === "private-user-images.githubusercontent.com" &&
			url.searchParams.has("jwt")
		);
	} catch {
		return false;
	}
}

async function getAuthorizedImage(
	adapter: NonNullable<Awaited<ReturnType<typeof adapterForTarget>>>,
	owner: string,
	repo: string,
	assetId: string,
): Promise<Response | null> {
	// Prefer GitHub's authenticated stable URL. Some private attachments are
	// only accessible via the temporary signed URL returned by the Markdown API,
	// so fall back to that mechanism if this response is not an image.
	if (adapter.getRawAttachment) {
		try {
			const response = await adapter.getRawAttachment(assetId);
			if (response.ok && imageContentType(response)) return response;
			await discard(response);
		} catch {
			// The signed Markdown URL below is the fallback for private attachments.
		}
	}

	if (!adapter.renderMarkdown) return null;

	try {
		const stableUrl = `https://github.com/user-attachments/assets/${assetId}`;
		const html = await adapter.renderMarkdown(
			owner,
			repo,
			`<img alt="attachment" src="${stableUrl}">`,
		);
		if (!html) return null;

		const signedUrl = extractRenderedImageUrl(html);
		if (!signedUrl || !isGitHubAttachmentUrl(signedUrl, assetId)) return null;

		const response = await fetch(signedUrl, {
			cache: "no-store",
			redirect: "follow",
			headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
		});
		if (response.ok && imageContentType(response)) return response;
		await discard(response);
	} catch {
		return null;
	}

	return null;
}

export async function GET(request: Request) {
	const searchParams = new URL(request.url).searchParams;
	const shareId = searchParams.get("s") ?? "";
	const ref = searchParams.get("ref") ?? "";
	const path = searchParams.get("path") ?? "";
	const assetId = searchParams.get("asset") ?? "";

	if (
		!shareId ||
		!ref ||
		!isSafeRepoPath(path) ||
		!ASSET_ID_RE.test(assetId)
	) {
		return NextResponse.json({ error: "Invalid attachment request" }, { status: 400 });
	}

	const target = await resolveShare(shareId);
	if (!target || (target.forge !== undefined && target.forge !== "github")) {
		return NextResponse.json({ error: "Attachment not available" }, { status: 404 });
	}

	// A locked share may only serve attachments from its locked branch.
	if (target.ref && target.ref !== ref) {
		return NextResponse.json(
			{ error: "That branch is not available" },
			{ status: 403 },
		);
	}

	const adapter = await adapterForTarget(target);
	if (!adapter || adapter.forge !== "github") {
		return NextResponse.json({ error: "Attachment not available" }, { status: 404 });
	}

	try {
		// The path is supplied from the README viewer, but it is still untrusted.
		// Require the attachment ID to occur in that exact file before serving it;
		// a share therefore cannot be used to probe arbitrary attachment IDs.
		const source = await adapter.getContents(
			target.owner,
			target.repo,
			path,
			ref,
			"blob",
		);
		if (
			source.kind !== "file" ||
			!source.text ||
			!source.text.toLowerCase().includes(`/user-attachments/assets/${assetId}`.toLowerCase())
		) {
			return NextResponse.json({ error: "Attachment not available" }, { status: 404 });
		}

		const response = await getAuthorizedImage(
			adapter,
			target.owner,
			target.repo,
			assetId,
		);
		if (!response) {
			return NextResponse.json({ error: "Attachment unavailable" }, { status: 502 });
		}

		const contentType = imageContentType(response);
		if (!contentType) {
			await discard(response);
			return NextResponse.json({ error: "Unsupported attachment type" }, { status: 415 });
		}

		const declaredSize = Number(response.headers.get("content-length"));
		if (Number.isFinite(declaredSize) && declaredSize > MAX_ASSET_BYTES) {
			await discard(response);
			return NextResponse.json({ error: "Attachment too large" }, { status: 413 });
		}

		return new NextResponse(response.body, {
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Disposition": "inline",
				"Content-Type": contentType,
				"X-Content-Type-Options": "nosniff",
				"Content-Security-Policy":
					"default-src 'none'; style-src 'unsafe-inline'; sandbox",
			},
		});
	} catch (error) {
		if (error instanceof ForgeHttpError && error.status === 400) {
			return NextResponse.json({ error: "Invalid attachment request" }, { status: 400 });
		}
		return NextResponse.json({ error: "Attachment unavailable" }, { status: 502 });
	}
}
