import "@/styles/global.css";
import "@/styles/dashboard.css";
import { DashboardClient } from "@/components/dashboard-client";
import { ForgePicker } from "@/components/forge-picker";
import { SignInChoice } from "@/components/sign-in-choice";
import { SignOutControl } from "@/components/sign-out-control";
import { SiteFooter } from "@/components/site-footer";
import { adapterForConnection, getConnection } from "@/lib/forge/connections";
import { listInstallationRepos } from "@/lib/github-app";
import { portfolioImagePath } from "@/lib/portfolio-image";
import { listPortfoliosForOwner } from "@/lib/portfolio-store";
import { pageMetadata } from "@/lib/seo";
import { getSavedSession, getSession } from "@/lib/session";
import { listSharesForOwner } from "@/lib/share-store";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
	title: "Dashboard",
	path: "/app",
	index: false,
});

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
		const saved = await getSavedSession();
		const savedConnections = saved
			? (await Promise.all(saved.connections.map(async (connection) =>
				(await getConnection(connection.id)) ? connection : null,
			))).filter((connection): connection is NonNullable<typeof connection> => connection !== null)
			: [];
		const hasSavedAccount = Boolean(saved && (saved.installationIds.length > 0 || savedConnections.length > 0));
		return (
			<div className="page-shell">
				<main className="signin-screen">
					<h1>Sign in to create a link</h1>
					{sp.error && <p className="signin-error">{String(sp.error)}</p>}
					{sp.needs_install && (
						<p className="signin-note">
							You're signed in but the app isn't installed on any repos yet.
							Install it and pick the repos to share.
						</p>
					)}
					{hasSavedAccount && saved ? (
						<SignInChoice
							login={saved.login}
							connections={savedConnections.map((connection) => ({
								id: connection.id,
								label: `${connection.forge} · ${connection.host.replace(/^https?:\/\//, "")} · ${connection.login}`,
							}))}
							installationCount={saved.installationIds.length}
							installUrl={installUrl}
						/>
					) : (
						<>
							<ForgePicker />
							{installUrl && (
								<a className="signin-alt" href={installUrl}>
									Or install the app on your repositories
								</a>
							)}
						</>
					)}
				</main>
				<SiteFooter />
			</div>
		);
	}

	interface DashRepo {
		installationId?: number;
		connectionId?: string;
		forge: string;
		host: string;
		owner: string;
		name: string;
		fullName: string;
		private: boolean;
	}
	let repos: DashRepo[] = [];
	// One entry per connected account, so a slow or broken forge shows as an error on its own row instead of taking the whole dashboard down.
	const connections = session.connections.map((c) => ({
		...c,
		error: false,
	}));
	let loadError: string | null = null;
	try {
		const lists = await Promise.all([
			...session.installationIds.map(async (id) =>
				(await listInstallationRepos(id)).map(
					(r): DashRepo => ({
						installationId: id,
						forge: "github",
						host: "github.com",
						owner: r.owner,
						name: r.name,
						fullName: r.fullName,
						private: r.private,
					}),
				),
			),
			...connections.map(async (c): Promise<DashRepo[]> => {
				try {
					const adapter = await adapterForConnection(c.id);
					if (!adapter) throw new Error("gone");
					return (await adapter.listRepos()).map((r) => ({
						connectionId: c.id,
						forge: c.forge,
						host: c.host,
						owner: r.owner,
						name: r.name,
						fullName: r.fullName,
						private: r.private,
					}));
				} catch {
					c.error = true;
					return [];
				}
			}),
		]);
		// Deduplicated per forge: the same owner/name on two forges is two different repositories.
		const seen = new Set<string>();
		repos = lists.flat().filter((r) => {
			const k = `${r.forge}:${r.fullName}`.toLowerCase();
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		});
	} catch (e) {
		loadError = e instanceof Error ? e.message : "Failed to load repositories";
	}

	let shares: {
		id: string;
		forge?: string;
		owner: string;
		repo: string;
		createdAt?: number;
		expiresAt?: number;
		ref?: string;
		showBranches?: boolean;
		allowDownload?: boolean;
		showReleases?: boolean;
		installationId?: number;
		connectionId?: string;
		portfolioId?: string;
	}[] = [];
	try {
		const all = await listSharesForOwner({
			installationIds: session.installationIds,
			connectionIds: session.connections.map((c) => c.id),
		});
		shares = all.map((s) => ({
			id: s.id,
			forge: s.forge ?? "github",
			owner: s.owner,
			repo: s.repo,
			createdAt: s.createdAt,
			expiresAt: s.expiresAt,
			ref: s.ref,
			showBranches: s.showBranches,
			allowDownload: s.allowDownload,
			showReleases: s.showReleases,
			// Which account owns the share. The portfolio editor needs it, because a
			// portfolio can only hold one account's repositories.
			installationId: s.installationId,
			connectionId: s.connectionId,
			// Set when a portfolio created the link; it then lives and dies with it.
			portfolioId: s.portfolioId,
		}));
	} catch {
		// Non-fatal.
	}

	let portfolios: {
		id: string;
		title?: string;
		description?: string;
		shareIds: string[];
		label: string;
		installationId?: number;
		connectionId?: string;
		imageUrl?: string | null;
		expiresAt?: number | null;
	}[] = [];
	try {
		const all = await listPortfoliosForOwner({
			installationIds: session.installationIds,
			connectionIds: session.connections.map((c) => c.id),
		});
		// A portfolio may still list shares that have since expired or been
		// revoked. Showing only live ones means the editor never offers to keep a
		// dead entry, and saving drops them for good.
		const live = new Set(shares.map((s) => s.id));
		portfolios = all.map((p) => ({
			id: p.id,
			title: p.title,
			description: p.description,
			shareIds: p.shareIds.filter((id) => live.has(id)),
			label: p.label,
			installationId: p.installationId,
			connectionId: p.connectionId,
			imageUrl: p.imageVersion
				? portfolioImagePath(p.id, p.imageVersion)
				: null,
			expiresAt: p.expiresAt ?? null,
		}));
	} catch {
		// Non-fatal: the dashboard works without the portfolio section's data.
	}

	if (loadError) {
		return (
			<div className="page-shell">
				<main className="signin-screen">
					<h1>Couldn't load repositories</h1>
					<p className="signin-error">{loadError}</p>
					<SignOutControl className="btn btn--ghost btn--sm" label="Sign out" />
				</main>
				<SiteFooter />
			</div>
		);
	}

	return (
		<DashboardClient
			repos={repos}
			shares={shares}
			portfolios={portfolios}
			login={session.login}
			connections={connections}
			repositoryInstallUrl={APP_SLUG ? `https://github.com/apps/${APP_SLUG}/installations/new` : null}
		/>
	);
}
