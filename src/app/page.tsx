import "@/styles/marketing.css";
import { NavLinks } from "@/components/nav-links";
import { SiteDrawer } from "@/components/site-drawer";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
	const session = await getSession();

	return (
		<div className="page-landing">
			<div className="bloom" aria-hidden="true" />

			<header className="site-nav">
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

				<NavLinks signedIn={Boolean(session)} active="home" />

				{session ? (
					<a className="nav-cta" href="/api/github/logout">
						Sign Out
					</a>
				) : (
					<a className="nav-cta" href="/api/github/login">
						Sign In
					</a>
				)}

				<SiteDrawer signedIn={Boolean(session)} active="home" />
			</header>

			<main className="hero">
				<div className="hero__inner">
					<h1 className="hero__title">
						Share a private repo as
						<br />
						<span className="bracket-word">
							<span className="word">unlisted</span>
						</span>{" "}
						repo.
					</h1>
					<p className="hero__sub">
						Share a private repo with a read-only link. No GitHub account needed
						for the recipient. You retain all control.
					</p>
				</div>
			</main>

			<div className="hero-cta">
				<div className="hero-cta__row">
					{session ? (
						<a className="btn btn--outline-accent" href="/app">
							Open your repositories
						</a>
					) : (
						<a className="btn btn--outline-accent" href="/api/github/login">
							<svg
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="currentColor"
								aria-hidden="true"
							>
								<path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
							</svg>
							Install on GitHub
						</a>
					)}
					<span className="hero-cta__divider" aria-hidden="true" />
					<a
						className="hero-cta__label"
						href="https://github.com/revoconner/github-unlisted"
						target="_blank"
						rel="noopener"
					>
						Source code
					</a>
				</div>
				<div className="hero-cta__tagline">
					Free and open source \ no hidden cost
				</div>
			</div>

			<footer className="site-footer">
				<span>
					Built by <span className="name">Rév</span>
				</span>
				<a href="https://www.revoconner.com" target="_blank" rel="noopener">
					Visit <span className="url">www.revoconner.com</span>
					<svg
						width="11"
						height="11"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M7 17L17 7" />
						<polyline points="7 7 17 7 17 17" />
					</svg>
				</a>
			</footer>
		</div>
	);
}
