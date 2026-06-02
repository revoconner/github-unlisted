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
	type: "maintenance-critical",
	startedUtc: "2026-06-02 15:09 UTC",
};

// Nav dot color class. Three colors map to four status types because
// "incident" and "maintenance-critical" both signal a critical state.
export function statusDotClass(s: SiteStatus): string {
	switch (s.type) {
		case "okay":
			return "status-dot--okay";
		case "maintenance-medium":
			return "status-dot--medium";
		case "maintenance-critical":
		case "incident":
			return "status-dot--critical";
	}
}

export function statusDotAriaLabel(s: SiteStatus): string {
	switch (s.type) {
		case "okay":
			return "Status: okay";
		case "maintenance-medium":
			return "Status: medium";
		case "maintenance-critical":
		case "incident":
			return "Status: critical";
	}
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
