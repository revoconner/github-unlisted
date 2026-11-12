import "@/styles/global.css";
import "@/styles/dashboard.css";
import { ForgeAdmin } from "@/components/forge-admin";
import { SiteFooter } from "@/components/site-footer";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
	title: "OAuth setup",
	path: "/forge-setup",
	index: false,
});

export default function ForgeSetupPage() {
	return (
		<div className="page-shell">
			<main className="signin-screen">
				<h1>OAuth applications</h1>
				<ForgeAdmin />
			</main>
			<SiteFooter />
		</div>
	);
}
