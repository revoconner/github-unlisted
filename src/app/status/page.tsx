import "@/styles/marketing.css";
import { JsonLd } from "@/components/json-ld";
import { SiteDrawer } from "@/components/site-drawer";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
	title: "Status",
	description:
		"Historical status of Unlisted Repo: ongoing maintenance work and past incidents.",
	path: "/status",
});

interface Incident {
	id: string;
	startedUtc: string;
	symptoms: string;
	endedUtc: string;
}

const incidents: Incident[] = [
	{
		id: "2026-05-26-dashboard-ui",
		startedUtc: "2026-05-26 00:30 UTC",
		symptoms:
			"UI changes for the dashboard to be more user friendly and have coherent user experience.",
		endedUtc: "2026-05-26 03:57 UTC",
	},
];

export default async function StatusPage() {
	const session = await getSession();

	return (
		<div className="page-status">
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
					<a href="/faq">FAQ</a>
					<a href="/privacy">PRIVACY</a>
					<a href="/status" className="is-active" aria-current="page">
						STATUS
					</a>
				</nav>

				<a className="nav-cta" href={session ? "/app" : "/api/github/login"}>
					{session ? "Dashboard" : "Sign In"}
				</a>

				<SiteDrawer signedIn={Boolean(session)} active="status" />
			</header>

			<main className="status-content">
				<div className="status-content__inner">
					<div className="status-eyebrow">
						<span className="rule" aria-hidden="true" />
						<span className="label-accent">STATUS</span>
						<span>· Historical record</span>
					</div>

					<h1 className="status-title">Historical status</h1>

					<ul className="status-list">
						{incidents.map((inc) => {
							const ongoing = inc.endedUtc.toLowerCase() === "ongoing";
							return (
								<li key={inc.id} className="status-row">
									<div className="status-row__time">{inc.startedUtc}</div>
									<div className="status-row__symptoms">{inc.symptoms}</div>
									<div
										className={`status-row__end${ongoing ? " is-ongoing" : ""}`}
									>
										{inc.endedUtc}
									</div>
								</li>
							);
						})}
					</ul>
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
					{ name: "Status", path: "/status" },
				])}
			/>
		</div>
	);
}
