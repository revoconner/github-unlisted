import { NextResponse } from "next/server";
import {
	getInstallationOctokit,
	listInstallationRepos,
} from "@/lib/github-app";
import { listBranches } from "@/lib/github-repo";
import { getSession } from "@/lib/session";

// Branch list for the dashboard's per-repo branch picker. Owner-only: same authorization as creating a share, since knowing a private repo's branch names is itself information the recipient of a share never needs.
export async function GET(request: Request) {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	}

	const sp = new URL(request.url).searchParams;
	const installationId = Number(sp.get("installationId"));
	const owner = sp.get("owner") ?? "";
	const repo = sp.get("repo") ?? "";
	if (!installationId || !owner || !repo) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	if (!session.installationIds.includes(installationId)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const repos = await listInstallationRepos(installationId);
	const match = repos.find((r) => r.owner === owner && r.name === repo);
	if (!match) {
		return NextResponse.json(
			{ error: "Repo not in this installation" },
			{ status: 403 },
		);
	}

	try {
		const octokit = getInstallationOctokit(installationId);
		const branches = await listBranches(octokit, owner, repo);
		return NextResponse.json({
			branches,
			defaultBranch: match.defaultBranch,
		});
	} catch {
		return NextResponse.json(
			{ error: "Could not read branches" },
			{ status: 502 },
		);
	}
}
