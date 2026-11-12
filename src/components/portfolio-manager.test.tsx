import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import {
	type ManagerRepo,
	type ManagerShare,
	type PortfolioItem,
	PortfolioManager,
	type VisibilityFilter,
} from "./portfolio-manager";

const fetchMock = vi.fn();

beforeEach(() => {
	refresh.mockClear();
	fetchMock.mockReset();
	fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
});

const share = (
	id: string,
	repo: string,
	extra: Partial<ManagerShare> = {},
): ManagerShare => ({
	id,
	owner: "me",
	repo,
	forge: "github",
	installationId: 7,
	private: true,
	...extra,
});
const repo = (name: string, extra: Partial<ManagerRepo> = {}): ManagerRepo => ({
	forge: "github",
	owner: "me",
	name,
	fullName: `me/${name}`,
	private: true,
	installationId: 7,
	...extra,
});

const baseShares = [
	share("s1", "alpha"),
	share("s2", "beta"),
	share("s3", "gamma"),
];
const baseRepos = [
	repo("alpha"),
	repo("beta"),
	repo("gamma"),
	repo("fresh"),
	repo("fresh2", { private: false }),
	repo("elsewhere", {
		owner: "other",
		fullName: "other/elsewhere",
		installationId: 8,
	}),
];
const basePortfolio: PortfolioItem = {
	id: "p1",
	title: "Work",
	shareIds: ["s1", "s2", "s3"],
	label: "me",
	installationId: 7,
};

function mount(
	opts: {
		shares?: ManagerShare[];
		repos?: ManagerRepo[];
		portfolios?: PortfolioItem[];
		visibility?: VisibilityFilter;
	} = {},
) {
	return render(
		<PortfolioManager
			login="me"
			connections={[]}
			shares={opts.shares ?? baseShares}
			repos={opts.repos ?? baseRepos}
			portfolios={opts.portfolios ?? [basePortfolio]}
			visibility={opts.visibility ?? "all"}
		/>,
	);
}

const edit = (opts: Parameters<typeof mount>[0] = {}) => {
	mount(opts);
	fireEvent.click(screen.getByRole("button", { name: "Edit" }));
};
const startNew = (opts: Parameters<typeof mount>[0] = {}) => {
	mount({ portfolios: [], ...opts });
	fireEvent.click(screen.getByRole("button", { name: "New portfolio" }));
};
const rows = () =>
	screen
		.getAllByRole("listitem")
		.map((li) => li.querySelector(".pfm-order__name")?.firstChild?.textContent);
const addMenu = () =>
	screen.getByLabelText("Add a repository") as HTMLSelectElement;
const optionTexts = () =>
	within(addMenu())
		.getAllByRole("option")
		.map((o) => o.textContent);
const choose = (text: string) => {
	const opt = within(addMenu()).getByText(text) as HTMLOptionElement;
	fireEvent.change(addMenu(), { target: { value: opt.value } });
};
const lastBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

describe("list", () => {
	it("shows the default title when the owner chose none", () => {
		mount({ portfolios: [{ ...basePortfolio, title: undefined }] });
		expect(screen.getByText("Portfolio for me")).toBeInTheDocument();
	});

	it("says when there is nothing to build a portfolio from", () => {
		mount({ shares: [], repos: [], portfolios: [] });
		expect(
			screen.getByText(/No repositories are available/),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "New portfolio" }),
		).toBeDisabled();
	});

	it("can start a portfolio even when nothing is shared yet", () => {
		mount({ shares: [], portfolios: [] });
		expect(screen.getByRole("button", { name: "New portfolio" })).toBeEnabled();
	});

	it("shows when a portfolio will be revoked", () => {
		mount({
			portfolios: [
				{ ...basePortfolio, expiresAt: new Date(2099, 0, 5, 12).getTime() },
			],
		});
		expect(screen.getByText(/revokes Jan 5, 2099/)).toBeInTheDocument();
	});
});

