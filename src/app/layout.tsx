import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { JsonLd } from "@/components/json-ld";
import { SITE, siteGraphLd } from "@/lib/seo";

// No CSS here on purpose: the root layout wraps EVERY route, and the viewer
// must stay style-isolated from the site. Each page imports its own sheet:
// global.css (site pages), global.css + dashboard.css (/app), viewer.css
// ([...slug]).

// gsans is a variable font; the full 100-900 weight range is available,
// so weights are picked freely in CSS. It replaces both the old sans
// (Geist) and serif (Instrument Serif); --font-serif aliases --font-sans
// in global.css. Mono stays Geist Mono.
const sans = localFont({
	src: "../fonts/gsans.ttf",
	variable: "--font-sans",
	weight: "100 900",
	display: "swap",
});
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
	metadataBase: new URL(SITE.url),
	title: { default: SITE.defaultTitle, template: SITE.titleTemplate },
	description: SITE.description,
	applicationName: SITE.name,
	authors: [{ name: SITE.author.name, url: SITE.author.url }],
	creator: SITE.author.name,
	alternates: { canonical: "/" },
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-image-preview": "large",
			"max-snippet": -1,
			"max-video-preview": -1,
		},
	},
	openGraph: {
		type: "website",
		siteName: SITE.name,
		locale: SITE.locale,
		title: SITE.defaultTitle,
		description: SITE.description,
		url: SITE.url,
	},
	twitter: {
		card: "summary_large_image",
		title: SITE.defaultTitle,
		description: SITE.description,
	},
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	colorScheme: "dark",
	themeColor: "#0a0b0e",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className={`${sans.variable} ${mono.variable}`}>
			<body>
				{children}
				<JsonLd data={siteGraphLd()} />
				<Analytics />
			</body>
		</html>
	);
}
