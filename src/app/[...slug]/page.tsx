import "@/styles/viewer.css";
import "@/styles/viewer_override.css";
import { ViewerContent } from "@/components/viewer-content";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

// Share links expose private repositories — never index them.
export const metadata = pageMetadata({
	title: "Shared repository",
	path: "/",
	index: false,
});

// The viewer is now a shell: the repo data it renders is fetched client-side
// from the BotID-protected /api/view endpoint. A cold document load (how share
// links are opened) can't carry a BotID challenge token, so the page itself
// stays open to everyone and the endpoint is what turns bots away — otherwise
// real recipients would be blocked on their first visit alongside the bots.
export default async function ViewPage({
	params,
	searchParams,
}: {
	params: Promise<{ slug?: string[] }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { slug = [] } = await params;
	const sp = await searchParams;
	const shareId = typeof sp.s === "string" ? sp.s : "";

	return <ViewerContent slug={slug} shareId={shareId} />;
}
