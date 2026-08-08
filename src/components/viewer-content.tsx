"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import * as React from "react";
import { BranchSwitcher } from "@/components/branch-switcher";
import { NavLinks } from "@/components/nav-links";
import { ReleasesList } from "@/components/releases-list";
import { RepoTree } from "@/components/repo-tree";
import { SidebarTree } from "@/components/sidebar-tree";
import { SiteDrawer } from "@/components/site-drawer";
import { SiteFooter } from "@/components/site-footer";
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

// Chrome shared by the file view and the releases view: wordmark, primary nav, the repo/ref readout, and the footer.
function ViewerShell({
	fullName,
	refName,
	signedIn,
	children,
}: {
	fullName: string;
	refName: string;
	signedIn: boolean;
	children: ReactNode;
}) {
	return (
		// viewer-shell scopes the branch's GitHub-like tokens/theme to this
		// surface only; page-shell (globals.css) supplies the flex layout.
		<div className="page-shell viewer-shell">
			<header className="topbar">
				<a className="wordmark" href="/" aria-label="github unlisted home">
					<span className="mark" aria-hidden="true">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<title>unlisted</title>
							<line
								x1="2"
								y1="11"
								x2="11"
								y2="2"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
							<line
								x1="5"
								y1="14"
								x2="14"
								y2="5"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
								opacity="0.55"
							/>
							<line
								x1="8"
								y1="17"
								x2="17"
								y2="8"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
								opacity="0.25"
							/>
						</svg>
					</span>
					<span className="word">
						<span className="pre">github</span>{" "}
						<span className="post">unlisted</span>
					</span>
				</a>

				<NavLinks signedIn={signedIn} />

				<div className="topbar__right">
					<span className="topbar__meta">
						{fullName} · {refName}
					</span>
					<SiteDrawer signedIn={signedIn} />
				</div>
			</header>

			{children}
			<SiteFooter />
		</div>
	);
}

function ReleasesView({
	payload,
}: {
	payload: Extract<ViewerPayload, { kind: "releases" }>;
}) {
	const { owner, repo, shareId, refName } = payload;
	return (
		<ViewerShell
			fullName={payload.fullName}
			refName={refName}
			signedIn={payload.signedIn}
		>
			<main className="viewer viewer--wide">
				<section className="viewer__main">
					<div className="viewer__topinfo">
						<Link
							className="viewer__tab"
							href={buildHref(owner, repo, "tree", refName, "", shareId)}
						>
							Files
						</Link>
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

	return (
		<ViewerShell fullName={fullName} refName={ref} signedIn={payload.signedIn}>
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

				<section className="viewer__main">
					<div className="viewer__topinfo">
						<ViewerTreeToggle />
						{branches && branches.length > 1 && (
							<BranchSwitcher
								owner={owner}
								repo={repo}
								branches={branches}
								current={ref}
								shareId={shareId}
							/>
						)}
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
								Download ZIP
							</a>
						)}
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
								<a
									href={`https://github.com/${fullName}/blob/${ref}/${path}`}
									target="_blank"
									rel="noopener noreferrer"
								>
									on GitHub
								</a>
							</div>
							{contents.isBinary ? (
								<div className="tree__empty">Binary file not shown.</div>
							) : mdHtml ? (
								<div
									className="readme"
									// biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub-sanitized HTML (or markdown-it html:false fallback)
									dangerouslySetInnerHTML={{ __html: mdHtml }}
								/>
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

	const slugKey = slug.join(" ");
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
	return <FileOrDirView payload={payload} />;
}
