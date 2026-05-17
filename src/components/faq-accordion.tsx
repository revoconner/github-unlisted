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
		a: "Not unless you share it with me. The store is Upstash and auth is a GitHub App with GitHub OAuth — I do not have access to your data.",
	},
	{
		q: "How long does a shared link last for?",
		a: "However long you wish to share it for. You can set an expiration duration, or set it to never expire.",
	},
	{
		q: "What other projects have you made?",
		a: (
			<>
				You can read about all of my work on my website{" "}
				<a
					href="https://www.revoconner.com"
					target="_blank"
					rel="noopener"
				>
					www.revoconner.com
				</a>
				.
			</>
		),
	},
];

export function FaqAccordion() {
	const [open, setOpen] = React.useState(0);
	const total = `/0${ITEMS.length}`;

	return (
		<div className="faq-list" role="list">
			{ITEMS.map((item, i) => {
				const isOpen = open === i;
				const qId = `q-${i + 1}`;
				const aId = `a-${i + 1}`;
				return (
					<div className="faq-item" role="listitem" key={item.q}>
						<button
							type="button"
							className="faq-q"
							aria-expanded={isOpen}
							aria-controls={aId}
							id={qId}
							onClick={() => setOpen(isOpen ? -1 : i)}
						>
							<span className="faq-q__index">
								{String(i + 1).padStart(2, "0")}
								<span className="total">{total}</span>
							</span>
							<span className="faq-q__text">{item.q}</span>
							<span className="faq-q__icon" aria-hidden="true">
								<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
									<line x1="6" y1="2" x2="6" y2="10" />
									<line x1="2" y1="6" x2="10" y2="6" />
								</svg>
							</span>
						</button>
						<div
							className="faq-a"
							id={aId}
							role="region"
							aria-labelledby={qId}
						>
							<div className="faq-a__inner">
								<div className="faq-a__body">{item.a}</div>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}
