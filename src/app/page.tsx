import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

export default async function Page() {
	const session = await getSession();
	const installUrl = APP_SLUG
		? `https://github.com/apps/${APP_SLUG}/installations/new`
		: null;

	return (
		<main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
			<h1 className="text-4xl font-bold tracking-tight">Unlisted Repo</h1>
			<p className="text-lg text-neutral-600">
				Share a private GitHub repository as a read-only browsable link —
				without adding collaborators, and without the recipient needing a
				GitHub account. No token to paste: install the GitHub App and pick
				the repos you want to share.
			</p>

			{session ? (
				<div className="flex flex-col items-center gap-2">
					<a
						href="/app"
						className="rounded-md bg-neutral-900 px-5 py-3 font-medium text-white hover:bg-neutral-700"
					>
						Open your repositories →
					</a>
					<p className="text-xs text-neutral-500">
						Signed in as {session.login} ·{" "}
						<a href="/api/github/logout" className="underline">
							sign out
						</a>
					</p>
				</div>
			) : (
				<div className="flex flex-col items-center gap-3">
					<a
						href="/api/github/login"
						className="rounded-md bg-neutral-900 px-5 py-3 font-medium text-white hover:bg-neutral-700"
					>
						Sign in with GitHub
					</a>
					{installUrl ? (
						<a
							href={installUrl}
							className="text-sm text-neutral-600 underline"
						>
							New here? Install the app on your repositories
						</a>
					) : (
						<p className="rounded-md border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-500">
							Set <code>NEXT_PUBLIC_GITHUB_APP_SLUG</code> to enable the
							install link.
						</p>
					)}
				</div>
			)}

			<p className="text-sm text-neutral-500">
				You stay in control: revoke access anytime from GitHub settings.
			</p>
		</main>
	);
}
