const APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

export default function Page() {
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

			{installUrl ? (
				<a
					href={installUrl}
					className="rounded-md bg-neutral-900 px-5 py-3 font-medium text-white hover:bg-neutral-700"
				>
					Install on GitHub
				</a>
			) : (
				<p className="rounded-md border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-500">
					Set <code>NEXT_PUBLIC_GITHUB_APP_SLUG</code> to your registered
					GitHub App slug to enable the install button.
				</p>
			)}

			<p className="text-sm text-neutral-500">
				You stay in control: revoke access anytime from GitHub settings.
			</p>
		</main>
	);
}
