import { Redis } from "@upstash/redis";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

const SUBJECT_LABELS: Record<string, string> = {
	problem: "Reporting a problem",
	feature: "Requesting a feature",
	other: "Other",
};

const RATE_LIMIT = 5; // messages
const RATE_WINDOW = 3600; // seconds

function getRedis(): Redis | null {
	const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
	const token =
		process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
	if (!url || !token) return null;
	return new Redis({ url, token });
}

function clientIp(req: Request): string {
	const xff = req.headers.get("x-forwarded-for");
	return xff ? (xff.split(",")[0]?.trim() ?? "unknown") : "unknown";
}

function isEmail(s: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function bad(error: string, status = 400) {
	return Response.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
	let body: Record<string, unknown>;
	try {
		body = await req.json();
	} catch {
		return bad("Invalid request.");
	}

	// Honeypot: bots fill the hidden field. Report success, send nothing.
	if (typeof body.company === "string" && body.company.trim() !== "") {
		return Response.json({ ok: true });
	}

	const name = typeof body.name === "string" ? body.name.trim() : "";
	const email = typeof body.email === "string" ? body.email.trim() : "";
	const subjectKey = typeof body.subject === "string" ? body.subject : "";
	const customSubject =
		typeof body.customSubject === "string" ? body.customSubject.trim() : "";
	const message = typeof body.message === "string" ? body.message.trim() : "";

	if (!name || name.length > 100) return bad("Please enter your name.");
	if (!isEmail(email) || email.length > 200)
		return bad("Please enter a valid email.");
	if (!(subjectKey in SUBJECT_LABELS)) return bad("Please choose a subject.");
	if (subjectKey === "other" && (!customSubject || customSubject.length > 100))
		return bad("Please specify the subject.");
	if (!message || message.length > 5000) return bad("Please enter a message.");

	const finalSubject =
		subjectKey === "other" ? customSubject : SUBJECT_LABELS[subjectKey];

	// Best-effort IP rate limit (skipped if KV isn't configured).
	const redis = getRedis();
	if (redis) {
		const key = `contact-rl:${clientIp(req)}`;
		const n = await redis.incr(key);
		if (n === 1) await redis.expire(key, RATE_WINDOW);
		if (n > RATE_LIMIT)
			return bad("Too many messages. Please try again later.", 429);
	}

	const apiKey = process.env.RESEND_API_KEY;
	if (!apiKey) return bad("Email is not configured.", 500);

	const to = process.env.CONTACT_TO_EMAIL ?? "github-unlisted@revoconner.com";
	const from =
		process.env.CONTACT_FROM_EMAIL ?? "Unlisted Repo <contact@revoconner.com>";

	const resend = new Resend(apiKey);
	const { error } = await resend.emails.send({
		from,
		to,
		replyTo: email,
		subject: `[Unlisted Repo] ${finalSubject}`,
		text: `Name: ${name}\nEmail: ${email}\nSubject: ${finalSubject}\n\n${message}`,
	});

	if (error) return bad("Could not send your message. Please try again.", 502);
	return Response.json({ ok: true });
}
