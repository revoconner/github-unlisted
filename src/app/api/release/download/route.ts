import { NextResponse } from "next/server";
import { adapterForTarget } from "@/lib/forge/target";
import { ForgeHttpError } from "@/lib/forge/types";
import { resolveShare } from "@/lib/share-store";

// Never cache: a GitHub redirect URL is signed and short-lived, and a streamed download is per-request.
export const dynamic = "force-dynamic";

// Release downloads for a recipient. Two shapes, both gated on the share's showReleases:
//   ?s=<id>&asset=<assetId>  an uploaded release asset
//   ?s=<id>&tag=<tag>        the source archive for a published release
// GitHub's answer is a signed redirect that is forwarded, not followed. On other forges the adapter either streams the file with the stored token or hands the browser an https link; the token never leaves the server either way.
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

	const adapter = await adapterForTarget(target);
	if (!adapter?.capabilities.releases) {
		return NextResponse.json(
			{ error: "Releases are not available for this link" },
			{ status: 404 },
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
	let releases: Awaited<ReturnType<typeof adapter.listReleases>>;
	try {
		releases = await adapter.listReleases(target.owner, target.repo);
	} catch {
		return NextResponse.json(
			{ error: "This repository is no longer available" },
			{ status: 404 },
		);
	}

	let assetId: number | undefined;
	let tag: string | undefined;
	if (assetParam) {
		assetId = Number(assetParam);
		const known = releases.some((r) => r.assets.some((a) => a.id === assetId));
		if (!Number.isFinite(assetId) || !known) {
			return NextResponse.json({ error: "Asset not found" }, { status: 404 });
		}
	} else {
		if (!releases.some((r) => r.tag === tagParam)) {
			return NextResponse.json({ error: "Release not found" }, { status: 404 });
		}
		tag = tagParam;
	}

	let out: Awaited<ReturnType<typeof adapter.releaseDownloadResponse>>;
	try {
		out = await adapter.releaseDownloadResponse(
			target.owner,
			target.repo,
			assetId,
			tag,
		);
	} catch (error) {
		const status = error instanceof ForgeHttpError ? error.status : 502;
		return NextResponse.json(
			{ error: "Download unavailable" },
			{ status: status === 404 || status === 403 ? 404 : 502 },
		);
	}

	if (out.kind === "redirect") {
		const res = NextResponse.redirect(out.url, 302);
		res.headers.set("Cache-Control", "no-store");
		return res;
	}

	const upstream = out.response;
	const name = (
		tag ??
		releases.flatMap((r) => r.assets).find((a) => a.id === assetId)?.name ??
		"download"
	).replace(/[^A-Za-z0-9._-]+/g, "-");
	return new NextResponse(upstream.body, {
		headers: {
			"Content-Type": "application/octet-stream",
			"Content-Disposition": `attachment; filename="${tag ? `${name}.zip` : name}"`,
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
