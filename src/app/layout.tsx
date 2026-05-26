import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { JsonLd } from "@/components/json-ld";
import { SITE, siteGraphLd } from "@/lib/seo";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Instrument_Serif({
	subsets: ["latin"],
	weight: "400",
	style: ["normal", "italic"],
	variable: "--font-serif",
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
	themeColor: "#0a0b0e",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			lang="en"
			className={`${sans.variable} ${mono.variable} ${serif.variable}`}
		>
			<body>
				{children}
				<JsonLd data={siteGraphLd()} />
				<Analytics />
			</body>
		</html>
	);
}
