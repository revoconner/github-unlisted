import { ImageResponse } from "next/og";

// Brand mark: the wordmark's three fading diagonal slashes on the app bg.
// Shapes only — no text, so Satori needs no font.
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

function Mark({ radius }: { radius: number }) {
	const bars = [
		{ d: -78, o: 1 },
		{ d: 0, o: 0.5 },
		{ d: 78, o: 0.22 },
	];
	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				background: "#0a0b0e",
				borderRadius: radius,
				position: "relative",
			}}
		>
			{bars.map((b) => (
				<div
					key={b.d}
					style={{
						position: "absolute",
						width: 64,
						height: 470,
						borderRadius: 32,
						background: "#ff38ae",
						opacity: b.o,
						transform: `translate(${b.d}px, ${b.d}px) rotate(-45deg)`,
					}}
				/>
			))}
		</div>
	);
}

export default function Icon() {
	return new ImageResponse(<Mark radius={104} />, { ...size });
}
