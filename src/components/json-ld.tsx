// Renders structured data. Place as the LAST child of its container so it
// doesn't shift :first-child / :nth-child / sibling selectors (it's inert).
export function JsonLd({ data }: { data: object }) {
	return (
		<script
			type="application/ld+json"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: serialized JSON-LD, no user input
			dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
		/>
	);
}
