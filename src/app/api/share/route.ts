import { NextResponse } from "next/server";
import { listInstallationRepos } from "@/lib/github-app";
import { getSession } from "@/lib/session";
import { createShare, deleteShare, resolveShare } from "@/lib/share-store";

export async function POST(request: Request) {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	}

	let body: { installationId?: unknown; owner?: unknown; repo?: unknown };
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const installationId = Number(body.installationId);
	const owner = typeof body.owner === "string" ? body.owner : "";
	const repo = typeof body.repo === "string" ? body.repo : "";
	if (!installationId || !owner || !repo) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	// Authorization: the signed-in user must control this installation, and
	// the repo must actually be in that installation's granted set.
	if (!session.installationIds.includes(installationId)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const repos = await listInstallationRepos(installationId);
	const match = repos.find(
		(r) => r.owner === owner && r.name === repo,
	);
	if (!match) {
		return NextResponse.json(
			{ error: "Repo not in this installation" },
			{ status: 403 },
		);
	}

	const id = await createShare({ installationId, owner, repo });
	const origin = new URL(request.url).origin;
	return NextResponse.json({
		id,
		url: `${origin}/${owner}/${repo}?s=${id}`,
	});
}

export async function DELETE(request: Request) {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	}

	const id = new URL(request.url).searchParams.get("id") ?? "";
	if (!id) {
		return NextResponse.json({ error: "Missing id" }, { status: 400 });
	}

	const target = await resolveShare(id);
	if (!target) {
		// Already gone — treat as success (idempotent).
		return NextResponse.json({ ok: true });
	}
	if (!session.installationIds.includes(target.installationId)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	await deleteShare(id);
	return NextResponse.json({ ok: true });
}
