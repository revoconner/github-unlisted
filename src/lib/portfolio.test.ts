import { describe, expect, it } from "vitest";
import {
	cleanDescription,
	cleanTitle,
	dateInputValue,
	defaultPortfolioTitle,
	MAX_DESCRIPTION_LENGTH,
	MAX_PORTFOLIO_REPOS,
	MAX_PORTFOLIO_TTL_SECONDS,
	MAX_TITLE_LENGTH,
	moveItem,
	parseItems,
	parsePortfolioTtl,
	parseShareIds,
	portfolioPath,
	revokeSecondsFromDate,
	secondsUntil,
} from "./portfolio";

describe("cleanTitle", () => {
	it("trims and collapses every kind of whitespace to single spaces", () => {
		expect(cleanTitle("  My \t Best\n\n Work  ")).toBe("My Best Work");
	});

	it("returns undefined for empty, whitespace-only and non-string input", () => {
		expect(cleanTitle("")).toBeUndefined();
		expect(cleanTitle("   \n\t ")).toBeUndefined();
		expect(cleanTitle(undefined)).toBeUndefined();
		expect(cleanTitle(null)).toBeUndefined();
		expect(cleanTitle(42)).toBeUndefined();
		expect(cleanTitle({ toString: () => "x" })).toBeUndefined();
	});

	it("strips control, zero-width and bidi-override characters", () => {
		// U+202E (right-to-left override) is the classic way to make a title read
		// backwards; U+200B is invisible; \u0000 is a NUL.
		expect(cleanTitle("Port\u202Efolio\u200B\u0000 A")).toBe("Portfolio A");
	});

	it("caps the length without cutting a character in half", () => {
		const long = "a".repeat(MAX_TITLE_LENGTH + 40);
		expect(Array.from(cleanTitle(long) ?? "")).toHaveLength(MAX_TITLE_LENGTH);

		// An emoji is one code point but two UTF-16 units: counting units would
		// either overshoot the cap or split it, leaving a lone surrogate.
		const emoji = "😀".repeat(MAX_TITLE_LENGTH + 5);
		const out = cleanTitle(emoji) ?? "";
		expect(Array.from(out)).toHaveLength(MAX_TITLE_LENGTH);
		expect(out).toBe("😀".repeat(MAX_TITLE_LENGTH));
	});

	it("does not interpret markup: it is returned as the literal text", () => {
		// Rendering escapes it; the point is that cleaning neither executes nor
		// "helpfully" strips it into something that looks different from input.
		expect(cleanTitle("<img src=x onerror=alert(1)>")).toBe(
			"<img src=x onerror=alert(1)>",
		);
	});
});

describe("cleanDescription", () => {
	it("keeps single line breaks and at most one blank line", () => {
		expect(cleanDescription("Line one\r\nLine two\n\n\n\n\nLine three")).toBe(
			"Line one\nLine two\n\nLine three",
		);
	});

	it("collapses runs of spaces and tabs but not newlines", () => {
		expect(cleanDescription("a   \t b\n c")).toBe("a b\nc");
	});

	it("returns undefined when nothing is left", () => {
		expect(cleanDescription("\n \n")).toBeUndefined();
		expect(cleanDescription(7)).toBeUndefined();
	});

	it("caps the length", () => {
		const out = cleanDescription("x".repeat(MAX_DESCRIPTION_LENGTH + 100));
		expect(out).toHaveLength(MAX_DESCRIPTION_LENGTH);
	});
});

describe("defaultPortfolioTitle", () => {
	it("uses the owner's name, and degrades to a plain title without one", () => {
		expect(defaultPortfolioTitle("ManuelRandazzo")).toBe(
			"Portfolio for ManuelRandazzo",
		);
		expect(defaultPortfolioTitle("  ")).toBe("Portfolio");
		expect(defaultPortfolioTitle(undefined)).toBe("Portfolio");
	});
});

describe("parseShareIds", () => {
	it("keeps the order it was given", () => {
		expect(parseShareIds(["c", "a", "b"])).toEqual({ ids: ["c", "a", "b"] });
	});

	it("drops duplicates, keeping the first position", () => {
		expect(parseShareIds(["a", "b", "a", "c", "b"])).toEqual({
			ids: ["a", "b", "c"],
		});
	});

	it("refuses anything that is not a list of non-empty strings", () => {
		for (const bad of [undefined, null, "a", {}, [1], [""], [null], [["a"]]]) {
			expect(parseShareIds(bad)).toEqual({ error: "Invalid repository list" });
		}
	});

	it("refuses an id too long to be a share id", () => {
		expect(parseShareIds(["x".repeat(65)])).toEqual({
			error: "Invalid repository list",
		});
	});

	it("requires at least one repository", () => {
		expect(parseShareIds([])).toEqual({ error: "Add at least one repository" });
	});

	it("refuses a list over the cap instead of silently truncating it", () => {
		const ids = Array.from(
			{ length: MAX_PORTFOLIO_REPOS + 1 },
			(_, i) => `s${i}`,
		);
		expect(parseShareIds(ids)).toMatchObject({
			error: expect.stringContaining(String(MAX_PORTFOLIO_REPOS)),
		});
		expect(parseShareIds(ids.slice(0, MAX_PORTFOLIO_REPOS))).toHaveProperty(
			"ids",
		);
	});

	it("counts the cap after de-duplication", () => {
		const ids = Array.from({ length: MAX_PORTFOLIO_REPOS }, (_, i) => `s${i}`);
		expect(parseShareIds([...ids, ...ids])).toHaveProperty("ids");
	});
});

