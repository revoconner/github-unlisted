import MarkdownIt from "markdown-it";

// html:false escapes any raw HTML in the source — markdown READMEs are
// recipient-visible, so this avoids XSS without needing a sanitizer.
const md = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: true,
});

export function renderMarkdown(src: string): string {
	return md.render(src);
}

export function isMarkdown(filename: string): boolean {
	return /\.(md|markdown|mdown|mkd)$/i.test(filename);
}
