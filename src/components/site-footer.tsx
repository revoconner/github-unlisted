import { ContactButton } from "./contact-button";

// Shared site footer (every page). The Contact button opens the contact
// modal (client); the visit link stays static. Server-neutral so it can be
// used in both server pages and the client dashboard.
export function SiteFooter() {
	return (
		<footer className="site-footer">
			<ContactButton />
			<a href="https://www.revoconner.com" target="_blank" rel="noopener">
				Visit <span className="url">www.revoconner.com</span>
				<svg
					width="11"
					height="11"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M7 17L17 7" />
					<polyline points="7 7 17 7 17 17" />
				</svg>
			</a>
		</footer>
	);
}
