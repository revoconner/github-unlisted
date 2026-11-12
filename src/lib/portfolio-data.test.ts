// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	portfolio: null as unknown,
	shares: new Map<string, unknown>(),
	adapter: null as unknown,
}));

vi.mock("@/lib/portfolio-store", async (orig) => ({
	...(await orig<typeof import("@/lib/portfolio-store")>()),
	getPortfolio: async () => mocks.portfolio,
}));
vi.mock("@/lib/share-store", () => ({
	resolveShare: async (id: string) => mocks.shares.get(id) ?? null,
}));
vi.mock("@/lib/forge/target", () => ({
	adapterForTarget: async () => mocks.adapter,
}));

import {
	PREVIEW_MAX_CHARS,
	resolvePortfolioView,
	truncatePreview,
} from "./portfolio-data";

const share = (repo: string, extra: object = {}) => ({
	installationId: 7,
	owner: "me",
	repo,
	createdAt: 1_700_000_000_000,
	...extra,
});

function adapter(readmes: Record<string, string | Error | null>) {
	return {
		forge: "github",
		getRepoMeta: async (_o: string, repo: string) => {
			if (!(repo in readmes)) throw new Error("revoked");
			return { fullName: `me/${repo}`, private: true, defaultBranch: "main" };
		},
		getContents: async (_o: string, repo: string, path: string) => {
			const r = readmes[repo];
			if (r instanceof Error) throw r;
			if (path === "") {
				return {
					kind: "dir",
					entries:
						r === null
							? []
							: [{ name: "README.md", path: "README.md", type: "file" }],
				};
			}
			return {
				kind: "file",
				name: "README.md",
				text: r,
				isBinary: false,
				size: 1,
			};
		},
	};
}

beforeEach(() => {
	mocks.shares.clear();
	mocks.portfolio = {
		installationId: 7,
		label: "me",
		shareIds: ["s1", "s2", "s3"],
		createdAt: 1,
		updatedAt: 1,
	};
	for (const [id, repo] of [
		["s1", "a"],
		["s2", "b"],
		["s3", "c"],
	]) {
		mocks.shares.set(id, share(repo));
	}
	mocks.adapter = adapter({ a: "# A", b: "# B", c: "# C" });
});

describe("resolvePortfolioView", () => {
	it("returns cards in the owner's order and renders README previews", async () => {
		const out = await resolvePortfolioView("p");
		expect(out.kind).toBe("portfolio");
		if (out.kind !== "portfolio") return;
		expect(out.cards.map((c) => c.repo)).toEqual(["a", "b", "c"]);
		expect(out.cards[0].preview?.html).toContain("<h1>A</h1>");
		expect(out.cards[0].href).toBe("/me/a?s=s1");
		expect(out.cards[0].publishedAt).toBe(1_700_000_000_000);
	});

	it("points at the stored picture, with its version, only when there is one", async () => {
		let out = await resolvePortfolioView("p");
		expect(out).toMatchObject({ imageUrl: null });
		mocks.portfolio = { ...(mocks.portfolio as object), imageVersion: 42 };
		out = await resolvePortfolioView("p");
		expect(out).toMatchObject({ imageUrl: "/api/portfolio/image?p=p&v=42" });
	});

	it("falls back to 'Portfolio for {label}' and honours a custom title/description", async () => {
		let out = await resolvePortfolioView("p");
		expect(out).toMatchObject({ title: "Portfolio for me", description: null });
		mocks.portfolio = {
			...(mocks.portfolio as object),
			title: "My work",
			description: "Things I built",
		};
		out = await resolvePortfolioView("p");
		expect(out).toMatchObject({
			title: "My work",
			description: "Things I built",
		});
	});

	it("silently skips expired shares and repos the app lost access to", async () => {
		mocks.shares.delete("s2");
		mocks.adapter = adapter({ a: "# A" }); // c: getRepoMeta throws
		const out = await resolvePortfolioView("p");
		if (out.kind !== "portfolio") throw new Error("expected portfolio");
		expect(out.cards.map((c) => c.repo)).toEqual(["a"]);
	});

	it("never serves a share that belongs to another account", async () => {
		mocks.shares.set("s2", share("b", { installationId: 999 }));
		const out = await resolvePortfolioView("p");
		if (out.kind !== "portfolio") throw new Error("expected portfolio");
		expect(out.cards.map((c) => c.repo)).toEqual(["a", "c"]);
	});

	it("keeps the card but drops the preview when the README cannot be read", async () => {
		mocks.adapter = adapter({ a: new Error("boom"), b: null, c: "# C" });
		const out = await resolvePortfolioView("p");
		if (out.kind !== "portfolio") throw new Error("expected portfolio");
		expect(out.cards.map((c) => [c.repo, c.preview === null])).toEqual([
			["a", true],
			["b", true],
			["c", false],
		]);
	});

	it("uses the locked branch of a share as the card's ref", async () => {
		mocks.shares.set("s1", share("a", { ref: "release" }));
		const out = await resolvePortfolioView("p");
		if (out.kind !== "portfolio") throw new Error("expected portfolio");
		expect(out.cards[0].refName).toBe("release");
		expect(out.cards[1].refName).toBe("main");
	});

	it("reports an unknown or empty portfolio as a notice", async () => {
		mocks.portfolio = null;
		expect(await resolvePortfolioView("p")).toMatchObject({
			kind: "notice",
			title: "Link invalid or expired",
		});
		expect(await resolvePortfolioView("")).toMatchObject({ kind: "notice" });
		expect(await resolvePortfolioView("x".repeat(65))).toMatchObject({
			kind: "notice",
		});

		mocks.portfolio = {
			installationId: 7,
			label: "me",
			shareIds: ["s1"],
			createdAt: 1,
			updatedAt: 1,
		};
		mocks.shares.clear();
		expect(await resolvePortfolioView("p")).toMatchObject({
			kind: "notice",
			title: "Nothing to show",
		});
	});

	it("never renders raw HTML from a README", async () => {
		mocks.adapter = adapter({
			a: "<script>alert(1)</script>\n\nhi",
			b: "x",
			c: "y",
		});
		const out = await resolvePortfolioView("p");
		if (out.kind !== "portfolio") throw new Error("expected portfolio");
		expect(out.cards[0].preview?.html).not.toContain("<script>");
	});
});

describe("truncatePreview", () => {
	it("leaves a short README alone", () => {
		expect(truncatePreview("hello")).toEqual({
			text: "hello",
			truncated: false,
		});
	});

	it("cuts a long README at a line boundary and flags it", () => {
		const text = `${"line\n".repeat(PREVIEW_MAX_CHARS)}`;
		const out = truncatePreview(text);
		expect(out.truncated).toBe(true);
		expect(out.text.length).toBeLessThanOrEqual(PREVIEW_MAX_CHARS);
		expect(out.text.endsWith("line")).toBe(true);
	});

	it("does not leave half a surrogate pair when there is no line break", () => {
		const out = truncatePreview(
			"😀".repeat(PREVIEW_MAX_CHARS),
			PREVIEW_MAX_CHARS - 1,
		);
		expect(out.truncated).toBe(true);
		const last = out.text.charCodeAt(out.text.length - 1);
		expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
	});
});
