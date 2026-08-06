import { NextResponse } from "next/server";
import { getInstallationOctokit, getInstallationToken } from "@/lib/github-app";
import { listReleases } from "@/lib/github-repo";
import { resolveShare } from "@/lib/share-store";

// Never cache: the URL this hands back is signed and expires within minutes.
export const dynamic = "force-dynamic";

// Release downloads for a recipient. Two shapes, both gated on the share's showReleases:
//   ?s=<id>&asset=<assetId>  an uploaded release asset
//   ?s=<id>&tag=<tag>        the source archive for a published release
// Both resolve to a signed, short-lived GitHub URL that needs no authentication, so the 302 is forwarded rather than followed and no bytes pass through this deployment. A private repo's browser_download_url would 404 in the recipient's browser, which is why this proxy exists at all.
export async function GET(request: Request) {
	const sp = new URL(request.url).searchParams;

	const shareId = sp.get("s") ?? "";
	if (!shareId) {
		return NextResponse.json({ error: "Missing share id" }, { status: 400 });
	}

	const target = await resolveShare(shareId);
	if (!target) {
		return NextResponse.json(
			{ error: "Link invalid or expired" },
			{ status: 404 },
		);
	}
	if (target.showReleases !== true) {
		return NextResponse.json(
			{ error: "Releases are not enabled for this link" },
			{ status: 403 },
		);
	}

	const assetParam = sp.get("asset");
	const tagParam = (sp.get("tag") ?? "").trim();
	if (!assetParam && !tagParam) {
		return NextResponse.json(
			{ error: "Missing asset or tag" },
			{ status: 400 },
		);
	}

	// Everything on offer is checked against the repo's own published releases. That keeps the tag parameter from reaching arbitrary refs and keeps the asset id from addressing a release this share should not see, notably a draft.
	let releases: Awaited<ReturnType<typeof listReleases>>;
	try {
		const octokit = getInstallationOctokit(target.installationId);
		releases = await listReleases(octokit, target.owner, target.repo);
	} catch {
		return NextResponse.json(
			{ error: "This repository is no longer available" },
			{ status: 404 },
		);
	}

	let url: string;
	let accept: string;
	if (assetParam) {
		const assetId = Number(assetParam);
		const known = releases.some((r) => r.assets.some((a) => a.id === assetId));
		if (!Number.isFinite(assetId) || !known) {
			return NextResponse.json({ error: "Asset not found" }, { status: 404 });
		}
		url = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/releases/assets/${assetId}`;
		accept = "application/octet-stream";
	} else {
		if (!releases.some((r) => r.tag === tagParam)) {
			return NextResponse.json({ error: "Release not found" }, { status: 404 });
		}
		const tagPath = tagParam.split("/").map(encodeURIComponent).join("/");
		url = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/zipball/refs/tags/${tagPath}`;
		accept = "application/vnd.github+json";
	}

	let location: string | null = null;
	try {
		const token = await getInstallationToken(target.installationId);
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: accept,
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "github-unlisted",
			},
			redirect: "manual",
		});
		location = res.headers.get("location");
	} catch {
		return NextResponse.json(
			{ error: "Download unavailable" },
			{ status: 502 },
		);
	}

	if (!location) {
		return NextResponse.json(
			{ error: "Download unavailable" },
			{ status: 502 },
		);
	}

	const out = NextResponse.redirect(location, 302);
	out.headers.set("Cache-Control", "no-store");
	return out;
}
