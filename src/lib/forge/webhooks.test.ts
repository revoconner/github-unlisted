// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	dispatchForgeWebhookEvent,
	hasForgeWebhookHandler,
	registerForgeWebhookHandler,
} from "./webhooks";

describe("Forge webhook dispatcher", () => {
	it("dispatches normalized events independently of provider payload formats", async () => {
		const kind = "test.dispatch";
		const received: unknown[] = [];
		registerForgeWebhookHandler(kind, async (event, forge) => {
			received.push({ event, forge });
		});

		expect(hasForgeWebhookHandler(kind)).toBe(true);
		const handled = await dispatchForgeWebhookEvent("gitea", {
			kind,
			deliveryId: "delivery-1",
			payload: { providerSpecific: true },
		});
		expect(handled).toBe(true);
		expect(received).toEqual([{
			event: { kind, deliveryId: "delivery-1", payload: { providerSpecific: true } },
			forge: "gitea",
		}]);
	});

	it("ignores normalized event kinds without a registered handler", async () => {
		expect(await dispatchForgeWebhookEvent("gitlab", { kind: "test.no-handler" })).toBe(false);
	});
});
