import { describe, expect, it } from "vitest";
import {
	buildRepoAssetPath,
	repairRepoImages,
	resolveRepoImagePath,
} from "./repo-asset";

const context = {
	owner: "alice",
	repo: "TestUnlistedRepo",
	ref: "main",
	filePath: "README.md",
};

describe("resolveRepoImagePath", () => {
	it("resolves an image path from the repository root", () => {
		expect(resolveRepoImagePath("root_image.jpg", context)).toBe(
			"root_image.jpg",
		);
	});

	it("resolves a nested relative image path", () => {
		expect(resolveRepoImagePath("RepoFiles/images/image.png", context)).toBe(
			"RepoFiles/images/image.png",
		);
	});

	it("resolves an image path relative to the README directory", () => {
		expect(
			resolveRepoImagePath("images/image.png", {
				...context,
				filePath: "docs/README.md",
			}),
		).toBe("docs/images/image.png");
	});

	it("resolves parent-directory paths", () => {
		expect(
			resolveRepoImagePath("../image.png", {
				...context,
				filePath: "docs/README.md",
			}),
		).toBe("image.png");
	});

	it("accepts a GitHub URL for the same repository", () => {
		expect(
			resolveRepoImagePath(
				"https://github.com/alice/TestUnlistedRepo/blob/main/root_image.jpg",
				context,
			),
		).toBe("root_image.jpg");
	});

	it("accepts a raw GitHub URL for the same repository", () => {
		expect(
			resolveRepoImagePath(
				"https://raw.githubusercontent.com/alice/TestUnlistedRepo/main/root_image.jpg",
				context,
			),
		).toBe("root_image.jpg");
	});

	it("rejects an image from another repository", () => {
		expect(
			resolveRepoImagePath(
				"https://github.com/other/repo/blob/main/image.png",
				context,
			),
		).toBeNull();
	});

	it("rejects external images", () => {
		expect(
			resolveRepoImagePath("https://example.com/image.png", context),
		).toBeNull();
	});
});

describe("buildRepoAssetPath", () => {
	it("builds an asset URL with encoded parameters", () => {
		expect(
			buildRepoAssetPath("RepoFiles/images/image.png", "main", "share 123"),
		).toBe(
			"/api/asset?path=RepoFiles%2Fimages%2Fimage.png&ref=main&s=share+123",
		);
	});

	it("encodes slashes in branch names", () => {
		expect(buildRepoAssetPath("image.png", "feature/demo", "share-123")).toBe(
			"/api/asset?path=image.png&ref=feature%2Fdemo&s=share-123",
		);
	});
});

describe("repairRepoImages", () => {
	it("rewrites a relative image source to the asset endpoint", () => {
		const html = '<img src="RepoFiles/images/image.png" alt="example">';

		const repaired = repairRepoImages(html, context, "share-123");

		expect(repaired).toBe(
			'<img src="/api/asset?path=RepoFiles%2Fimages%2Fimage.png&ref=main&s=share-123" alt="example">',
		);
	});

	it("rewrites an image path relative to the README", () => {
		const html = '<img src="images/image.png" alt="example">';

		const repaired = repairRepoImages(
			html,
			{
				...context,
				filePath: "docs/README.md",
			},
			"share-123",
		);

		expect(repaired).toBe(
			'<img src="/api/asset?path=docs%2Fimages%2Fimage.png&ref=main&s=share-123" alt="example">',
		);
	});

	it("does not rewrite external images", () => {
		const html = '<img src="https://example.com/image.png" alt="external">';

		const repaired = repairRepoImages(html, context, "share-123");

		expect(repaired).toBe(html);
	});
});
