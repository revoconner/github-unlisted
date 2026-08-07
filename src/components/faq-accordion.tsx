"use client";

import * as React from "react";

const ITEMS: { q: string; a: React.ReactNode }[] = [
	{
		q: "How is it free?",
		a: "I already pay for Vercel for my own personal website. I also needed a solution to share private GitHub repositories online, hence this was created. I incur no extra cost hosting this, other than the domain name — which I am more than happy to bear.",
	},
	{
		q: "How do you plan to monetize it?",
		a: "I don't. It's a solution I built for my own use. It's not a business.",
	},
	{
		q: "Can you see the private repos I share?",
		a: "Honest answer: technically I could. Like any GitHub App (the same as Vercel, CodeRabbit, and others), the server holds the app key and fetches your repo from GitHub to display it, so the content passes through the server in plain form. There is no end-to-end encryption that would make this impossible. What protects you: the app is read-only and limited to the repos you choose, you can revoke it instantly in GitHub (it stops working immediately), nothing from your repo is ever stored (it is streamed live per request), share links carry no credentials and can be set to expire, and the whole project is open source so the behaviour is auditable. I do not read your repositories, but you are trusting that, the same as installing any third-party GitHub App.",
	},
	{
		q: "How long does a shared link last for?",
		a: "However long you wish to share it for. You can set an expiration duration, or set it to never expire.",
	},
	{
		q: "Do you track me or use analytics?",
		a: "I use Vercel Web Analytics to see aggregate page views and where traffic comes from — purely so I know whether anyone is actually using this. It is cookieless, does not assign you a persistent identifier, and does not follow you across other sites. There is no third-party advertising or cross-site tracking on the site.",
	},
	{
		q: "How do I uninstall the app?",
		a: (
			<>
				Uninstalling is done from GitHub, not from this site. Go to{" "}
				<a
					href="https://github.com/settings/installations"
					target="_blank"
					rel="noopener"
				>
					github.com/settings/installations
				</a>{" "}
				(or, for an organization, your org's Settings → Third-party Access →
				GitHub Apps), find <em>Unlisted Repo</em>, click{" "}
				<strong>Configure</strong>, scroll to the <em>Danger Zone</em>, and
				choose <strong>Uninstall</strong>. The app loses access immediately, any
				active share links stop working, and the associated share records are
				purged. If you also want to remove the OAuth authorization, revoke it
				under{" "}
				<a
					href="https://github.com/settings/apps/authorizations"
					target="_blank"
					rel="noopener"
				>
					Authorized GitHub Apps
				</a>
				.
			</>
		),
	},
	{
		q: "What other projects have you made?",
		a: (
			<>
				You can read about all of my work on my website{" "}
				<a href="https://www.revoconner.com" target="_blank" rel="noopener">
					www.revoconner.com
				</a>
				.
			</>
		),
	},
];

export function FaqAccordion() {
	// A set, not a single index: opening one answer must not collapse
	// another. Collapsing a sibling moves the page under the pointer
	// between mousedown and mouseup, so the release lands somewhere the
	// user never aimed at.
	const [open, setOpen] = React.useState<Set<number>>(() => new Set([0]));
	const toggle = (i: number) =>
		setOpen((prev) => {
			const next = new Set(prev);
			if (!next.delete(i)) next.add(i);
			return next;
		});

	return (
		<ul className="faq-list">
			{ITEMS.map((item, i) => {
				const isOpen = open.has(i);
				const qId = `q-${i + 1}`;
				const aId = `a-${i + 1}`;
				return (
					<li className="faq-item" key={item.q}>
						<button
							type="button"
							className="faq-q"
							aria-expanded={isOpen}
							aria-controls={aId}
							id={qId}
							onClick={() => toggle(i)}
						>
							<span className="faq-q__text">{item.q}</span>
							<span className="faq-q__icon" aria-hidden="true">
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<polyline points="6 9 12 15 18 9" />
								</svg>
							</span>
						</button>
						<section className="faq-a" id={aId} aria-labelledby={qId}>
							<div className="faq-a__inner">
								<div className="faq-a__body">{item.a}</div>
							</div>
						</section>
					</li>
				);
			})}
		</ul>
	);
}
