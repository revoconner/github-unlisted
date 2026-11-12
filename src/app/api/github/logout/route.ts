import { NextResponse } from "next/server";
import { deleteConnection } from "@/lib/forge/connections";
import {
	deletePortfoliosForConnection,
	deletePortfoliosForInstallation,
} from "@/lib/portfolio-store";
import {
	clearSavedSession,
	clearSession,
	getSavedSession,
	getSession,
	rememberSession,
	type Session,
} from "@/lib/session";
import {
	deleteSharesForConnection,
	deleteSharesForInstallation,
} from "@/lib/share-store";

function mergeSessionReferences(
	current: Session | null,
	saved: Session | null,
): Session | null {
	if (!current) return saved;
	if (!saved) return current;

	const connections = new Map(saved.connections.map((connection) => [connection.id, connection]));
	for (const connection of current.connections) connections.set(connection.id, connection);

	return {
		...current,
		installationIds: [...new Set([...saved.installationIds, ...current.installationIds])],
		connections: [...connections.values()],
	};
}

async function signOut(deleteStoredOauth: boolean): Promise<void> {
	const current = await getSession();
	const saved = await getSavedSession();

	if (deleteStoredOauth) {
		const connectionIds = new Set([
			...(current?.connections.map((connection) => connection.id) ?? []),
			...(saved?.connections.map((connection) => connection.id) ?? []),
		]);
		const installationIds = new Set([
			...(current?.installationIds ?? []),
			...(saved?.installationIds ?? []),
		]);

		// Remove the share indexes before deleting the stored connection record.
		// This revokes links for both the active session and any remembered account.
		for (const connectionId of connectionIds) {
			await deleteSharesForConnection(connectionId);
			await deletePortfoliosForConnection(connectionId);
			await deleteConnection(connectionId);
		}
		for (const installationId of installationIds) {
			await deleteSharesForInstallation(installationId);
			await deletePortfoliosForInstallation(installationId);
		}
		await clearSavedSession();
	} else {
		const remembered = mergeSessionReferences(current, saved);
		if (remembered) await rememberSession(remembered);
	}

	await clearSession();
}

export async function POST(request: Request) {
	const origin = request.headers.get("origin");
	if (origin && origin !== new URL(request.url).origin) {
		return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
	}

	const body = await request.json().catch(() => null);
	const deleteStoredOauth =
		typeof body === "object" && body !== null &&
		(body as Record<string, unknown>).deleteStoredOauth === true;

	try {
		await signOut(deleteStoredOauth);
		return NextResponse.json({ ok: true });
	} catch (error) {
		console.error("Sign out failed", error);
		return NextResponse.json(
			{ error: "Could not complete sign out. Please try again." },
			{ status: 500 },
		);
	}
}

// Backwards-compatible sign-out URL: older bookmarks or tabs log out while
// keeping saved credentials, matching the non-destructive choice in the UI.
export async function GET(request: Request) {
	try {
		await signOut(false);
	} catch (error) {
		console.error("Sign out failed", error);
	}
	return NextResponse.redirect(new URL("/app", request.url));
}
