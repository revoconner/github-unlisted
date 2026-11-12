import { NextResponse } from "next/server";
import { getConnection } from "@/lib/forge/connections";
import { getSavedSession, setSession } from "@/lib/session";

export async function POST() {
	try {
		const saved = await getSavedSession();
		if (!saved) {
			return NextResponse.json(
				{ error: "No saved account is available. Sign in again." },
				{ status: 404 },
			);
		}

		// Do not put stale connection references back into an active session if
		// an account was separately disconnected or removed from the server.
		const connectionChecks = await Promise.all(
			saved.connections.map(async (connection) => ({
				connection,
				stored: Boolean(await getConnection(connection.id)),
			})),
		);
		const connections = connectionChecks
			.filter((item) => item.stored)
			.map((item) => item.connection);
		const installationIds = saved.installationIds;

		if (connections.length === 0 && installationIds.length === 0) {
			return NextResponse.json(
				{ error: "The saved account is no longer available. Sign in again." },
				{ status: 410 },
			);
		}

		await setSession({
			login: saved.login,
			userId: saved.userId,
			authProvider: saved.authProvider,
			installationIds,
			connections,
		});
		return NextResponse.json({ ok: true });
	} catch (error) {
		console.error("Saved account restore failed", error);
		return NextResponse.json(
			{ error: "Could not restore the saved account. Sign in again." },
			{ status: 500 },
		);
	}
}
