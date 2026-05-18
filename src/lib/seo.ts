import type { Metadata } from "next";

// Single source of truth for site identity + metadata/JSON-LD builders.
// Change the domain or identity HERE only; layout, pages, sitemap, robots,
// manifest and JSON-LD all derive from this.

export const SITE = {
	url: "https://www.github-unlisted.com",
	name: "Unlisted Repo",
	// The root layout adds this suffix; pages pass the BARE title.
	titleTemplate: "%s — Unlisted Repo",
	defaultTitle: "Unlisted Repo — share a private GitHub repo by link",
	description:
		"Share a private GitHub repository as a read-only browsable link. No collaborator invites, no GitHub account needed for the recipient — you keep full control through GitHub.",
	locale: "en_US",
	author: { name: "Rév", url: "https://www.revoconner.com" },
	repo: "https://github.com/revoconner/github-unlisted",
} as const;

export function absoluteUrl(path = "/"): string {
	return new URL(path, SITE.url).toString();
}

interface PageOpts {
	title: string;
	description?: string;
	path?: string;
	// Bare title (template applied) by default; absolute skips the suffix.
	absolute?: boolean;
	// Private/auth routes set false → noindex, no canonical, no OG.
	index?: boolean;
}

export function pageMetadata({
	title,
	description = SITE.description,
	path = "/",
	absolute = false,
	index = true,
}: PageOpts): Metadata {
	if (!index) {
		return {
			title: absolute ? { absolute: title } : title,
			description,
			robots: { index: false, follow: false },
		};
	}

	const url = absoluteUrl(path);
	const ogTitle = absolute ? title : `${title} — ${SITE.name}`;
	return {
		title: absolute ? { absolute: title } : title,
		description,
		alternates: { canonical: url },
		openGraph: {
			type: "website",
			siteName: SITE.name,
			locale: SITE.locale,
			title: ogTitle,
			description,
			url,
		},
		twitter: {
			card: "summary_large_image",
			title: ogTitle,
			description,
		},
	};
}

// JSON-LD graph for the whole site (rendered once, in the root layout).
export function siteGraphLd() {
	return {
		"@context": "https://schema.org",
		"@graph": [
			{
				"@type": "WebSite",
				"@id": `${SITE.url}/#website`,
				url: SITE.url,
				name: SITE.name,
				description: SITE.description,
				publisher: { "@id": `${SITE.url}/#person` },
				inLanguage: "en",
			},
			{
				"@type": "Person",
				"@id": `${SITE.url}/#person`,
				name: SITE.author.name,
				url: SITE.author.url,
				sameAs: [SITE.author.url, SITE.repo],
			},
			{
				"@type": "SoftwareApplication",
				"@id": `${SITE.url}/#app`,
				name: SITE.name,
				url: SITE.url,
				description: SITE.description,
				applicationCategory: "DeveloperApplication",
				operatingSystem: "Web",
				offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
				author: { "@id": `${SITE.url}/#person` },
				isAccessibleForFree: true,
			},
		],
	};
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: items.map((it, i) => ({
			"@type": "ListItem",
			position: i + 1,
			name: it.name,
			item: absoluteUrl(it.path),
		})),
	};
}
