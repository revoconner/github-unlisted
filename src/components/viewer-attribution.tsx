// The line recipients see on every shared surface (a repository or a
// portfolio): whose product this is, so the page reads as our chrome and not
// as part of what the owner shared.
export function ViewerAttribution({ noun = "repo" }: { noun?: string }) {
	return (
		<span className="viewer-attrib">
			Private {noun} shared using{" "}
			<a
				href="https://github-unlisted.com"
				target="_blank"
				rel="noopener noreferrer"
			>
				Github-Unlisted
			</a>{" "}
			hosted by{" "}
			<a
				href="https://revoconner.com"
				target="_blank"
				rel="noopener noreferrer"
			>
				Rév
			</a>
		</span>
	);
}
