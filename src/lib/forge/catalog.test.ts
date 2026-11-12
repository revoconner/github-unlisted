// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
	FORGE_CATALOG,
	PUBLIC_OAUTH_PROVIDER_IDS,
	SELF_HOSTED_OAUTH_PROVIDER_IDS,
	getForgeProviderDefinition,
	getPublicOAuthProfile,
	getSelfHostedOAuthProfile,
	isPublicOAuthProvider,
	isSelfHostedOAuthProvider,
} from "./catalog";

describe("Forge provider catalog", () => {
	it("maps API-compatible provider variants onto one adapter", () => {
		expect(FORGE_CATALOG.codeberg.adapterForge).toBe("gitea");
		expect(FORGE_CATALOG.forgejo.adapterForge).toBe("gitea");
		expect(FORGE_CATALOG.gogs.adapterForge).toBe("gitea");
		expect(getForgeProviderDefinition("forgejo").label).toBe("Forgejo");
	});

	it("keeps hosted and self-hosted OAuth endpoint profiles declarative", () => {
		expect(getPublicOAuthProfile("gitlab")).toMatchObject({ host: "https://gitlab.com", tokenPath: "/oauth/token" });
		expect(getSelfHostedOAuthProfile("gitea")).toMatchObject({ tokenPath: "/login/oauth/access_token" });
		expect(PUBLIC_OAUTH_PROVIDER_IDS).toContain("codeberg");
		expect(SELF_HOSTED_OAUTH_PROVIDER_IDS).toContain("forgejo");
	});

	it("validates OAuth providers from the catalog", () => {
		expect(isPublicOAuthProvider("gitea")).toBe(true);
		expect(isPublicOAuthProvider("forgejo")).toBe(false);
		expect(isSelfHostedOAuthProvider("gogs")).toBe(true);
		expect(isSelfHostedOAuthProvider("gitee")).toBe(true);
	});
});
