// Single source of truth for the site's current operational status.
// Drives two surfaces:
//   1. The colored dot next to the STATUS nav link in every header
//      (landing, FAQ, privacy, status, dashboard, mobile drawer).
//   2. The Current Status section on /status.
//
// Edit `CURRENT_STATUS` to switch states. Examples are listed above the
// constant.

export type SiteStatusType =
	| "okay"
	| "maintenance-medium"
	| "maintenance-critical"
	| "incident";

export interface SiteStatus {
	type: SiteStatusType;
	// Required for everything except "okay".
	startedUtc?: string;
}

// Edit this constant to change the displayed status site-wide.
// Examples:
//   { type: "okay" }
//   { type: "maintenance-medium",   startedUtc: "2026-05-26 04:00 UTC" }
//   { type: "maintenance-critical", startedUtc: "2026-05-26 04:00 UTC" }
//   { type: "incident",             startedUtc: "2026-05-26 04:00 UTC" }
export const CURRENT_STATUS: SiteStatus = {
	type: "maintenance-medium",
	startedUtc: "2026-08-06 21:35 UTC",
};

// The nav indicator collapses the four status types into three buckets,
// because "incident" and "maintenance-critical" both signal the same
// thing to a visitor. Each bucket has its own GLYPH as well as its own
// colour (see <StatusIcon>), so the state survives a colour vision
// deficiency and survives sitting on the accent-filled active pill.
export type StatusIconKind = "okay" | "medium" | "critical";

export function statusIconKind(s: SiteStatus): StatusIconKind {
	switch (s.type) {
		case "okay":
			return "okay";
		case "maintenance-medium":
			return "medium";
		case "maintenance-critical":
		case "incident":
			return "critical";
	}
}

export function statusIconClass(s: SiteStatus): string {
	return `status-icon--${statusIconKind(s)}`;
}

export function statusIconAriaLabel(s: SiteStatus): string {
	return `Status: ${statusIconKind(s)}`;
}

// Pill class for the Current Status card on /status. Four distinct
// pills (one per status type) so the visible text reads correctly.
export function statusPillClass(s: SiteStatus): string {
	switch (s.type) {
		case "okay":
			return "chip--okay";
		case "maintenance-medium":
			return "chip--medium";
		case "maintenance-critical":
			return "chip--critical";
		case "incident":
			return "chip--incident";
	}
}

export function statusPillLabel(s: SiteStatus): string {
	switch (s.type) {
		case "okay":
			return "Okay";
		case "maintenance-medium":
			return "Medium";
		case "maintenance-critical":
			return "Critical";
		case "incident":
			return "Incident";
	}
}
