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

	it("keeps safe raw image tags while removing unsafe image attributes", () => {
		const imageUrl =
			"https://github.com/user-attachments/assets/ac0d2c11-b338-43b1-ac55-37394abe6427";
		const out = renderMarkdown(
			`<img width="1920" height="auto" alt="image" onerror="alert(1)" src="${imageUrl}" />`,
		);
		expect(out).toContain(`<img src="${imageUrl}" alt="image" width="1920">`);
		expect(out).not.toContain("onerror");
		expect(out).not.toContain('height="auto"');
	});

	it("keeps image-like examples inside fenced code blocks as code", () => {
		const example = [
			"```html",
			'<img src="https://example.com/image.png">',
			"```",
		].join("\n");
		const out = renderMarkdown(example);
		expect(out).not.toContain('<img src="https://example.com/image.png">');
		expect(out).toContain("&lt;img");
	});

	it("does not allow javascript image sources", () => {
		const out = renderMarkdown('<img src="javascript:alert(1)" alt="bad">');
		expect(out).not.toContain('<img src="javascript:');
		expect(out).toContain("&lt;img");
	});

	it("renders safe details and summary tags as a working disclosure block", () => {
		const out = renderMarkdown(
			"<details>\n<summary>Phone View</summary>\n\n**Mobile preview**\n\n- First item\n- Second item\n\n</details>",
		);
		expect(out).toContain("<details>");
		expect(out).toContain("<summary>Phone View</summary>");
		expect(out).toContain("<p><strong>Mobile preview</strong></p>");
		expect(out).toContain("<ul>");
		expect(out).toContain("</details>");
		expect(out).not.toContain("&lt;details&gt;");
		expect(out).not.toContain("&lt;summary&gt;");
	});

	it("renders inline <details> markup used by README files", () => {
		const out = renderMarkdown("<details> <summary> Phone View</summary> </details>");
		expect(out).toContain("<details>");
		expect(out).toContain("<summary> Phone View</summary>");
		expect(out).toContain("</details>");
		expect(out).not.toContain("&lt;details&gt;");
	});

	it("removes arbitrary attributes from details and summary tags", () => {
		const out = renderMarkdown(
			'<details class="x" onclick="alert(1)"><summary class="y" onclick="alert(1)">Phone View</summary>Hidden</details>',
		);
		expect(out).toContain("<details>");
		expect(out).toContain("<summary>Phone View</summary>");
		expect(out).not.toContain("onclick");
		expect(out).not.toContain('class="x"');
		expect(out).not.toContain('class="y"');
	});

	it("keeps details examples inside fenced code blocks as escaped code", () => {
		const out = renderMarkdown(
			[
				"```html",
				"<details>",
				"<summary>Phone View</summary>",
				"</details>",
				"```",
			].join("\n"),
		);
		expect(out).not.toContain("<details>");
		expect(out).toContain("&lt;details&gt;");
	});

	it("linkifies bare URLs", () => {
		expect(renderMarkdown("see https://example.com")).toContain(
			'<a href="https://example.com">',
		);
	});
});
