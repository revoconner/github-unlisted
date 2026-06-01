// Shared primary-nav item list. Both the desktop nav (NavLinks) and the
// mobile drawer (SiteDrawer) render from this single array so the menu
// items stay identical across platforms. Order here is the render order:
// Home first, Dashboard second (signed-in only), then the static pages.

export type NavKey = "home" | "dashboard" | "faq" | "privacy" | "status";
export type NavActive = NavKey | null;

export interface NavItem {
	key: NavKey;
	label: string;
	href: string;
	// Only render when a session exists (the owner is signed in).
	signedInOnly?: boolean;
	// Render the operational-status indicator dot after the label.
	dot?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
	{ key: "home", label: "Home", href: "/" },
	{ key: "dashboard", label: "Dashboard", href: "/app", signedInOnly: true },
	{ key: "faq", label: "FAQ", href: "/faq" },
	{ key: "privacy", label: "Privacy", href: "/privacy" },
	{ key: "status", label: "Status", href: "/status", dot: true },
];
