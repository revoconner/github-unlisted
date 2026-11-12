import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ForgePicker } from "./forge-picker";

beforeEach(() => {
	Object.defineProperty(window, "location", {
		value: { assign: () => {}, origin: "https://app.example", search: "?connect=codeberg" },
		writable: true,
		configurable: true,
	});
});
afterEach(cleanup);

describe("ForgePicker after a forge without a shared app", () => {
	it("opens the credentials form prefilled for that forge", () => {
		render(<ForgePicker />);
		expect(screen.getByLabelText("Instance domain")).toHaveValue("https://codeberg.org");
		expect(screen.getByLabelText("Instance type")).toHaveValue("forgejo");
		expect(screen.getByText(/no shared Codeberg app/)).toBeInTheDocument();
	});
});
