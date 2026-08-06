import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { JsonLd } from "@/components/json-ld";
import { SITE, siteGraphLd } from "@/lib/seo";
import "./globals.css";
import "./globals_override.css";

// Both faces are variable, which is what makes --base-weight (350) render
// as a real weight rather than rounding to 400. The fallback chains live
// in globals.css, on --font-sans / --font-mono.
const sans = localFont({
	src: "../fonts/gsans.ttf",
	weight: "100 900",
	style: "normal",
	display: "swap",
	variable: "--font-gsans",
});
const mono = localFont({
	src: "../fonts/AtkinsonHyperlegibleMono-VariableFont_wght.ttf",
	weight: "200 800",
	style: "normal",
	display: "swap",
	variable: "--font-mono-atk",
});

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
	themeColor: "#0d0d0d",
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
