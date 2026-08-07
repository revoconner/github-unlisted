import { describe, expect, it } from "vitest";
import { matchesQuery } from "./dashboard-client";

describe("matchesQuery", () => {
	it("matches on the repo name", () => {
		expect(matchesQuery("github-unlisted", "unlisted")).toBe(true);
		expect(matchesQuery("github-unlisted", "github")).toBe(true);
	});

	it("is case insensitive and ignores surrounding whitespace", () => {
		expect(matchesQuery("Felicity", "felicity")).toBe(true);
		expect(matchesQuery("felicity", "  FELI  ")).toBe(true);
	});

	it("returns everything for an empty or whitespace-only query", () => {
		expect(matchesQuery("anything", "")).toBe(true);
		expect(matchesQuery("anything", "   ")).toBe(true);
	});

	it("does not match a repo whose name lacks the term", () => {
		expect(matchesQuery("github-unlisted", "felicity")).toBe(false);
	});

	// The reported bug. The owner prefix is the same on nearly every row, so
	// searching your own login used to match your whole repo list. Only what
	// comes after `owner/` is searchable.
	it("never sees the owner prefix", () => {
		const owner = "revoconner";
		// A repo named after its author still matches by its own name.
		expect(matchesQuery("revoconner-site", owner)).toBe(true);
		// Every other repo under the same owner must NOT match.
		for (const name of ["github-unlisted", "felicity", "dotfiles"]) {
			expect(matchesQuery(name, owner)).toBe(false);
			// Sanity check: the full path would have matched, which is the bug.
			expect(`${owner}/${name}`.includes(owner)).toBe(true);
		}
	});
});