describe("ordering", () => {
	it("reorders with the arrow buttons", () => {
		edit();
		expect(rows()).toEqual(["me/alpha", "me/beta", "me/gamma"]);
		fireEvent.click(screen.getByRole("button", { name: "Move me/gamma up" }));
		expect(rows()).toEqual(["me/alpha", "me/gamma", "me/beta"]);
		fireEvent.click(screen.getByRole("button", { name: "Move me/alpha down" }));
		expect(rows()).toEqual(["me/gamma", "me/alpha", "me/beta"]);
		expect(screen.getByRole("status")).toHaveTextContent(
			/me\/alpha moved to position 2 of 3/,
		);
	});

	it("disables moves that would fall off either end", () => {
		edit();
		expect(
			screen.getByRole("button", { name: "Move me/alpha up" }),
		).toBeDisabled();
		expect(
			screen.getByRole("button", { name: "Move me/gamma down" }),
		).toBeDisabled();
	});

	it("reorders with drag and drop", () => {
		edit();
		const items = screen.getAllByRole("listitem");
		const dt = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
		fireEvent.dragStart(items[0], { dataTransfer: dt });
		fireEvent.dragOver(items[2], { dataTransfer: dt });
		fireEvent.drop(items[2], { dataTransfer: dt });
		expect(rows()).toEqual(["me/beta", "me/gamma", "me/alpha"]);
	});

	it("ignores drags that did not start on a row (e.g. a file dragged in)", () => {
		edit();
		const items = screen.getAllByRole("listitem");
		fireEvent.dragOver(items[1], { dataTransfer: {} });
		fireEvent.drop(items[1], { dataTransfer: {} });
		expect(rows()).toEqual(["me/alpha", "me/beta", "me/gamma"]);
	});

	it("keeps the order across existing and new repositories", async () => {
		edit();
		choose("me/fresh");
		fireEvent.click(screen.getByRole("button", { name: "Move me/fresh up" }));
		fireEvent.click(screen.getByRole("button", { name: "Move me/fresh up" }));
		expect(rows()).toEqual(["me/alpha", "me/fresh", "me/beta", "me/gamma"]);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const items = lastBody().items;
		expect(items[0]).toEqual({ shareId: "s1" });
		expect(items[1]).toMatchObject({ owner: "me", repo: "fresh" });
		expect(items[2]).toEqual({ shareId: "s2" });
	});
});

describe("adding repositories", () => {
	it("offers links that exist and repositories that do not have one yet, in separate groups", () => {
		edit({ portfolios: [{ ...basePortfolio, shareIds: ["s1"] }] });
		const shared = within(addMenu()).getByRole("group", {
			name: "Already shared",
		});
		expect(
			within(shared)
				.getAllByRole("option")
				.map((o) => o.textContent),
		).toEqual(["me/beta", "me/gamma"]);
		const fresh = within(addMenu()).getByRole("group", {
			name: /Not shared yet/,
		});
		expect(
			within(fresh)
				.getAllByRole("option")
				.map((o) => o.textContent),
		).toEqual(["me/fresh", "me/fresh2"]);
	});

	it("never offers a repository that already has a link as a 'new' one", () => {
		edit({ portfolios: [{ ...basePortfolio, shareIds: ["s1"] }] });
		const fresh = within(addMenu()).getByRole("group", {
			name: /Not shared yet/,
		});
		expect(fresh).not.toHaveTextContent("me/alpha");
		expect(fresh).not.toHaveTextContent("me/beta");
	});

	it("never offers another account's repositories", () => {
		edit({ portfolios: [{ ...basePortfolio, shareIds: ["s1"] }] });
		expect(optionTexts().join()).not.toContain("elsewhere");
	});

	it("does not offer a link that another portfolio created", () => {
		edit({
			shares: [
				...baseShares,
				share("owned", "owned", { managedBy: "other-portfolio" }),
			],
			repos: [...baseRepos, repo("owned")],
			portfolios: [{ ...basePortfolio, shareIds: ["s1"] }],
		});
		expect(optionTexts().join()).not.toContain("me/owned");
	});

	it("offers a link this same portfolio created if it was taken out", () => {
		edit({
			shares: [...baseShares, share("mine", "mine", { managedBy: "p1" })],
			repos: [...baseRepos, repo("mine")],
			portfolios: [{ ...basePortfolio, shareIds: ["s1"] }],
		});
		expect(optionTexts()).toContain("me/mine");
	});

	it("marks a new repository and starts with every option off", () => {
		edit();
		choose("me/fresh");
		const row = screen.getByText("me/fresh").closest("li") as HTMLElement;
		expect(within(row).getByText("gets a new link")).toBeInTheDocument();
		for (const label of [
			"Show releases for",
			"Allow zip download for",
			"Show branches for",
		]) {
			expect(within(row).getByLabelText(`${label} me/fresh`)).not.toBeChecked();
		}
	});

	it("removes a repository and offers it again", () => {
		edit();
		fireEvent.click(
			screen.getByRole("button", { name: "Remove me/beta from the portfolio" }),
		);
		expect(rows()).toEqual(["me/alpha", "me/gamma"]);
		expect(optionTexts()).toContain("me/beta");
		choose("me/beta");
		expect(rows()).toEqual(["me/alpha", "me/gamma", "me/beta"]);
	});
});

