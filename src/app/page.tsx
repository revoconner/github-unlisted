import "@/styles/normal.css";
import "@/styles/normal_override.css";
import { NavLinks } from "@/components/nav-links";
import { SiteDrawer } from "@/components/site-drawer";
import { SiteFooter } from "@/components/site-footer";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Page() {
	const session = await getSession();

	return (
		<div className="page-shell">
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
					<h1 className="hero__title">Github Unlisted</h1>
					<p className="hero__sub">
						Share a private repo with a read-only link. No GitHub account needed
						for the recipient. You retain all control.
					</p>

					{/* 16:9 slot for a viewer screenshot, so an owner can see what
					    their recipient will see before installing anything. Holding
					    the ratio now keeps the layout from jumping when the real
					    image lands. */}
					<div className="hero__shot">
						<div className="hero__shot-placeholder">
							<svg
								width="28"
								height="28"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<rect x="3" y="4" width="18" height="16" rx="2" />
								<path d="M3 15l4.5-4.5 3.5 3.5 3-3L21 16" />
								<circle cx="8.5" cy="8.5" r="1.2" />
							</svg>
							<span>Viewer preview coming soon</span>
						</div>
					</div>

					<div className="hero__actions">
						{session ? (
							<a className="btn btn--primary" href="/app">
								Open your repositories
							</a>
						) : (
							<a className="btn btn--primary" href="/api/github/login">
								<svg
									width="15"
									height="15"
									viewBox="0 0 24 24"
									fill="currentColor"
									aria-hidden="true"
								>
									<path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
								</svg>
								Install on GitHub
							</a>
						)}
						<a
							className="btn btn--quiet"
							href="https://github.com/revoconner/github-unlisted"
							target="_blank"
							rel="noopener"
						>
							View source code
						</a>
					</div>
				</div>
			</main>

			<SiteFooter />
		</div>
	);
}
