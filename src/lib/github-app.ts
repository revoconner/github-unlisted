import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

// Server-only. Never import from client components.

function getAppCredentials() {
	const appId = process.env.GITHUB_APP_ID;
	// Env stores the PEM with literal \n; normalize back to real newlines.
	const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
	if (!appId || !privateKey) {
		throw new Error(
			"GitHub App not configured: set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY",
		);
	}
	return { appId, privateKey };
}

// App-level auth (JWT): list installations, exchange for installation tokens.
export function getAppOctokit(): Octokit {
	const { appId, privateKey } = getAppCredentials();
	return new Octokit({
		authStrategy: createAppAuth,
		auth: { appId, privateKey },
	});
}

// Installation-level auth: read the repos that installation granted.
export function getInstallationOctokit(installationId: number): Octokit {
	const { appId, privateKey } = getAppCredentials();
	return new Octokit({
		authStrategy: createAppAuth,
		auth: { appId, privateKey, installationId },
	});
}

export interface InstallationRepo {
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
	defaultBranch: string;
}

export async function listInstallationRepos(
	installationId: number,
): Promise<InstallationRepo[]> {
	const octokit = getInstallationOctokit(installationId);
	const repos = await octokit.paginate("GET /installation/repositories", {
		per_page: 100,
	});
	return repos.map((r) => ({
		owner: r.owner.login,
		name: r.name,
		fullName: r.full_name,
		private: r.private,
		defaultBranch: r.default_branch,
	}));
}
