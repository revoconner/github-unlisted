import "@/styles/viewer.css";
import "@/styles/portfolio.css";
import { PortfolioContent } from "@/components/portfolio-content";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

// A portfolio exposes links to private repositories: never index it.
export const metadata = pageMetadata({
	title: "Shared portfolio",
	path: "/portfolio",
	index: false,
});

// Like the repository viewer this is only a shell. The data it renders comes
// from the BotID-protected /api/portfolio/view, because a cold document load
// cannot carry a BotID challenge token.
//
// The id travels as ?p= rather than as a path segment: every /{a}/{b} path is
// a repository link owned by the [...slug] route, so a path-based portfolio
// URL could collide with a real owner/repo.
export default async function PortfolioPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const sp = await searchParams;
	const id = typeof sp.p === "string" ? sp.p : "";
	return <PortfolioContent id={id} />;
}
