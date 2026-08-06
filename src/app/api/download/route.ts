import { NextResponse } from "next/server";
import { getInstallationOctokit, getInstallationToken } from "@/lib/github-app";
import { getRepoMeta, listBranches } from "@/lib/github-repo";
import { resolveShare } from "@/lib/share-store";

// Never cache: the URL this hands back is signed and expires within minutes.
export const dynamic = "force-dynamic";

// Whole-branch zip for a recipient. GitHub's archive endpoint answers 302 with a signed, short-lived codeload URL that needs no authentication, so the redirect is forwarded verbatim: no archive bytes pass through this deployment, no memory or duration ceiling, and the installation token never leaves the server.
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

	// A locked share always downloads its locked branch, never whatever the query string asks for.
	const requested = (sp.get("ref") ?? "").trim();

	// Resolved and validated up front. GitHub answers 302 even for a ref that does not exist, and codeload then serves a bare text/plain 404, so without this check a mistyped ref would dump the recipient on an unbranded GitHub error page.
	let ref: string;
	try {
		const octokit = getInstallationOctokit(target.installationId);
		const meta = await getRepoMeta(octokit, target.owner, target.repo);
		// requested is always a string, so an empty one falls through to the repo default.
		ref = target.ref || requested || meta.defaultBranch;

		const branches = await listBranches(octokit, target.owner, target.repo);
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

	// Slashes inside a branch name are path separators here, so each segment is encoded on its own.
	const refPath = ref.split("/").map(encodeURIComponent).join("/");
	const url = `https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/zipball/${refPath}`;

	let location: string | null = null;
	let status = 502;
	try {
		const token = await getInstallationToken(target.installationId);
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "github-unlisted",
			},
			redirect: "manual",
		});
		status = res.status;
		location = res.headers.get("location");
	} catch {
		return NextResponse.json({ error: "Archive unavailable" }, { status: 502 });
	}

	if (!location) {
		// 404 covers both a missing branch and a repository the app can no longer read, which is the same "gone" story for the recipient.
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

	const out = NextResponse.redirect(location, 302);
	out.headers.set("Cache-Control", "no-store");
	return out;
}
