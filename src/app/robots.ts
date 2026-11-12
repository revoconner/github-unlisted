import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: {
			userAgent: "*",
			allow: ["/", "/faq"],
			// Dashboard, API, and any share link (carries ?s=) stay out of the
			// index; the share viewer also emits per-page noindex.
			// /portfolio is a shared collection of private-repo links: same rule.
			disallow: ["/app", "/api/", "/*?s=", "/portfolio"],
		},
		sitemap: absoluteUrl("/sitemap.xml"),
		host: absoluteUrl("/"),
	};
}
