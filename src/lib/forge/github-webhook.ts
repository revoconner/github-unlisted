import crypto from "node:crypto";
import { registerForgeWebhookAdapter, type ForgeWebhookAdapter } from "./webhooks";

const githubWebhookAdapter: ForgeWebhookAdapter = {
	verify({ headers, rawBody, secret }) {
		const signature = headers.get("x-hub-signature-256") ?? "";
		if (!/^sha256=[0-9a-f]{64}$/i.test(signature)) return false;
		const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
		const providedBytes = Buffer.from(signature);
		const expectedBytes = Buffer.from(expected);
		return providedBytes.length === expectedBytes.length && crypto.timingSafeEqual(providedBytes, expectedBytes);
	},
	parse({ headers, rawBody }) {
		const payload = JSON.parse(rawBody) as {
			action?: unknown;
			installation?: { id?: unknown };
			repositories_removed?: { full_name?: unknown }[];
		};
		const eventName = headers.get("x-github-event") ?? "";
		const deliveryId = headers.get("x-github-delivery") ?? undefined;
		const rawInstallationId = payload.installation?.id;
		const installationId = typeof rawInstallationId === "number" && Number.isSafeInteger(rawInstallationId) && rawInstallationId > 0
			? rawInstallationId
			: undefined;

		if (
			eventName === "installation" &&
			(payload.action === "deleted" || payload.action === "suspend") &&
			installationId
		) {
			return { kind: "installation.revoked", installationId, deliveryId, payload };
		}

		if (eventName === "installation_repositories" && payload.action === "removed" && installationId) {
			const repositories = (payload.repositories_removed ?? [])
				.map((repository) => repository.full_name)
				.filter((name): name is string => typeof name === "string" && name.length > 0);
			return { kind: "repositories.removed", installationId, repositories, deliveryId, payload };
		}
		return null;
	},
};

registerForgeWebhookAdapter("github", githubWebhookAdapter);
