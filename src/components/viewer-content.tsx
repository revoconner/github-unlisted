"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import * as React from "react";
import { BranchSwitcher } from "@/components/branch-switcher";
import { ReleasesList } from "@/components/releases-list";
import { RepoTree } from "@/components/repo-tree";
import { SidebarTree } from "@/components/sidebar-tree";
import { ViewerTreeToggle } from "@/components/viewer-tree-toggle";
import { buildHref, buildReleasesHref } from "@/lib/repo-path";
import type { ViewerPayload } from "@/lib/viewer-data";

function Notice({ title, detail }: { title: string; detail?: string }) {
	return (
		// viewer-shell so the notice resolves the viewer's --gh-* tokens.
		<div className="viewer-shell notice-screen">
			<h1>{title}</h1>
			{detail && <p>{detail}</p>}
			<Link href="/">Home</Link>
		</div>
	);
}

function FolderIcon() {
	return (
		<span className="icon-d" aria-hidden="true">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
			</svg>
		</span>
	);
}
function FileIcon() {
	return (
		<span className="icon-f" aria-hidden="true">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
			</svg>
		</span>
	);
}

// Chrome shared by the file view and the releases view. The viewer carries
// none of the site's own navigation: recipients get an attribution line and
// the repo/ref readout, nothing else.
function ViewerShell({
	fullName,
	refName,
	children,
}: {
	fullName: string;
	refName: string;
	children: ReactNode;
}) {
	return (
		// viewer-shell scopes the branch's GitHub-like tokens/theme to this
		// surface only; page-shell (globals.css) supplies the flex layout.
		<div className="page-shell viewer-shell">
			{/* Universal header: attribution only, on a darker strip so it reads
			    as our chrome, not part of the shared repo's content. */}
			<header className="topbar">
				<span className="viewer-attrib">
					Private repo shared using{" "}
					<a
						href="https://github-unlisted.com"
						target="_blank"
						rel="noopener noreferrer"
					>
						Github-Unlisted
					</a>{" "}
					hosted by{" "}
					<a
						href="https://revoconner.com"
						target="_blank"
						rel="noopener noreferrer"
					>
						Rév
					</a>
				</span>
			</header>

			{/* The repo's content starts here: owner/repo on its own row, with
			    the ref as a muted readout beside it. */}
			<div className="viewer-repohead">
				<span className="viewer-repohead__name">{fullName}</span>
				<span className="viewer-repohead__ref">{refName}</span>
			</div>

			{children}
		</div>
	);
}

