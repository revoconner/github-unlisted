import { NextResponse } from "next/server";
import {
	cleanDescription,
	cleanTitle,
	MAX_PORTFOLIOS_PER_OWNER,
	parseItems,
	parsePortfolioTtl,
	portfolioPath,
	secondsUntil,
} from "@/lib/portfolio";
import {
	countPortfoliosFor,
	createPortfolio,
	deletePortfolio,
	getPortfolio,
	type NewPortfolio,
	type Portfolio,
	type PortfolioPatch,
	updatePortfolio,
} from "@/lib/portfolio-store";
import {
	deleteManagedShares,
	executePlan,
	syncManagedTtl,
	validateItems,
} from "@/lib/portfolio-sync";
import {
	getSession,
	ownsConnection,
	type Session,
	sessionOwnsTarget,
} from "@/lib/session";

type OwnerRef = Pick<Portfolio, "forge" | "installationId" | "connectionId">;

type Owner =
	| { base: OwnerRef; label: string }
	| { status: number; error: string };

// Who a new portfolio belongs to. Same rule as creating a share: a GitHub
// installation the session holds, or a connection it holds.
function resolveOwner(
	session: Session,
	body: { installationId?: unknown; connectionId?: unknown },
): Owner {
	if (body.connectionId !== undefined) {
		if (!ownsConnection(session, body.connectionId)) {
			return { status: 403, error: "Forbidden" };
		}
		const conn = session.connections.find((c) => c.id === body.connectionId);
		if (!conn) return { status: 404, error: "Connection not found" };
		return {
			base: { forge: conn.forge, connectionId: conn.id },
			label: conn.login,
		};
	}
	const installationId = Number(body.installationId);
	if (!installationId) return { status: 400, error: "Missing fields" };
	if (!session.installationIds.includes(installationId)) {
		return { status: 403, error: "Forbidden" };
	}
	return { base: { installationId }, label: session.login };
}

// Only the fields that identify the account. The portfolio record also holds a
// title, a list and more; none of that may leak into a share created for it.
function ownerRef(p: OwnerRef): OwnerRef {
	return p.connectionId === undefined
		? { installationId: p.installationId }
		: { forge: p.forge, connectionId: p.connectionId };
}

// The ordered list from a request. `items` is the full form; a plain
// `shareIds` array (every repository already shared) is still accepted.
function rawItems(body: Record<string, unknown>): unknown {
	if (body.items !== undefined) return body.items;
	return Array.isArray(body.shareIds)
		? body.shareIds.map((shareId) => ({ shareId }))
		: body.shareIds;
}

