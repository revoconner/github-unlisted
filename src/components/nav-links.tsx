import { NAV_ITEMS, type NavActive } from "@/lib/nav";
import {
	CURRENT_STATUS,
	statusDotAriaLabel,
	statusDotClass,
} from "@/lib/site-status";

// Desktop / tablet inline nav. Mirrors SiteDrawer (mobile) so the menu
// items are identical across platforms. Labels render uppercase to match
// the existing chrome; the drawer renders the same labels in title case.
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
						{item.label.toUpperCase()}
						{item.dot && (
							<>
								{" "}
								<span
									className={`status-dot ${statusDotClass(CURRENT_STATUS)}`}
									role="img"
									aria-label={statusDotAriaLabel(CURRENT_STATUS)}
								/>
							</>
						)}
					</a>
				),
			)}
		</nav>
	);
}
