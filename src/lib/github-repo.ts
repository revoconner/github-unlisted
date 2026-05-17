import type { Octokit } from "octokit";

// Read helpers, all called server-side with an installation Octokit.

export interface RepoMeta {
	fullName: string;
	private: boolean;
	defaultBranch: string;
}

export async function getRepoMeta(
	octokit: Octokit,
	owner: string,
	repo: string,
): Promise<RepoMeta> {
	const { data } = await octokit.rest.repos.get({ owner, repo });
	return {
		fullName: data.full_name,
		private: data.private,
		defaultBranch: data.default_branch,
	};
}

export async function listBranches(
	octokit: Octokit,
	owner: string,
	repo: string,
): Promise<string[]> {
	const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
		owner,
		repo,
		per_page: 100,
	});
	return branches.map((b) => b.name);
}

export interface DirEntry {
	name: string;
	path: string;
	type: "dir" | "file";
}

export type Contents =
	| { kind: "dir"; entries: DirEntry[] }
	| {
			kind: "file";
			name: string;
			text: string | null;
			isBinary: boolean;
			size: number;
	  }
	| { kind: "notfound" };

export async function getContents(
	octokit: Octokit,
	owner: string,
	repo: string,
	path: string,
	ref: string,
): Promise<Contents> {
	try {
		const { data } = await octokit.rest.repos.getContent({
			owner,
			repo,
			path,
			ref,
		});

		if (Array.isArray(data)) {
			const entries: DirEntry[] = data
				.map((e) => ({
					name: e.name,
					path: e.path,
					type: e.type === "dir" ? ("dir" as const) : ("file" as const),
				}))
				.sort((a, b) =>
					a.type === b.type
						? a.name.localeCompare(b.name)
						: a.type === "dir"
							? -1
							: 1,
				);
			return { kind: "dir", entries };
		}

		if (data.type === "file") {
			const buf = Buffer.from(data.content ?? "", "base64");
			const isBinary = buf.includes(0);
			return {
				kind: "file",
				name: data.name,
				text: isBinary ? null : buf.toString("utf8"),
				isBinary,
				size: data.size,
			};
		}

		return { kind: "notfound" };
	} catch (e) {
		const status = (e as { status?: number }).status;
		if (status === 404) return { kind: "notfound" };
		throw e;
	}
}
