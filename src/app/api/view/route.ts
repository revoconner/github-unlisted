import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";
import { resolveViewer, type ViewerPayload } from "@/lib/viewer-data";

// The viewer's data lives behind this endpoint precisely so bots can be turned
// away here. It exposes private-repo contents, so it must never be cached.
export const dynamic = "force-dynamic";

// Deep Analysis (Kasada) on top of the basic challenge check. checkLevel MUST
// match the client registration in src/instrumentation-client.ts, or every
// verification fails.
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
			{ kind: "notice", title: "Bad request" } satisfies ViewerPayload,
			{ status: 400 },
		);
	}

	const record = (body ?? {}) as { slug?: unknown; shareId?: unknown };
	const slug = Array.isArray(record.slug)
		? record.slug.filter((s): s is string => typeof s === "string")
		: [];
	const shareId = typeof record.shareId === "string" ? record.shareId : "";

	try {
		const payload = await resolveViewer(slug, shareId);
		return NextResponse.json(payload);
	} catch (err) {
		// The old server component let unexpected throws bubble to Next's error
		// boundary. Here they'd surface as a bare fetch failure, so translate them
		// into a viewer notice the client can render.
		console.error("view resolve failed", err);
		return NextResponse.json(
			{
				kind: "notice",
				title: "Something went wrong",
				detail: "This repository could not be loaded. Please try again.",
			} satisfies ViewerPayload,
			{ status: 500 },
		);
	}
}
