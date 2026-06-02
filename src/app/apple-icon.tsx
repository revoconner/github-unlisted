import { ImageResponse } from "next/og";
import { ACCENT } from "@/lib/brand";

// Apple touch icon: same mark, opaque, square (Apple applies its own mask).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
	const bars = [
		{ d: -27, o: 1 },
		{ d: 0, o: 0.5 },
		{ d: 27, o: 0.22 },
	];
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "#0a0b0e",
				position: "relative",
			}}
		>
			{bars.map((b) => (
				<div
					key={b.d}
					style={{
						position: "absolute",
						width: 22,
						height: 165,
						borderRadius: 11,
						background: ACCENT,
						opacity: b.o,
						transform: `translate(${b.d}px, ${b.d}px) rotate(-45deg)`,
					}}
				/>
			))}
		</div>,
		{ ...size },
	);
}
