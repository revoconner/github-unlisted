import crypto from "node:crypto";
import { cookies } from "next/headers";
import { isConnectionForge, isConnectionId } from "@/lib/forge/registry";
import type { ForgeId } from "@/lib/forge/types";

// Minimal stateless session: an HMAC-signed cookie. Forge credentials live only in encrypted Redis records.

const COOKIE = "ur_session";
const DEFAULT_SESSION_TTL = 60 * 60 * 24 * 30;
const MAX_SESSION_TTL = 60 * 60 * 24 * 365;
const MAX_COOKIE_LENGTH = 3800;

export const MAX_CONNECTIONS = 10;

export type ConnectionForge = Exclude<ForgeId, "github">;

export interface SessionConnection {
	id: string;
	forge: ConnectionForge;
	host: string;
	login: string;
}

export interface Session {
	login: string;
	authProvider?: "github";
	userId: number;
	installationIds: number[];
	connections: SessionConnection[];
	exp: number;
}

export type SessionInput = Pick<Session, "login" | "userId"> & {
	authProvider?: "github";
	installationIds: number[];
	connections?: SessionConnection[];
	expiresAt?: number;
};

export class TooManyConnectionsError extends Error {
	constructor() {
		super(`You can connect at most ${MAX_CONNECTIONS} accounts. Disconnect one first.`);
		this.name = "TooManyConnectionsError";
	}
}

export class SessionTooLargeError extends Error {
	constructor() {
		super("Session is too large to store. Disconnect an account first.");
		this.name = "SessionTooLargeError";
	}
}

export class InvalidSessionExpiryError extends Error {
	constructor() {
		super("Invalid session expiration date.");
		this.name = "InvalidSessionExpiryError";
	}
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
	return b64url(crypto.createHmac("sha256", secret()).update(payload).digest());
}

function nowSeconds(now: number): number {
	return Math.floor(now / 1000);
}

function normalizeExpiry(expiresAt: number | undefined, now: number): number {
	const nowS = nowSeconds(now);
	if (expiresAt === undefined) return nowS + DEFAULT_SESSION_TTL;
	if (!Number.isFinite(expiresAt) || !Number.isInteger(expiresAt)) {
		throw new InvalidSessionExpiryError();
	}
	const exp = Math.floor(expiresAt / 1000);
	if (exp <= nowS) throw new InvalidSessionExpiryError();
	if (exp > nowS + MAX_SESSION_TTL) throw new InvalidSessionExpiryError();
	return exp;
}

function encode(session: Session): string {
	const safe: Session = {
		...session,
		connections: session.connections.map(({ id, forge, host, login }) => ({
			id,
			forge,
			host,
			login,
		})),
	};
	const payload = b64url(Buffer.from(JSON.stringify(safe)));
	const token = `${payload}.${sign(payload)}`;
	if (token.length > MAX_COOKIE_LENGTH) throw new SessionTooLargeError();
	return token;
}

function build(data: SessionInput, now: number): Session {
	return {
		login: data.login,
		authProvider: data.authProvider,
		userId: data.userId,
		installationIds: data.installationIds,
		connections: data.connections ?? [],
		exp: normalizeExpiry(data.expiresAt, now),
	};
}

export function serializeSession(
	data: SessionInput,
	now = Date.now(),
): string {
	return encode(build(data, now));
}

function isConnection(value: unknown): value is SessionConnection {
	if (typeof value !== "object" || value === null) return false;
	const c = value as Record<string, unknown>;
	return (
		isConnectionId(c.id) &&
		isConnectionForge(c.forge) &&
		typeof c.host === "string" &&
		typeof c.login === "string"
	);
}

function normalize(raw: unknown): Session | null {
	if (typeof raw !== "object" || raw === null) return null;
	const s = raw as Record<string, unknown>;
	if (
		typeof s.login !== "string" ||
		typeof s.userId !== "number" ||
		typeof s.exp !== "number" ||
		!Array.isArray(s.installationIds) ||
		!s.installationIds.every((n) => typeof n === "number")
	) {
		return null;
	}
	return {
		login: s.login,
		authProvider: s.authProvider === "github" ? "github" : undefined,
		userId: s.userId,
		installationIds: s.installationIds as number[],
		connections: Array.isArray(s.connections)
			? s.connections.filter(isConnection)
			: [],
		exp: s.exp,
	};
}

export function parseSession(token: string | undefined, now = Date.now()): Session | null {
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
		const session = normalize(JSON.parse(Buffer.from(payload, "base64").toString()));
		if (!session || session.exp <= nowSeconds(now)) return null;
		return session;
	} catch {
		return null;
	}
}

export async function getSession(): Promise<Session | null> {
	const store = await cookies();
	return parseSession(store.get(COOKIE)?.value);
}

async function writeCookie(session: Session): Promise<void> {
	const maxAge = session.exp - nowSeconds(Date.now());
	if (maxAge <= 0) {
		throw new InvalidSessionExpiryError();
	}
	const token = encode(session);
	const store = await cookies();
	store.set(COOKIE, token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "lax",
		path: "/",
		maxAge,
	});
}

export async function setSession(data: SessionInput): Promise<void> {
	await writeCookie(build(data, Date.now()));
}

export async function updateSessionConnections(
	session: Session,
	connections: SessionConnection[],
): Promise<void> {
	if (connections.length > MAX_CONNECTIONS) throw new TooManyConnectionsError();
	await writeCookie({ ...session, connections });
}

export async function clearSession(): Promise<void> {
	const store = await cookies();
	store.delete(COOKIE);
}

export function findConnection(
	connections: SessionConnection[],
	forge: ConnectionForge,
	host: string,
	login: string,
): SessionConnection | undefined {
	const wanted = login.toLowerCase();
	return connections.find(
		(c) =>
			c.forge === forge && c.host === host && c.login.toLowerCase() === wanted,
	);
}

export function addConnection(
	connections: SessionConnection[],
	connection: SessionConnection,
): SessionConnection[] {
	const without = connections.filter((c) => c.id !== connection.id);
	if (without.length >= MAX_CONNECTIONS) throw new TooManyConnectionsError();
	return [...without, connection];
}

export function removeConnection(
	connections: SessionConnection[],
	id: string,
): SessionConnection[] {
	return connections.filter((c) => c.id !== id);
}

export function ownsConnection(
	session: Pick<Session, "connections"> | null,
	connectionId: unknown,
): boolean {
	return (
		session !== null &&
		isConnectionId(connectionId) &&
		session.connections.some((c) => c.id === connectionId)
	);
}

export function sessionOwnsTarget(
	session: Pick<Session, "installationIds" | "connections"> | null,
	target: {
		forge?: ForgeId;
		installationId?: number;
		connectionId?: string;
	},
): boolean {
	if (!session) return false;
	const hasInstallation = target.installationId !== undefined;
	const hasConnection = target.connectionId !== undefined;
	if (hasInstallation === hasConnection) return false;

	if (hasInstallation) {
		if (target.forge !== undefined && target.forge !== "github") return false;
		return session.installationIds.includes(target.installationId as number);
	}

	if (!isConnectionId(target.connectionId)) return false;
	const found = session.connections.find((c) => c.id === target.connectionId);
	if (!found) return false;
	return target.forge === undefined || target.forge === found.forge;
}
