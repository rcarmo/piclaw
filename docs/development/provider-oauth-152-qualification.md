# Additional OAuth qualification — #1458

Current SDK 1.5.2 public auth methods are exercised with synthetic responses for
Meta, xAI and Radius. The tests use denied-egress network namespaces; no real
account, cloud metadata, model inference or credential profile is used by these
provider-flow fixtures.

## Provider cases

[`provider-oauth-extra-152.test.ts`](../../runtime/test/agent-control/provider-oauth-extra-152.test.ts)
runs three mandatory namespace fixtures and two parent-namespace rejection cases.
The provider fixtures execute 40 scenarios; that is separate from the five Bun
wrapper-test count.

| Provider | Current public flow and checked behaviour |
| --- | --- |
| Meta | Device authorization, user-code event, identity-token polling and Model API key mint. Success re-mints the key through public refresh using the same identity token. Denial, malformed device/token, unsafe URI, in-flight/poll-wait cancellation, expiry and expired-session mint failure reject. No browser callback or refresh-token renewal is invented. |
| xAI | Device authorization/polling with exact client/scope/referrer, user-code event and expiry skew. Public refresh handles both rotated and omitted refresh tokens. Denial, malformed device/token, unsafe URI, poll/wait cancellation, expiry and refresh failure reject. |
| Radius | Public `radiusProvider` with an explicitly synthetic gateway: browser discovery/PKCE/state, device-code polling/backoff/cancellation and refresh. Wrong state is rejected without token exchange and does not prevent a later correct callback. Denial, token failure, malformed discovery/device, unknown selection and abort paths reject. |

Only Radius browser cases open a callback server. They require exact IPv4
127.0.0.1:1456, reject IPv6/wildcard binding, check no-store responses and verify
that the provider releases the port after every case. Requests use the public
provider entrypoints; SDK-internal files are read only for admitted-payload
fingerprints, never imported as execution entrypoints.

All new flows check exact endpoint/method/form/header shapes, cancellation,
unexpected requests and post-settlement activity. Reports contain scenario names,
counts and hashes, with synthetic token/code sentinels excluded. Existing 0.99.1
Radius fixtures and all historical receipts stay unchanged. Current source hashes
are pinned separately in `provider-oauth-152-hashes.json`; metadata alone is no
login-execution result.

## Malformed successful token responses

The current Radius public refresh accepts an HTTP200 `{}` body and returns an
OAuth object with missing access/refresh fields and a NaN expiry. The isolated
fixture records this SDK limitation separately from its passing auth scenarios;
it never persists that object or invokes inference.

Core's existing serialized `FileCredentialStore.modify` now rejects a returned
OAuth object unless access/refresh are strings and expiry is finite. The check is
before any write and outside the provider-callback retry loop. It introduces no
new credential broker or SDK patch and does not replay the callback.

Regressions exercise missing/non-numeric/non-finite fields, public Models login
and refresh, unchanged file bytes/inode/unrelated credentials, lock release and a
later valid commit. Empty strings, expired timestamps, MAX_SAFE_INTEGER,
extension metadata and API-key environment-only setup keep their existing type
semantics. Existing records are not swept, reset or migrated.

Preserving prior local bytes cannot prove that a provider did not already rotate
or revoke tokens before returning malformed data. No automatic reauthentication,
old-token restoration or external-effect rollback is supplied. The SDK method's
behaviour outside Core's credential store remains a separate limitation.

## Native Delegate credential scope

The existing actual-factory
[`native-core-delegate.test.ts`](../../qualification/native/native-core-delegate.test.ts)
retains its four keyless fresh/legacy-poisoned/approved/denied cases and adds four
credentialed variants with distinct parent/child providers and an unrelated
credential. Assertions outside provider callbacks verify the actual dispatched
provider/model/key, child-context isolation and absence of keys in committed
entries, Settings responses and model transcripts. SDK exception conversion must
not hide a swallowed callback assertion.

In approved credentialed cases, public ModelRuntime logout removes only the
synthetic child's credentials. A later parent turn still completes, but the child
provider is not entered and no parent/unrelated credential is substituted. Parent
and unrelated credentials survive; passive backend reopen neither revives the
child credential nor dispatches another model call.

This qualifies isolation and logout between turns. It does not promise atomic
revocation of an already-admitted external request or server-side revocation.

## Scope and delivery

The production change is seven lines at the existing serialized write owner.
There is no new owner, execution facade, provider proxy or schema. Removal of that
boundary check needs a qualified public SDK/store invariant covering malformed
provider credentials; a package version bump alone is insufficient.

Qualification uses the central launcher, existing filesystem isolation and
disposable literal credentials. Namespace fixtures fail before SDK imports in the
ordinary network namespace, drop capabilities/groups, clear their environment
and permit only loopback. They are bounded auth probes, not a filesystem sandbox
for arbitrary plug-ins.

Exact full/native/type/package results belong to the candidate receipt. Broader
real-account, live-server, restore/token-rotation, latency and whole-series review
acceptance remains with #1458/#1456/#1907/#1650. Source merge does not install the
credential-store change or authorise a reload.
