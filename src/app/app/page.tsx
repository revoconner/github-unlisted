import { CreateShareButton } from "@/components/create-share-button";
import { ShareLinkRow } from "@/components/share-link-row";
import {
	type InstallationRepo,
	listInstallationRepos,
} from "@/lib/github-app";
import { getSession } from "@/lib/session";
import {
	listSharesForInstallation,
	type ShareRecord,
} from "@/lib/share-store";

type RepoRow = InstallationRepo & { installationId: number };

export const dynamic = "force-dynamic";

const APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

export default async function AppPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const sp = await searchParams;
	const session = await getSession();

	if (!session) {
		const installUrl = APP_SLUG
			? `https://github.com/apps/${APP_SLUG}/installations/new`
			: null;
		return (
			<main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
				<h1 className="text-2xl font-semibold">Sign in to create a link</h1>
				{sp.error && (
					<p className="text-sm text-red-600">{String(sp.error)}</p>
				)}
				{sp.needs_install && (
					<p className="text-sm text-neutral-600">
						You're signed in but the app isn't installed on any repos yet.
						Install it and pick the repos you want to share.
					</p>
				)}
				<a
					href="/api/github/login"
					className="rounded-md bg-neutral-900 px-5 py-3 font-medium text-white hover:bg-neutral-700"
				>
					Sign in with GitHub
				</a>
				{installUrl && (
					<a
						href={installUrl}
						className="text-sm text-neutral-600 underline"
					>
						Or install the app on your repositories
					</a>
				)}
			</main>
		);
	}

	let repos: RepoRow[] = [];
	let loadError: string | null = null;
	try {
		const lists = await Promise.all(
			session.installationIds.map(async (id) =>
				(await listInstallationRepos(id)).map(
					(r): RepoRow => ({ ...r, installationId: id }),
				),
			),
		);
		const seen = new Set<string>();
		repos = lists.flat().filter((r) => {
			if (seen.has(r.fullName)) return false;
			seen.add(r.fullName);
			return true;
		});
	} catch (e) {
		loadError =
			e instanceof Error ? e.message : "Failed to load repositories";
	}

	let shares: ShareRecord[] = [];
	try {
		const lists = await Promise.all(
			session.installationIds.map((id) => listSharesForInstallation(id)),
		);
		shares = lists.flat();
	} catch {
		// Non-fatal: the dashboard still works without the existing-links list.
	}

	return (
		<main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
			<header className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold">Your repositories</h1>
					<p className="text-sm text-neutral-600">
						Signed in as {session.login}
					</p>
				</div>
				<a href="/api/github/logout" className="text-sm text-neutral-600 underline">
					Sign out
				</a>
			</header>

			{loadError && (
				<p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{loadError}
				</p>
			)}

			{!loadError && repos.length === 0 && (
				<p className="text-sm text-neutral-600">
					No repositories. Add some to the installation on GitHub.
				</p>
			)}

			<ul className="divide-y rounded-md border">
				{repos.map((r) => (
					<li
						key={r.fullName}
						className="flex items-center justify-between gap-4 px-4 py-3"
					>
						<span className="font-mono text-sm">
							{r.fullName}{" "}
							<span className="text-xs text-neutral-500">
								{r.private ? "private" : "public"}
							</span>
						</span>
						<CreateShareButton
							installationId={r.installationId}
							owner={r.owner}
							repo={r.name}
						/>
					</li>
				))}
			</ul>

			<section className="flex flex-col gap-2">
				<h2 className="text-lg font-semibold">Your share links</h2>
				{shares.length === 0 ? (
					<p className="text-sm text-neutral-600">
						No links yet. Create one from a repository above.
					</p>
				) : (
					<ul className="divide-y rounded-md border">
						{shares.map((s) => (
							<ShareLinkRow
								key={s.id}
								id={s.id}
								owner={s.owner}
								repo={s.repo}
							/>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}
