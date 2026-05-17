import { describe, expect, it } from "vitest";
import { isMarkdown, renderMarkdown } from "./markdown";

describe("isMarkdown", () => {
	it("matches markdown extensions case-insensitively", () => {
		for (const n of ["README.md", "a.markdown", "b.MDOWN", "c.mkd"]) {
			expect(isMarkdown(n)).toBe(true);
		}
	});

	it("rejects non-markdown names", () => {
		for (const n of ["a.ts", "readme.txt", "md", "a.md.ts"]) {
			expect(isMarkdown(n)).toBe(false);
		}
	});
});

describe("renderMarkdown", () => {
	it("renders basic markdown", () => {
		expect(renderMarkdown("# Title")).toContain("<h1>Title</h1>");
	});

	it("escapes raw HTML (html:false guards recipient-visible READMEs)", () => {
		const out = renderMarkdown("<script>alert(1)</script>");
		expect(out).not.toContain("<script>");
		expect(out).toContain("&lt;script&gt;");
	});

	it("linkifies bare URLs", () => {
		expect(renderMarkdown("see https://example.com")).toContain(
			'<a href="https://example.com">',
		);
	});
});
