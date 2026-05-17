import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Unlisted Repo — share a private GitHub repo by link",
	description:
		"Share a private GitHub repository as a read-only browsable link without adding collaborators. No token to paste — install the GitHub App and pick your repos.",
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
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
