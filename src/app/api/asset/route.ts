import { NextResponse } from "next/server";
import { getInstallationToken } from "@/lib/github-app";
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

function getImageContentType(path: string): string | null {
	const lower = path.toLowerCase();
	const dot = lower.lastIndexOf(".");

	if (dot === -1) return null;

	return MIME_TYPES[lower.slice(dot)] ?? null;
}

function encodePath(path: string): string {
	return path
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function encodeRef(ref: string): string {
	return ref
		.split("/")
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function isSafeRepoPath(path: string): boolean {
	if (!path || path.startsWith("/")) {
		return false;
	}

	const segments = path.split("/");

	return segments.every(
		(segment) => segment !== "" && segment !== "." && segment !== "..",
	);
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

	const refPath = encodeRef(ref);
	const filePath = encodePath(path);

	const githubUrl =
		`https://api.github.com/repos/` +
		`${encodeURIComponent(target.owner)}/` +
		`${encodeURIComponent(target.repo)}/` +
		`contents/${filePath}?ref=${refPath}`;

	try {
		const token = await getInstallationToken(target.installationId);

		const response = await fetch(githubUrl, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github.raw+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "github-unlisted",
			},
		});

		if (!response.ok) {
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

		return new NextResponse(response.body, {
			headers: {
				"Cache-Control": "private, no-store",
				"Content-Disposition": "inline",
				"Content-Type": contentType,
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch {
		return NextResponse.json({ error: "Asset unavailable" }, { status: 502 });
	}
}