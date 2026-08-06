import { NextResponse } from "next/server";
import {
	getInstallationOctokit,
	listInstallationRepos,
} from "@/lib/github-app";
import { listBranches } from "@/lib/github-repo";
import { getSession } from "@/lib/session";
import {
	createShare,
	deleteShare,
	resolveShare,
	type ShareSettings,
	updateShareSettings,
	updateShareTtl,
} from "@/lib/share-store";

// Accepts a positive integer (seconds) or null (never). Anything else is null.
function parseTtl(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

// A share locks to one branch or to none. Empty string and null both mean "no lock" (the pre-existing behaviour). Anything else must name a real branch, checked against the live list so a typo can't produce a link that 404s for the recipient.
async function parseRef(
	v: unknown,
	installationId: number,
	owner: string,
	repo: string,
): Promise<{ ref: string | null } | { error: string }> {
	if (v === null || v === undefined) return { ref: null };
	if (typeof v !== "string") return { error: "Invalid branch" };
	const wanted = v.trim();
	if (!wanted) return { ref: null };
	const octokit = getInstallationOctokit(installationId);
	const branches = await listBranches(octokit, owner, repo);
	if (!branches.includes(wanted)) return { error: "Unknown branch" };
	return { ref: wanted };
}

export async function POST(request: Request) {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	}

	let body: {
		installationId?: unknown;
		owner?: unknown;
		repo?: unknown;
		ttlSeconds?: unknown;
		ref?: unknown;
		showBranches?: unknown;
		allowDownload?: unknown;
	};
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
	const match = repos.find((r) => r.owner === owner && r.name === repo);
	if (!match) {
		return NextResponse.json(
			{ error: "Repo not in this installation" },
			{ status: 403 },
		);
	}

	const parsedRef = await parseRef(body.ref, installationId, owner, repo);
	if ("error" in parsedRef) {
		return NextResponse.json({ error: parsedRef.error }, { status: 400 });
	}

	// Only meaningful without a lock; a locked share must never enumerate branches.
	const showBranches = body.showBranches === true && !parsedRef.ref;

	const ttlSeconds = parseTtl(body.ttlSeconds);
	const id = await createShare(
		{
			installationId,
			owner,
			repo,
			ref: parsedRef.ref ?? undefined,
			showBranches: showBranches || undefined,
			allowDownload: body.allowDownload === true || undefined,
		},
		ttlSeconds,
	);
	const origin = new URL(request.url).origin;
	return NextResponse.json({
		id,
		url: `${origin}/${owner}/${repo}?s=${id}`,
	});
}

export async function PATCH(request: Request) {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	}

	let body: {
		id?: unknown;
		ttlSeconds?: unknown;
		ref?: unknown;
		showBranches?: unknown;
		allowDownload?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const id = typeof body.id === "string" ? body.id : "";
	if (!id) {
		return NextResponse.json({ error: "Missing id" }, { status: 400 });
	}

	const target = await resolveShare(id);
	if (!target) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	if (!session.installationIds.includes(target.installationId)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// Each field is only touched when the caller actually sent it, so an older client posting just ttlSeconds cannot silently clear a branch lock or a switcher setting.
	const patch: Partial<ShareSettings> = {};
	if ("ref" in body) {
		const parsedRef = await parseRef(
			body.ref,
			target.installationId,
			target.owner,
			target.repo,
		);
		if ("error" in parsedRef) {
			return NextResponse.json({ error: parsedRef.error }, { status: 400 });
		}
		patch.ref = parsedRef.ref ?? undefined;
	}
	if ("showBranches" in body) {
		patch.showBranches = body.showBranches === true || undefined;
	}
	if ("allowDownload" in body) {
		patch.allowDownload = body.allowDownload === true || undefined;
	}

	// Locking wins regardless of the order the two fields arrived in, including when a lock is added to a share that already had the switcher on.
	const effectiveRef = "ref" in patch ? patch.ref : target.ref;
	if (effectiveRef) {
		patch.showBranches = undefined;
	}

	let updated = target;
	if (Object.keys(patch).length > 0) {
		updated = (await updateShareSettings(id, patch)) ?? updated;
	}
	// Applied last so the caller-supplied window wins; updateShareSettings deliberately preserves whatever window was already running.
	if ("ttlSeconds" in body) {
		updated = (await updateShareTtl(id, parseTtl(body.ttlSeconds))) ?? updated;
	}

	return NextResponse.json({
		ok: true,
		expiresAt: updated.expiresAt ?? null,
		ref: updated.ref ?? null,
		showBranches: updated.showBranches === true,
		allowDownload: updated.allowDownload === true,
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
