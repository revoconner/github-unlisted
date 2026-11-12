/**
 * Central, data-only description of supported Forge providers.
 *
 * Keep provider-specific metadata here (labels, hosts, OAuth endpoints, API
 * authentication headers and credential declarations). Runtime behaviour stays
 * in adapters, while routes and UI consume these descriptors instead of
 * maintaining their own provider switch statements.
 */
export const FORGE_IDS = ["github", "gitlab", "gitee", "gitea", "codeberg", "forgejo", "gogs"] as const;
export type ForgeId = (typeof FORGE_IDS)[number];

export interface OAuthEndpointProfile {
	host?: string;
	authorizePath: string;
	tokenPath: string;
	userPath: string;
	scope: string;
}

export interface ForgeSecretField {
	/** Stable identifier used as an encrypted-storage key. */
	key: string;
	label: string;
	purpose: string;
	required?: boolean;
}

export interface ForgeProviderDefinition {
	/** Provider identity (can differ from its API-compatible adapter family). */
	id: string;
	label: string;
	/** Registered implementation family used to create the adapter. */
	adapterForge: ForgeId;
	deployment: "hosted" | "self-hosted" | "both";
	defaultHost?: string;
	website?: string;
	loginUrl?: string;
	api: {
		identityPath: string;
		auth: {
			tokenHeader: string;
			tokenPrefix: string;
			bearerHeader: string;
			bearerPrefix: string;
		};
		versionPath?: string;
	};
	oauth?: {
		public?: OAuthEndpointProfile;
		selfHosted?: OAuthEndpointProfile;
		selfHostedProvider?: string;
		/** Environment variable prefix for the site's shared OAuth application. */
		envPrefix?: string;
	};
	credentials?: {
		application?: readonly ForgeSecretField[];
		connection?: readonly ForgeSecretField[];
		webhook?: readonly ForgeSecretField[];
	};
	/** Named extension points may be added without changing this shared schema. */
	features: readonly string[];
}

const GITEA_API = {
	identityPath: "/api/v1/user",
	auth: {
		tokenHeader: "Authorization",
		tokenPrefix: "token ",
		bearerHeader: "Authorization",
		bearerPrefix: "Bearer ",
	},
	versionPath: "/api/v1/version",
} as const;

const GITLAB_API = {
	identityPath: "/api/v4/user",
	auth: {
		tokenHeader: "PRIVATE-TOKEN",
		tokenPrefix: "",
		bearerHeader: "Authorization",
		bearerPrefix: "Bearer ",
	},
} as const;

const GITEE_API = {
	identityPath: "/api/v5/user",
	auth: {
		tokenHeader: "Authorization",
		tokenPrefix: "Bearer ",
		bearerHeader: "Authorization",
		bearerPrefix: "Bearer ",
	},
} as const;

const GITEA_OAUTH: OAuthEndpointProfile = {
	authorizePath: "/login/oauth/authorize",
	tokenPath: "/login/oauth/access_token",
	userPath: "/api/v1/user",
	scope: "read:user read:repository",
};

const GITLAB_OAUTH: OAuthEndpointProfile = {
	authorizePath: "/oauth/authorize",
	tokenPath: "/oauth/token",
	userPath: "/api/v4/user",
	scope: "read_api",
};

const GITEE_OAUTH: OAuthEndpointProfile = {
	authorizePath: "/oauth/authorize",
	tokenPath: "/oauth/token",
	userPath: "/api/v5/user",
	scope: "projects",
};

/**
 * Single catalog for hosted providers and self-hosted API-compatible variants.
 * `adapterForge` selects the implementation family; the selected provider ID
 * remains the connection/share identity.
 */
