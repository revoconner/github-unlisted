import MarkdownIt from "markdown-it";

// html:false escapes arbitrary raw HTML. We preserve only a small allowlist of
// safe image tags and native details/summary disclosure tags, rebuilding them
// from safe attributes so READMEs can show images and collapsible sections
// without enabling scripts, event handlers, styles, or arbitrary HTML.
const md = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: true,
});

function decodeBasicEntities(value: string): string {
	return value
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&#x27;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">");
}

function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function readAttribute(tag: string, name: string): string | null {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = tag.match(
		new RegExp(
			`\\b${escapedName}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>\`]+))`,
			"i",
		),
	);
	if (!match) return null;
	return decodeBasicEntities(match[1] ?? match[2] ?? match[3] ?? "");
}

function safeImageSource(src: string): boolean {
	if (!src || src.startsWith("#") || /^(?:javascript|data|vbscript|blob):/i.test(src)) {
		return false;
	}
	try {
		const url = new URL(src, "https://github-unlisted.invalid/");
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function sanitizeImageTag(tag: string): string | null {
	const src = readAttribute(tag, "src");
	if (src === null || !safeImageSource(src)) return null;

	const attributes: string[] = [`src=\"${escapeAttribute(src)}\"`];
	const alt = readAttribute(tag, "alt");
	const title = readAttribute(tag, "title");
	const width = readAttribute(tag, "width");
	const height = readAttribute(tag, "height");

	if (alt !== null) attributes.push(`alt=\"${escapeAttribute(alt)}\"`);
	if (title !== null) attributes.push(`title=\"${escapeAttribute(title)}\"`);
	// Dimension attributes are numeric in HTML. Invalid values such as height="auto"
	// are omitted; the README stylesheet already applies height:auto to images.
	if (width !== null && /^\d{1,5}$/.test(width) && Number(width) <= 10000) {
		attributes.push(`width=\"${width}\"`);
	}
	if (height !== null && /^\d{1,5}$/.test(height) && Number(height) <= 10000) {
		attributes.push(`height=\"${height}\"`);
	}

	return `<img ${attributes.join(" ")}>`;
}

function preserveSafeHtmlTags(src: string): {
	text: string;
	tags: Map<string, string>;
} {
	const tags = new Map<string, string>();
	let tokenPrefix = "GHUNLISTEDSAFETOKEN";
	while (src.includes(tokenPrefix)) tokenPrefix += "X";
	let nextToken = 0;

	const makeToken = (html: string) => {
		const token = `${tokenPrefix}${nextToken++}END`;
		tags.set(token, html);
		return token;
	};

	const text = src
		.split(/(\r?\n)/)
		.reduce(
			(state, part) => {
				if (part === "\n" || part === "\r\n") {
					state.parts.push(part);
					return state;
				}
				const fence = part.match(/^ {0,3}(`{3,}|~{3,})/);
				if (fence) {
					if (!state.fence) {
						state.fence = { marker: fence[1][0], length: fence[1].length };
					} else if (
						fence[1][0] === state.fence.marker &&
						fence[1].length >= state.fence.length
					) {
						state.fence = null;
					}
					state.parts.push(part);
					return state;
				}
				if (state.fence) {
					state.parts.push(part);
					return state;
				}

				state.parts.push(
					part.replace(
						/<img\b[^>]*>|<details\b[^>]*>|<\/details\s*>|<summary\b[^>]*>|<\/summary\s*>/gi,
						(tag) => {
							if (/^<img\b/i.test(tag)) {
								const safeTag = sanitizeImageTag(tag);
								return safeTag ? makeToken(safeTag) : tag;
							}

							if (/^<details\b/i.test(tag)) {
								// Preserve only native disclosure behavior; discard all
								// attributes except the harmless boolean `open`.
								const attrs = tag
									.replace(/^<details\b/i, "")
									.replace(/\/?\s*>$/, "");
								const open = /(?:^|\s)open(?:\s|=|$)/i.test(attrs);
								return `\n\n${makeToken(open ? "<details open>" : "<details>")}\n\n`;
							}

							if (/^<\/details/i.test(tag)) {
								return `\n\n${makeToken("</details>")}\n\n`;
							}

							if (/^<summary\b/i.test(tag)) {
								// Summary is inline content. Do not permit classes, styles,
								// event handlers, or other arbitrary attributes.
								return makeToken("<summary>");
							}

							// Keep text after the closing summary outside its paragraph,
							// even when the entire disclosure is written on one line.
							return `${makeToken("</summary>")}\n\n`;
						},
					),
				);
				return state;
			},
			{
				parts: [] as string[],
				fence: null as { marker: string; length: number } | null,
			},
		)
		.parts.join("");

	return { text, tags };
}

export function renderMarkdown(src: string): string {
	const preserved = preserveSafeHtmlTags(src);
	let html = md.render(preserved.text);
	for (const [token, safeTag] of preserved.tags) {
		html = html.replaceAll(token, safeTag);
	}

	// The local Markdown renderer wraps standalone placeholders in paragraphs.
	// Unwrap only the structural tags we deliberately restored so the result is
	// valid native <details><summary>…</summary>…</details> markup.
	html = html.replace(
		/<p>\s*(<details(?:\s+open)?>|<\/details>)\s*<\/p>/gi,
		"$1",
	);
	html = html.replace(
		/<p>\s*(<summary>[\s\S]*?<\/summary>)\s*<\/p>/gi,
		"$1",
	);
	return html;
}

export function isMarkdown(filename: string): boolean {
	return /\.(md|markdown|mdown|mkd)$/i.test(filename);
}
