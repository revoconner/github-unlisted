import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// next/link → plain anchor so the tree renders without the Next runtime.
vi.mock("next/link", () => ({
	default: ({
		children,
		href,
	}: {
		children: React.ReactNode;
		href: string;
	}) => createElement("a", { href }, children),
}));

import { RepoTree } from "./repo-tree";

const items = [
	{ path: "README.md", type: "file" as const },
	{ path: "src", type: "dir" as const },
	{ path: "src/a.ts", type: "file" as const },
	{ path: "src/util", type: "dir" as const },
	{ path: "src/util/b.ts", type: "file" as const },
];

function renderTree(activePath: string) {
	return render(
		<RepoTree
			items={items}
			owner="o"
			repo="r"
			refName="main"
			shareId="s1"
			activePath={activePath}
		/>,
	);
}

describe("RepoTree", () => {
	it("shows top-level entries and keeps folders collapsed by default", () => {
		renderTree("");
		expect(screen.getByText("README.md")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "src" })).toBeInTheDocument();
		expect(screen.queryByText("a.ts")).not.toBeInTheDocument();
	});

	it("expands a folder on click", () => {
		renderTree("");
		fireEvent.click(screen.getByRole("button", { name: "src" }));
		expect(screen.getByText("a.ts")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "util" })).toBeInTheDocument();
		expect(screen.queryByText("b.ts")).not.toBeInTheDocument();
	});

	it("auto-expands ancestors of the active path and marks it current", () => {
		renderTree("src/util/b.ts");
		const file = screen.getByText("b.ts");
		expect(file).toBeInTheDocument();
		expect(file.closest(".tree__row")).toHaveAttribute(
			"aria-current",
			"true",
		);
	});

	it("filters to matching files while searching", () => {
		renderTree("");
		fireEvent.change(screen.getByPlaceholderText("Find a file"), {
			target: { value: "b.ts" },
		});
		expect(screen.getByText("src/util/b.ts")).toBeInTheDocument();
		expect(screen.queryByText("README.md")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "src" }),
		).not.toBeInTheDocument();
	});

	it("shows an empty-state when a search matches nothing", () => {
		renderTree("");
		fireEvent.change(screen.getByPlaceholderText("Find a file"), {
			target: { value: "zzz-nope" },
		});
		expect(screen.getByText("No matches.")).toBeInTheDocument();
	});
});
