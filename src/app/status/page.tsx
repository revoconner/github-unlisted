import "@/styles/marketing.css";
import { JsonLd } from "@/components/json-ld";
import { SiteDrawer } from "@/components/site-drawer";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/session";
import {
	CURRENT_STATUS,
	type SiteStatus,
	statusDotAriaLabel,
	statusDotClass,
	statusPillClass,
	statusPillLabel,
} from "@/lib/site-status";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
	title: "Status",
	description:
		"Operational status for Unlisted Repo: current state, a quick helpsheet, and the historical log.",
	path: "/status",
});

// Historical log entries. Each event has a start and end time, a category
// (planned maintenance vs unexpected incident), a severity (medium vs
// critical), and a body explaining what happened. Add a new entry by
// prepending to this array.
interface LogEntry {
	id: string;
	startedUtc: string;
	endedUtc: string;
	category: "maintenance" | "incident";
	severity: "medium" | "critical";
	body: string;
}

const log: LogEntry[] = [
	{
		id: "2026-05-26-dashboard-ui",
		startedUtc: "2026-05-26 00:30 UTC",
		endedUtc: "2026-05-26 03:57 UTC",
		category: "maintenance",
		severity: "medium",
		body: "UI changes for the dashboard to be more user friendly and have coherent user experience across different device types. Users on phones and tablets have experienced slight error with page navigation. Users may have had inconsistent UI experience with page refresh. Shared links were not affected.",
	},
];

// Body copy for each current-status type. Kept here (not in
// site-status.ts) because it's view-layer text rather than logic.
function currentBody(status: SiteStatus) {
	switch (status.type) {
		case "okay":
			return (
				<>
					All systems operational. If you are having trouble with something,
					please{" "}
					<a
						className="status-current-row__contact"
						href="mailto:oconnerrev@gmail.com?subject=github-unlisted-status-error"
					>
						contact
					</a>
					.
				</>
			);
		case "maintenance-medium":
			return "Maintenance going on. Some features might be affected.";
		case "maintenance-critical":
			return "Maintenance going on. Dashboard access may not work for majority of the users. Will be operational soon.";
		case "incident":
			return "An error or fault has been detected, which may result in degraded state of the app. I am looking into it.";
	}
}

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function StatusPage() {
	const session = await getSession();
	const status = CURRENT_STATUS;

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
						STATUS{" "}
						<span
							className={`status-dot ${statusDotClass(status)}`}
							role="img"
							aria-label={statusDotAriaLabel(status)}
						/>
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
						<span>· Operational health</span>
					</div>

					<h1 className="status-title">Status</h1>

					{/* Current status. The displayed row is driven by
					    CURRENT_STATUS in src/lib/site-status.ts. */}
					<section className="status-section">
						<h2>Current status</h2>
						<div className="status-card">
							<article className="status-current-row">
								<div className="status-current-row__head">
									<span className={`chip chip--md ${statusPillClass(status)}`}>
										{statusPillLabel(status)}
									</span>
									{status.startedUtc && (
										<span className="status-time">{status.startedUtc}</span>
									)}
								</div>
								<div className="status-current-row__body">
									{currentBody(status)}
								</div>
							</article>
						</div>
					</section>

					<section className="status-section">
						<h2>Quick helpsheet</h2>
						<ul className="status-helpsheet">
							<li>All times are in UTC.</li>
							<li>
								<strong>Maintenance:</strong> a planned upgrade or change by the
								developer. The developer expects the downtime. Usually these are
								shortlived.
							</li>
							<li>
								<strong>Incident:</strong> an event of degraded or errored
								state, either reported by an end user, detected by the
								developer, or reported by a third-party dependency such as
								GitHub, Vercel, Upstash, AWS. Downtime for these may be longer,
								as these are not expected.
							</li>
							<li>
								<strong>Medium / Critical:</strong> a degraded-state category.
								Medium means some parts are usable; critical usually indicates a
								total or near-total collapse of usability.
								<ul>
									<li>
										During a critical state, this page or the entire website may
										be unreachable. In that case the only indication will be a
										Historical Status Log entry once operational stability is
										restored.
									</li>
								</ul>
							</li>
							<li>
								Uptime logs are not recorded. To get operational uptime,
								subtract the duration of logged events from your calculation.
							</li>
						</ul>
					</section>

					<section className="status-section">
						<h2>Historical status log</h2>
						<div className="status-card">
							{log.map((entry) => (
								<article key={entry.id} className="status-log-row">
									<div className="status-log-row__head">
										<span className="status-time">
											{entry.startedUtc} {"—"} {entry.endedUtc}
										</span>
										<div className="status-log-row__pills">
											<span className={`chip chip--${entry.category}`}>
												{cap(entry.category)}
											</span>
											<span className={`chip chip--${entry.severity}`}>
												{cap(entry.severity)}
											</span>
										</div>
									</div>
									<div className="status-log-row__body">{entry.body}</div>
								</article>
							))}
						</div>
					</section>
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
