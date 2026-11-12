import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";
import {
	type PortfolioPayload,
	resolvePortfolioView,
} from "@/lib/portfolio-data";

// Like /api/view, this endpoint is what turns bots away: the portfolio page is
// a shell and the repository data it shows lives here. It reads several
// private repositories per call, so it must never be cached.
export const dynamic = "force-dynamic";

// checkLevel MUST match the client registration in src/instrumentation-client.ts,
// or every verification fails.
export async function POST(request: Request): Promise<NextResponse> {
	const verification = await checkBotId({
		advancedOptions: { checkLevel: "deepAnalysis" },
	});

	if (verification.isBot) {
		return NextResponse.json({ kind: "blocked" }, { status: 403 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ kind: "notice", title: "Bad request" } satisfies PortfolioPayload,
			{ status: 400 },
		);
	}

	const record = (body ?? {}) as { id?: unknown };
	const id = typeof record.id === "string" ? record.id : "";

	try {
		return NextResponse.json(await resolvePortfolioView(id));
	} catch (err) {
		console.error("portfolio resolve failed", err);
		return NextResponse.json(
			{
				kind: "notice",
				title: "Something went wrong",
				detail: "This portfolio could not be loaded. Please try again.",
			} satisfies PortfolioPayload,
			{ status: 500 },
		);
	}
}