async function readJson(
	request: Request,
): Promise<Record<string, unknown> | null> {
	try {
		const body = await request.json();
		return typeof body === "object" && body !== null
			? (body as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export async function POST(request: Request) {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	}
	const body = await readJson(request);
	if (!body) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const who = resolveOwner(session, body);
	if ("error" in who) {
		return NextResponse.json({ error: who.error }, { status: who.status });
	}

	const parsed = parseItems(rawItems(body));
	if ("error" in parsed) {
		return NextResponse.json({ error: parsed.error }, { status: 400 });
	}

	// One revoke date for the page and for every link it creates. Absent means
	// never; a malformed value is refused, never read as "never".
	const ttl = parsePortfolioTtl(body.ttlSeconds ?? null);
	if ("error" in ttl) {
		return NextResponse.json({ error: ttl.error }, { status: 400 });
	}

	if ((await countPortfoliosFor(who.base)) >= MAX_PORTFOLIOS_PER_OWNER) {
		return NextResponse.json(
			{
				error: `You can have at most ${MAX_PORTFOLIOS_PER_OWNER} portfolios per account`,
			},
			{ status: 400 },
		);
	}

	// Nothing has been written yet: a bad request ends here without side effects.
	const checked = await validateItems(
		session,
		who.base,
		parsed.items,
		undefined,
	);
	if ("error" in checked) {
		return NextResponse.json(
			{ error: checked.error },
			{ status: checked.status },
		);
	}

	// The portfolio is created first because the links it makes carry its id.
	const id = await createPortfolio(
		{
			...who.base,
			label: who.label,
			title: cleanTitle(body.title),
			description: cleanDescription(body.description),
			shareIds: [],
		} as NewPortfolio,
		ttl.ttl,
	);
	try {
		const shareIds = await executePlan(checked.plan, who.base, id, ttl.ttl);
		await updatePortfolio(id, { shareIds });
	} catch {
		// executePlan already removed the links it made; remove the page too, so
		// a failed create leaves nothing behind.
		await deletePortfolio(id);
		return NextResponse.json(
			{ error: "Could not create the repository links" },
			{ status: 502 },
		);
	}

	const origin = new URL(request.url).origin;
	return NextResponse.json({ id, url: `${origin}${portfolioPath(id)}` });
}

export async function PATCH(request: Request) {
	const session = await getSession();
	if (!session) {
		return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	}
	const body = await readJson(request);
	if (!body) {
		return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
	}

	const id = typeof body.id === "string" ? body.id : "";
	if (!id) {
		return NextResponse.json({ error: "Missing id" }, { status: 400 });
	}

	const portfolio = await getPortfolio(id);
	if (!portfolio) {
		return NextResponse.json({ error: "Not found" }, { status: 404 });
	}
	if (!sessionOwnsTarget(session, portfolio)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// Each field is only touched when the caller sent it, so a client that edits
	// just the title can never clear the repository list.
	const patch: PortfolioPatch = {};
	if ("title" in body) patch.title = cleanTitle(body.title);
	if ("description" in body)
		patch.description = cleanDescription(body.description);

	let ttl: { ttl: number | null } | null = null;
	if ("ttlSeconds" in body) {
		const parsedTtl = parsePortfolioTtl(body.ttlSeconds);
		if ("error" in parsedTtl) {
			return NextResponse.json({ error: parsedTtl.error }, { status: 400 });
		}
		ttl = parsedTtl;
	}

	const owner = ownerRef(portfolio);
	const created = new Set<string>();
	let finalIds = portfolio.shareIds;

	if ("items" in body || "shareIds" in body) {
		const parsed = parseItems(rawItems(body));
		if ("error" in parsed) {
			return NextResponse.json({ error: parsed.error }, { status: 400 });
		}
		const checked = await validateItems(session, owner, parsed.items, id);
		if ("error" in checked) {
			return NextResponse.json(
				{ error: checked.error },
				{ status: checked.status },
			);
		}
		const before = new Set(portfolio.shareIds);
		try {
			// A link added now must expire with the rest: the new window if this
			// request changes it, otherwise what is left of the current one.
			finalIds = await executePlan(
				checked.plan,
				owner,
				id,
				ttl ? ttl.ttl : secondsUntil(portfolio.expiresAt),
			);
		} catch {
			return NextResponse.json(
				{ error: "Could not create the repository links" },
				{ status: 502 },
			);
		}
		for (const sid of finalIds) if (!before.has(sid)) created.add(sid);

		// Links this portfolio made and the owner just took out are revoked with
		// it. Links the owner made themselves are only detached, never deleted.
		const keep = new Set(finalIds);
		await deleteManagedShares(
			session,
			id,
			portfolio.shareIds.filter((sid) => !keep.has(sid)),
		);
		patch.shareIds = finalIds;
	}

	if (ttl) {
		// The new date applies to every link the portfolio manages, except the
		// ones just created with it.
		await syncManagedTtl(id, finalIds, ttl.ttl, created);
	}

	await updatePortfolio(id, patch, ttl ? { ttlSeconds: ttl.ttl } : undefined);
	return NextResponse.json({ ok: true });
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

	const portfolio = await getPortfolio(id);
	if (!portfolio) {
		// Already gone: idempotent, like deleting a share.
		return NextResponse.json({ ok: true });
	}
	if (!sessionOwnsTarget(session, portfolio)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	// The links this portfolio created go with it. The ones the owner made on
	// their own stay: deleting a page must not revoke something they shared
	// separately.
	await deleteManagedShares(session, id, portfolio.shareIds);
	await deletePortfolio(id);
	return NextResponse.json({ ok: true });
}
