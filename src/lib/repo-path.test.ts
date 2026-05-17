import { describe, expect, it } from "vitest";
import { buildHref, parseView } from "./repo-path";

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
