import crypto from "node:crypto";
import { cookies } from "next/headers";

// Minimal stateless session: an HMAC-signed cookie. We never store the GitHub
// user token; we only remember who the verified owner is and which
// installations they control, so they can create share links.

const COOKIE = "ur_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface Session {
	login: string;
	userId: number;
	installationIds: number[];
	exp: number;
}

function secret(): string {
	const s = process.env.SESSION_SECRET;
	if (!s) throw new Error("SESSION_SECRET is not set");
	return s;
}

function b64url(buf: Buffer): string {
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function sign(payload: string): string {
	return b64url(
		crypto.createHmac("sha256", secret()).update(payload).digest(),
	);
}

export function serializeSession(data: Omit<Session, "exp">): string {
	const session: Session = {
		...data,
		exp: Math.floor(Date.now() / 1000) + MAX_AGE,
	};
	const payload = b64url(Buffer.from(JSON.stringify(session)));
	return `${payload}.${sign(payload)}`;
}

function parseSession(token: string | undefined): Session | null {
	if (!token) return null;
	const [payload, mac] = token.split(".");
	if (!payload || !mac) return null;
	const expected = sign(payload);
	if (
		mac.length !== expected.length ||
		!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
	) {
		return null;
	}
	try {
		const session = JSON.parse(
			Buffer.from(payload, "base64").toString(),
		) as Session;
		if (session.exp < Math.floor(Date.now() / 1000)) return null;
		return session;
	} catch {
		return null;
	}
}

export async function getSession(): Promise<Session | null> {
	const store = await cookies();
	return parseSession(store.get(COOKIE)?.value);
}

export async function setSession(data: Omit<Session, "exp">): Promise<void> {
	const store = await cookies();
	store.set(COOKIE, serializeSession(data), {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge: MAX_AGE,
	});
}

export async function clearSession(): Promise<void> {
	const store = await cookies();
	store.delete(COOKIE);
}
