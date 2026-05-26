import "@/styles/marketing.css";
import { FaqAccordion } from "@/components/faq-accordion";
import { JsonLd } from "@/components/json-ld";
import { SiteDrawer } from "@/components/site-drawer";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
	title: "FAQ",
	description:
		"Frequently asked questions about Unlisted Repo — how private repo sharing, access control, and link revocation work.",
	path: "/faq",
});

export default async function FaqPage() {
	const session = await getSession();

	return (
		<div className="page-faq">
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
								stroke="#ff38ae"
								strokeWidth="1.6"
								strokeLinecap="round"
							/>
							<line
								x1="5"
								y1="14"
								x2="14"
								y2="5"
								stroke="#ff38ae"
								strokeWidth="1.6"
								strokeLinecap="round"
								opacity="0.55"
							/>
							<line
								x1="8"
								y1="17"
								x2="17"
								y2="8"
								stroke="#ff38ae"
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

				<nav className="nav-links" aria-label="Primary">
					<a href="/faq" className="is-active" aria-current="page">
						FAQ
					</a>
					<a href="/privacy">PRIVACY</a>
					<a href="/status">STATUS</a>
				</nav>

				<a className="nav-cta" href={session ? "/app" : "/api/github/login"}>
					{session ? "Dashboard" : "Sign In"}
				</a>

				<SiteDrawer signedIn={Boolean(session)} active="faq" />
			</header>

			<main className="faq-content">
				<div className="faq-content__inner">
					<div className="faq-eyebrow">
						<span className="rule" aria-hidden="true" />
						<span className="label-accent">FAQ</span>
						<span>· Common questions</span>
					</div>

					<h1 className="faq-title">
						Questions, <em>answered.</em>
					</h1>

					<p className="faq-lede">
						A short list. If you have something else on your mind, the source is
						on GitHub.
					</p>

					<FaqAccordion />
				</div>
			</main>

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

			<JsonLd
				data={breadcrumbLd([
					{ name: "Home", path: "/" },
					{ name: "FAQ", path: "/faq" },
				])}
			/>
		</div>
	);
}