describe("per-repository options", () => {
	it("are chosen independently for each new repository and sent with the repository", async () => {
		edit({ portfolios: [{ ...basePortfolio, shareIds: ["s1"] }] });
		choose("me/fresh");
		choose("me/fresh2");
		fireEvent.click(screen.getByLabelText("Show releases for me/fresh"));
		fireEvent.click(screen.getByLabelText("Allow zip download for me/fresh2"));
		fireEvent.click(screen.getByLabelText("Show branches for me/fresh2"));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastBody().items).toEqual([
			{ shareId: "s1" },
			{
				owner: "me",
				repo: "fresh",
				showReleases: true,
				allowDownload: false,
				showBranches: false,
			},
			{
				owner: "me",
				repo: "fresh2",
				showReleases: false,
				allowDownload: true,
				showBranches: true,
			},
		]);
	});

	it("are not offered for a link the owner made, which keeps its own settings", async () => {
		edit();
		const row = screen.getByText("me/alpha").closest("li") as HTMLElement;
		expect(
			within(row).getByText(/settings of its own link/),
		).toBeInTheDocument();
		expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		// Only the id: nothing that could change those links.
		expect(lastBody().items).toEqual([
			{ shareId: "s1" },
			{ shareId: "s2" },
			{ shareId: "s3" },
		]);
	});

	it("show the current state of a link this portfolio created, and can be changed", async () => {
		edit({
			shares: [
				share("m1", "managed", {
					managedBy: "p1",
					showReleases: true,
					allowDownload: false,
					showBranches: true,
				}),
			],
			repos: [repo("managed")],
			portfolios: [{ ...basePortfolio, shareIds: ["m1"] }],
		});
		expect(screen.getByLabelText("Show releases for me/managed")).toBeChecked();
		expect(
			screen.getByLabelText("Allow zip download for me/managed"),
		).not.toBeChecked();
		expect(screen.getByLabelText("Show branches for me/managed")).toBeChecked();
		fireEvent.click(screen.getByLabelText("Allow zip download for me/managed"));
		fireEvent.click(screen.getByLabelText("Show releases for me/managed"));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastBody().items).toEqual([
			{
				shareId: "m1",
				showReleases: false,
				allowDownload: true,
				showBranches: true,
			},
		]);
	});
});

