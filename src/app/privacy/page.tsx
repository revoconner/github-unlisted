import "@/styles/marketing.css";
import { JsonLd } from "@/components/json-ld";
import { NavLinks } from "@/components/nav-links";
import { SiteDrawer } from "@/components/site-drawer";
import { breadcrumbLd, pageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
	title: "Privacy Policy",
	description:
		"How Unlisted Repo collects, processes, and retains data, the third parties involved, and your rights. The operator does not access user repository content.",
	path: "/privacy",
});

export default async function PrivacyPage() {
	const session = await getSession();

	return (
		<div className="page-legal">
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

				<NavLinks signedIn={Boolean(session)} active="privacy" />

				{session ? (
					<a className="nav-cta" href="/api/github/logout">
						Sign Out
					</a>
				) : (
					<a className="nav-cta" href="/api/github/login">
						Sign In
					</a>
				)}

				<SiteDrawer signedIn={Boolean(session)} active="privacy" />
			</header>

			<main className="legal-content">
				<div className="legal-content__inner legal">
					<h1>Privacy Policy</h1>
					<p className="legal-updated">Last updated: 22 May 2026</p>

					<p>
						This Privacy Policy explains how the Unlisted Repo service ("the
						Service", "we", "us") collects, uses, retains, and discloses
						information when you use{" "}
						<a href="https://www.github-unlisted.com">
							www.github-unlisted.com
						</a>
						. The Service is operated by Rév ("the Operator"). By using the
						Service you agree to the practices described below.
					</p>

					<h2>1. Data Controller and Contact</h2>
					<p>
						The data controller for the purposes of the EU and UK General Data
						Protection Regulation (GDPR) is the Operator. For any privacy
						enquiry, or to exercise the rights set out in this policy, contact:{" "}
						<a href="mailto:oconnerrev@gmail.com">oconnerrev@gmail.com</a>. The
						source code is publicly available at the{" "}
						<a
							href="https://github.com/revoconner/github-unlisted"
							target="_blank"
							rel="noopener"
						>
							project repository
						</a>
						.
					</p>

					<h2>2. Summary</h2>
					<p>
						The Service lets a repository owner share a private GitHub
						repository as a read-only link. The Operator does not, in the
						ordinary course of operating the Service, access the contents of
						your repositories. Repository content is retrieved from GitHub on
						demand and rendered to the viewer. It is not stored, cached, or
						logged by the Service. As with any GitHub App, the Service is
						technically capable of reading the repositories you grant it; the
						Operator does not exercise that capability, and you can revoke
						access at any time through GitHub.
					</p>

					<h2>3. Information We Collect</h2>
					<p>
						We collect the minimum information required to operate the Service:
					</p>
					<ul>
						<li>
							<strong>Account identity.</strong> When you sign in with GitHub,
							we receive your GitHub username, your numeric GitHub user
							identifier, and the list of GitHub App installations you control.
							This information is held only in a signed, HTTP-only session
							cookie stored in your browser. It is not written to any
							server-side database.
						</li>
						<li>
							<strong>Share configuration.</strong> When you create a share
							link, we store a record containing the GitHub installation
							identifier, the repository owner and name, a creation timestamp,
							and an optional expiry. Each link is identified by a random,
							opaque identifier. No repository content and no access credentials
							are stored.
						</li>
						<li>
							<strong>Authentication tokens.</strong> During sign-in, a
							short-lived GitHub user access token is used in memory only,
							solely to confirm your identity and list your installations. It is
							never persisted. Server-side installation tokens used to read
							repositories are short-lived and never sent to the browser.
						</li>
						<li>
							<strong>Repository content.</strong> Not collected. It is fetched
							live from GitHub for each request and streamed to the viewer. It
							is not stored, cached, or logged by the Service.
						</li>
						<li>
							<strong>Operational data.</strong> Our infrastructure providers
							process standard technical data (such as IP address and request
							metadata) in server logs for security, reliability, and abuse
							prevention.
						</li>
						<li>
							<strong>Aggregate analytics.</strong> We use Vercel Web Analytics
							to measure aggregate page views and traffic sources so we can
							understand overall usage of the Service. It is cookieless, does
							not assign you a persistent identifier, and does not track you
							across other sites. We do not operate any advertising or
							cross-site tracking technologies.
						</li>
					</ul>

					<h2>4. Cookies</h2>
					<p>
						The Service uses strictly necessary, first-party cookies only: a
						signed session cookie that keeps you authenticated, and a
						short-lived state cookie used to protect the sign-in flow against
						cross-site request forgery. Our analytics provider (Vercel Web
						Analytics) is cookieless, and no advertising or cross-site tracking
						cookies are used, so no cookie consent banner is required for
						non-essential cookies.
					</p>

					<h2>5. How We Use Information</h2>
					<p>Information is used exclusively to:</p>
					<ul>
						<li>
							authenticate you and identify the installations you control;
						</li>
						<li>
							create, display, and manage share links, and render the
							repositories you have chosen to share;
						</li>
						<li>enforce access controls, link expiry, and revocation; and</li>
						<li>maintain the security and integrity of the Service.</li>
					</ul>
					<p>
						We do not use your information for marketing, profiling, or
						automated decision-making, and we do not sell or share it for
						cross-context behavioural advertising.
					</p>

					<h2>6. Legal Bases for Processing (GDPR)</h2>
					<p>
						Where the GDPR applies, we rely on the performance of a contract
						(Article 6(1)(b)) to provide the Service you request, and on our
						legitimate interests (Article 6(1)(f)) in operating the Service
						securely and preventing abuse. You may object to processing based on
						legitimate interests as described in your rights below.
					</p>

					<h2>7. Disclosure and Sub-Processors</h2>
					<p>
						We do not sell your personal information and have no commercial
						interest in it. We rely on the following processors strictly to
						deliver the Service:
					</p>
					<ul>
						<li>
							<strong>GitHub</strong> as the source of repository data and
							identity (GitHub App and OAuth).
						</li>
						<li>
							<strong>Vercel</strong> for application hosting, request handling,
							and cookieless, aggregate web analytics (Vercel Web Analytics).
						</li>
						<li>
							<strong>Upstash</strong> for the key-value store that holds
							share-link records.
						</li>
					</ul>
					<p>
						Each processor maintains its own privacy and security practices. We
						may also disclose information where required by law.
					</p>

					<h2>8. Data Retention</h2>
					<ul>
						<li>
							The session cookie expires approximately seven days after sign-in,
							or sooner if you sign out.
						</li>
						<li>
							A share-link record is retained until you revoke the link, the
							link reaches the expiry you set, or the GitHub App is uninstalled
							or repository access is removed, at which point associated records
							are purged.
						</li>
						<li>Repository content is never retained.</li>
					</ul>

					<h2>9. International Transfers</h2>
					<p>
						The Service and its processors operate on infrastructure that may be
						located outside your country of residence, including the United
						States. Where personal data is transferred internationally, the
						relevant processors apply their own lawful transfer safeguards.
					</p>

					<h2>10. Your Rights</h2>
					<p>
						Subject to applicable law, you have the right to access, correct,
						delete, restrict, or object to the processing of your personal
						information, and the right to data portability. If you are a
						California resident, you have the right to know, the right to
						delete, the right to correct, the right to opt out of the sale or
						sharing of personal information (we do not sell or share it), and
						the right not to receive discriminatory treatment for exercising
						your rights.
					</p>
					<p>
						You can exercise most of these rights yourself and immediately:
						revoke a share link from your dashboard, and grant or revoke
						repository access, or uninstall the GitHub App, from your GitHub
						settings. Revocation takes effect at once. For any other request,
						contact{" "}
						<a href="mailto:oconnerrev@gmail.com">oconnerrev@gmail.com</a>.
					</p>

					<h2>11. Security</h2>
					<p>
						Access credentials are held server-side only, are short-lived, and
						are never placed in a URL or sent to the browser. Share links
						contain only an opaque identifier. Session cookies are signed and
						verified. No method of transmission or storage is completely secure,
						and we cannot guarantee absolute security.
					</p>

					<h2>12. Children</h2>
					<p>
						The Service is not directed to children and is not intended for use
						by anyone under the age required to hold a GitHub account in their
						jurisdiction. We do not knowingly collect information from children.
					</p>

					<h2>13. Changes to This Policy</h2>
					<p>
						We may update this policy from time to time. The date at the top of
						this page indicates when it was last revised. Continued use of the
						Service after changes take effect constitutes acceptance of the
						revised policy.
					</p>

					<h2>14. Contact</h2>
					<p>
						Questions about this policy or our handling of your information can
						be sent to{" "}
						<a href="mailto:oconnerrev@gmail.com">oconnerrev@gmail.com</a>, or
						raised on the{" "}
						<a
							href="https://github.com/revoconner/github-unlisted"
							target="_blank"
							rel="noopener"
						>
							project repository
						</a>
						.
					</p>
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
					{ name: "Privacy Policy", path: "/privacy" },
				])}
			/>
		</div>
	);
}