// Rendered markdown with the repo-relative links repaired. The HTML arrives
// with the hrefs the author wrote ("LICENSE", "docs/setup.md"); the browser
// resolves those against the current /owner/repo/blob/ref/... URL, which is
// the right path but LOSES the ?s= share query — so every relative link died
// on a "share link required" screen. Same-origin links get the share id
// appended; external links open in a new tab.
function RepoHtml({
	html,
	className,
	shareId,
}: {
	html: string;
	className: string;
	shareId: string;
}) {
	const ref = React.useRef<HTMLDivElement>(null);

	// html is a real dependency even though the body never reads it: a new
	// html string replaces the markup, re-creating the anchors, and the
	// rewrite has to run again over that fresh DOM.
	// biome-ignore lint/correctness/useExhaustiveDependencies: html drives the DOM this effect mutates
	React.useEffect(() => {
		const root = ref.current;
		if (!root) return;
		for (const a of Array.from(root.querySelectorAll("a[href]"))) {
			const raw = a.getAttribute("href") ?? "";
			// In-page anchors stay as they are.
			if (raw.startsWith("#")) continue;
			let url: URL;
			try {
				// a.href would also work, but going through the attribute keeps
				// this robust if the effect ever re-runs over rewritten links.
				url = new URL(raw, window.location.href);
			} catch {
				continue;
			}
			if (url.origin !== window.location.origin) {
				a.setAttribute("target", "_blank");
				a.setAttribute("rel", "noopener noreferrer");
				continue;
			}
			if (!url.searchParams.has("s")) url.searchParams.set("s", shareId);
			a.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
		}
	}, [html, shareId]);

	return (
		<div
			ref={ref}
			className={className}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub-sanitized HTML (or markdown-it html:false fallback)
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

function ReleasesView({
	payload,
}: {
	payload: Extract<ViewerPayload, { kind: "releases" }>;
}) {
	const { owner, repo, shareId, refName } = payload;
	return (
		<ViewerShell fullName={payload.fullName} refName={refName}>
			<main className="viewer viewer--wide">
				<section className="viewer__main">
					<div className="viewer__topinfo">
						<div className="viewer__row">
							<Link
								className="viewer__tab"
								href={buildHref(owner, repo, "tree", refName, "", shareId)}
							>
								Files
							</Link>
						</div>
						<div className="viewer__crumbs">
							<span>{repo}</span>
							<span className="sep"> / </span>
							releases
						</div>
					</div>
					<ReleasesList releases={payload.releases} shareId={shareId} />
				</section>
			</main>
		</ViewerShell>
	);
}

function FileOrDirView({
	payload,
}: {
	payload: Extract<ViewerPayload, { kind: "view" }>;
}) {
	const {
		owner,
		repo,
		shareId,
		refName: ref,
		path,
		crumbs,
		contents,
		fullTree,
		sidebarEntries,
		branches,
		codeHtml,
		mdHtml,
		fullName,
	} = payload;

	// Soft wrap for code — the highlighted file view AND fenced blocks inside a
	// markdown preview (the CSS keys off data-wrap on the content pane). The
	// choice is remembered across files and visits.
	const [wrap, setWrap] = React.useState(
		() =>
			typeof window !== "undefined" &&
			window.localStorage.getItem("viewer:wrap") === "1",
	);
	const toggleWrap = () =>
		setWrap((w) => {
			try {
				window.localStorage.setItem("viewer:wrap", w ? "0" : "1");
			} catch {
				// Private-mode storage failures just lose the persistence.
			}
			return !w;
		});

	// A markdown file with both renderings gets Preview/Code tabs, preview
	// first. The component is keyed by path at the call site, so the tab
	// resets to Preview on every navigation.
	const hasMdTabs = Boolean(mdHtml && codeHtml);
	const [mdTab, setMdTab] = React.useState<"preview" | "code">("preview");
	const showPreview = Boolean(mdHtml) && (!hasMdTabs || mdTab === "preview");

	return (
		<ViewerShell fullName={fullName} refName={ref}>
			<main className="viewer">
				<aside className="viewer__sidebar">
					{fullTree ? (
						<RepoTree
							items={fullTree}
							owner={owner}
							repo={repo}
							refName={ref}
							shareId={shareId}
							activePath={path}
						/>
					) : (
						<SidebarTree
							entries={sidebarEntries}
							owner={owner}
							repo={repo}
							refName={ref}
							shareId={shareId}
							parentPath={crumbs.slice(0, -1).join("/")}
							showParent={Boolean(path)}
						/>
					)}
				</aside>

				<section className="viewer__main" data-wrap={wrap ? "on" : undefined}>
					<div className="viewer__topinfo">
						{/* Row: files sheet toggle. Mobile only — on wide viewports
						    the sidebar is already visible, so the row disappears. */}
						<div className="viewer__row viewer__row--files">
							<ViewerTreeToggle />
						</div>
						{/* Row: branch picker left; Releases / download right on wide
						    viewports, their own row on phones. Skipped entirely when
						    the share enables none of them. */}
						{((branches && branches.length > 1) ||
							payload.showReleases ||
							payload.allowDownload) && (
							<div className="viewer__row viewer__row--actions">
								{branches && branches.length > 1 && (
									<BranchSwitcher
										owner={owner}
										repo={repo}
										branches={branches}
										current={ref}
										shareId={shareId}
									/>
								)}
								{(payload.showReleases || payload.allowDownload) && (
									<div className="viewer__actions">
										{payload.showReleases && (
											<Link
												className="viewer__tab"
												href={buildReleasesHref(owner, repo, shareId)}
											>
												Releases
											</Link>
										)}
										{payload.allowDownload && (
											<a
												className="viewer__dl"
												href={`/api/download?s=${encodeURIComponent(shareId)}&ref=${encodeURIComponent(ref)}`}
											>
												Download as ZIP
											</a>
										)}
									</div>
								)}
							</div>
						)}
						{/* Row: breadcrumb. */}
						<div className="viewer__crumbs">
							<Link href={buildHref(owner, repo, "tree", ref, "", shareId)}>
								{repo}
							</Link>
							{crumbs.map((c, i) => {
								const sub = crumbs.slice(0, i + 1).join("/");
								const isLast = i === crumbs.length - 1;
								return (
									<span key={sub}>
										<span className="sep"> / </span>
										{isLast ? (
											c
										) : (
											<Link
												href={buildHref(owner, repo, "tree", ref, sub, shareId)}
											>
												{c}
											</Link>
										)}
									</span>
								);
							})}
						</div>
					</div>

					{contents.kind === "notfound" && (
						<div className="tree__empty">Path not found on {ref}.</div>
					)}

					{contents.kind === "dir" && (
						<div className="tree">
							{contents.entries.map((e) => (
								<div className="tree__row" key={e.path}>
									<Link
										href={buildHref(
											owner,
											repo,
											e.type === "dir" ? "tree" : "blob",
											ref,
											e.path,
											shareId,
										)}
									>
										{e.type === "dir" ? <FolderIcon /> : <FileIcon />}
										{e.name}
									</Link>
								</div>
							))}
						</div>
					)}

					{contents.kind === "file" && (
						<>
							<div className="filebar">
								<span>
									{contents.name} · {contents.size} bytes
								</span>
								{hasMdTabs && (
									<div
										className="filebar__tabs"
										role="tablist"
										aria-label="Markdown view"
									>
										<button
											type="button"
											role="tab"
											className="filebar__tab"
											aria-selected={mdTab === "preview"}
											onClick={() => setMdTab("preview")}
										>
											Preview
										</button>
										<button
											type="button"
											role="tab"
											className="filebar__tab"
											aria-selected={mdTab === "code"}
											onClick={() => setMdTab("code")}
										>
											Code
										</button>
									</div>
								)}
								{!contents.isBinary && (
									<button
										type="button"
										className="viewer__tab viewer__wrap"
										aria-pressed={wrap}
										onClick={toggleWrap}
									>
										Soft wrap
									</button>
								)}
							</div>
							{contents.isBinary ? (
								<div className="tree__empty">Binary file not shown.</div>
							) : showPreview && mdHtml ? (
								<RepoHtml className="readme" html={mdHtml} shareId={shareId} />
							) : codeHtml ? (
								<div
									className="codeblock"
									// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output
									dangerouslySetInnerHTML={{ __html: codeHtml }}
								/>
							) : (
								<div className="codeblock codeblock--plain">
									<pre>{contents.text}</pre>
								</div>
							)}
						</>
					)}
				</section>
			</main>
		</ViewerShell>
	);
}

type FetchState =
	| { status: "loading" }
	| { status: "blocked" }
	| { status: "error" }
	| { status: "ready"; payload: ViewerPayload };

// The viewer shell. On mount (and on every soft navigation to a new slug) it
// POSTs to the BotID-protected /api/view: the browser attaches the challenge
// token, so a real visitor gets content and a bot gets a 403 it can't satisfy.
export function ViewerContent({
	slug,
	shareId,
}: {
	slug: string[];
	shareId: string;
}) {
	const router = useRouter();
	const [state, setState] = React.useState<FetchState>({ status: "loading" });

	const slugKey = slug.join("\u0000");
	// Keep the freshest slug for the request without making the array itself an
	// effect dependency (a new array every render would refetch in a loop).
	const slugRef = React.useRef(slug);
	slugRef.current = slug;

	// slugKey is the deliberate trigger: it refetches on every soft navigation to
	// a new slug, while slugRef feeds the request the current array. shareId never
	// changes for a given page, but is listed for correctness.
	// biome-ignore lint/correctness/useExhaustiveDependencies: slugKey drives the refetch
	React.useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });

		(async () => {
			try {
				const res = await fetch("/api/view", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ slug: slugRef.current, shareId }),
				});

				if (cancelled) return;

				if (res.status === 403) {
					setState({ status: "blocked" });
					return;
				}
				if (!res.ok && res.status !== 400 && res.status !== 500) {
					setState({ status: "error" });
					return;
				}

				const payload = (await res.json()) as ViewerPayload;
				if (cancelled) return;

				if (payload.kind === "redirect") {
					router.replace(payload.href);
					return;
				}
				setState({ status: "ready", payload });
			} catch {
				if (!cancelled) setState({ status: "error" });
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [slugKey, shareId, router]);

	if (state.status === "loading") {
		return (
			<div className="viewer-shell notice-screen">
				<h1>Loading…</h1>
			</div>
		);
	}

	if (state.status === "blocked") {
		return (
			<Notice
				title="Access blocked"
				detail="This shared repository is protected against automated access. If you're using a normal browser, reload the page and try again."
			/>
		);
	}

	if (state.status === "error") {
		return (
			<Notice
				title="Something went wrong"
				detail="This repository could not be loaded. Please try again."
			/>
		);
	}

	const { payload } = state;
	if (payload.kind === "notice") {
		return <Notice title={payload.title} detail={payload.detail} />;
	}
	if (payload.kind === "redirect") {
		// Handled in the effect; render nothing while the replace navigates.
		return null;
	}
	if (payload.kind === "releases") {
		return <ReleasesView payload={payload} />;
	}
	// Keyed by ref+path so per-file state (the markdown Preview/Code tab)
	// resets on every navigation instead of leaking to the next file.
	return (
		<FileOrDirView
			key={`${payload.refName}:${payload.path}`}
			payload={payload}
		/>
	);
}
