import type { Release } from "@/lib/github-repo";

// Release notes are rendered by the caller, which knows whether markdown is available; the HTML arrives already sanitized.
export interface RenderedRelease extends Release {
	bodyHtml: string | null;
}

function size(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.round(kb)} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

// Minute precision, UTC, matching the rest of the site. Fixed format rather than a locale one so the server and client agree.
function published(iso: string | null): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	return d.toISOString().slice(0, 10);
}

export function ReleasesList({
	releases,
	shareId,
}: {
	releases: RenderedRelease[];
	shareId: string;
}) {
	if (releases.length === 0) {
		return <div className="tree__empty">This repository has no releases.</div>;
	}

	const dl = (qs: string) =>
		`/api/release/download?s=${encodeURIComponent(shareId)}&${qs}`;

	return (
		<div className="releases">
			{releases.map((r) => (
				<article className="release" key={r.id}>
					<div className="release__head">
						<h2 className="release__name">{r.name}</h2>
						<span className="chip release__tag">{r.tag}</span>
						{r.prerelease && (
							<span className="chip chip--medium">pre-release</span>
						)}
						{r.publishedUtc && (
							<span className="release__date">{published(r.publishedUtc)}</span>
						)}
					</div>

					{r.bodyHtml ? (
						<div
							className="readme release__body"
							// biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it with html:false, so the source cannot inject markup
							dangerouslySetInnerHTML={{ __html: r.bodyHtml }}
						/>
					) : (
						<p className="release__empty">No release notes.</p>
					)}

					<div className="release__assets">
						<a
							className="release__asset"
							href={dl(`tag=${encodeURIComponent(r.tag)}`)}
						>
							<span className="release__asset-name">Source code (zip)</span>
						</a>
						{r.assets.map((a) => (
							<a
								className="release__asset"
								key={a.id}
								href={dl(`asset=${a.id}`)}
							>
								<span className="release__asset-name">{a.name}</span>
								<span className="release__asset-size">{size(a.size)}</span>
							</a>
						))}
					</div>
				</article>
			))}
		</div>
	);
}
