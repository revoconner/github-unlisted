import { describe, expect, it } from "vitest";
import {
	inspectImage,
	MAX_IMAGE_BYTES,
	MAX_IMAGE_DIMENSION,
	portfolioImagePath,
} from "./portfolio-image";

const be32 = (n: number) => [
	(n >>> 24) & 255,
	(n >>> 16) & 255,
	(n >>> 8) & 255,
	n & 255,
];
const be16 = (n: number) => [(n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >>> 8) & 255];
const le24 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const bytes = (...parts: number[][]) => Uint8Array.from(parts.flat());

const png = (w: number, h: number) =>
	bytes(
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
		be32(13),
		ascii("IHDR"),
		be32(w),
		be32(h),
		[8, 6, 0, 0, 0],
	);

// APP0 segment first, so the walk has to skip a real segment to find the frame.
const jpeg = (w: number, h: number) =>
	bytes(
		[0xff, 0xd8],
		[0xff, 0xe0],
		be16(16),
		new Array(14).fill(0),
		[0xff, 0xc0],
		be16(17),
		[8],
		be16(h),
		be16(w),
		[3, 0, 0, 0],
	);

const webpHeader = (chunk: string): number[] => [
	...ascii("RIFF"),
	0,
	0,
	0,
	0,
	...ascii("WEBP"),
	...ascii(chunk),
	0,
	0,
	0,
	0,
];
const webpX = (w: number, h: number) =>
	bytes(webpHeader("VP8X"), [0, 0, 0, 0], le24(w - 1), le24(h - 1), [0, 0]);
const webpLossy = (w: number, h: number) =>
	bytes(
		webpHeader("VP8 "),
		[0, 0, 0],
		[0x9d, 0x01, 0x2a],
		le16(w),
		le16(h),
		[0, 0],
	);
const webpLossless = (w: number, h: number) => {
	const wm = w - 1;
	const hm = h - 1;
	return bytes(
		webpHeader("VP8L"),
		[0x2f],
		[
			wm & 255,
			((wm >> 8) & 0x3f) | ((hm & 3) << 6),
			(hm >> 2) & 255,
			(hm >> 10) & 0x0f,
		],
		[0, 0, 0, 0, 0, 0, 0, 0],
	);
};

describe("inspectImage", () => {
	it("reads PNG, JPEG and every WebP flavour from the bytes", () => {
		expect(inspectImage(png(120, 80))).toEqual({
			image: { type: "image/png", width: 120, height: 80 },
		});
		expect(inspectImage(jpeg(300, 200))).toEqual({
			image: { type: "image/jpeg", width: 300, height: 200 },
		});
		expect(inspectImage(webpX(640, 480))).toEqual({
			image: { type: "image/webp", width: 640, height: 480 },
		});
		expect(inspectImage(webpLossy(256, 256))).toEqual({
			image: { type: "image/webp", width: 256, height: 256 },
		});
		expect(inspectImage(webpLossless(500, 300))).toEqual({
			image: { type: "image/webp", width: 500, height: 300 },
		});
	});

	it("refuses SVG, HTML and GIF even when they look harmless", () => {
		const enc = (s: string) => new TextEncoder().encode(s);
		for (const body of [
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			"<!doctype html><script>alert(1)</script>",
			"GIF89a\x01\x00\x01\x00",
		]) {
			expect(inspectImage(enc(body))).toEqual({
				error: "Only PNG, JPEG and WebP images are supported",
			});
		}
	});

	it("cannot be fooled by a PNG signature followed by garbage", () => {
		const fake = bytes(
			[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
			new Array(30).fill(0x41),
		);
		expect(inspectImage(fake)).toHaveProperty("error");
	});

	it("refuses an empty or truncated file", () => {
		expect(inspectImage(new Uint8Array())).toEqual({
			error: "The image is empty",
		});
		expect(inspectImage(bytes([0xff, 0xd8, 0xff]))).toHaveProperty("error");
		expect(inspectImage(png(10, 10).slice(0, 12))).toHaveProperty("error");
	});

	it("refuses an image over the byte cap", () => {
		const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
		big.set(png(10, 10));
		expect(inspectImage(big)).toMatchObject({
			error: expect.stringContaining("KB"),
		});
	});

	it("refuses huge pixel dimensions even when the file is tiny", () => {
		const bomb = MAX_IMAGE_DIMENSION + 1;
		expect(inspectImage(png(bomb, 10))).toMatchObject({
			error: expect.stringContaining("pixels"),
		});
		expect(inspectImage(png(10, 60000))).toMatchObject({
			error: expect.stringContaining("pixels"),
		});
		expect(inspectImage(jpeg(60000, 10))).toMatchObject({
			error: expect.stringContaining("pixels"),
		});
		expect(inspectImage(webpX(16000, 16000))).toMatchObject({
			error: expect.stringContaining("pixels"),
		});
		expect(
			inspectImage(png(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION)),
		).toHaveProperty("image");
	});

	it("refuses a zero-sized image", () => {
		expect(inspectImage(png(0, 10))).toEqual({
			error: "The image has no readable size",
		});
	});
});

describe("portfolioImagePath", () => {
	it("carries the version so a changed picture busts the cache", () => {
		expect(portfolioImagePath("abc", 5)).toBe("/api/portfolio/image?p=abc&v=5");
	});
});
