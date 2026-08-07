import { NAV_ITEMS, type NavActive } from "@/lib/nav";
import { StatusIcon } from "./status-icon";

// Desktop / tablet inline nav. Mirrors SiteDrawer (mobile) so the menu
// items are identical across platforms. Every item is an equal-width
// pill; the current page is the accent-filled one.
export function NavLinks({
	signedIn,
	active = null,
}: {
	signedIn: boolean;
	active?: NavActive;
}) {
	return (
		<nav className="nav-links" aria-label="Primary">
			{NAV_ITEMS.filter((item) => !item.signedInOnly || signedIn).map(
				(item) => (
					<a
						key={item.key}
						href={item.href}
						className={active === item.key ? "is-active" : undefined}
						aria-current={active === item.key ? "page" : undefined}
					>
						{item.label}
						{item.dot && <StatusIcon />}
					</a>
				),
			)}
		</nav>
	);
}
