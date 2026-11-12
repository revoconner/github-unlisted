import { NextResponse } from "next/server";
import { getInstallationOctokit } from "@/lib/github-app";
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

function getMimeType(path: string): string | null {
	const lower = path.toLowerCase();
	const dot = lower.lastIndexOf(".");
	if (dot === -1) return null;

	return MIME_TYPES[lower.slice(dot)] ?? null;
}

export async function GET(request: Request): Promise<Response> {
	const url = new URL(request.url);

	const shareId = url.searchParams.get("s") ?? "";
	const ref = url.searchParams.get("ref") ?? "";
	const path = url.searchParams.get("path") ?? "";

	if (!shareId || !ref || !path) {
		return NextResponse.json({ error: "Bad request" }, { status: 400 });
	}

	const contentType = getMimeType(path);

	if (!contentType) {
		return NextResponse.json(
			{ error: "Unsupported file type" },
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

	// A locked share may only access its pinned branch.
	if (target.ref && target.ref !== ref) {
		return NextResponse.json({ error: "Invalid ref" }, { status: 403 });
	}

	const octokit = getInstallationOctokit(target.installationId);

	try {
		const { data } = await octokit.rest.repos.getContent({
			owner: target.owner,
			repo: target.repo,
			path,
			ref,
		});

		if (Array.isArray(data) || data.type !== "file" || !data.sha) {
			return NextResponse.json(
				{ error: "File not found" },
				{ status: 404 },
			);
		}

		const blob = await octokit.rest.git.getBlob({
			owner: target.owner,
			repo: target.repo,
			file_sha: data.sha,
		});

		const bytes = Buffer.from(blob.data.content, "base64");

		return new Response(bytes, {
			status: 200,
			headers: {
				"Content-Type": contentType,
				"Content-Length": String(bytes.length),
				"Content-Disposition": `inline; filename="${encodeURIComponent(
					data.name,
				)}"`,
				"Cache-Control": "private, no-store",
			},
		});
	} catch (error) {
		console.error("share-file failed", error);

		return NextResponse.json(
			{ error: "Unable to read file" },
			{ status: 500 },
		);
	}
}