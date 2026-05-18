import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

// Only the public pages. /app and the share viewer are private (noindex).
// No lastModified: Google distrusts always-fresh static lastmod.
export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{ url: absoluteUrl("/"), changeFrequency: "monthly", priority: 1 },
		{ url: absoluteUrl("/faq"), changeFrequency: "monthly", priority: 0.6 },
		{
			url: absoluteUrl("/privacy"),
			changeFrequency: "yearly",
			priority: 0.3,
		},
	];
}
