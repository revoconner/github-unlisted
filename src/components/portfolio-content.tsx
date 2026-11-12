"use client";

import Link from "next/link";
import * as React from "react";
import { ViewerAttribution } from "@/components/viewer-attribution";
import type { PortfolioCard, PortfolioPayload } from "@/lib/portfolio-data";
import { repairRepoImages } from "@/lib/repo-asset";

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function Shell({ children }: { children: React.ReactNode }) {
	return (
		<div className="page-shell viewer-shell">
			<header className="topbar">
				<ViewerAttribution noun="repositories" />
			</header>
			{children}
		</div>
	);
}

function Notice({ title, detail }: { title: string; detail?: string }) {
	return (
		<div className="viewer-shell notice-screen">
			<h1>{title}</h1>
			{detail && <p>{detail}</p>}
			<Link href="/">Home</Link>
		</div>
	);
}

// README HTML with its links and images made to work from this page. The
// browser would resolve a relative href against /portfolio, which is wrong, so
// each one is resolved against where the README really lives and then either
// sent to the repository's own viewer (carrying that repo's share id) or
// opened in a new tab.
function PreviewHtml({
	card,
	html,
	path,
}: {
	card: PortfolioCard;
	html: string;
	path: string;
}) {
	const ref = React.useRef<HTMLDivElement>(null);

	const repaired = React.useMemo(
		() =>
			repairRepoImages(
				html,
				{
					owner: card.owner,
					repo: card.repo,
					ref: card.refName,
					filePath: path,
				},
				card.shareId,
			),
		[html, card.owner, card.repo, card.refName, card.shareId, path],
	);

	// repaired is a real dependency: a new html string replaces the markup,
	// re-creating the anchors, and the rewrite has to run over the fresh DOM.
	// biome-ignore lint/correctness/useExhaustiveDependencies: repaired drives the DOM this effect mutates
	React.useEffect(() => {
		const root = ref.current;
		if (!root) return;
		const base = new URL(
			`https://portfolio.invalid/${[
				card.owner,
				card.repo,
				"blob",
				card.refName,
				path,
			]
				.join("/")
				.split("/")
				.map(encodeURIComponent)
				.join("/")}`,
		);
		for (const a of Array.from(root.querySelectorAll("a[href]"))) {
			const raw = a.getAttribute("href") ?? "";
			// An in-page anchor would scroll this page, not the README, so it is
			// dropped to plain text rather than left looking clickable.
			if (raw.startsWith("#")) {
				a.removeAttribute("href");
				continue;
			}
			let url: URL;
			try {
				url = new URL(raw, base);
			} catch {
				a.removeAttribute("href");
				continue;
			}
			if (url.origin !== base.origin) {
				a.setAttribute("target", "_blank");
				a.setAttribute("rel", "noopener noreferrer");
				continue;
			}
			url.searchParams.set("s", card.shareId);
			a.setAttribute("href", `${url.pathname}${url.search}${url.hash}`);
		}
	}, [repaired, card.owner, card.repo, card.refName, card.shareId, path]);

	return (
		<div
			ref={ref}
			className="readme"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it output with html:false and a sanitised <img>/<details> allowlist
			dangerouslySetInnerHTML={{ __html: repaired }}
		/>
	);
}

function Chevron() {
	return (
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<polyline points="9 6 15 12 9 18" />
		</svg>
	);
}

