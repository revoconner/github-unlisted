# Forge integration architecture

Provider-specific facts live in `catalog.ts`; network behaviour lives in adapter modules; authentication secrets are stored through the connection vault; optional capabilities use extension registries. The intent is that a new Forge should not require adding another provider-specific branch in every route and component.

## Main contracts

- **`catalog.ts`** — provider IDs, labels, hosted/default hosts, API identity endpoints, token-header profiles, OAuth endpoint profiles, environment prefixes, capability names, and declarative secret-field metadata. Shared selectors and OAuth validation use the catalog.
- **`types.ts` / `ForgeAdapter`** — the stable repository-facing API used by the viewer: repository list and metadata, branches, trees, contents, releases, archives and optional Markdown rendering.
- **`adapters.ts` / `registry.ts`** — adapter factories are registered once and resolved by `createForgeAdapter`. Providers that share an API family can reuse an existing adapter (Codeberg already reuses Gitea's implementation).
- **`vault.ts`** — encrypts each connection credential separately using AES-GCM and authenticated associated data tied to connection ID, Forge, host and field name. Examples include a private key, client secret, webhook secret, signing key or refresh credential.
- **`app-credentials.ts`** — equivalent encrypted storage for application-wide and webhook-scope secrets, validated against `ForgeProviderDefinition.credentials`. This avoids treating a Forge App's private key as if it were a user's access token.
- **`webhooks.ts` / `webhook-route.ts`** — provider-specific signature verification and payload parsing produce neutral event names, then a shared dispatcher calls registered handlers. `github-webhook.ts` is the current protocol adapter; the GitHub endpoint is just a thin route wrapper.
- **`extensions.ts`** — registers capabilities outside the common adapter contract (for example issue creation, pull requests, commit statuses or branch protection) without expanding the core adapter interface for every possible feature.

## Adding a Forge that follows an existing protocol

1. Add its provider ID to `FORGE_IDS` and `FORGE_CATALOG`, including the API-compatible `adapterForge`, default host, OAuth profiles, capability names and credential fields. Add it to the public/self-hosted OAuth ID list only when that login mode is supported.
2. If the API is compatible with an existing adapter, point `adapterForge` to that API family and provide provider-specific OAuth endpoints in the catalog. Otherwise implement `ForgeAdapter` in a new module.
3. Register a custom adapter in `adapters.ts`. Keep URL validation, redirect handling and secret-stripping behaviour in `safe-url.ts` / `api.ts`; do not make unguarded requests with a saved credential.
4. For standard OAuth authorization-code flows, define authorization/token/user endpoints and scopes in the catalog. Providers with non-standard token exchange or identity responses need a small provider-specific OAuth strategy rather than special cases spread across routes.
5. Add tests for URL/path validation, auth headers, identity decoding, pagination, archive responses and failure mapping. Add a webhook adapter only when that Forge supports webhooks.

## Adding a new authentication method or credential

Declare stable field names in `ForgeProviderDefinition.credentials`. Use `saveConnection({ credentials })` for user/instance-specific secrets and `saveForgeScopedCredentials(forge, "application" | "webhook", values)` for app-wide private keys, client secrets or webhook signing secrets. Read them only in server-side code via the matching getters, `ForgeContext.credentials` or `ForgeOperationContext`. Never return credentials from settings/status endpoints. A Forge that authenticates with a private key can use its own token/signing strategy while reusing the vault; the shared connection model does not assume every secret is an access token.

## Adding functionality beyond repositories

Register a namespaced operation with `registerForgeOperation(forge, { id, description, execute })`. Execute it server-side with `runConnectionForgeOperation(connectionId, operationId, input)`. This supplies the host, access token and additional decrypted credentials to the handler. Do not send that context to the browser or log it.

## Webhook implementation contract

Implement `ForgeWebhookAdapter.verify` using the provider's signature scheme and `parse` to map provider events into neutral `ForgeWebhookEvent.kind` values. Register it once with `registerForgeWebhookAdapter`, use `handleForgeWebhookRequest` in the route, and register shared/domain effects with `registerForgeWebhookHandler`. Always verify the raw body before parsing or acting on it, compare signatures in constant time where applicable, and keep webhook effects idempotent.
