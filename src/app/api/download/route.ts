import { NextResponse } from "next/server";
import { adapterForTarget } from "@/lib/forge/target";
import { ForgeHttpError } from "@/lib/forge/types";
import { resolveShare } from "@/lib/share-store";

// Never cache: a GitHub redirect URL is signed and short-lived, and a streamed archive is per-request.
export const dynamic = "force-dynamic";

// Whole-branch zip for a recipient. GitHub answers with a signed redirect that is forwarded as is, so no bytes pass through this deployment. Other forges are streamed through with the stored token, never buffered, so the token never leaves the server.
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
	if (target.allowDownload !== true) {
		return NextResponse.json(
			{ error: "Download is not enabled for this link" },
			{ status: 403 },
		);
	}

	const adapter = await adapterForTarget(target);
	if (!adapter?.capabilities.archive) {
		return NextResponse.json(
			{ error: "Download is not available for this link" },
			{ status: 404 },
		);
	}

	// A locked share always downloads its locked branch, never whatever the query string asks for.
	const requested = (sp.get("ref") ?? "").trim();

	// Resolved and validated up front against the real branch list, so a mistyped ref is a clean 404 here instead of an unbranded error page on the forge, and nothing the recipient typed reaches an upstream URL unless it is a branch that exists.
	let ref: string;
	try {
		const meta = await adapter.getRepoMeta(target.owner, target.repo);
		ref = target.ref || requested || meta.defaultBranch;

		const branches = await adapter.listBranches(target.owner, target.repo);
		if (!branches.includes(ref)) {
			return NextResponse.json(
				{ error: "That branch is not available" },
				{ status: 404 },
			);
		}
	} catch {
		// getRepoMeta throwing is the same "access revoked" signal the viewer uses.
		return NextResponse.json(
			{ error: "This repository is no longer available" },
			{ status: 404 },
		);
	}

	let archive: Awaited<ReturnType<typeof adapter.archiveResponse>>;
	try {
		archive = await adapter.archiveResponse(target.owner, target.repo, ref);
	} catch (error) {
		// 404 covers both a missing branch and a repository that can no longer be read, which is the same "gone" story for the recipient.
		const status = error instanceof ForgeHttpError ? error.status : 502;
		return NextResponse.json(
			{
				error:
					status === 404 || status === 403
						? "That branch is not available"
						: "Archive unavailable",
			},
			{ status: status === 404 || status === 403 ? 404 : 502 },
		);
	}

	if (archive.kind === "redirect") {
		const out = NextResponse.redirect(archive.url, 302);
		out.headers.set("Cache-Control", "no-store");
		return out;
	}

	// Headers are chosen here, not copied from the forge: its Content-Type, Set-Cookie and Location are not ours to relay.
	const safe = (v: string) => v.replace(/[^A-Za-z0-9._-]+/g, "-");
	return new NextResponse(archive.response.body, {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${safe(target.repo)}-${safe(ref)}.zip"`,
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}
