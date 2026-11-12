import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgePicker } from "./forge-picker";

const fetchMock = vi.fn();
const assign = vi.fn();

beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
	fetchMock.mockReset();
	assign.mockReset();
	Object.defineProperty(window, "location", {
		value: { assign },
		writable: true,
		configurable: true,
	});
});
afterEach(cleanup);

describe("ForgePicker", () => {
	it("shows GitHub plus the four hosted forge buttons", () => {
		render(<ForgePicker />);
		for (const name of ["GitHub", "GitLab", "Gitee", "Gitea", "Codeberg"]) {
			expect(screen.getByRole("button", { name })).toBeInTheDocument();
		}
		expect(screen.getByLabelText("Stay signed in until")).toBeInTheDocument();
	});

	it("uses only inline SVG icons", () => {
		const { container } = render(<ForgePicker />);
		expect(container.querySelectorAll("svg").length).toBe(5);
		expect(container.querySelector("img")).toBeNull();
	});

	it("redirects hosted providers to OAuth", () => {
		render(<ForgePicker />);
		fireEvent.click(screen.getByRole("button", { name: "GitLab" }));
		expect(assign).toHaveBeenCalledTimes(1);
		expect(assign.mock.calls[0][0]).toMatch(/^\/api\/forge\/login\?provider=gitlab&expiresAt=/);
	});

	it("applies the selected calendar date as the next local midnight", () => {
		render(<ForgePicker />);
		fireEvent.change(screen.getByLabelText("Stay signed in until"), {
			target: { value: "2003-02-07" },
		});
		fireEvent.click(screen.getByRole("button", { name: "GitHub" }));
		const expected = new Date(2003, 1, 8, 0, 0, 0, 0).getTime();
		expect(assign).toHaveBeenCalledWith(`/api/github/login?expiresAt=${expected}`);
	});

	it("opens the self-hosted OAuth setup and supports Gogs", () => {
		render(<ForgePicker />);
		fireEvent.click(screen.getByRole("button", { name: "Your own self-hosted instance" }));
		expect(screen.getByLabelText("Instance domain")).toBeInTheDocument();
		expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
		expect(screen.getByLabelText("Client Secret")).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Instance type"), {
			target: { value: "gogs" },
		});
		expect(screen.getByRole("option", { name: "Gogs (OAuth2-compatible)" })).toBeInTheDocument();
		expect(screen.getByText(/First-time setup/)).toBeInTheDocument();
		expect(screen.getByText(/api\/forge\/callback/)).toBeInTheDocument();
	});

	it("starts self-hosted OAuth without putting the client secret in the URL", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ url: "https://git.example.com/login/oauth/authorize?state=x" }), {
				status: 200,
			}),
		);
		render(<ForgePicker />);
		fireEvent.click(screen.getByRole("button", { name: "Your own self-hosted instance" }));
		fireEvent.change(screen.getByLabelText("Instance domain"), {
			target: { value: "https://git.example.com" },
		});
		fireEvent.change(screen.getByLabelText("Client ID"), {
			target: { value: "client-123" },
		});
		fireEvent.change(screen.getByLabelText("Client Secret"), {
			target: { value: "super-secret" },
		});
		fireEvent.click(screen.getByRole("button", { name: /Connect & Authorize/ }));
		await waitFor(() => expect(assign).toHaveBeenCalledWith(expect.stringContaining("git.example.com")));
		const [, init] = fetchMock.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body.provider).toBe("gitea");
		expect(body.host).toBe("https://git.example.com");
		expect(body.clientId).toBe("client-123");
		expect(body.clientSecret).toBe("super-secret");
		expect(String(init.body)).not.toContain("/api/forge/login?provider=");
	});
});
