import { NextResponse } from "next/server";
import { adapterForConnection } from "@/lib/forge/connections";
import { createGitHubAdapter } from "@/lib/forge/github";
import { adapterForTarget } from "@/lib/forge/target";
import type { ForgeAdapter } from "@/lib/forge/types";
import {
	getSession,
	ownsConnection,
	type Session,
	sessionOwnsTarget,
} from "@/lib/session";
import {
	createShare,
	deleteShare,
	resolveShare,
	type ShareSettings,
	type ShareTarget,
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
	adapter: ForgeAdapter,
	owner: string,
	repo: string,
): Promise<{ ref: string | null } | { error: string }> {
	if (v === null || v === undefined) return { ref: null };
	if (typeof v !== "string") return { error: "Invalid branch" };
	const wanted = v.trim();
	if (!wanted) return { ref: null };
	const branches = await adapter.listBranches(owner, repo);
	if (!branches.includes(wanted)) return { error: "Unknown branch" };
	return { ref: wanted };
}

type Owner =
	| {
			adapter: ForgeAdapter;
			base: Pick<ShareTarget, "forge" | "installationId" | "connectionId">;
	  }
	| { status: number; error: string };

// Who is allowed to create a share, and on what. A GitHub share is authorized by installation membership, a connected-forge share by membership of the connection in the signed session; either way the repo must then appear in that account's own listing.
async function resolveOwner(
	session: Session,
	body: { installationId?: unknown; connectionId?: unknown },
): Promise<Owner> {
	if (body.connectionId !== undefined) {
		if (!ownsConnection(session, body.connectionId)) {
			return { status: 403, error: "Forbidden" };
		}
		const id = body.connectionId as string;
		const conn = session.connections.find((c) => c.id === id);
		const adapter = await adapterForConnection(id);
		if (!conn || !adapter)
			return { status: 404, error: "Connection not found" };
		return { adapter, base: { forge: conn.forge, connectionId: id } };
	}
	const installationId = Number(body.installationId);
	if (!installationId) return { status: 400, error: "Missing fields" };
	if (!session.installationIds.includes(installationId)) {
		return { status: 403, error: "Forbidden" };
	}
	return {
		adapter: createGitHubAdapter(installationId),
		base: { installationId },
	};
}

export async function POST(request: Request) {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	}

	let body: {
		installationId?: unknown;
		connectionId?: unknown;
		owner?: unknown;
		repo?: unknown;
		ttlSeconds?: unknown;
		ref?: unknown;
		showBranches?: unknown;
		allowDownload?: unknown;
		showReleases?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const owner = typeof body.owner === "string" ? body.owner : "";
	const repo = typeof body.repo === "string" ? body.repo : "";
	if (!owner || !repo) {
		return NextResponse.json({ error: "Missing fields" }, { status: 400 });
	}

	const who = await resolveOwner(session, body);
	if ("error" in who) {
		return NextResponse.json({ error: who.error }, { status: who.status });
	}
	const { adapter } = who;

	// The repo must actually be in the granted set (GitHub: the installation; other forges: the connected account's listing).
	let repos: Awaited<ReturnType<ForgeAdapter["listRepos"]>>;
	try {
		repos = await adapter.listRepos();
	} catch {
		return NextResponse.json(
			{ error: "Could not read repositories" },
			{ status: 502 },
		);
	}
	if (!repos.some((r) => r.owner === owner && r.name === repo)) {
		return NextResponse.json(
			{ error: "Repo not in this account" },
			{ status: 403 },
		);
	}

	const parsedRef = await parseRef(body.ref, adapter, owner, repo);
	if ("error" in parsedRef) {
		return NextResponse.json({ error: parsedRef.error }, { status: 400 });
	}

	// Only meaningful without a lock; a locked share must never enumerate branches.
	const showBranches = body.showBranches === true && !parsedRef.ref;

	const ttlSeconds = parseTtl(body.ttlSeconds);
	const id = await createShare(
		{
			...who.base,
			owner,
			repo,
			ref: parsedRef.ref ?? undefined,
			showBranches: showBranches || undefined,
			// A forge without an archive or releases API cannot honour these, so they are never stored as on.
			allowDownload:
				(body.allowDownload === true && adapter.capabilities.archive) ||
				undefined,
			showReleases:
				(body.showReleases === true && adapter.capabilities.releases) ||
				undefined,
		} as ShareTarget,
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
		showReleases?: unknown;
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
	if (!sessionOwnsTarget(session, target)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	const adapter = await adapterForTarget(target);
	if (!adapter) {
		return NextResponse.json(
			{ error: "Connection not found" },
			{ status: 404 },
		);
	}

	// Each field is only touched when the caller actually sent it, so an older client posting just ttlSeconds cannot silently clear a branch lock or a switcher setting.
	const patch: Partial<ShareSettings> = {};
	if ("ref" in body) {
		const parsedRef = await parseRef(
			body.ref,
			adapter,
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
		patch.allowDownload =
			(body.allowDownload === true && adapter.capabilities.archive) ||
			undefined;
	}
	if ("showReleases" in body) {
		patch.showReleases =
			(body.showReleases === true && adapter.capabilities.releases) ||
			undefined;
	}

	// Locking wins regardless of the order the two fields arrived in, including when a lock is added to a share that already had the switcher on.
	const effectiveRef = "ref" in patch ? patch.ref : target.ref;
	if (effectiveRef) {
		patch.showBranches = undefined;
	}

	let updated: ShareTarget = target;
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
		showReleases: updated.showReleases === true,
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
	if (!sessionOwnsTarget(session, target)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	await deleteShare(id);
	return NextResponse.json({ ok: true });
}