describe("moveItem", () => {
	const list = ["a", "b", "c", "d"];

	it("moves an item forward and backward", () => {
		expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
		expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
	});

	it("does not mutate its input", () => {
		const copy = [...list];
		moveItem(list, 0, 3);
		expect(list).toEqual(copy);
	});

	it("returns an unchanged copy for a no-op or out-of-range move", () => {
		expect(moveItem(list, 1, 1)).toEqual(list);
		expect(moveItem(list, -1, 2)).toEqual(list);
		expect(moveItem(list, 0, 9)).toEqual(list);
		expect(moveItem(list, 9, 0)).toEqual(list);
	});
});

describe("portfolioPath", () => {
	it("uses a query parameter, never a path segment", () => {
		expect(portfolioPath("abc-123")).toBe("/portfolio?p=abc-123");
	});

	it("encodes the id", () => {
		expect(portfolioPath("a b&c")).toBe("/portfolio?p=a%20b%26c");
	});
});

describe("parsePortfolioTtl", () => {
	it("accepts a positive number of seconds, rounding down, and an explicit null", () => {
		expect(parsePortfolioTtl(3600)).toEqual({ ttl: 3600 });
		expect(parsePortfolioTtl(90.9)).toEqual({ ttl: 90 });
		expect(parsePortfolioTtl(null)).toEqual({ ttl: null });
	});

	it("refuses everything else instead of reading it as 'never'", () => {
		for (const bad of [
			undefined,
			0,
			0.5,
			-1,
			"3600",
			Number.NaN,
			Number.POSITIVE_INFINITY,
			{},
			[],
			true,
		]) {
			expect(parsePortfolioTtl(bad)).toHaveProperty("error");
		}
	});

	it("has a ceiling", () => {
		expect(parsePortfolioTtl(MAX_PORTFOLIO_TTL_SECONDS)).toEqual({
			ttl: MAX_PORTFOLIO_TTL_SECONDS,
		});
		expect(parsePortfolioTtl(MAX_PORTFOLIO_TTL_SECONDS + 1)).toHaveProperty(
			"error",
		);
	});
});

describe("parseItems", () => {
	it("reads shared and not-yet-shared entries, in order", () => {
		const out = parseItems([
			{ shareId: "s1" },
			{ owner: "me", repo: "new", showReleases: true, allowDownload: false },
		]);
		expect(out).toEqual({
			items: [
				{ shareId: "s1" },
				{ owner: "me", repo: "new", showReleases: true, allowDownload: false },
			],
		});
	});

	it("keeps options three-valued: unset stays unset, false stays false", () => {
		const out = parseItems([
			{ shareId: "s", showReleases: false, allowDownload: "yes" },
		]);
		if (!("items" in out)) throw new Error("expected items");
		const item = out.items[0] as unknown as Record<string, unknown>;
		expect(item.showReleases).toBe(false);
		expect(item.allowDownload).toBeUndefined();
		expect(item.showBranches).toBeUndefined();
	});

	it("drops duplicates (a repo is the same regardless of case)", () => {
		const out = parseItems([
			{ owner: "Me", repo: "App" },
			{ owner: "me", repo: "app" },
			{ shareId: "s" },
			{ shareId: "s" },
		]);
		expect(out).toHaveProperty("items");
		if ("items" in out) expect(out.items).toHaveLength(2);
	});

	it("refuses malformed entries, empty and oversized lists", () => {
		for (const bad of [
			null,
			"x",
			[null],
			[{}],
			[{ shareId: 5 }],
			[{ shareId: "" }],
			[{ owner: "a" }],
			[{ owner: "", repo: "r" }],
			[{ shareId: "x".repeat(65) }],
		]) {
			expect(parseItems(bad)).toEqual({ error: "Invalid repository list" });
		}
		expect(parseItems([])).toEqual({ error: "Add at least one repository" });
		const many = Array.from({ length: MAX_PORTFOLIO_REPOS + 1 }, (_, i) => ({
			shareId: `s${i}`,
		}));
		expect(parseItems(many)).toHaveProperty("error");
	});
});

describe("secondsUntil", () => {
	it("returns what is left, and null when there is no expiry", () => {
		expect(secondsUntil(undefined)).toBeNull();
		expect(secondsUntil(1_000_000 + 90_000, 1_000_000)).toBe(90);
		expect(secondsUntil(1_000_000 + 90_001, 1_000_000)).toBe(91);
	});

	it("never returns 0 or less, which would mean 'never expires'", () => {
		expect(secondsUntil(1_000_000 - 5000, 1_000_000)).toBe(1);
	});
});

describe("revokeSecondsFromDate", () => {
	const now = new Date(2026, 9, 11, 12, 0, 0).getTime(); // 11 Oct 2026, noon local

	it("means 'never' for an empty field", () => {
		expect(revokeSecondsFromDate("", now)).toBeNull();
	});

	it("counts to the end of the chosen day, local time", () => {
		// 12:00:00 -> 23:59:59 is 43199 seconds.
		expect(revokeSecondsFromDate("2026-10-11", now)).toBe(43199);
		expect(revokeSecondsFromDate("2026-10-12", now)).toBe(43199 + 86400);
	});

	it("refuses a day that is over, so it is never sent as a tiny or negative number", () => {
		expect(revokeSecondsFromDate("2026-10-10", now)).toBe("invalid");
		expect(revokeSecondsFromDate("2000-01-01", now)).toBe("invalid");
	});

	it("refuses garbage instead of returning NaN", () => {
		for (const bad of ["tomorrow", "2026-13-40x", "11/10/2026", "2026-1-1"]) {
			expect(revokeSecondsFromDate(bad, now)).toBe("invalid");
		}
	});
});

describe("dateInputValue", () => {
	it("formats a timestamp as a local YYYY-MM-DD", () => {
		expect(dateInputValue(new Date(2026, 0, 5, 18, 30).getTime())).toBe(
			"2026-01-05",
		);
	});
});
