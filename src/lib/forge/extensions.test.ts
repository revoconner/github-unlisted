// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasForgeOperation, listForgeOperations, registerForgeOperation, runForgeOperation } from "./extensions";

describe("Forge capability extensions", () => {
	it("runs a namespaced operation with connection context and input", async () => {
		const id = "test-capability";
		registerForgeOperation("gitlab", {
			id,
			description: "Test-only extension capability",
			execute: ({ host, credentials, accessToken }, input: { value: number }) => ({
				host,
				credential: credentials.testKey,
				token: accessToken,
				result: input.value + 1,
			}),
		});
		const output = await runForgeOperation("gitlab", id, {
			host: "https://forge.example",
			connectionId: "connection-1",
			credentials: { testKey: "secret" },
			accessToken: "token",
		}, { value: 41 });
		expect(output).toEqual({ host: "https://forge.example", credential: "secret", token: "token", result: 42 });
		expect(hasForgeOperation("gitlab", id)).toBe(true);
		expect(listForgeOperations("gitlab")).toContainEqual({ id, description: "Test-only extension capability" });
	});

	it("rejects duplicate operation registration", () => {
		const operation = { id: "duplicate-capability", description: "Duplicate", execute: () => true };
		registerForgeOperation("gitea", operation);
		expect(() => registerForgeOperation("gitea", operation)).toThrow("already registered");
	});
});