export const FORGE_CATALOG: Record<ForgeId, ForgeProviderDefinition> = {
	github: {
		id: "github",
		label: "GitHub",
		adapterForge: "github",
		deployment: "hosted",
		defaultHost: "https://github.com",
		website: "https://github.com",
		loginUrl: "https://github.com/login",
		api: {
			identityPath: "/user",
			auth: {
				tokenHeader: "Authorization",
				tokenPrefix: "Bearer ",
				bearerHeader: "Authorization",
				bearerPrefix: "Bearer ",
			},
		},
		credentials: {
			application: [
				{ key: "appId", label: "App ID", purpose: "Identify the GitHub App", required: true },
				{ key: "appPrivateKey", label: "App private key", purpose: "Sign GitHub App JWTs", required: true },
			],
			webhook: [
				{ key: "webhookSecret", label: "Webhook secret", purpose: "Verify GitHub webhook signatures", required: true },
			],
		},
		features: ["repositories", "branches", "tree", "contents", "releases", "archives", "webhooks", "app-installations"],
	},
	gitlab: {
		id: "gitlab",
		label: "GitLab",
		adapterForge: "gitlab",
		deployment: "both",
		defaultHost: "https://gitlab.com",
		website: "https://gitlab.com",
		loginUrl: "https://gitlab.com/users/sign_in",
		api: GITLAB_API,
		oauth: {
			public: { ...GITLAB_OAUTH, host: "https://gitlab.com" },
			selfHosted: GITLAB_OAUTH,
			selfHostedProvider: "gitlab",
			envPrefix: "GITLAB",
		},
		credentials: { connection: [{ key: "accessToken", label: "Access token", purpose: "Forge API access", required: true }] },
		features: ["repositories", "branches", "tree", "contents", "releases", "archives", "oauth", "personal-access-token"],
	},
	gitee: {
		id: "gitee",
		label: "Gitee",
		adapterForge: "gitee",
		deployment: "hosted",
		defaultHost: "https://gitee.com",
		website: "https://gitee.com",
		loginUrl: "https://gitee.com/login",
		api: GITEE_API,
		oauth: {
			public: { ...GITEE_OAUTH, host: "https://gitee.com" },
			selfHosted: GITEE_OAUTH,
			selfHostedProvider: "gitee",
			envPrefix: "GITEE",
		},
		credentials: { connection: [{ key: "accessToken", label: "Access token", purpose: "Forge API access", required: true }] },
		features: ["repositories", "branches", "tree", "contents", "releases", "archives", "oauth", "personal-access-token"],
	},
	gitea: {
		id: "gitea",
		label: "Gitea",
		adapterForge: "gitea",
		deployment: "both",
		defaultHost: "https://gitea.com",
		website: "https://gitea.com",
		loginUrl: "https://gitea.com/user/login",
		api: GITEA_API,
		oauth: {
			public: { ...GITEA_OAUTH, host: "https://gitea.com" },
			selfHosted: GITEA_OAUTH,
			selfHostedProvider: "gitea",
			envPrefix: "GITEA",
		},
		credentials: { connection: [{ key: "accessToken", label: "Access token", purpose: "Forge API access", required: true }] },
		features: ["repositories", "branches", "tree", "contents", "releases", "archives", "oauth", "personal-access-token"],
	},
	codeberg: {
		id: "codeberg",
		label: "Codeberg",
		adapterForge: "gitea",
		deployment: "hosted",
		defaultHost: "https://codeberg.org",
		website: "https://codeberg.org",
		loginUrl: "https://codeberg.org/user/login",
		api: GITEA_API,
		oauth: {
			public: { ...GITEA_OAUTH, host: "https://codeberg.org" },
			selfHostedProvider: "forgejo",
			envPrefix: "CODEBERG",
		},
		credentials: { connection: [{ key: "accessToken", label: "Access token", purpose: "Forge API access", required: true }] },
		features: ["repositories", "branches", "tree", "contents", "releases", "archives", "oauth", "personal-access-token"],
	},
	forgejo: {
		id: "forgejo",
		label: "Forgejo",
		adapterForge: "gitea",
		deployment: "self-hosted",
		api: GITEA_API,
		oauth: { selfHosted: GITEA_OAUTH, selfHostedProvider: "forgejo" },
		features: ["repositories", "branches", "tree", "contents", "releases", "archives", "oauth", "personal-access-token"],
	},
	gogs: {
		id: "gogs",
		label: "Gogs",
		adapterForge: "gitea",
		deployment: "self-hosted",
		api: GITEA_API,
		oauth: { selfHosted: GITEA_OAUTH, selfHostedProvider: "gogs" },
		features: ["repositories", "branches", "tree", "contents", "oauth", "personal-access-token"],
	},
} as const satisfies Record<ForgeId, ForgeProviderDefinition>;

export const PUBLIC_OAUTH_PROVIDER_IDS = ["gitlab", "gitee", "gitea", "codeberg"] as const;
export type PublicOAuthProvider = (typeof PUBLIC_OAUTH_PROVIDER_IDS)[number];

export const SELF_HOSTED_OAUTH_PROVIDER_IDS = ["gitlab", "gitee", "gitea", "forgejo", "gogs"] as const;
export type SelfHostedOAuthProvider = (typeof SELF_HOSTED_OAUTH_PROVIDER_IDS)[number];
export type OAuthProviderId = PublicOAuthProvider | SelfHostedOAuthProvider;

export const OAUTH_APP_PROVIDER_IDS = PUBLIC_OAUTH_PROVIDER_IDS;
export type OAuthAppProviderId = (typeof OAUTH_APP_PROVIDER_IDS)[number];

export function isPublicOAuthProvider(value: unknown): value is PublicOAuthProvider {
	return typeof value === "string" && (PUBLIC_OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function isSelfHostedOAuthProvider(value: unknown): value is SelfHostedOAuthProvider {
	return typeof value === "string" && (SELF_HOSTED_OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function getForgeProviderDefinition(provider: OAuthProviderId | ForgeId): ForgeProviderDefinition {
	return FORGE_CATALOG[provider as ForgeId];
}

export function getPublicOAuthProfile(provider: PublicOAuthProvider): OAuthEndpointProfile {
	const profile = FORGE_CATALOG[provider].oauth?.public;
	if (!profile) throw new Error(`Public OAuth is not configured for ${provider}`);
	return profile;
}

export function getSelfHostedOAuthProfile(provider: SelfHostedOAuthProvider): OAuthEndpointProfile {
	const definition = getForgeProviderDefinition(provider);
	const profile = definition.oauth?.selfHosted;
	if (!profile) throw new Error(`Self-hosted OAuth is not configured for ${provider}`);
	return profile;
}

/** API profiles are projected from the catalog; adding a provider does not require another profile map. */
export const FORGE_API_PROFILES = Object.fromEntries(
	FORGE_IDS.map((id) => [id, FORGE_CATALOG[id].api]),
) as Record<ForgeId, ForgeProviderDefinition["api"]>;
