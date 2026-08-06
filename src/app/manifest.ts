import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

// Colours are literal site tokens (mirror globals.css --bg / --accent).
export default function manifest(): MetadataRoute.Manifest {
	return {
		name: SITE.name,
		short_name: "Unlisted",
		description: SITE.description,
		start_url: "/",
		display: "standalone",
		background_color: "#0d0d0d",
		theme_color: "#0d0d0d",
		icons: [
			{ src: "/icon", sizes: "512x512", type: "image/png" },
			{ src: "/apple-icon", sizes: "180x180", type: "image/png" },
		],
	};
}
