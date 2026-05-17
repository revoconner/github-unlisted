import type { Octokit } from "octokit";
import { highlightByLang } from "./highlight";

// Render markdown exactly as GitHub does: GFM, GitHub's own sanitizer, image
// proxying, issue/@user refs. The /markdown API does not syntax-highlight
// code, so recognized fenced blocks are re-highlighted with Shiki; anything
// unrecognized is left as GitHub returned it (already safe HTML).

function unescapeHtml(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#(?:39|x27);/g, "'")
		.replace(/&amp;/g, "&");
}

async function highlightBlocks(html: string): Promise<string> {
	// Two shapes GitHub may emit: a plain <pre><code class="language-x"> block,
	// or a <div class="highlight highlight-source-x"><pre>…</pre></div> wrapper.
	const patterns: { re: RegExp; lang: number; body: number }[] = [
		{
			re: /<div class="highlight highlight-source-([\w+.-]+)"><pre>([\s\S]*?)<\/pre><\/div>/g,
			lang: 1,
			body: 2,
		},
		{
			re: /<pre><code(?: class="language-([\w+.-]+)")?>([\s\S]*?)<\/code><\/pre>/g,
			lang: 1,
			body: 2,
		},
	];

	let result = html;
	for (const { re, lang, body } of patterns) {
		const out: string[] = [];
		let last = 0;
		let m = re.exec(result);
		while (m !== null) {
			out.push(result.slice(last, m.index));
			last = m.index + m[0].length;
			const code = m[body];
			if (code.includes("<span")) {
				out.push(m[0]); // already highlighted — leave it
			} else {
				const shiki = await highlightByLang(
					unescapeHtml(code),
					m[lang] ?? "text",
				);
				out.push(shiki ?? m[0]);
			}
			m = re.exec(result);
		}
		out.push(result.slice(last));
		result = out.join("");
	}
	return result;
}

export async function renderMarkdownGitHub(
	octokit: Octokit,
	owner: string,
	repo: string,
	text: string,
): Promise<string | null> {
	try {
		const { data } = await octokit.rest.markdown.render({
			text,
			mode: "gfm",
			context: `${owner}/${repo}`,
		});
		const html = typeof data === "string" ? data : String(data);
		return await highlightBlocks(html);
	} catch {
		return null;
	}
}
