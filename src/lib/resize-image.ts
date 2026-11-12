// Browser-only. Turns a file the owner picked into a small square avatar.
//
// Re-encoding through a canvas does three jobs at once: it shrinks a multi-MB
// photo to a few KB, it converts formats the server does not accept (GIF, AVIF)
// into PNG/JPEG/WebP, and it drops EXIF metadata, which in a phone photo
// includes the GPS position it was taken at. The server still validates
// whatever arrives; this is a convenience, not the trust boundary.

import { MAX_IMAGE_BYTES } from "@/lib/portfolio-image";

const SIZE = 256;
// A source this large is not an avatar and would just stall the tab decoding.
const MAX_SOURCE_BYTES = 15_000_000;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
	return new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, type, quality),
	);
}

function toBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export async function resizeToAvatar(
	file: File,
): Promise<{ data: string; type: string }> {
	if (file.size > MAX_SOURCE_BYTES) throw new Error("That file is too large");
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new Error("That file could not be read as an image");
	}

	const canvas = document.createElement("canvas");
	canvas.width = SIZE;
	canvas.height = SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx)
		throw new Error("Image processing is not available in this browser");

	// Centre-crop to a square (what "cover" does), so no aspect ratio is stretched.
	const side = Math.min(bitmap.width, bitmap.height);
	ctx.drawImage(
		bitmap,
		(bitmap.width - side) / 2,
		(bitmap.height - side) / 2,
		side,
		side,
		0,
		0,
		SIZE,
		SIZE,
	);
	bitmap.close();

	// WebP keeps transparency (logos) and is small. Browsers that cannot encode
	// it silently hand back PNG, which is also fine; only if that is still too
	// big do we fall back to a lossy JPEG.
	for (const [type, quality] of [
		["image/webp", 0.9],
		["image/webp", 0.7],
		["image/jpeg", 0.85],
	] as const) {
		const blob = await toBlob(canvas, type, quality);
		if (blob && blob.size <= MAX_IMAGE_BYTES) {
			return { data: await toBase64(blob), type: blob.type };
		}
	}
	throw new Error("That image is too detailed to shrink enough");
}
