import Link from "next/link";
import { getInstallationOctokit } from "@/lib/github-app";
import { getContents, getRepoMeta } from "@/lib/github-repo";
import { buildHref, parseView } from "@/lib/repo-path";
import { resolveShare } from "@/lib/share-store";

export const dynamic = "force-dynamic";

function Notice({ title, detail }: { title: string; detail?: string }) {
	return (
		<main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
			<h1 className="text-2xl font-semibold">{title}</h1>
			{detail && <p className="text-sm text-neutral-600">{detail}</p>}
			<Link href="/" className="text-sm text-neutral-600 underline">
				Home
			</Link>
		</main>
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
	if (!parsed) {
		return <Notice title="Not found" />;
	}

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

	// A shareId is bound to one repo; don't let it be reused for another path.
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

	const crumbs = parsed.path ? parsed.path.split("/") : [];

	return (
		<main className="mx-auto max-w-4xl px-4 py-8">
			<header className="mb-4 flex items-center justify-between gap-3 border-b pb-3">
				<h1 className="font-mono text-lg">
					{meta.fullName}
					<span className="ml-2 text-xs text-neutral-500">
						{meta.private ? "private" : "public"} · {ref}
					</span>
				</h1>
				<a
					href={`https://github.com/${meta.fullName}`}
					target="_blank"
					rel="noopener noreferrer"
					className="text-xs text-neutral-500 underline"
				>
					on GitHub
				</a>
			</header>

			<nav className="mb-4 font-mono text-sm">
				<Link
					href={buildHref(
						target.owner,
						target.repo,
						"tree",
						ref,
						"",
						shareId,
					)}
					className="text-blue-600 hover:underline"
				>
					{target.repo}
				</Link>
				{crumbs.map((c, i) => {
					const sub = crumbs.slice(0, i + 1).join("/");
					return (
						<span key={sub}>
							{" / "}
							<Link
								href={buildHref(
									target.owner,
									target.repo,
									"tree",
									ref,
									sub,
									shareId,
								)}
								className="text-blue-600 hover:underline"
							>
								{c}
							</Link>
						</span>
					);
				})}
			</nav>

			{contents.kind === "notfound" && (
				<p className="text-sm text-neutral-600">Path not found on {ref}.</p>
			)}

			{contents.kind === "dir" && (
				<ul className="divide-y rounded-md border">
					{contents.entries.map((e) => (
						<li key={e.path} className="px-4 py-2 font-mono text-sm">
							<Link
								href={buildHref(
									target.owner,
									target.repo,
									e.type === "dir" ? "tree" : "blob",
									ref,
									e.path,
									shareId,
								)}
								className="text-blue-600 hover:underline"
							>
								{e.type === "dir" ? "📁 " : "📄 "}
								{e.name}
							</Link>
						</li>
					))}
				</ul>
			)}

			{contents.kind === "file" && (
				<div className="rounded-md border">
					<div className="border-b bg-neutral-50 px-4 py-2 font-mono text-xs">
						{contents.name} · {contents.size} bytes
					</div>
					{contents.isBinary ? (
						<p className="px-4 py-6 text-sm text-neutral-600">
							Binary file not shown.
						</p>
					) : (
						<pre className="overflow-x-auto px-4 py-3 text-xs leading-relaxed">
							<code>{contents.text}</code>
						</pre>
					)}
				</div>
			)}
		</main>
	);
}