describe("revoke date", () => {
	const dateField = () =>
		screen.getByLabelText("Revoke date") as HTMLInputElement;

	it("sends the number of seconds to the end of the chosen day when creating", async () => {
		startNew();
		choose("me/fresh");
		fireEvent.change(dateField(), { target: { value: "2099-01-01" } });
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const body = lastBody();
		expect(body.ttlSeconds).toBeGreaterThan(60 * 60 * 24 * 365 * 70);
		expect(Number.isInteger(body.ttlSeconds)).toBe(true);
	});

	it("sends an explicit null for 'never' when creating", async () => {
		startNew();
		choose("me/fresh");
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastBody()).toHaveProperty("ttlSeconds", null);
	});

	it("does not touch an existing revoke date the owner did not change", async () => {
		edit({
			portfolios: [
				{ ...basePortfolio, expiresAt: new Date(2099, 5, 1, 9, 17).getTime() },
			],
		});
		expect(dateField().value).toBe("2099-06-01");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastBody()).not.toHaveProperty("ttlSeconds");
	});

	it("sends the new date once it is changed, and null once cleared with 'Never'", async () => {
		edit({
			portfolios: [
				{ ...basePortfolio, expiresAt: new Date(2099, 5, 1).getTime() },
			],
		});
		fireEvent.change(dateField(), { target: { value: "2099-07-01" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(typeof lastBody().ttlSeconds).toBe("number");
	});

	it("clears the date with Never, which is sent as null", async () => {
		edit({
			portfolios: [
				{ ...basePortfolio, expiresAt: new Date(2099, 5, 1).getTime() },
			],
		});
		fireEvent.click(screen.getByRole("button", { name: "Never" }));
		expect(dateField().value).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastBody()).toHaveProperty("ttlSeconds", null);
	});

	it("refuses a date in the past instead of sending it (or sending 'never')", async () => {
		startNew();
		choose("me/fresh");
		fireEvent.change(dateField(), { target: { value: "2000-01-01" } });
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			/today or later/,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("saving", () => {
	it("creates with POST naming the account, and cannot save an empty list", async () => {
		startNew({
			shares: [],
			repos: [repo("fresh"), repo("fresh2", { private: false })],
		});
		expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
		choose("me/fresh2");
		choose("me/fresh");
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const init = fetchMock.mock.calls[0][1];
		expect(init.method).toBe("POST");
		expect(lastBody()).toMatchObject({ installationId: 7 });
		expect(lastBody().items.map((i: { repo: string }) => i.repo)).toEqual([
			"fresh2",
			"fresh",
		]);
	});

	it("saves title and description with PATCH", async () => {
		edit();
		fireEvent.change(screen.getByLabelText(/^Title/), {
			target: { value: "Best of" },
		});
		fireEvent.change(screen.getByLabelText(/^Description/), {
			target: { value: "Things" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
		expect(lastBody()).toMatchObject({
			id: "p1",
			title: "Best of",
			description: "Things",
		});
		await waitFor(() => expect(refresh).toHaveBeenCalled());
	});

	it("shows the server's error and stays open", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
		);
		edit();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden");
		expect(refresh).not.toHaveBeenCalled();
		expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
	});
});

describe("deleting", () => {
	it("warns that links the owner made are not revoked", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		edit();
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		expect(confirmSpy.mock.calls[0][0]).toMatch(/NOT revoked/);
		expect(fetchMock).not.toHaveBeenCalled();
		confirmSpy.mockRestore();
	});

	it("says how many links created by the portfolio will be revoked with it", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		edit({
			shares: [
				share("m1", "a", { managedBy: "p1" }),
				share("m2", "b", { managedBy: "p1" }),
				share("own", "c"),
			],
			portfolios: [{ ...basePortfolio, shareIds: ["m1", "m2", "own"] }],
		});
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		const message = confirmSpy.mock.calls[0][0] as string;
		expect(message).toMatch(
			/2 repository links created by this portfolio will be revoked/,
		);
		expect(message).toMatch(/shared yourself are NOT revoked/);
		confirmSpy.mockRestore();
	});
});

describe("picture", () => {
	const editWithPicture = (imageUrl: string | null = null) =>
		edit({ portfolios: [{ ...basePortfolio, shareIds: ["s1"], imageUrl }] });

	it("saves the portfolio first, then asks the server to import the URL", async () => {
		editWithPicture();
		fireEvent.change(screen.getByLabelText("Image URL"), {
			target: { value: "https://example.com/me.png" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Use URL" }));
		expect(screen.getByText(/downloaded when you save/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(fetchMock.mock.calls[0][0]).toBe("/api/portfolio");
		const [url, init] = fetchMock.mock.calls[1];
		expect(url).toBe("/api/portfolio/image");
		expect(JSON.parse(init.body)).toEqual({
			id: "p1",
			url: "https://example.com/me.png",
		});
		await waitFor(() => expect(refresh).toHaveBeenCalled());
	});

	it("does not touch the picture when nothing changed", async () => {
		editWithPicture("/api/portfolio/image?p=p1&v=1");
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(refresh).toHaveBeenCalled());
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("removes the picture with DELETE", async () => {
		editWithPicture("/api/portfolio/image?p=p1&v=1");
		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		const [url, init] = fetchMock.mock.calls[1];
		expect(url).toBe("/api/portfolio/image?id=p1");
		expect(init.method).toBe("DELETE");
	});

	it("closes and explains when only the picture fails, so links are never created twice", async () => {
		fetchMock
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ id: "new-id" }), { status: 200 }),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: "Could not download that URL" }), {
					status: 400,
				}),
			);
		startNew({ shares: [], repos: [repo("fresh")] });
		choose("me/fresh");
		fireEvent.change(screen.getByLabelText("Image URL"), {
			target: { value: "https://example.com/me.png" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Use URL" }));
		fireEvent.click(screen.getByRole("button", { name: "Create" }));
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent(/Saved, but the picture could not be set/);
		expect(alert).toHaveTextContent(/Could not download that URL/);
		// The editor is gone: saving it again would re-create the link.
		expect(
			screen.queryByRole("button", { name: "Create" }),
		).not.toBeInTheDocument();
		expect(refresh).toHaveBeenCalled();
	});
});

describe("visibility filter", () => {
	// alpha(private) beta(public) gamma(private) delta(public), in that order.
	const mixedShares = [
		share("a", "alpha"),
		share("b", "beta", { private: false }),
		share("c", "gamma"),
		share("d", "delta", { private: false }),
		share("u", "unknown", { private: undefined }),
	];
	const mixedRepos = [
		repo("alpha"),
		repo("beta", { private: false }),
		repo("gamma"),
		repo("delta", { private: false }),
		repo("fresh"),
		repo("fresh2", { private: false }),
	];
	const portfolio: PortfolioItem = {
		...basePortfolio,
		id: "p1",
		shareIds: ["a", "b", "c", "d"],
	};
	const open = (visibility: VisibilityFilter, p = portfolio) =>
		edit({
			shares: mixedShares,
			repos: mixedRepos,
			portfolios: [p],
			visibility,
		});

	it("lists only repositories of the chosen visibility", () => {
		open("private");
		expect(rows()).toEqual(["me/alpha", "me/gamma"]);
	});

	it("shows the other kind under Public", () => {
		open("public");
		expect(rows()).toEqual(["me/beta", "me/delta"]);
	});

	it("filters the 'not shared yet' repositories too", () => {
		open("private", { ...portfolio, shareIds: ["a"] });
		const fresh = within(addMenu()).getByRole("group", {
			name: /Not shared yet/,
		});
		expect(fresh).toHaveTextContent("me/fresh");
		expect(fresh).not.toHaveTextContent("me/fresh2");
	});

	it("filters the already-shared ones, and keeps unknown-visibility ones for All only", () => {
		open("private", { ...portfolio, shareIds: ["a"] });
		expect(optionTexts()).toContain("me/gamma");
		expect(optionTexts()).not.toContain("me/beta");
		expect(optionTexts()).not.toContain("me/unknown");
	});

	it("offers an unknown-visibility repository under All", () => {
		open("all", { ...portfolio, shareIds: ["a"] });
		expect(optionTexts()).toContain("me/unknown");
	});

	it("saves hidden repositories too, instead of silently dropping them", async () => {
		open("private");
		fireEvent.click(
			screen.getByRole("button", {
				name: "Remove me/alpha from the portfolio",
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(lastBody().items.map((i: { shareId: string }) => i.shareId)).toEqual(
			["b", "c", "d"],
		);
	});

	it("reorders visible items without disturbing where hidden ones sit", async () => {
		open("private");
		fireEvent.click(screen.getByRole("button", { name: "Move me/gamma up" }));
		expect(rows()).toEqual(["me/gamma", "me/alpha"]);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		const ids = lastBody().items.map(
			(i: { shareId: string }) => i.shareId,
		) as string[];
		expect(ids).toHaveLength(4);
		expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("a"));
		expect(ids.filter((i) => i === "b" || i === "d")).toEqual(["b", "d"]);
	});

	it("explains that some repositories are hidden and still belong to the portfolio", () => {
		open("private");
		expect(
			screen.getByText(/2 repositories are hidden by the private filter/),
		).toBeInTheDocument();
	});

	it("hides a portfolio that has nothing of the chosen visibility, and says so", () => {
		mount({
			shares: mixedShares,
			repos: mixedRepos,
			portfolios: [{ ...portfolio, shareIds: ["b", "d"] }],
			visibility: "private",
		});
		expect(
			screen.queryByRole("button", { name: "Edit" }),
		).not.toBeInTheDocument();
		expect(screen.getByText(/no private repositories/)).toBeInTheDocument();
	});

	it("counts only the matching repositories in the list, and mentions the rest", () => {
		mount({
			shares: mixedShares,
			repos: mixedRepos,
			portfolios: [portfolio],
			visibility: "private",
		});
		expect(
			screen.getByText(/2 repositories \(\+2 not private\)/),
		).toBeInTheDocument();
	});
});
