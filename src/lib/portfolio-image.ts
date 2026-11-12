// Validation of the picture shown next to a portfolio's title. Pure and
// dependency-free so it can be tested without a network or an image library.
//
// The type is decided from the bytes, never from a file extension or a
// Content-Type header: both are chosen by whoever supplies the file.
// SVG is deliberately NOT accepted: it is a document that can carry script.

export type PortfolioImageType = "image/png" | "image/jpeg" | "image/webp";

// The picture is drawn at roughly 44px. Anything near these caps is already
// far more than needed; they exist to bound Redis usage and, via the pixel cap,
// to stop a tiny file that decodes to an enormous bitmap in a visitor's browser.
export const MAX_IMAGE_BYTES = 300_000;
export const MAX_IMAGE_DIMENSION = 2048;

export interface DetectedImage {
	type: PortfolioImageType;
	width: number;
	height: number;
}

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) =>
	((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) =>
	b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const ascii = (b: Uint8Array, o: number, s: string) =>
	[...s].every((c, i) => b[o + i] === c.charCodeAt(0));

function png(b: Uint8Array): DetectedImage | null {
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	if (b.length < 24 || !sig.every((v, i) => b[i] === v)) return null;
	if (!ascii(b, 12, "IHDR")) return null;
	return { type: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
}

function jpeg(b: Uint8Array): DetectedImage | null {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
	let o = 2;
	while (o + 4 <= b.length) {
		if (b[o] !== 0xff) return null;
		const marker = b[o + 1];
		if (marker === 0xff) {
			o += 1; // fill byte
			continue;
		}
		// Standalone markers carry no length.
		if (
			marker === 0xd8 ||
			marker === 0x01 ||
			(marker >= 0xd0 && marker <= 0xd7)
		) {
			o += 2;
			continue;
		}
		const len = u16be(b, o + 2);
		if (len < 2) return null;
		// Start-of-frame markers hold the size (C4, C8 and CC are not frames).
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		) {
			if (o + 9 > b.length) return null;
			return {
				type: "image/jpeg",
				height: u16be(b, o + 5),
				width: u16be(b, o + 7),
			};
		}
		o += 2 + len;
	}
	return null;
}

function webp(b: Uint8Array): DetectedImage | null {
	if (b.length < 30 || !ascii(b, 0, "RIFF") || !ascii(b, 8, "WEBP"))
		return null;
	if (ascii(b, 12, "VP8 ")) {
		return {
			type: "image/webp",
			width: u16le(b, 26) & 0x3fff,
			height: u16le(b, 28) & 0x3fff,
		};
	}
	if (ascii(b, 12, "VP8L")) {
		if (b[20] !== 0x2f) return null;
		return {
			type: "image/webp",
			width: 1 + (b[21] | ((b[22] & 0x3f) << 8)),
			height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)),
		};
	}
	if (ascii(b, 12, "VP8X")) {
		return {
			type: "image/webp",
			width: 1 + u24le(b, 24),
			height: 1 + u24le(b, 27),
		};
	}
	return null;
}

// Returns the image's type and size, or an error to show the owner. Rejection
// reasons are specific on purpose: "unsupported" alone sends people hunting.
export function inspectImage(
	bytes: Uint8Array,
): { image: DetectedImage } | { error: string } {
	if (bytes.length === 0) return { error: "The image is empty" };
	if (bytes.length > MAX_IMAGE_BYTES) {
		return {
			error: `The image is larger than ${Math.round(MAX_IMAGE_BYTES / 1000)} KB`,
		};
	}
	const image = png(bytes) ?? jpeg(bytes) ?? webp(bytes);
	if (!image) return { error: "Only PNG, JPEG and WebP images are supported" };
	if (image.width < 1 || image.height < 1) {
		return { error: "The image has no readable size" };
	}
	if (image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION) {
		return {
			error: `The image is larger than ${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION} pixels`,
		};
	}
	return { image };
}

// Where the public page loads it from. ?v changes whenever the image does, so
// a browser never keeps showing the old one.
export function portfolioImagePath(id: string, version: number): string {
	return `/api/portfolio/image?p=${encodeURIComponent(id)}&v=${version}`;
}
