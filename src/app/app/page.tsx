import "@/styles/app.css";
import { DashboardClient } from "@/components/dashboard-client";
import { listInstallationRepos } from "@/lib/github-app";
import { getSession } from "@/lib/session";
import { listSharesForInstallation } from "@/lib/share-store";

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
			<div className="app-shell">
				<main className="signin-screen">
					<h1>Sign in to create a link</h1>
					{sp.error && <p className="signin-error">{String(sp.error)}</p>}
					{sp.needs_install && (
						<p className="signin-note">
							You're signed in but the app isn't installed on any repos
							yet. Install it and pick the repos to share.
						</p>
					)}
					<a className="btn btn--accent" href="/api/github/login">
						Sign in with GitHub
					</a>
					{installUrl && (
						<a className="signin-alt" href={installUrl}>
							Or install the app on your repositories
						</a>
					)}
				</main>
			</div>
		);
	}

	let repos: {
		installationId: number;
		owner: string;
		name: string;
		fullName: string;
		private: boolean;
	}[] = [];
	let loadError: string | null = null;
	try {
		const lists = await Promise.all(
			session.installationIds.map(async (id) =>
				(await listInstallationRepos(id)).map((r) => ({
					installationId: id,
					owner: r.owner,
					name: r.name,
					fullName: r.fullName,
					private: r.private,
				})),
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

	let shares: { id: string; owner: string; repo: string; createdAt?: number }[] =
		[];
	try {
		const lists = await Promise.all(
			session.installationIds.map((id) => listSharesForInstallation(id)),
		);
		shares = lists.flat().map((s) => ({
			id: s.id,
			owner: s.owner,
			repo: s.repo,
			createdAt: s.createdAt,
		}));
	} catch {
		// Non-fatal.
	}

	if (loadError) {
		return (
			<div className="app-shell">
				<main className="signin-screen">
					<h1>Couldn't load repositories</h1>
					<p className="signin-error">{loadError}</p>
					<a className="btn btn--ghost btn--sm" href="/api/github/logout">
						Sign out
					</a>
				</main>
			</div>
		);
	}

	return (
		<DashboardClient
			repos={repos}
			shares={shares}
			login={session.login}
		/>
	);
}
