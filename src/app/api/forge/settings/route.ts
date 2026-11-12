import { NextResponse } from "next/server";
import {
	deletePublicOAuthSettings,
	listPublicOAuthSettings,
	savePublicOAuthSettings,
} from "@/lib/forge/settings";
import { isPublicOAuthProvider, type PublicOAuthProvider } from "@/lib/forge/catalog";
import { getSession } from "@/lib/session";

async function requireGitHubAdmin() {
	const session = await getSession();
	return session && session.installationIds.length > 0 ? session : null;
}

function validProvider(value: unknown): value is PublicOAuthProvider {
	return isPublicOAuthProvider(value);
}

export async function GET() {
	if (!(await requireGitHubAdmin())) {
		return NextResponse.json(
			{ error: "GitHub admin authentication required" },
			{ status: 401 },
		);
	}
	return NextResponse.json({ configured: await listPublicOAuthSettings() });
}

export async function POST(request: Request) {
	if (!(await requireGitHubAdmin())) {
		return NextResponse.json(
			{ error: "GitHub admin authentication required" },
			{ status: 401 },
		);
	}
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	if (typeof body !== "object" || body === null) {
		return NextResponse.json({ error: "Invalid request" }, { status: 400 });
	}
	const b = body as Record<string, unknown>;
	const provider = b.provider;
	const clientId = typeof b.clientId === "string" ? b.clientId : "";
	const clientSecret = typeof b.clientSecret === "string" ? b.clientSecret : "";
	if (!validProvider(provider)) {
		return NextResponse.json({ error: "Unknown forge" }, { status: 400 });
	}
	try {
		await savePublicOAuthSettings(provider, clientId, clientSecret);
		return NextResponse.json({ ok: true });
	} catch (error) {
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : "Could not save OAuth settings",
			},
			{ status: 400 },
		);
	}
}

export async function DELETE(request: Request) {
	if (!(await requireGitHubAdmin())) {
		return NextResponse.json(
			{ error: "GitHub admin authentication required" },
			{ status: 401 },
		);
	}
	const provider = new URL(request.url).searchParams.get("provider");
	if (!validProvider(provider)) {
		return NextResponse.json({ error: "Unknown forge" }, { status: 400 });
	}
	await deletePublicOAuthSettings(provider);
	return NextResponse.json({ ok: true });
}
