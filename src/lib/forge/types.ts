import type { ForgeId, OAuthProviderId } from "./catalog";

export type { ForgeId } from "./catalog";

import type {
	Contents,
	DirEntry,
	Release,
	ReleaseAsset,
	RepoMeta,
	TreeItem,
} from "@/lib/github-repo";

// Adapters throw this for any non-success upstream answer so routes can map status codes (404/403 -> "gone", the rest -> 502) without knowing which forge produced them. The message never contains a URL or a token.
export class ForgeHttpError extends Error {
	readonly status: number;
	constructor(status: number, message?: string) {
		super(message ?? `Forge request failed: ${status}`);
		this.name = "ForgeHttpError";
		this.status = status;
	}
}

export interface ForgeCapabilities {
	releases: boolean;
	archive: boolean;
	recursiveTree: boolean;
	markdownApi: boolean;
}

export interface ForgeRepo {
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
	defaultBranch: string;
	capabilities: ForgeCapabilities;
}

export type ArchiveResponse =
	| { kind: "redirect"; url: string }
	| { kind: "stream"; response: Response };

export interface ForgeAdapter {
	readonly forge: ForgeId;
	readonly host: string;
	readonly capabilities: ForgeCapabilities;

	listRepos(): Promise<ForgeRepo[]>;
	getRepoMeta(owner: string, repo: string): Promise<RepoMeta>;
	listBranches(owner: string, repo: string): Promise<string[]>;
	getRepoTree(
		owner: string,
		repo: string,
		ref: string,
	): Promise<{ items: TreeItem[]; truncated: boolean } | null>;
	getContents(
		owner: string,
		repo: string,
		path: string,
		ref: string,
		hint?: "tree" | "blob",
	): Promise<Contents>;
	getRawFile(
		owner: string,
		repo: string,
		path: string,
		ref: string,
	): Promise<Response>;
	/** Raw GitHub user-attachment fetch; only supported for the GitHub adapter. */
	getRawAttachment?(assetId: string): Promise<Response>;
	listReleases(owner: string, repo: string): Promise<Release[]>;
	archiveResponse(
		owner: string,
		repo: string,
		ref: string,
	): Promise<ArchiveResponse>;
	releaseDownloadResponse(
		owner: string,
		repo: string,
		assetId?: number,
		tag?: string,
	): Promise<ArchiveResponse>;
	renderMarkdown?: (
		owner: string,
		repo: string,
		text: string,
	) => Promise<string | null>;
}

export interface ForgeConnectionRecord {
	forge: Exclude<ForgeId, "github">;
	host: string;
	login: string;
	userId: number;
	tokenEnc: string;
	/** Additional provider-specific secrets, encrypted independently by field name. */
	credentialsEnc?: Record<string, string>;
	authScheme?: "token" | "bearer";
	oauthProvider?: OAuthProviderId;
	oauthClientId?: string;
	oauthClientSecretEnc?: string;
	refreshTokenEnc?: string;
	tokenExpiresAt?: number;
	createdAt: number;
}

export interface ForgeConnectionInput {
	forge: Exclude<ForgeId, "github">;
	host: string;
	token: string;
	/** Additional typed-by-provider secrets, encrypted by the connection vault. */
	credentials?: Record<string, string>;
	authScheme?: "token" | "bearer";
}

export type { Contents, DirEntry, Release, ReleaseAsset, RepoMeta, TreeItem };
