import { ogImage } from "@/lib/og";

export { contentType, size } from "@/lib/og";
export const alt = "FAQ — Unlisted Repo";

export default function Image() {
	return ogImage(
		"Frequently asked questions",
		"How private repo sharing, access control, and link revocation work.",
	);
}
