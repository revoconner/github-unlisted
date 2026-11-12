import type { ShareTarget } from "@/lib/share-store";
import { adapterForConnection } from "./connections";
import { createGitHubAdapter } from "./github";
import type { ForgeAdapter } from "./types";

// The only place that turns a share record into the adapter that serves it, so no route needs to know which forge it is talking to. A connection whose stored forge differs from the share's is refused: the record would otherwise route one forge's token to another forge's adapter.
export async function adapterForTarget(
	target: ShareTarget,
): Promise<ForgeAdapter | null> {
	if (target.connectionId === undefined) {
		return createGitHubAdapter(target.installationId);
	}
	const adapter = await adapterForConnection(target.connectionId);
	return adapter && adapter.forge === target.forge ? adapter : null;
}