function RepoCard({ card }: { card: PortfolioCard }) {
	return (
		<article className="pf-card">
			<header className="pf-card__head">
				<Link
					className="pf-card__name"
					href={card.href}
					prefetch={false}
					title={card.fullName}
				>
					{card.repo}
				</Link>
				<span className="pf-card__ref">{card.refName}</span>
			</header>

			{/* A scrollable region has to be reachable by keyboard, so it is focusable and labelled. */}
			<section
				className="pf-card__preview"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard-focusable
				tabIndex={0}
				aria-label={`README preview of ${card.repo}`}
			>
				{card.preview ? (
					<>
						<PreviewHtml
							card={card}
							html={card.preview.html}
							path={card.preview.path}
						/>
						{card.preview.truncated && (
							<p className="pf-card__more">
								Preview shortened. Open the repository to read the rest.
							</p>
						)}
					</>
				) : (
					<p className="pf-card__empty">No README preview</p>
				)}
			</section>

			<footer className="pf-card__foot">
				<span>
					{card.publishedAt
						? `Published ${DATE.format(card.publishedAt)}`
						: "Shared repository"}
				</span>
				<Link
					className="pf-card__open"
					href={card.href}
					prefetch={false}
					aria-label={`Open ${card.fullName}`}
				>
					<Chevron />
				</Link>
			</footer>
		</article>
	);
}

// The owner's own picture when there is one, the briefcase otherwise. If the
// picture fails to load the briefcase takes over, so the heading never shows a
// broken-image glyph.
function PortfolioMark({ imageUrl }: { imageUrl: string | null }) {
	const [failed, setFailed] = React.useState(false);
	if (imageUrl && !failed) {
		return (
			<span className="pf-head__icon pf-head__icon--image">
				{/* biome-ignore lint/performance/noImgElement: a validated, same-origin avatar served by /api/portfolio/image */}
				<img src={imageUrl} alt="" onError={() => setFailed(true)} />
			</span>
		);
	}
	return (
		<span className="pf-head__icon" aria-hidden="true">
			<svg
				width="22"
				height="22"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.8"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<rect x="3" y="7" width="18" height="13" rx="2" />
				<path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
				<path d="M3 13h18" />
			</svg>
		</span>
	);
}

type FetchState =
	| { status: "loading" }
	| { status: "blocked" }
	| { status: "error" }
	| { status: "ready"; payload: PortfolioPayload };

export function PortfolioContent({ id }: { id: string }) {
	const [state, setState] = React.useState<FetchState>({ status: "loading" });

	React.useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });
		(async () => {
			try {
				const res = await fetch("/api/portfolio/view", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ id }),
				});
				if (cancelled) return;
				if (res.status === 403) {
					setState({ status: "blocked" });
					return;
				}
				if (!res.ok && res.status !== 400 && res.status !== 500) {
					setState({ status: "error" });
					return;
				}
				const payload = (await res.json()) as PortfolioPayload;
				if (!cancelled) setState({ status: "ready", payload });
			} catch {
				if (!cancelled) setState({ status: "error" });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [id]);

	// The page title is owner-controlled text, so it goes through the DOM
	// property (never markup) and only once it has been resolved.
	React.useEffect(() => {
		if (state.status === "ready" && state.payload.kind === "portfolio") {
			document.title = `${state.payload.title} — Unlisted Repo`;
		}
	}, [state]);

	if (state.status === "loading") {
		return (
			<div className="viewer-shell notice-screen">
				<h1>Loading…</h1>
			</div>
		);
	}
	if (state.status === "blocked") {
		return (
			<Notice
				title="Access blocked"
				detail="This shared portfolio is protected against automated access. If you're using a normal browser, reload the page and try again."
			/>
		);
	}
	if (state.status === "error") {
		return (
			<Notice
				title="Something went wrong"
				detail="This portfolio could not be loaded. Please try again."
			/>
		);
	}

	const { payload } = state;
	if (payload.kind === "notice") {
		return <Notice title={payload.title} detail={payload.detail} />;
	}

	return (
		<Shell>
			<main className="pf">
				<header className="pf-head">
					<PortfolioMark imageUrl={payload.imageUrl} />
					<div className="pf-head__copy">
						<h1 className="pf-head__title">{payload.title}</h1>
						<p className="pf-head__sub">Shared Repository Collection</p>
					</div>
				</header>
				{payload.description && (
					<p className="pf-desc">{payload.description}</p>
				)}
				<section className="pf-grid" aria-label="Repositories">
					{payload.cards.map((card) => (
						<RepoCard key={card.shareId} card={card} />
					))}
				</section>
			</main>
		</Shell>
	);
}
