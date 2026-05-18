import { ImageResponse } from "next/og";

// Shared 1200×630 share card. Satori constraints: flexbox only, no CSS vars
// (colours hardcoded to mirror app.css tokens), default font (no custom font
// asset — Latin text only), tiny bundle.

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Slashes() {
	const bars = [
		{ d: -22, o: 1 },
		{ d: 0, o: 0.5 },
		{ d: 22, o: 0.22 },
	];
	return (
		<div
			style={{
				display: "flex",
				position: "relative",
				width: 64,
				height: 64,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			{bars.map((b) => (
				<div
					key={b.d}
					style={{
						position: "absolute",
						width: 9,
						height: 64,
						borderRadius: 5,
						background: "#ff38ae",
						opacity: b.o,
						transform: `translate(${b.d}px, ${b.d}px) rotate(-45deg)`,
					}}
				/>
			))}
		</div>
	);
}

export function ogImage(title: string, subtitle: string) {
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				padding: "76px 80px",
				background: "#0a0b0e",
				color: "#f1f2f5",
				backgroundImage:
					"radial-gradient(circle at 82% 6%, rgba(255,56,174,0.20), transparent 55%)",
			}}
		>
			<div style={{ display: "flex", alignItems: "center" }}>
				<Slashes />
				<div
					style={{
						display: "flex",
						marginLeft: 20,
						fontSize: 30,
						fontWeight: 600,
						letterSpacing: "-0.02em",
					}}
				>
					<span style={{ color: "#8f93a0" }}>github</span>
					<span style={{ color: "#ff38ae", marginLeft: 10 }}>unlisted</span>
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column" }}>
				<div
					style={{
						display: "flex",
						fontSize: 62,
						fontWeight: 700,
						lineHeight: 1.1,
						letterSpacing: "-0.03em",
						maxWidth: 920,
					}}
				>
					{title}
				</div>
				<div
					style={{
						display: "flex",
						marginTop: 24,
						fontSize: 25,
						color: "#b4b7c0",
						maxWidth: 900,
						lineHeight: 1.45,
					}}
				>
					{subtitle}
				</div>
			</div>

			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					fontSize: 22,
					color: "#777b86",
				}}
			>
				<span>www.github-unlisted.com</span>
				<span>Free · open source</span>
			</div>
		</div>,
		{ ...size },
	);
}
