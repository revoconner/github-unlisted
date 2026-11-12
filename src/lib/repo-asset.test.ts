import { describe, expect, it } from "vitest";
import {
	buildRepoAssetPath,
	buildRepoAttachmentPath,
	repairRepoImages,
	rewriteGitHubAttachmentReferences,
	resolveGitHubAttachmentId,
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

describe("GitHub user attachments", () => {
	const attachmentUrl =
		"https://github.com/user-attachments/assets/ac0d2c11-b338-43b1-ac55-37394abe6427";

	it("recognizes only stable GitHub attachment URLs", () => {
		expect(resolveGitHubAttachmentId(attachmentUrl)).toBe(
			"ac0d2c11-b338-43b1-ac55-37394abe6427",
		);
		expect(
			resolveGitHubAttachmentId(
				"https://example.com/user-attachments/assets/ac0d2c11-b338-43b1-ac55-37394abe6427",
			),
		).toBeNull();
	});

	it("builds a share-scoped attachment URL", () => {
		expect(
			buildRepoAttachmentPath(
				"ac0d2c11-b338-43b1-ac55-37394abe6427",
				"README.md",
				"main",
				"share 123",
			),
		).toBe(
			"/api/attachment?asset=ac0d2c11-b338-43b1-ac55-37394abe6427&path=README.md&ref=main&s=share+123",
		);
	});

	it("rewrites HTML and Markdown image references for local rendering", () => {
		const source =
			`<img alt="image" src="${attachmentUrl}" />\n` +
			`![also image](${attachmentUrl})`;
		const result = rewriteGitHubAttachmentReferences(
			source,
			context,
			"share-123",
			"https://github-unlisted.example",
		);
		const proxy =
			"https://github-unlisted.example/api/attachment?" +
			"asset=ac0d2c11-b338-43b1-ac55-37394abe6427&path=README.md&ref=main&s=share-123";
		expect(result).toContain(`src="${proxy}"`);
		expect(result).toContain(`![also image](${proxy})`);
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

	it("rewrites GitHub user-attachment images", () => {
		const html =
			'<img src="https://github.com/user-attachments/assets/' +
			'ac0d2c11-b338-43b1-ac55-37394abe6427" alt="example">';
		expect(repairRepoImages(html, context, "share-123")).toContain(
			"/api/attachment?asset=ac0d2c11-b338-43b1-ac55-37394abe6427&path=README.md&ref=main&s=share-123",
		);
	});

	it("does not rewrite external images", () => {
		const html = '<img src="https://example.com/image.png" alt="external">';

		const repaired = repairRepoImages(html, context, "share-123");

		expect(repaired).toBe(html);
	});
});
