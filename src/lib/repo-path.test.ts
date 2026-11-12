import { describe, expect, it } from "vitest";
import {
	buildHref,
	isSafeRepoPath,
	parseView,
	resolveRef,
	splitRefFromBranches,
} from "./repo-path";

const T = { owner: "o", repo: "r" };

describe("parseView", () => {
	it("returns null with fewer than two segments", () => {
		expect(parseView([], T)).toBeNull();
		expect(parseView(["owner"], T)).toBeNull();
	});

	it("parses a bare owner/repo as a tree root", () => {
		expect(parseView(["o", "r"], T)).toEqual({
			owner: "o",
			repo: "r",
			viewType: "tree",
			ref: "",
			path: "",
		});
	});

	it("parses a tree view with ref and nested path", () => {
		expect(parseView(["o", "r", "tree", "main", "src", "lib"], T)).toEqual({
			owner: "o",
			repo: "r",
			viewType: "tree",
			ref: "main",
			path: "src/lib",
		});
	});

	it("parses a blob view", () => {
		expect(parseView(["o", "r", "blob", "dev", "a", "b.ts"], T)).toEqual({
			owner: "o",
			repo: "r",
			viewType: "blob",
			ref: "dev",
			path: "a/b.ts",
		});
	});

	it("parses the releases view, which carries no ref or path", () => {
		expect(parseView(["o", "r", "releases"], T)).toEqual({
			owner: "o",
			repo: "r",
			viewType: "releases",
			ref: "",
			path: "",
		});
	});

	it("ignores trailing segments on the releases view", () => {
		expect(parseView(["o", "r", "releases", "v1.0", "x"], T)).toEqual({
			owner: "o",
			repo: "r",
			viewType: "releases",
			ref: "",
			path: "",
		});
	});

	it("treats an unknown view type as a tree with no ref/path", () => {
		expect(parseView(["o", "r", "wat", "x"], T)).toEqual({
			owner: "o",
			repo: "r",
			viewType: "tree",
			ref: "",
			path: "",
		});
	});

	it("ignores empty segments", () => {
		expect(parseView(["o", "r", "", ""], T)).toEqual({
			owner: "o",
			repo: "r",
			viewType: "tree",
			ref: "",
			path: "",
		});
	});
});

describe("parseView with a share's repository", () => {
	const gl = { owner: "group/sub", repo: "project" };

	it("strips a nested GitLab owner before reading the view", () => {
		expect(
			parseView(["group", "sub", "project", "blob", "main", "src", "a.ts"], gl),
		).toEqual({
			owner: "group/sub",
			repo: "project",
			viewType: "blob",
			ref: "main",
			path: "src/a.ts",
		});
	});

	it("parses a bare nested repository and its releases view", () => {
		expect(parseView(["group", "sub", "project"], gl)).toMatchObject({
			viewType: "tree",
			ref: "",
			path: "",
		});
		expect(
			parseView(["group", "sub", "project", "releases"], gl),
		).toMatchObject({ viewType: "releases" });
	});

	it("returns null when the URL names a different repository", () => {
		expect(parseView(["group", "sub", "other", "tree", "main"], gl)).toBeNull();
		expect(parseView(["group", "other", "project"], gl)).toBeNull();
		expect(parseView(["other", "sub", "project"], gl)).toBeNull();
	});

	// Without the share record, "group/sub/project" could be read as owner "group", repo "sub", path "project": a link for one project would address another.
	it("reads the URL relative to the share's repository instead of guessing the split", () => {
		expect(
			parseView(["group", "sub", "project", "tree", "main"], {
				owner: "group",
				repo: "sub",
			}),
		).toMatchObject({ viewType: "tree", ref: "", path: "" });
		expect(parseView(["group", "sub"], gl)).toBeNull();
	});

	it("is not confused by a repository named like a view keyword", () => {
		expect(
			parseView(["o", "tree", "blob", "main", "tree", "x.ts"], {
				owner: "o",
				repo: "tree",
			}),
		).toMatchObject({ viewType: "blob", ref: "main", path: "tree/x.ts" });
		expect(
			parseView(["o", "releases", "releases"], {
				owner: "o",
				repo: "releases",
			}),
		).toMatchObject({ viewType: "releases" });
	});

	it("compares segments exactly, including case", () => {
		expect(parseView(["O", "r"], T)).toBeNull();
		expect(parseView(["o", "R"], T)).toBeNull();
	});

	it("refuses a degenerate target with no owner", () => {
		expect(parseView(["r"], { owner: "", repo: "r" })).toBeNull();
		expect(parseView(["x", "r"], { owner: "/", repo: "r" })).toBeNull();
	});
});

describe("isSafeRepoPath", () => {
	it.each(["a", "src/a.ts", "dir with space/é.png", ".github/x.yml", "a..b/c"])(
		"accepts %s",
		(p) => expect(isSafeRepoPath(p)).toBe(true),
	);

	it.each([
		"",
		"/abs",
		"a//b",
		"a/",
		".",
		"..",
		"a/../b",
		"../a",
		"a/./b",
		"a\\b",
		"a\u0000b",
		"a\nb",
		"a\u007fb",
	])("rejects %j", (p) => expect(isSafeRepoPath(p)).toBe(false));
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

	it("keeps the slashes of a nested owner as path separators", () => {
		expect(buildHref("group/sub", "p", "blob", "main", "a.ts", "abc")).toBe(
			"/group/sub/p/blob/main/a.ts?s=abc",
		);
	});
});
