import { NextResponse } from "next/server";
import { deleteConnection } from "@/lib/forge/connections";
import { deletePortfoliosForConnection } from "@/lib/portfolio-store";
import { deleteSharesForConnection } from "@/lib/share-store";
import {
	getSession,
	ownsConnection,
	removeConnection,
	updateSessionConnections,
} from "@/lib/session";

export async function DELETE(request: Request) {
	const session = await getSession();
	if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	const bodyId =
		typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).id === "string"
			? (body as Record<string, unknown>).id
			: null;
	const queryId = new URL(request.url).searchParams.get("id");
	const connectionId = bodyId ?? queryId;
	if (typeof connectionId !== "string" || !ownsConnection(session, connectionId)) {
		return NextResponse.json({ error: "Unknown connection" }, { status: 404 });
	}
	await deleteConnection(connectionId);
	await deleteSharesForConnection(connectionId);
	await deletePortfoliosForConnection(connectionId);
	await updateSessionConnections(session, removeConnection(session.connections, connectionId));
	return NextResponse.json({ ok: true });
}
