# Native-only provider authentication — #1650

Provider authentication now accepts only `NativeProviderAuthContext`. Production calls already came exclusively from `AgentRuntimeFacade` with a captured, owned native lifetime. There was no production consumer for the `AgentSession` alternative.

## Removed paths

- `ProviderAuthSubject`, its discriminator and three legacy-aware runtime/binding/registry selectors.
- The unowned `runOwnedAuth` bypass and legacy exception-forwarding branch.
- The `disposeBound` state and `AgentSession.dispose` monkeypatch.
- The duplicate `ModelRegistryLike` declaration, two registry aliases and five redundant registry parameters. Metadata and refresh use the public `ModelRegistry`.

The family-mode refusal runs before native ownership or runtime access. A non-native subject receives a fixed error without opening a runtime or reading credentials. Native revocation, lifetime listeners, synchronous authority checks, provider mutation joins, private presentation, source identity, one-use activation and offline saved-credential recovery remain.

`disposedAuthSessions` is retained: explicit native revocation can occur independently of aborting the lifetime signal. It is not merely an abort cache.

## Evidence at the local checkpoint

- Two legacy-subject rejection regressions reproduce RED, then pass without runtime/disposal reads.
- 74 focused tests /438 assertions cover the handlers, isolation, custom providers, public SDK saved-credential recovery, private card composition and family-mode refusal.
- 60 authority/capability/retention tests /712 assertions pass separately, including actual native facade lifetime/protection entry and fail-closed absence.
- All ten Chromium/WebKit auth cases /514 assertions pass, including explicit activation, retry, cancellation, expiry, private events and recording/export exclusion.
- All five root type-check projects pass.

These are separate focused receipts, not a complete host/native qualification. Full exact-source qualification is still required before push.

The eighteen saved-credential recovery variants now all use the existing native authority fixture and check owned entries/settlement. No variant, deadline or credential/network/replay assertion was removed. Handler-only revocation tests assert the native boundary's exact rejection instead of expecting a legacy result object. The custom deletion-failure test checks the fixed native warning in full, rather than allowing arbitrary stderr; the configuration and credential retention assertions remain.

Synthetic state in `native-auth-fixture.ts` exercises handler identity/replacement counterexamples, not SDK execution. Actual command composition uses the existing native control fixture. Historical version-pinned auth measurements are retained as historical evidence, not claimed as current execution coverage.

## Accounting and qualification history

Relative to `8945e2c14`: production +49/−93, net −44 physical lines; net −39 nonblank. Excluding seven type-only lines, two comment-only lines and five unused formal-parameter lines leaves a conservative **−25 executable-source-line floor**. Tests, documentation, generated output and declaration cleanup earn no backend deletion credit. No previous #1875 reduction is re-credited.

The preceding full run on `8945e2c14` exposed an unrefreshed retained checksum for the Settings dispatch change, as well as an unchanged database-reopen deadline exceeded during I/O stalls. It was interrupted after these failures; it is not a full pass. Only that dispatch checksum and a provenance entry were refreshed. The 105 classifications, 37 deleted paths, financial accounting and guard assertions are unchanged.

No account, migration, installation, restart, live-data change or latency acceptance is established by these source tests.
