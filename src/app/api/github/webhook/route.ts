import "@/lib/forge/github-webhook";
import "@/lib/forge/share-webhook-handlers";
import { handleForgeWebhookRequest } from "@/lib/forge/webhook-route";

export async function POST(request: Request) {
	return handleForgeWebhookRequest(request, "github", {
		secretField: "webhookSecret",
		fallbackSecret: process.env.GITHUB_APP_WEBHOOK_SECRET,
	});
}
