import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
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
	title: "Unlisted Repo — share a private GitHub repo by link",
	description:
		"Share a private GitHub repository as a read-only browsable link without adding collaborators. Install the GitHub App and pick your repos.",
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
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
			<body>{children}</body>
		</html>
	);
}
