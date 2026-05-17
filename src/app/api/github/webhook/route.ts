import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
	deleteSharesForInstallation,
	deleteSharesForRepos,
} from "@/lib/share-store";

interface WebhookPayload {
	action?: string;
	installation?: { id?: number };
	repositories_removed?: { full_name?: string }[];
}

export async function POST(request: Request) {
	const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
	if (!secret || secret.startsWith("FILL_ME")) {
		return NextResponse.json(
			{ error: "Webhook secret not configured" },
			{ status: 500 },
		);
	}

	const event = request.headers.get("x-github-event") ?? "";
	const sig = request.headers.get("x-hub-signature-256") ?? "";
	const raw = await request.text();

	const expected = `sha256=${crypto
		.createHmac("sha256", secret)
		.update(raw)
		.digest("hex")}`;
	const valid =
		sig.length === expected.length &&
		crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
	if (!valid) {
		return NextResponse.json({ error: "Bad signature" }, { status: 401 });
	}

	let payload: WebhookPayload;
	try {
		payload = JSON.parse(raw) as WebhookPayload;
	} catch {
		return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
	}

	const installationId = payload.installation?.id;

	try {
		if (
			event === "installation" &&
			(payload.action === "deleted" || payload.action === "suspend") &&
			installationId
		) {
			await deleteSharesForInstallation(installationId);
		} else if (
			event === "installation_repositories" &&
			payload.action === "removed" &&
			installationId
		) {
			const removed = (payload.repositories_removed ?? [])
				.map((r) => r.full_name)
				.filter((n): n is string => Boolean(n));
			await deleteSharesForRepos(installationId, removed);
		}
	} catch (e) {
		// Still 200 so GitHub doesn't retry-storm; read-time checks still
		// protect access even if this cleanup didn't run.
		console.error("[webhook] cleanup failed:", e);
	}

	return NextResponse.json({ ok: true });
}
