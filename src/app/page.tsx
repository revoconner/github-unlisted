import "@/styles/global.css";
import { getImageProps } from "next/image";
import { NavLinks } from "@/components/nav-links";
import { SiteDrawer } from "@/components/site-drawer";
import { SiteFooter } from "@/components/site-footer";
import shotDesktop from "@/images/1080p.png";
import shotMobile from "@/images/mobile.png";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Art-directed hero screenshot: one <picture> that serves the phone
// capture at 480px and below and the desktop capture above it, so only
// the matching file is downloaded (two <Image>s hidden by CSS would
// fetch both).
function HeroShot() {
	const alt = "Screenshot of the Github-Unlisted app";
	const mobile = getImageProps({ alt, src: shotMobile });
	const desktop = getImageProps({ alt, src: shotDesktop, priority: true });
	return (
		<picture className="hero__shot">
			<source media="(max-width: 760px)" srcSet={mobile.props.srcSet} />
			<img {...desktop.props} alt={alt} />
		</picture>
	);
}

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
						for the recipient. You retain all control. The service is free for
						use and open source.
					</p>
				</div>

				<HeroShot />

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
					</div>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
