import {
	CURRENT_STATUS,
	statusIconAriaLabel,
	statusIconClass,
	statusIconKind,
} from "@/lib/site-status";

// The operational status indicator that rides the STATUS nav item.
//
// It is a SHAPE first and a colour second: a check for okay, an
// exclamation for medium, a cross for critical. Colour alone cannot be
// read by someone with a colour vision deficiency, and on the accent
// filled active pill it has even less to work with, so the glyph is what
// actually carries the meaning here.
export function StatusIcon() {
	const kind = statusIconKind(CURRENT_STATUS);

	return (
		<svg
			className={`status-icon ${statusIconClass(CURRENT_STATUS)}`}
			viewBox="0 0 16 16"
			width="14"
			height="14"
			role="img"
			aria-label={statusIconAriaLabel(CURRENT_STATUS)}
		>
			<title>{statusIconAriaLabel(CURRENT_STATUS)}</title>
			<circle cx="8" cy="8" r="7" fill="currentColor" />
			{kind === "okay" && (
				<path
					d="M4.6 8.2 7 10.6l4.4-5"
					fill="none"
					stroke="var(--accent-on)"
					strokeWidth="1.8"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
			{kind === "medium" && (
				<>
					<path
						d="M8 4.2v4.4"
						fill="none"
						stroke="var(--accent-on)"
						strokeWidth="1.8"
						strokeLinecap="round"
					/>
					<circle cx="8" cy="11.4" r="1" fill="var(--accent-on)" />
				</>
			)}
			{kind === "critical" && (
				<path
					d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2"
					fill="none"
					stroke="var(--accent-on)"
					strokeWidth="1.8"
					strokeLinecap="round"
				/>
			)}
		</svg>
	);
}
