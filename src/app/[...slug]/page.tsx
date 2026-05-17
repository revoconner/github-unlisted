import "@/styles/app.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import { highlight } from "@/lib/highlight";
import { getInstallationOctokit } from "@/lib/github-app";
import {
	type DirEntry,
	getContents,
	getRepoMeta,
	getRepoTree,
} from "@/lib/github-repo";
import { isMarkdown, renderMarkdown } from "@/lib/markdown";
import { renderMarkdownGitHub } from "@/lib/markdown-github";
import { buildHref, parseView } from "@/lib/repo-path";
import { resolveShare } from "@/lib/share-store";
import { RepoTree } from "@/components/repo-tree";
import { SidebarTree } from "@/components/sidebar-tree";

export const dynamic = "force-dynamic";

function Notice({ title, detail }: { title: string; detail?: string }) {
	return (
		<div className="notice-screen">
			<h1>{title}</h1>
			{detail && <p>{detail}</p>}
			<Link href="/">Home</Link>
		</div>
	);
}

function FolderIcon() {
	return (
		<span className="icon-d" aria-hidden="true">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
			</svg>
		</span>
	);
}
function FileIcon() {
	return (
		<span className="icon-f" aria-hidden="true">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
			</svg>
		</span>
	);
}

export default async function ViewPage({
	params,
	searchParams,
}: {
	params: Promise<{ slug?: string[] }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { slug = [] } = await params;
	const sp = await searchParams;

	const parsed = parseView(slug);
	if (!parsed) return <Notice title="Not found" />;

	const shareId = typeof sp.s === "string" ? sp.s : "";
	if (!shareId) {
		return (
			<Notice
				title="A share link is required"
				detail="Open a link created from the dashboard (it includes ?s=…)."
			/>
		);
	}

	const target = await resolveShare(shareId);
	if (!target) {
		return (
			<Notice
				title="Link invalid or expired"
				detail="This share link no longer works. Ask the owner for a new one."
			/>
		);
	}
	if (target.owner !== parsed.owner || target.repo !== parsed.repo) {
		return <Notice title="This link does not match this repository" />;
	}

	const octokit = getInstallationOctokit(target.installationId);
	let meta: Awaited<ReturnType<typeof getRepoMeta>>;
	try {
		meta = await getRepoMeta(octokit, target.owner, target.repo);
	} catch {
		return (
			<Notice
				title="Access revoked"
				detail="The app no longer has access to this repository."
			/>
		);
	}

	const ref = parsed.ref || meta.defaultBranch;
	const contents = await getContents(
		octokit,
		target.owner,
		target.repo,
		parsed.path,
		ref,
	);

	// The bare repo link opens the README as a file (not a directory listing).
	if (contents.kind === "dir" && parsed.path === "") {
		const readme = contents.entries.find(
			(e) =>
				e.type === "file" && /^readme\./i.test(e.name) && isMarkdown(e.name),
		);
		if (readme) {
			redirect(
				buildHref(target.owner, target.repo, "blob", ref, readme.path, shareId),
			);
		}
	}

	const crumbs = parsed.path ? parsed.path.split("/") : [];

	// Whole-repo tree for the sidebar (one recursive call). Falls back to the
	// current directory's listing if the ref can't be read or the tree is too
	// large for the API to return in full.
	const tree = await getRepoTree(octokit, target.owner, target.repo, ref);
	const fullTree =
		tree && !tree.truncated && tree.items.length > 0 ? tree.items : null;

	// A file view shows its containing folder in the sidebar so navigation
	// stays usable instead of an empty tree.
	let sidebarEntries: DirEntry[] = [];
	if (contents.kind === "dir") {
		sidebarEntries = contents.entries;
	} else if (contents.kind === "file") {
		const parentPath = parsed.path.includes("/")
			? parsed.path.slice(0, parsed.path.lastIndexOf("/"))
			: "";
		const parent = await getContents(
			octokit,
			target.owner,
			target.repo,
			parentPath,
			ref,
		);
		if (parent.kind === "dir") sidebarEntries = parent.entries;
	}

	let codeHtml: string | null = null;
	let mdHtml: string | null = null;
	if (contents.kind === "file" && !contents.isBinary && contents.text) {
		if (isMarkdown(contents.name)) {
			mdHtml =
				(await renderMarkdownGitHub(
					octokit,
					target.owner,
					target.repo,
					contents.text,
				)) ?? renderMarkdown(contents.text);
		} else {
			codeHtml = await highlight(contents.text, contents.name);
		}
	}

	return (
		<div className="app-shell">
			<header className="topbar">
				<a className="wordmark" href="/" aria-label="github unlisted home">
					<span className="mark" aria-hidden="true">
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
							<title>unlisted</title>
							<line x1="2" y1="11" x2="11" y2="2" stroke="#ff38ae" strokeWidth="1.6" strokeLinecap="round" />
							<line x1="5" y1="14" x2="14" y2="5" stroke="#ff38ae" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
							<line x1="8" y1="17" x2="17" y2="8" stroke="#ff38ae" strokeWidth="1.6" strokeLinecap="round" opacity="0.25" />
						</svg>
					</span>
					<span className="word">
						<span className="pre">github</span>{" "}
						<span className="post">unlisted</span>
					</span>
				</a>
				<div className="topbar__right">
					<span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" }}>
						{meta.fullName} · {ref}
					</span>
				</div>
			</header>

			<div className="viewer">
				<aside className="viewer__sidebar">
					{fullTree ? (
						<RepoTree
							items={fullTree}
							owner={target.owner}
							repo={target.repo}
							refName={ref}
							shareId={shareId}
							activePath={parsed.path}
						/>
					) : (
						<SidebarTree
							entries={sidebarEntries}
							owner={target.owner}
							repo={target.repo}
							refName={ref}
							shareId={shareId}
							parentPath={crumbs.slice(0, -1).join("/")}
							showParent={Boolean(parsed.path)}
						/>
					)}
				</aside>

				<section className="viewer__main">
					<div className="viewer__topinfo">
						<div className="viewer__crumbs">
							<Link
								href={buildHref(
									target.owner,
									target.repo,
									"tree",
									ref,
									"",
									shareId,
								)}
							>
								{target.repo}
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
												href={buildHref(
													target.owner,
													target.repo,
													"tree",
													ref,
													sub,
													shareId,
												)}
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
											target.owner,
											target.repo,
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
									href={`https://github.com/${meta.fullName}/blob/${ref}/${parsed.path}`}
									target="_blank"
									rel="noopener noreferrer"
								>
									on GitHub
								</a>
							</div>
							{contents.isBinary ? (
								<div className="tree__empty">Binary file not shown.</div>
							) : mdHtml ? (
								// biome-ignore lint/security/noDangerouslySetInnerHtml: GitHub-sanitized HTML (or markdown-it html:false fallback)
								<div
									className="readme"
									dangerouslySetInnerHTML={{ __html: mdHtml }}
								/>
							) : codeHtml ? (
								// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki output
								<div
									className="codeblock"
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
			</div>
		</div>
	);
}
