// @vitest-environment node
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import "./github-webhook";
import { getForgeWebhookAdapter } from "./webhooks";

const adapter = getForgeWebhookAdapter("github");
const secret = "test-webhook-secret";

function signature(body: string): string {
	return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("GitHub webhook adapter", () => {
	it("verifies the raw body signature and rejects altered payloads", () => {
		expect(adapter).toBeDefined();
		const rawBody = JSON.stringify({ action: "deleted", installation: { id: 42 } });
		const headers = new Headers({ "x-hub-signature-256": signature(rawBody) });
		expect(adapter?.verify({ headers, rawBody, secret })).toBe(true);
		expect(adapter?.verify({ headers, rawBody: `${rawBody} `, secret })).toBe(false);
		expect(adapter?.verify({ headers: new Headers(), rawBody, secret })).toBe(false);
	});

	it("normalizes an installation revocation event", () => {
		const rawBody = JSON.stringify({ action: "deleted", installation: { id: 42 } });
		const event = adapter?.parse({
			headers: new Headers({ "x-github-event": "installation", "x-github-delivery": "delivery-1" }),
			rawBody,
		});
		expect(event).toMatchObject({ kind: "installation.revoked", installationId: 42, deliveryId: "delivery-1" });
	});

	it("normalizes removed repositories independently from GitHub's payload shape", () => {
		const rawBody = JSON.stringify({
			action: "removed",
			installation: { id: 7 },
			repositories_removed: [{ full_name: "org/one" }, { full_name: "org/two" }, {}],
		});
		const event = adapter?.parse({ headers: new Headers({ "x-github-event": "installation_repositories" }), rawBody });
		expect(event).toMatchObject({ kind: "repositories.removed", installationId: 7, repositories: ["org/one", "org/two"] });
	});
});
