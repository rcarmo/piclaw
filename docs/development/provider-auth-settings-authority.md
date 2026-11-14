# Provider authentication authority in Settings

The Settings endpoint must use the same provider-owned method inventory as `/login`. Its former merge kept static flags for every built-in provider and consulted the runtime only for extension-only providers. This hid supported OpenAI OAuth and advertised static methods even when the authoritative runtime inventory was empty or failed.

Use `getProviderDefs(registry, modelRuntime)` directly. The existing helper already handles display names, external/custom configuration and authoritative capability failure. Registry display metadata may be unavailable during refresh; it must not override runtime authentication capabilities. No provider login, model selection, credential write or network call occurs while reading Settings.

The Settings change adds four production lines and deletes ten. Remove one orphaned config import left by prewarm retirement as well: **4 lines added, 11 deleted; net seven lines removed**, no new wrapper, cache or state owner.

Regression coverage compares every current public provider with the endpoint, checks OpenAI and OpenAI Codex separately, and checks empty/failed authoritative inventories. Extension-only providers, local no-key configuration and secret-free output remain covered.

The optional browser fixtures had two obsolete composition paths: they attempted model activation through an `AgentSession` subject although production activation is native-only, and the matrix bypassed `WebChannel.admitMessage`'s committed-message recording hook. Both failed unchanged representative baseline cases. Reuse the existing native control fixture and the actual web admission composition. Supply the runtime from fixture state rather than a nonexistent property on the SDK's registry compatibility facade. No browser assertion or deadline changes.

Focused checks: 70 handler/auth/inventory/Settings tests pass, `build-ts` passes, and all ten Chromium/WebKit password, explicit activation, retry, cancellation, expiry, private-event and recording/export cases pass (514 assertions). These are synthetic disposable fixtures, not live-account acceptance. Earlier failed browser receipts remain separate.

This is part of #1458 and #1650. Full exact-candidate qualification and delivery are recorded separately; no installation, restart or live-account operation is included.
