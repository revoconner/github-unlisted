import { describe, expect, it } from "vitest";
import {
	buildHref,
	parseView,
	resolveRef,
	splitRefFromBranches,
} from "./repo-path";

describe("parseView", () => {
	it("returns null with fewer than two segments", () => {
		expect(parseView([])).toBeNull();
		expect(parseView(["owner"])).toBeNull();
	});

	it("parses a bare owner/repo as a tree root", () => {
		expect(parseView(["o", "r"])).toEqual({
			owner: "o",
			repo: "r",
			viewType: "tree",
			ref: "",
			path: "",
		});
	});

	it("parses a tree view with ref and nested path", () => {
		expect(parseView(["o", "r", "tree", "main", "src", "lib"])).toEqual({
			owner: "o",
			repo: "r",
			viewType: "tree",
			ref: "main",
			path: "src/lib",
		});
	});

	it("parses a blob view", () => {
		expect(parseView(["o", "r", "blob", "dev", "a", "b.ts"])).toEqual({
			owner: "o",
			repo: "r",
			viewType: "blob",
			ref: "dev",
			path: "a/b.ts",
		});
	});

	it("treats an unknown view type as a tree with no ref/path", () => {
		expect(parseView(["o", "r", "wat", "x"])).toEqual({
			owner: "o",
			repo: "r",
			viewType: "tree",
			ref: "",
			path: "",
		});
	});

	it("ignores empty segments", () => {
		expect(parseView(["o", "r", "", ""])).toEqual({
			owner: "o",
			repo: "r",
			viewType: "tree",
			ref: "",
			path: "",
		});
	});
});

describe("resolveRef", () => {
	it("falls back to the default branch when nothing is locked or in the URL", () => {
		expect(resolveRef(undefined, "", "", "main")).toEqual({
			ref: "main",
			path: "",
			redirectRef: null,
		});
	});

	it("lets the URL ref and path win when the share is not locked", () => {
		expect(resolveRef(undefined, "dev", "src/a.ts", "main")).toEqual({
			ref: "dev",
			path: "src/a.ts",
			redirectRef: null,
		});
	});

	it("uses the locked branch for a bare link with no ref", () => {
		expect(resolveRef("release", "", "", "main")).toEqual({
			ref: "release",
			path: "",
			redirectRef: null,
		});
	});

	it("does not redirect when the URL already names the locked branch", () => {
		expect(resolveRef("release", "release", "", "main")).toEqual({
			ref: "release",
			path: "",
			redirectRef: null,
		});
	});

	it("keeps the path when the URL is already on the locked branch", () => {
		expect(resolveRef("release", "release", "src/a.ts", "main")).toEqual({
			ref: "release",
			path: "src/a.ts",
			redirectRef: null,
		});
	});

	it("redirects a URL that names any other branch back to the locked one", () => {
		expect(resolveRef("release", "secret-wip", "", "main")).toEqual({
			ref: "release",
			path: "",
			redirectRef: "release",
		});
	});

	it("redirects even when the URL names the repo default branch", () => {
		expect(resolveRef("release", "main", "", "main")).toEqual({
			ref: "release",
			path: "",
			redirectRef: "release",
		});
	});

	// A slashed branch is split across segments by parseView, so the ref/path boundary has to be recovered from the locked name or the viewer redirects forever.
	it("recombines a slashed locked branch that parseView split", () => {
		expect(
			resolveRef("ft/initialCommit", "ft", "initialCommit", "main"),
		).toEqual({ ref: "ft/initialCommit", path: "", redirectRef: null });
	});

	it("recovers the path that follows a slashed locked branch", () => {
		expect(
			resolveRef("ft/initialCommit", "ft", "initialCommit/src/a.ts", "main"),
		).toEqual({
			ref: "ft/initialCommit",
			path: "src/a.ts",
			redirectRef: null,
		});
	});

	it("settles in one hop when a slashed lock is reached from another branch", () => {
		const first = resolveRef("ft/initialCommit", "main", "src/a.ts", "main");
		expect(first).toEqual({
			ref: "ft/initialCommit",
			path: "src/a.ts",
			redirectRef: "ft/initialCommit",
		});
		// The redirect target is /{owner}/{repo}/blob/ft/initialCommit/src/a.ts, which parseView reports as ref "ft" plus the rest.
		expect(
			resolveRef("ft/initialCommit", "ft", "initialCommit/src/a.ts", "main"),
		).toEqual({
			ref: "ft/initialCommit",
			path: "src/a.ts",
			redirectRef: null,
		});
	});

	it("does not treat a branch that merely shares a prefix as the locked one", () => {
		expect(resolveRef("ft/init", "ft", "initial", "main")).toEqual({
			ref: "ft/init",
			path: "initial",
			redirectRef: "ft/init",
		});
	});
});

describe("splitRefFromBranches", () => {
	const branches = ["main", "ft/init", "ft/init/deep", "unstable"];

	it("returns null when nothing matches", () => {
		expect(splitRefFromBranches("nope", "", branches)).toBeNull();
	});

	it("returns null for an empty url", () => {
		expect(splitRefFromBranches("", "", branches)).toBeNull();
	});

	it("matches a plain branch with no path", () => {
		expect(splitRefFromBranches("main", "", branches)).toEqual({
			ref: "main",
			path: "",
		});
	});

	it("splits a plain branch from its path", () => {
		expect(splitRefFromBranches("main", "src/a.ts", branches)).toEqual({
			ref: "main",
			path: "src/a.ts",
		});
	});

	it("recombines a slashed branch that parseView split", () => {
		expect(splitRefFromBranches("ft", "init", branches)).toEqual({
			ref: "ft/init",
			path: "",
		});
	});

	it("splits a slashed branch from its path", () => {
		expect(splitRefFromBranches("ft", "init/src/a.ts", branches)).toEqual({
			ref: "ft/init",
			path: "src/a.ts",
		});
	});

	// "ft/init" also matches, so the longest wins or the deeper branch becomes unreachable.
	it("prefers the longest matching branch", () => {
		expect(splitRefFromBranches("ft", "init/deep", branches)).toEqual({
			ref: "ft/init/deep",
			path: "",
		});
		expect(splitRefFromBranches("ft", "init/deep/src/a.ts", branches)).toEqual({
			ref: "ft/init/deep",
			path: "src/a.ts",
		});
	});

	it("does not match a branch that is only a string prefix", () => {
		expect(splitRefFromBranches("mainline", "", branches)).toBeNull();
	});
});

describe("buildHref", () => {
	it("builds a root href without a path", () => {
		expect(buildHref("o", "r", "tree", "main", "", "abc")).toBe(
			"/o/r/tree/main?s=abc",
		);
	});

	it("builds a path href", () => {
		expect(buildHref("o", "r", "blob", "main", "src/a.ts", "abc")).toBe(
			"/o/r/blob/main/src/a.ts?s=abc",
		);
	});

	it("encodes the share id", () => {
		expect(buildHref("o", "r", "tree", "main", "", "a/b c")).toBe(
			"/o/r/tree/main?s=a%2Fb%20c",
		);
	});
});
