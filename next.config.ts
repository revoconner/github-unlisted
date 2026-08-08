import path from "node:path";
import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// octokit / @octokit/auth-app are ESM and server-only; don't bundle them.
	serverExternalPackages: [
		"octokit",
		"@octokit/auth-app",
		"@octokit/core",
		"shiki",
	],
	// Pin workspace root so Turbopack/Webpack don't infer it from a parent
	// lockfile (there are other repos above this directory).
	turbopack: {
		root: path.join(__dirname),
	},
};

// withBotId injects the same-origin proxy rewrites the BotID challenge script
// needs, so ad-blockers and third-party script blockers can't defeat it.
export default withBotId(nextConfig);
