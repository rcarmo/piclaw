# Access modes

Piclaw supports **single-user deployments only**. **Family and isolated modes cannot start.** Use these preview guides for controlled testing and implementation review. Do not bypass the startup checks.

## Guides

- [Family preview user guide](user-guide.md): sign-in, accounts, messages, sessions, preferences and privacy.
- [Family preview administrator guide](administrator-guide.md): account onboarding, invitations, security, recovery, home and tool policies.
- [Troubleshooting](troubleshooting.md): safe next steps for users, administrators and operators.
- [Copy-only migration runbook](migration-copy.md) and [offline recovery runbook](operator-recovery.md): operator procedures and explicit release limits.

The development backend includes account administration, per-user TOTP, multiple passkeys, restricted invitations, administrator-assisted recovery, owned forks, ownership-checked reads and server-sent events (SSE), and authentication maintenance. The login page uses the site's public authentication policy to show the available methods. Migration-copy promotion and activation through Settings are not implemented. [#1134](https://github.com/rcarmo/piclaw/issues/1134) tracks the remaining integration.

The [HTTP inventory](../../runtime/docs/web-api-endpoint-inventory.md#family-development-routes) lists development routes; [storage](../storage.md) lists persisted records. Update user-facing guides whenever their controls change.

```json
{
  "domains": {
    "access": {
      "mode": "single-user"
    }
  }
}
```

An absent mode is equivalent to this setting on a fresh or legacy single-user store. Empty/unknown modes, malformed JSON and contradictory isolation settings cause startup failure. There is no access-mode environment variable or top-level `access` alias. Ordinary single-user authentication settings and optional unauthenticated use are unchanged.

## Planned profiles

| Profile | Workspace and skills | Authentication and execution | Availability |
|---|---|---|---|
| `single-user` | Existing workspace, skills and add-ons | Existing TOTP/WebAuthn or optional unauthenticated local access | Available |
| `family-shared` | Shared workspace and skills; personal memory selected by user | Individual accounts, owned session trees, forks and friendly renames | Disabled until the family gate |
| `isolated-containers` | Separate per-user volumes; optional read-only shared skills | Gateway authenticates and routes to dedicated backends | Disabled until the container gate |

Family mode is intended for trusted household members. Users with arbitrary shell or filesystem access can read shared files, runtime state and credentials; application capability controls do not provide filesystem confinement. Containers add process, volume and network boundaries but share a host kernel. Host administrators and deliberately shared writable volumes remain part of the trust model.

## Implementation status

| Area | Implemented and tested | Not yet complete |
|---|---|---|
| Modes and migration (#1123/#1126/#1133) | Strict config/marker checks, copy-only ownership/child/resource preparation, immutable factor preservation and proof-checked default TOTP import | Promotion/rollback, physical factor proof and remaining resource migration, activation gates |
| Accounts and factors (#1124/#1125) | Disabled account + owned home provisioning, live/recent-login admin checks, own-device/factor APIs and names, owner avatars, login-bound self TOTP enrolment and multiple passkeys | Recovery startup integration, owner-aware replacement for disabled legacy factor commands |
| Invitations/recovery (#1125) | One-use browser-bound TOTP/passkey grants, atomic enrol-and-enable, other-admin reset, offline operator grant preparation with backup/lock/audit, fragment invitation page and admin confirmation UI | Physical-device and full account browser workflows, recovery startup/listener integration |
| Sessions (#1126/#1128) | Root ownership, owner-local names, atomic forks/rename, additional roots, home selection and idle archive/restore; owned lifecycle browser controls | Merge/purge, full archive backup, process-kill recovery proof |
| HTTP and SSE (#1127) | Terminal family HTTP policy, SQL-scoped search, own-thread reads, revocable SSE, text-only persisted message admission, selected account/fork routes, separate pinned text browser shell | Uploads and remaining derived resources/mutations, direct WebSocket/transport/tool paths, legacy-origin migration and push recipients |
| Model identity/memory (#1129/#1131) | Server identity before hydration, scoped model context and owner/family memory paths; mandatory fixed family run-tool ceiling narrowed by revisioned account denials | All direct/queued/delegate/side/Dream entry points and service grants; broader role/capability profiles and shared-resource policy |
| Settings and isolation (#1130/#1132) | Own-account, owned-session lifecycle and account administration controls; revisioned personal appearance/response guidance; read-only workspace/deployment/capability panel | Container destination assignment, broader capability/preference editors, complete setting/add-on classification and per-user container gateway/deployment |
| Auth maintenance (#1125) | Transient-expiry loop and offline factor re-encryption helper | Coordinated rotation CLI/dual-key support, generic-keychain rotation, audit retention |

Passing backend tests and merged PRs do not complete these issues or allow activation. Preserve single-user compatibility until the staged integration gates pass.

## Foundation storage

The core access records in `messages.db` are:

- `users`: immutable ID, normalised username, display name, role (`admin` or `member`), enabled flag, home chat reference and timestamps;
- `access_state`: singleton activated mode and access-schema version.

Initialisation seeds `default` as the existing local administrator with home `web:default`. It does not create a chat, rename an existing root, modify authentication tokens/passkey user handles, or change the existing configured model-visible identity. Subsequent initialisation does not overwrite user fields. Low-level `createUser` returns a disabled account with no home; the implemented family admin service creates that account and its owned home in one transaction. Direct store helpers provide validation and transactions; their callers must enforce authority. The [storage inventory](../storage.md#key-tables) includes the additional factor, invitation, recovery, namespace and fork-operation tables.

Usernames are trimmed, lowercased ASCII identifiers of 1–64 characters: an initial letter/digit followed by letters, digits, `_` or `-`. Disabled accounts retain their usernames. Public creation/rename reserves `default`, `admin`, `system`, `service` and `anonymous`. Display names are non-empty and at most 128 Unicode characters, without control characters/newlines. Public updates cannot change immutable IDs or home ownership and cannot disable/demote the last enabled administrator. The account service protects last-factor removal using the configured auth methods and current RP ID; legacy factor-tool paths still need integration.

`previewAccessMigration(database)` is a read-only inventory of registered roots/descendants, archived branches, unregistered chats, topology faults and resource counts. Proposed default ownership of legacy web roots is a preview only. Non-web roots need explicit channel/service mappings. No preview output includes message contents, secrets or credentials; it does not assign ownership or enable a mode. Filesystem recordings, durable queue provenance and complete derived-resource ownership still need migration and enforcement work.

## Request identity foundation

`GET /auth/me` returns the actor principal, authentication method and non-secret login ID, home destination and initial role capabilities. Responses use `Cache-Control: private, no-store` and `Vary: Cookie`. Missing credentials return 401 JSON; HEAD returns headers without a body. Client-supplied user/correlation headers and requested chat IDs cannot select the actor.

With authentication disabled in single-user mode, the endpoint returns the legacy local/default principal using the current configured user display name and `auth_enabled: false`. Authenticated requests resolve the cookie's user record and reject disabled, unknown or expired accounts. Dormant non-default cookies cannot activate another account in single-user mode. The gateway holds one immutable identity snapshot per Request and rechecks the next request. Family SSE subscriptions revalidate the login and owned target before event delivery and on each heartbeat.

Web sessions gain a random `session_id` unrelated to the bearer token/hash. Existing cookies retain their token and user handle; a missing login ID is populated on authenticated lookup. Per-user session listing excludes token material, and low-level revocation functions require both user and session IDs. Account API authorisation and own-device revocation are implemented below; explicit service identities/grants and all non-browser entry points still need integration. The initial role helper denies unknown actions and does not grant administrators another owner's session content.

## Root ownership foundation

The additive `session_roots` table records the immutable owner and private policy against the stable root `branch_id`. Its current chat JID is resolved from the branch registry, so permitted internal JID maintenance preserves ownership. No ownership is inferred from username or JID prefixes, and schema installation does not assign legacy owners.

Internal provisioning helpers assign an existing root and a user's home atomically. Same-owner retries are idempotent; reassignment to another owner is rejected. The home must be an active root; archived roots remain owned but cannot execute. Database guards protect an assigned home from archive and an owned root from deletion; explicit safe cleanup is required before eventual root purge. Friendly renaming keeps IDs unchanged.

`resolveAuthorisedChat(database, principal, requestedChatJid, action)` checks live account status/role, root ownership and the whole stored parent chain before returning a target. Missing targets use the current owned home. Explicit empty, foreign, unknown, orphaned, cyclic or cross-root targets are denied uniformly. Admin role alone gives no access to another owner. Selected family reads, forks, account operations and SSE use this resolver. Remaining route/tool/transport consumers must integrate ownership checks before family mode becomes available.

`assignLegacyRootOwners` takes an explicit mapping for every registered root, including archived and non-web roots. It validates all parent chains and users, rejects unregistered chats or incomplete/duplicate mappings, and applies the assignments in one transaction. It never runs automatically or changes the activation marker. Full migration preflight, non-web service scope and dependent resource/queue handling remain release prerequisites.

## Owner-local handle storage

`chat_branches.handle_owner_id` separates the legacy namespace (empty string) from explicitly migrated owner namespaces. Existing single-user branches keep the empty namespace, existing names and legacy suffixing. The legacy active-name index covers only those rows. A second partial unique index enforces case-normalised `(handle_owner_id, agent_name)` uniqueness across each owner's active roots and descendants. Different owners can each claim `@research`; archive frees the name and restore must satisfy the same constraint.

`migrateOwnedSessionHandles(database)` is an explicit offline transaction. It validates ownership for every registered branch, including archived branches, then adopts namespaces without changing names or IDs. Any missing/mismatched ownership or collision rolls back the migration. It does not activate a mode or run at startup. Back up the store before eventual mode migration.

The [copy-preparation runbook](migration-copy.md) documents `piclaw access-migration preview|prepare-copy`. It reads an existing single-user source under the maintenance lock and writes a private inventory, then requires a reviewed fingerprint and explicit owner mapping for every root. Preparation creates and verifies a separate SQLite snapshot, validates topology/homes/owner-local handle collisions, and adopts ownership/namespaces only in that copy. Non-web or broken topology is quarantined and blocks preparation. Source bytes, names, IDs, account state and configuration are unchanged. An `access_migration_preparation` marker makes current access-state reads reject the copy, without activating family mode. Remaining resource/credential/queue migration, child-seed adoption and promotion are separate gates; never run an older binary against the copy.

The owner-aware lookup/list/rename helpers validate live account and parent-chain ownership. Friendly rename updates only `agent_name` and `updated_at`; it preserves branch ID, chat JID, root, home, message references and filesystem paths. Owner-local misses never query another namespace. The legacy database lookup returns only legacy handles, and legacy ensure/rename/restore methods reject migrated rows.

Family branch listing, fork and friendly rename now use owner-bound controls. AgentBranchManager handle lookup and active/known lists use execution identity and have no cross-user active-session fallback. Chat discovery and read-only session control now use owner-bound resolution. Cross-session sends, mutating controls, schedules and peer ingress still need end-to-end owner propagation. Additional root creation, own-home selection, archive and restore now use explicit family lifecycle routes. Merge and purge remain denied. Archive download uses the text-only owned export described below. Legacy JID migration and unscoped destructive branch-manager methods still deny multi-user mode.

### Owned roots, home selection and archive/restore

POST `/agent/root-session` accepts exactly `{agent_name}`. Current family policy allows an enabled authenticated user to create additional private roots. Chat, branch, owner and handle are committed atomically; duplicate active owner-local names roll back creation. A UUID-based JID stays independent of the friendly name. Creation does not change the current home or prewarm a model session.

PATCH `/account/home` accepts exactly `{chat_jid}` and requires recent authentication. Only an active owned root can become home; a fork, archive or foreign root is rejected. The change affects future targetless requests and fresh logins, never an existing device's explicit authorised target.

POST `/agent/branch-prune` accepts exactly `{chat_jid}` and archives one session. It rejects the current home, active main/side turns, in-flight hydration/protected runs and any unarchived descendant. Archive descendants bottom-up; no cascade is implicit. The archive commits before caches are detached and runtimes disposed. Restore of that target is blocked until disposal finishes. Database seeds, messages, ownership and filesystem artifacts remain intact; SSE revalidation closes archived subscriptions before the next delivery or heartbeat.

POST `/agent/branch-restore` accepts `{chat_jid,agent_name?}`. It requires active parents and an available owner-local handle; collision leaves the archive untouched. An explicit alternate name resolves a collision without changing branch/chat IDs. Restore is metadata-only: the next authorised use performs hydration. GET `/agent/branches?include_archived=true` can list owned archived metadata and filter an owned root; it cannot read archived messages. All mutation routes require matching Origin and their existing rate limits.

These backend operations do not complete process-kill race verification, merge/purge, full backups or adoption of unsupported legacy child histories. Reviewed version-two copy plans can capture complete v3 child JSONL into pending import provenance as described in the migration runbook.

### Atomic family forks

`POST /agent/branch-fork` accepts `chat_jid` (omitted means the current home), `agent_name` and an owner-scoped `request_id` of 1–128 letters, digits, underscores or hyphens. The request needs a current account cookie and matching browser Origin; internal secrets cannot bypass either. The server supplies interactive execution identity before source hydration. Active sources require a recorded stable turn boundary. Capture rechecks identity before committing.

`owned_fork_operations` persists the captured JSON seed, source/target branch IDs and idempotency key in the same transaction as child chat/branch registration. The child inherits its root and namespace. Same-owner/source/key retries return the original child, including after rename; using the key with another source denies. New forks choose an available owner-local handle and an immutable UUID-based JID. Nested forks keep the same root. No filesystem branch seed is created for family forks.

On first use, session hydration validates live execution identity, the target and the seed's source before replay. It applies the current stored name, persists/reopens the session, then clears the seed payload while retaining the operation identity. Failure keeps the seed for retry and disposes the broken runtime. A crash before completion may replay into a fresh session again; the seed is retained until successful persistence. Legacy file seeds are rejected for family sessions. Version-two migration plans can explicitly capture complete v3 child JSONL as an `adopted_jsonl` seed; the runtime imports the exact captured tree rather than reconstructing messages or loading the unverified source file first. Unadopted children remain blocked. See [child-session capture](migration-copy.md#explicit-child-session-capture) for bounds, parent/hash checks and unsupported histories.

Main/cached/side hydration now requires matching live family execution identity. Family background prewarm is disabled until its queue carries durable owner provenance. The session manager rechecks identity after asynchronous waits; callers still need integration across direct model/tool entry points. The gated My sessions panel exposes fork, rename and lifecycle operations. Process-kill crash testing, per-user deployment and activation gates remain unfinished.

## HTTP and SSE enforcement

The family router makes a terminal decision before legacy, add-on and widget-state dispatch. Unsupported routes cannot fall through. Isolated mode returns 503 until its gateway exists. Startup still blocks both multi-user modes.

| Route class | Family policy |
|---|---|
| GET/HEAD login page; POST TOTP verify and WebAuthn login start/finish | Existing authentication handlers and rate limits; internal-secret bypass disabled |
| GET/HEAD login JS/CSS and invitation JS | Public packaged assets; source maps and other assets require login |
| GET/HEAD `/auth/invitation` | Public restricted enrolment shell when family TOTP or passkeys are enabled; private/no-store and no-referrer |
| GET/HEAD `/auth/me` | Account snapshot or JSON 401 |
| GET/HEAD `/auth/options` | Public mode and login-method flags only; no user/credential inventory, no-store; isolated mode returns 503 |
| POST `/auth/invitation/claim`, `/auth/invitation/confirm` | Restricted grant, mandatory matching Origin, bound enrolment cookie on confirmation; no account login issued |
| POST `/auth/invitation/passkey/claim`, `/check`, `/confirm` | Explicit passkey-method grant, Origin/client rate limit, restricted browser cookie + RP/challenge/intent binding; no normal login or TOTP fallback |
| GET/HEAD index and family JS/CSS | Separate authenticated text shell and its two bundles only; legacy app/vendor/source-map assets denied; anonymous index serves login |
| POST `/auth/logout` | Matching account/login headers and Origin; revoke original login without clearing a potentially replaced cookie |
| GET `/timeline`, `/hashtag/:tag`, `/thread/:id` | Live owned home or validated owned target |
| GET `/search` | `current`, `root` and `all` search only authorised chats; filter before pagination |
| GET `/sse/stream` | Server-authorised chat subscription with live revalidation |
| POST `/agent/:id/message` | Text-only owned admission with idempotency key; persisted execution authority, no steering/commands/attachments |
| GET `/agent/message-recovery` | Live owned target or home; metadata-only idle/queued/working/blocked/held status, oldest held input ID only |
| POST `/agent/message-recovery` | Recent owner-authenticated retry/skip of the oldest unconsumed admitted input, serialized on its chat lane |
| GET `/media/:id`, `/media/:id/thumbnail`, `/media/:id/info` | Require a stored message link to an active owned session; metadata is projected |
| GET `/agent/branch-download` | Bounded text-only export of one owned archived conversation; not the legacy full-state dump |
| GET `/agent/branches` | Owned roots/descendants; optional `include_archived=true` metadata, no runtime-global fallback |
| POST `/agent/branch-fork`, `/agent/branch-rename` | Owner-bound target, strict fields, browser Origin, cookie revalidation and branch rate limit |
| POST `/agent/root-session`, `/agent/branch-prune`, `/agent/branch-restore` | Owned root creation and idle metadata lifecycle; no implicit cascading or hydration |
| PATCH `/account/home` | Recent self authentication, active owned root only; future targetless requests |
| `/admin/users/*`, `/account`, `/account/sessions/*`, `/account/factors/*`, `/account/passkeys/register/*` | Only the exact methods below; live account/login checks, own-resource scope, recent authentication and Origin on mutations |
| Other routes/methods reaching ordinary family dispatch | JSON 401 without a browser principal; 403 with one. Specialised auth/account endpoints may return validation errors or 405 for `/auth/me` |

Missing `chat_jid` selects the current stored home; explicit empty, duplicate, unknown, unowned and foreign targets receive the same denial. An explicit `root_chat_jid` must resolve to the target's root. Role alone cannot select another owner's messages. Thread IDs are looked up within the authorised chat. Timeline responses retain existing owner-message fields. Media retrieval separately validates stored message links; caller-supplied chat/owner query parameters cannot authorise a media ID. No response is derived from a foreign chat's message contents. Family responses use `Cache-Control: private, no-store` and `Vary: Cookie`. The separate family shell keeps drafts and conversation state in memory only. It sends `x-piclaw-account-id` and `x-piclaw-login-id`; supplied pins must both match the cookie or the server returns 409 `account_changed` before private dispatch (including `/auth/me`). Pins are a stale-tab guard, never authentication or ownership authority. They remain optional for existing gated API callers, but logout requires both. The client revalidates after responses, masks background UI and discards drafts on invalidation/navigation. Existing service workers/cache entries are retired before private fetches, with a controlled page blocked until reload. Legacy-origin migration, account Settings and physical-device verification remain unfinished; see the [family shell notes](../web-ui.md#family-text-shell-gated).

An SSE subscription retains a non-secret login ID and target, without retaining bearer cookies. Login expiry/revocation, disabled accounts, changed roles and invalid/archived parent chains close it before the next event. Idle clients are checked every 30 seconds. Only known chat-scoped event types matching the authorised target are delivered; no global broadcast event is approved yet. The connection handshake omits global UI preferences. Cancellation and revocation clear the heartbeat and remove the client. Already delivered/queued bytes cannot be recalled.

Denied surfaces include add-on ingress/config APIs, widget state/snapshots, mutations other than the listed owned-session and account methods, E2E bootstrap, general factor registration, uploads, workspace, full-state/timeline exports, recordings, terminal/VNC, other agent controls/metadata, push and legacy Settings. Each needs an explicit policy and target validation before being enabled. Tool/non-web boundaries, per-user browser state, device notification routing and complete route/resource inventory remain #1127 work. Single-user routing and unscoped SSE behaviour are unchanged. Terminal/VNC WebSocket upgrades are handled separately from `RequestRouterService`; the upgrade methods explicitly reject both family and isolated modes before resolving a target/owner or opening a socket. This is denial of an unsupported feature, not owner-aware terminal/VNC access. Direct tools/transports and background workers also require separate integration. The startup gate is essential until these paths are verified.

## Owned media and archive transcript reads

GET `/media/:id`, `/media/:id/thumbnail` and `/media/:id/info` authorise through `message_media` → `messages` → the current root/parent chain. At least one linked conversation must be active and owned by the requester. Foreign, missing, orphaned and archived-only links receive the same denial. A blob deliberately linked to both owners' conversations is readable by either; duplicate query parameters or supplied `chat_jid` do not establish authority. Uploads are still denied.

Version-three [copy preparation](migration-copy.md#authentication-tasks-and-media-disposition) quarantines ambiguous legacy media instead of assuming shared links were deliberate. `migration_media_quarantine` blocks every family read for marked media, including after later linking to an owned message. The copy retains bytes/links; no unquarantine writer is exposed. The same transaction revokes copied logins/enrolments and pauses active task payloads and authority heads. In-flight/durable queued work and invalid thread/task relationships block this stage; unconsumed legacy messages remain counted without new authority. Confirmed factors, shared credentials, filesystem notifications/recordings and broader resource migration remain release work. Prepared copies still cannot start.

Binary reads retain the existing non-image `Content-Disposition: attachment` and security headers. Metadata returns only ID, filename, content type and creation time; arbitrary stored metadata, paths and binary data are omitted. Responses use private/no-store caching.

GET `/agent/branch-download?chat_jid=...` requires an owned archived branch and returns `piclaw.owned-transcript.v1` as a JSON attachment. `limit` defaults to 200 and is capped at 500; follow `page.next_before` while `page.has_more` is true. Each page is chronological, selected from newest backwards. Message content is capped at 32,000 characters in SQL and carries `content_truncated`; sender display names are capped at 128 characters.

The export contains the selected branch's safe identity fields and message text/time/sender/bot metadata. It omits media, structured content blocks, previews, annotations, thread links, tasks, service configs, extension state and session files. It is not a full backup or the legacy `piclaw.archived-session.v1` single-user export. Text may naturally contain private information from that owner's conversation; no content redaction is implied. Archived media must be restored into an active owned conversation before normal media access. Cross-user/unknown/active targets deny; no default-home fallback is used for export.

The My sessions panel exposes **Download transcript** only for owned archives. Confirmation and **Prepare transcript** fetch pinned 100-message pages, up to 2,000 messages and 8 MiB of UTF-8 text including headings. It checks ordering, pagination and the selected archive on every page, then checks the archive and login again before enabling **Save text file** and before creating the download. Overflow or invalid pages produce no partial file. Restoring or changing the archive requires a fresh preparation. The file names truncated messages and omitted data; it is a paginated text export, not an atomic snapshot.

Prepared text and download blob URLs are temporary browser state. Cancel, blur, panel close or refresh, session switch, navigation and login replacement clear that state and abort pending reads. Saving clears the prepared text; the blob URL is revoked on cleanup or after 30 seconds. Saved conversations and account preferences remain on the server. A downloaded file remains on the user's device and cannot be recalled by logout.

## Account-factor foundation

Version-four [copy preparation](migration-copy.md#factor-preservation-and-optional-legacy-totp-import) explicitly preserves existing passkey/user-handle bytes and confirmed TOTP ciphertext. Optional legacy TOTP import reads a protected seed/code file, targets only immutable `default`, consumes the verified timestep and encrypts under the existing bootstrap key. It cannot overwrite factors, transfer credentials, enable an account or issue a login. Factor fingerprints fence stale plans without exposing authentication material. Prepared copies remain blocked; runtime factor recovery, physical-device proof and complete activation integration are separate gates.

Per-user TOTP factors and pending enrolments use dedicated `user_totp_factors` and `user_totp_enrolments` tables. They are absent from generic keychain listing and shell secret injection. Seeds use AES-256-GCM with a per-record salt/nonce, PBKDF2-SHA256 (150,000 iterations), bootstrap key material and user-bound associated data. Sharing the machine still permits a sufficiently privileged process to read state and keys; this separation prevents accidental tool exposure.

The internal enrolment service returns a newly generated seed once for a future QR ceremony; stores only encrypted seed and hashed token; expires tokens after five minutes; reserves at most five confirmation attempts; and consumes token plus confirmed factor atomically. Confirmation does not enable an account or assign its home. An existing factor cannot be overwritten through enrolment. Expired pending records are pruned during confirmation and by the runtime maintenance loop; account reset is described below.

Multi-user TOTP selects one normalised username, strictly validates its six-digit code, and atomically consumes the accepted 30-second step. Login reserves a persistent five-attempt account / twenty-attempt IP budget per five minutes before asynchronous cryptography. Reservations include successful and in-flight attempts and are not cleared by another concurrent success. Unknown/disabled accounts perform equivalent KDF work and receive the same invalid-code response. Cookie issuance rechecks current account enablement, home and verified factor revision. Legacy single-user verification behaviour is unchanged.

WebAuthn discoverable login resolves the verified credential owner and checks its user handle, account state and current credential before issuing a cookie. Multi-user ceremonies require user verification and capture the expected origin. Registration requires same-account recent authentication and origin checks; it uses the user's immutable ID/username/display name and cannot overwrite an existing credential. Legacy single-user ceremony settings remain supported.

Recovery startup integration, legacy WebAuthn ceremony isolation and remaining Settings are unfinished. The account service below protects factor removal. Legacy `/totp` and `/passkey` commands reject multi-user mode before reading shared/default factors or creating enrolment cards. Direct Adaptive Card actions (including old TOTP cards) and HTTP side-prompt service calls also reject multi-user mode before payload parsing, source lookup or model invocation. Owner-aware replacements for these disabled entry points are unfinished. No mode is enabled by these internal methods. Back up the factor tables and bootstrap key together. Changing the bootstrap key requires the coordinated offline procedure below; automatic rotation and mixed-key ciphertext are unsupported.

## Mode-aware login shell

The static login page fetches GET `/auth/options` before enabling inputs. The response includes only `mode`, `auth_enabled`, `totp`, `passkey` and `username_required`; it never resolves a principal or returns usernames, credentials or key material. Unknown/inconsistent policy and network failures leave credential forms disabled with an explicit retry action.

Single-user TOTP submits `{code}` as before. Family TOTP shows a labelled account-username field and submits `{username,code}` with normalised username. Passkey-only policy hides the code form; code-only policy never attempts passkeys. An explicit passkey button is available when enabled. Clicking it cancels outstanding conditional mediation; code submission cancels passkey work. Failed/cancelled attempts are shown without removing enabled alternatives. Login success continues to `/`, where the gated family shell selects the owned home and offers plain-text compose. Legacy-origin migration and full browser integration still need verification before activation.

Unit tests cover public response projection, mode parsing and payload shape. Headless Chromium tests cover family/single-user fields, passkey-only/code-only controls, conditional/explicit cancellation, failed policy retry, network failure and mobile width. Physical authenticators, full family browser workflows and translations of the login form still need integration.

## Family account administration

Account reads recheck the login ID and enabled user/role. Mutations require a matching browser Origin, recent TOTP/passkey authentication (five minutes), and rate limiting. Internal secrets do not bypass these checks. Profile/device/factor reads return metadata only; they omit login bearer tokens, token hashes, factor secrets, public keys and conversation content. Invitation/reset issuance deliberately returns a new restricted grant once; passkey start returns a new ceremony token. The public invitation claim returns a new TOTP seed once for enrolment, never a persisted old seed.

| Method and path | Scope |
|---|---|
| GET `/admin/users` | Enabled administrator lists account metadata |
| GET `/admin/users/settings` | Enabled administrator reads labels, role/enabled/invitation state and operation eligibility; no foreign home/session/factor identifiers; query selectors denied |
| GET `/admin/users/:id/security` | Recent administrator reads explicit other-account factor/device metadata; no content, home, keys, seeds or bearer material |
| POST `/admin/users/:id/security/revoke` | Recent administrator revokes an exact target item after exact username confirmation; actor/target audit in the same transaction |
| GET/PATCH `/admin/users/:id/home` | Recent administrator lists eligible already-owned active roots or assigns one after exact username confirmation; no content access or ownership transfer |
| POST `/admin/users` | Recent administrator creates a disabled account and owned home root atomically |
| PATCH `/admin/users/:id` | Recent administrator changes username/displayName/role/enabled; immutable identity/home fields rejected |
| GET `/account` | Live self-only profile/factor/device snapshot with current-policy capability hints; query selectors denied |
| GET/PATCH `/account/preferences` | Live self-only appearance/response guidance; writes use exact fields, Origin and expected revision, with no admin override or global state changes |
| GET/PATCH `/account/model-defaults` | Live self-only model/thinking defaults for empty owned roots; exact available scoped model/level validation and revision CAS, no provider settings or live-session mutation |
| GET/POST/DELETE `/account/avatar`, GET `/account/avatar/image` | Live self-only, mandatory account/login pins; bounded raster upload and revisioned removal, no selectors/admin override; private no-store image bytes |
| GET `/account/workspace` | Live self; read-only sharing, fixed tool ceiling, memory-selection paths and Settings scopes; configured mode and activation marker are distinct; no inventories or config values |
| GET/PATCH `/admin/users/:id/tools` | Recent administrator reads or updates account denials within the fixed ceiling; exact username, expected revision and audited writes |
| GET `/account/trees` | Live self-only root/fork/archive metadata and action eligibility; query selectors denied; distinct from browser-device `/account/sessions` |
| PATCH `/account` | Recent account owner changes only username/displayName |
| PATCH `/account/home` | Recent account owner selects an active owned root; no other device's explicit target is rewritten |
| GET `/account/sessions` | Current owner's login metadata, excluding bearer material |
| DELETE `/account/sessions/:sessionId` | Revoke own device; foreign/missing IDs have the same response and no effect |
| PATCH `/account/sessions/:sessionId` or `/account/factors/passkey/:credentialId` | Recent self changes only `{label}` on an exact owned item; labels never select identity or authority |
| GET `/account/factors` | Own TOTP presence and passkey metadata |
| DELETE `/account/factors/totp` or `/account/factors/passkey/:credentialId` | Remove an own factor only if another factor permitted by configured auth policy remains |
| POST/DELETE `/admin/users/:id/invitation` | Recent administrator issues/revokes a restricted TOTP enrolment grant |
| POST `/admin/users/:id/reset` | Recent other-administrator reset with exact username confirmation; TOTP-capable recovery only |
| POST `/admin/users/:id/passkey-invitation`, `/reset-passkey` | Recent administrator with exact username confirmation and passkeys enabled; first-factor invitation or other-account atomic reset-to-passkey |
| POST `/account/passkeys/register/start`, `/account/passkeys/register/finish` | Same account/login/Origin ceremony for an additional independent passkey |
| POST `/account/totp/start`, `/account/totp/confirm`, `/account/totp/cancel` | Recent self and matching Origin; add a missing TOTP factor with a login-bound reservation, never replace one |

Provisioning creates the disabled user, immutable `web:user:<id>` home, root ownership and owner-local `home` handle in one transaction. Enabling requires an active owned root and at least one currently configured factor (passkeys must match the current RP ID). Disable, enable and role transitions revoke all target logins and pending enrolments; changing profile labels leaves devices active. The last enabled administrator cannot be disabled or demoted. Factor removal rolls back if it would remove the last configured factor, and otherwise revokes all target devices/enrolments. These transactions do not grant administrators access to another user's sessions.

GET `/account` returns `{user,recent_auth,capabilities,factors,sessions}` from one read transaction. `user` contains only ID, username and display name. Factor metadata marks current-site usability and removal eligibility; login metadata marks the current device without returning bearer tokens. The same five-minute check used by mutations controls profile, registration and revocation hints. A stale snapshot never authorises a write: mutations recheck authentication, policy and last-factor protection independently.

The gated shell's **My account** panel changes username/display name, adds independent passkeys, removes eligible factors and revokes owned logins. Destructive actions require a checked confirmation. Removing a factor signs out every account device and clears the panel through identity invalidation. Existing TOTP seeds cannot be displayed or replaced. Account form drafts are discarded on blur, close, session switch and navigation; late responses cannot restore a different login's data. Native passkey dialogs may blur the page, so registration masks the panel and revalidates the original account/login before submitting the result. Closing the panel cancels native registration.

Owned passkeys and logins can be named through PATCH with exactly `{label}`. The same recent-authentication, Origin and rate-limit checks apply. Labels allow up to 80 Unicode characters before trimming, reject control/format characters and line separators, and accept empty text to clear. Duplicate labels are display-only: all updates and removals still use exact immutable credential/login IDs with owner predicates. Admin role grants no right to label another account's items. Expired login targets deny. No credential key, counter, token, timestamp or login authority is changed.

Schema migration adds `label TEXT NOT NULL DEFAULT ''` to both credential and login rows transactionally, preserving existing authentication data. Own-account snapshots and factor/device lists include the label; legacy single-user credential lookup and login flows are unchanged. Labels disappear with the underlying row and require no separate cleanup. Browser Name controls use the server `label_security_item` capability and render text safely; drafts clear with account-panel lifecycle events.

GET `/account/trees` returns the live home, root-creation capability and owned root/fork/archive metadata. Per-row hints permit open/fork/rename on active chains, archive only outside the home with archived descendants, restore under active parents and recent-auth home selection on active roots. Hints do not reserve runtime state or a handle: the existing write paths recheck all authority and operation predicates. No model runtime is hydrated for this read, and administrators receive only their own trees.

My sessions uses that snapshot with explicit targets, archive/home confirmations and stable manual fork retry keys. Successful changes refresh the owned picker without changing the open conversation. Closing/backgrounding clears forms; navigation uses the explicit Open/Go home controls. Root creation has no request key; an unchanged duplicate name fails uniqueness, so inspect the list after an uncertain result before choosing a new name. Fork form closure discards its retry key and also requires inspection before a new attempt.

GET `/admin/users/settings` returns `{recent_auth,capabilities,users}` in one read transaction. It requires a live administrator; recent authentication controls mutation hints. Last-enabled-admin protection, current-site factors and valid owned-home eligibility determine enabled operations. Invitation state omits grant hashes and bearer values. This snapshot exposes no foreign conversation, home or credential identifiers and grants no content access.

The gated Family administration panel creates disabled accounts, changes role/enablement, issues/revokes invitations and resets another account. Existing-account changes require an exact username plus a checkbox. Issued links are memory-only, displayed once without automatic clipboard writes/navigation, and cleared on blur, close, refresh, expiry, session switch or navigation. A late response cannot restore them; a lost result requires explicit revocation/reissue. Admin reset authority can replace another user's authentication, but does not open their conversations or run a model as them.

The separate GET `/admin/users/:id/security` requires recent administrator authentication even for reads, and permits only another account. It exposes names, non-secret credential/login IDs, dates, TOTP presence and current-policy removal eligibility. It never returns keys, seeds, bearer tokens, homes or conversation data. The acting administrator is never projected into a target principal or model context. Self-management uses My account.

POST `/admin/users/:id/security/revoke` accepts `{kind,confirm_username,item_id?}` with `session`, `passkey` or `totp`. The item ID is required for a device/passkey and forbidden for TOTP; the stored target username must match. Session revocation removes only that account's exact login and its pending registrations. Factor removal reuses the self-service last-usable-factor guard and revokes all target logins/enrolments; current RP and auth policy determine usability. Unknown, wrong-target and already-removed items deny without new audit records. Disabled targets retain the same last-factor safeguard; full reset uses its separate explicit API.

`account_security_events` records actor, target, item kind/non-secret ID and time in the revocation transaction. An audit-write failure restores the removed item and logins. The UI requires the server `inspect_security` capability, an explicit Security action, exact username and checked confirmation. Details and pending confirmation clear on close, blur, navigation and account replacement; failed writes never auto-retry. Audit retention and physical-device verification are unfinished.

GET `/admin/users/:id/home` requires recent administrator authentication and returns only another account's eligible active owned root branch IDs, handles and current-home markers. It omits chat JIDs, descendants, content and runtime paths. The read validates ownership and handle namespace and never hydrates a model. Self-home selection stays in My sessions.

PATCH at the same path accepts exactly `{branch_id,confirm_username}` with matching Origin and account rate limits. In one write transaction it rechecks the acting admin, target username and root ownership/namespace/active state, then changes the target's home and inserts an `account_home_events` audit row. The target may be disabled, but assignment cannot enable it. Foreign, archived, child, unowned and malformed roots deny; no implicit adoption is performed. Assigning the already-current root returns `{changed:false}` without another audit event. Audit failure rolls back the default change.

Home changes affect future sign-ins and targetless requests only. Existing target-bound logins, conversations, runs, seeds and ownership remain unchanged, and the administrator still cannot read that root's messages. The UI uses server eligibility, exact username and checkbox confirmation, clears metadata on close/blur/navigation, and does not retry automatically. Container destination assignment is a separate #1132 gate. Audit retention is unfinished.

Restricted invitations below bootstrap a new account's TOTP factor or passkey; administrator-assisted reset and offline grant preparation are described separately. Container destination assignment and recovery startup integration are not implemented. Full mode activation, migrated legacy factors and legacy WebAuthn tool/ceremony isolation need integration testing before release.

## Personal account avatars

`user_avatars` stores the owner's immutable account ID, revision, canonical WebP blob and update time. GET `/account/avatar` returns `{user_id,revision,present,can_edit}`. GET `/account/avatar/image` returns only that owner's image, or 404 when absent. Both require explicit account/login headers matching the live principal; direct image tags without those headers deny. Query selectors and other-account administrator endpoints are unavailable. Family responses are private/no-store and vary by cookie. Existing single-user `/avatar/user`, global avatar configuration and agent/PWA icons are unchanged; the family router still denies the legacy user-avatar route.

POST accepts raw PNG/JPEG/WebP bytes with the exact matching Content-Type and `x-piclaw-avatar-revision` header. A matching Origin and account-change rate limit apply. Input is limited to 2 MiB while streaming, with a 15-second body-read deadline, at most 4 million decoded pixels and a five-second image-processing timeout. SVG, animated images, type mismatches and decode warnings reject. Successful decoding rotates/crops to 256×256 and re-encodes to WebP without source metadata; no original bytes, filename, URL or temporary file are persisted. The stored blob is bounded to 256 KiB. Authentication and revision are rechecked in the committing transaction after decoding; concurrent writes cannot silently replace a newer avatar.

DELETE accepts exactly `{expected_revision}`. Removal clears the blob but keeps a revision tombstone to prevent stale uploads from resurrecting it; repeated removal at the current revision is a no-op. These non-sensitive self-service edits require live authentication, without a five-minute freshness requirement. They do not change logins, factors or shared configuration. SQL failure rolls back. Rename and new logins retain the avatar by immutable ID. Database backup/privileged access remains trusted; this does not provide filesystem isolation or erase historical backup copies.

My account loads the saved image through pinned fetch followed by identity revalidation, then displays a memory-only blob URL. Upload is explicit; deletion requires a checkbox. The original selected file is never previewed or automatically uploaded. Blur, close, refresh, session switch and navigation clear selections, remove image sources and revoke object URLs. Generation checks discard late image responses. Failed writes require explicit refresh, without automatic replay; an already-admitted request can still complete after the panel closes. Avatars appear only in the owner's account panel in this preview. Native file-picker/physical-device behaviour and broader account-switch integration remain release gates.

## Personal account preferences

`user_preferences` stores immutable account ID, revision, theme, bounded response guidance and update time. Missing rows use revision zero, system appearance and empty guidance. GET `/account/preferences` returns only the current owner's snapshot/defaults; query selectors deny. PATCH accepts exactly `{expected_revision,theme,response_guidance}` under live authentication, matching Origin and account-change rate limits. These non-sensitive fields do not require recent authentication. Themes are system/light/dark; guidance allows at most 2,000 UTF-16 code units, rejects control/format characters except tab/newline/carriage return, and trims surrounding whitespace. Stale revisions reject rather than overwrite newer edits. Matching unchanged values preserve revision; failed SQL writes roll back.

No administrator preferences endpoint exists. Rename, disable/enable and new logins retain values because the key is immutable user ID. The browser uses no local/session storage for these preferences, and writes do not modify global Settings or `notes/users/<id>/preferences.md`. File-based personal/family memory selection remains separate. The execution authoriser freezes the owner's preference snapshot for each run; payload preferences cannot substitute another owner's data. The bootstrap adds only non-empty response guidance, JSON-quoted and described as user-authored preferences with no authority to change permissions or higher-priority instructions. Old runs retain their snapshots; new runs pick up edits.

My preferences provides an explicit form, default reset and revisioned save. Polls update saved appearance without replacing dirty form fields. Blur, close, session switch and navigation discard form drafts; account-theme state clears on blur or invalidation and is reapplied only after identity verification. Unsupported stored values fail closed. Other appearance settings and complete preference inheritance remain unfinished.

### Model and thinking defaults

`user_model_defaults` stores model, thinking level, independent revision and update time by immutable owner ID. GET `/account/model-defaults` reads only the current account and returns the locally cached available model catalogue, constrained by the existing instance model-scope setting. It projects exact labels, display names and SDK-supported thinking levels; no credentials, endpoints, headers, provider diagnostics, usage requests or session hydration occur. The effective fields report the configured account/instance model and thinking inheritance, not the selection of an already-running conversation. When there is no explicit instance default, the SDK chooses at initial creation; the preview does not guess that choice.

PATCH accepts exactly `{expected_revision,model,thinking_level}` under live authentication, matching Origin and account rate limits. Personal models require an exact available scoped `provider/model` match; aliases, fuzzy matching and unsupported thinking levels reject. A null thinking level inherits per-model instance thinking, then the global default (or SDK medium), clamped to model support. Both fields null reset to instance defaults. A thinking override without a model denies. Failed writes roll back and stale revisions reject. Missing rows use revision zero; unchanged writes preserve revision. This preference cannot change provider authentication, widen tool policy or override an administrator capability decision.

The execution authoriser freezes defaults per run. Before SDK session creation, only an empty owned root without a parent receives that personal override. Existing persisted model/thinking entries, resumed conversations and fork seeds retain precedence; cached sessions do not change when a preference is saved. A new root picks up the current run snapshot. A saved or explicit personal model that is unavailable fails visibly instead of silently replacing it. With no personal override, initial SDK instance-default behaviour is unchanged. Current instance scope narrows new personal choices; this is not a separate per-user model authorisation or quota policy. Single-user creation is untouched.

My preferences has a separate model form, revisioned save, effective-value notice and explicit reset. Unavailable saved choices remain visible and can be reset; the UI never silently picks another option. Catalogue labels render as text. Blur, close, refresh, session switch and navigation discard choices; identity/generation checks reject late responses. Failed writes need an explicit refresh, without automatic retry. Live per-session model switching, broader inheritance, per-user budgets and complete queue/transport verification remain release work.

## Self-service authenticator enrolment

POST `/account/totp/start` accepts `{}` with recent authentication, matching Origin and TOTP-enabled policy. It refuses an existing factor or invitation. A five-minute `user_totp_registrations` reservation binds user, login, Origin and a generation ID before asynchronous encryption; a superseded or revoked start cannot overwrite newer pending ciphertext. The encrypted pending seed and token hash use the existing enrolment table. A new `{token,secret,qr_data_url,expires_at}` response is returned once. No cookie or account enablement is issued.

POST `/account/totp/confirm` accepts `{token,code}` and checks the same recent login and Origin before cryptography and at commit. Five guesses are reserved before decrypting. Successful confirmation consumes the encrypted enrolment and registration while inserting the factor in one transaction; failures roll back those changes. Confirmation consumes that TOTP step and leaves existing passkeys and login sessions unchanged. POST `/account/totp/cancel` accepts `{token}` and deletes only the matching reservation and encrypted pending seed. Reissue starts a fresh attempt budget; account-route rate limits still apply.

Login deletion (including logout, device revocation, disable/role changes and reset) deletes its reservations and matching pending ciphertext through triggers. Maintenance removes expired/orphaned reservations; offline factor rotation clears them as well. An existing factor cannot be overwritten or read back. The My account panel holds new secrets only in memory and clears them on success, cancel, blur, close, refresh, expiry or navigation. Closing without Cancel only clears the browser; the reservation expires or is superseded by a new explicit start. A cleared or replaced-login response cannot restore a secret.

## Restricted TOTP invitations

POST `/admin/users/:id/invitation` requires recent administrator authentication and creates a 15-minute random grant for a disabled account with an owned home and no factors. DELETE at the same path revokes it. Only hashes are stored. Reissue invalidates the previous grant and pending TOTP enrolment. Explicit disable (even already disabled), role transitions and factor removal revoke affected issued grants; issuer demotion/disable prevents grant use.

POST `/auth/invitation/claim` accepts only `{token}`. It requires matching browser Origin and a rate-limited client, but no account cookie. It consumes the claim before cryptography, returns the new seed, rendered QR data URL and enrolment token once, and sets a five-minute HttpOnly/Secure/SameSite=Strict `piclaw_enrolment` cookie restricted to `/auth/invitation`. The persisted grant binds hashes of the browser cookie and enrolment token plus the origin. A lost claim response requires an administrator to issue another invitation.

POST `/auth/invitation/confirm` accepts only `{token,enrolment_token,code}` and needs that cookie and origin. Five guesses are allowed by the underlying enrolment record. Verification rechecks the grant and account after asynchronous cryptography. One transaction inserts the factor, enables the same invited account, revokes any account logins and consumes the grant; failure rolls everything back. Success clears the enrolment cookie and requires an ordinary login. The invitation grants no account-role/profile changes, factor deletion or transcript access. Responses are private/no-store. TOTP-disabled/passkey-only policy cannot issue or redeem these TOTP invitations.

The family invitation page is `/auth/invitation#token=<grant>`. The grant belongs in the fragment, never the query string, and should be delivered privately by the administrator. The page clears fragment/query from history before making requests and waits for an explicit Begin action before consuming the one-use claim. It shows the returned QR and manual seed, then confirms with the restricted HttpOnly cookie; success clears the displayed seed/QR and links to ordinary login. It never creates a normal login session or stores credentials in local/session storage.

Expiry, pagehide and back-forward restoration clear displayed secrets and disable confirmation. A fresh fragment navigated into the same tab discards the previous ceremony and reloads. Failed or lost claims require a new administrator-issued invitation rather than automatic retry. Browser network requests have a 15-second bound. The page requires HTTPS for the Secure enrolment cookie; the public shell contains no account/seed data before claim.

Recovery startup integration and physical authenticator tests remain unfinished. Chromium tests cover gated admin issuance/revocation, grant clearing/stale responses, fragment removal, explicit claim, confirmation/no login, errors, expiry/navigation clearing and mobile fit; API tests use real TOTP verification and QR generation. Expired records are also pruned at runtime. General factor reset cannot reuse invitations for accounts with existing factors.

## Restricted passkey invitations

POST `/admin/users/:id/passkey-invitation` accepts exactly `{confirm_username}` with recent administrator authentication, matching Origin, account rate limiting and passkeys enabled. It issues a 15-minute grant for a disabled account with an active owned home and no factors. The stored `method` is explicit; additive migration assigns existing grants `totp`. Reissue replaces any previous grant, clears pending TOTP seed material and resets browser/challenge state. DELETE `/admin/users/:id/invitation` revokes either method. TOTP endpoints cannot redeem a passkey grant and passkey endpoints cannot redeem a TOTP grant.

The private link uses `/auth/invitation#token=<grant>&method=passkey`. Fragment selection chooses the page flow only; server grant method and configured factor policy remain authoritative. POST `/auth/invitation/passkey/claim` consumes the claim before asynchronous option generation, binds a hashed restricted browser cookie, Origin and RP, and narrows expiry to five minutes. Options require a discoverable resident credential and user verification with the immutable account ID as user handle. The returned enrolment token is hashed in storage; there is no TOTP seed or normal login session.

POST `/auth/invitation/passkey/check` verifies `{token,enrolment_token}` against the current restricted cookie, grant, Origin, RP, issuer and target eligibility after the native prompt. POST `/auth/invitation/passkey/confirm` also accepts `credential`. It consumes the one proof attempt before real WebAuthn verification, then rechecks grant/issuer/target/home/expiry in the committing transaction. Plain credential INSERT never replaces another key. One transaction inserts the first factor, enables the target, removes any target logins and deletes the grant. Failed verification requires a new invitation; failed SQL rolls back credential insertion and enablement while the proof stays consumed. Revocation/reissue during verification prevents commit. Responses remain private/no-store; success clears the restricted cookie and requires ordinary login.

The browser claims only on Begin and invokes native registration only on Create account passkey. It clears fragment/query immediately, keeps ceremony values in memory, uses bounded requests/native prompts, and rechecks the restricted grant before sending proof. Ordinary blur, cancel, expiry and navigation clear state; a native prompt may blur the page but cannot skip the post-prompt check. Closing does not revoke the server grant. A replaced enrolment cookie, cancelled prompt or stale response cannot complete through this page. No automatic proof retry occurs. Tests use real P-256 proofs and a Chromium virtual authenticator; physical-device and complete multi-tab migration testing are still release gates.

## Administrator-assisted recovery

POST `/admin/users/:id/reset` accepts exactly `{confirm_username}`. It requires another enabled administrator, recent TOTP/passkey authentication, matching browser Origin and account rate limits. The confirmation must match the stored username. Self-reset is denied. This endpoint requires TOTP policy; the separate `/reset-passkey` endpoint requires passkeys and selects a passkey invitation, including under passkey-only policy.

One transaction disables the target (respecting last-administrator protection), deletes all target login sessions, TOTP/passkey factors and pending ceremonies, revokes invitations it owns or issued, and creates a restricted invitation for the selected method. `account_recovery_events` records only actor ID, target ID, event and time, never tokens or seeds. Failure to write the invitation or audit record rolls back the reset. User ID, role, username, home, branch ownership, conversations and filesystem paths remain unchanged. The returned grant is delivered through its method-specific invitation flow; the target must enrol and log in again.

Recovery cannot display old seeds or act as the target's conversational identity. Offline grant preparation is available below; recovery startup integration and audit retention are unfinished. The gated panel requires the exact target username and a checkbox before either reset method. An authorised administrator can replace another user's authentication through this explicit reset; recent-auth and confirmation requirements protect against accidental use, but do not remove that administrative power.

## Offline operator recovery preparation

The [operator recovery runbook](operator-recovery.md) documents `piclaw account-recovery preview|issue|serve`. It requires a configured, already-migrated family store and an existing administrator with an owned home; it never activates or migrates a store. Issue requires exact account/username/method/HTTPS origin, writer-stop and key-backup acknowledgements, typed confirmation, the workspace maintenance lock, a verified SQLite backup and a protected `0600` output file in a `0700` directory. A competing SQLite writer or changed backup snapshot aborts the operation. No grant is printed to stdout. `serve` opens a separate maintenance-locked, TLS-only listener bound to one recovery event and exact origin; only invitation assets and ceremony endpoints are available, and it stops on success, expiry or signal. Normal family runtime startup remains blocked.

Only this offline path can replace a final administrator's lost factors with an audited restricted invitation. `operator_recovery_events` records target, method, exact origin and time without a synthetic actor or secret. The grant references that audit row; redemption permits its disabled administrator issuer only while audit, target role, method, origin, home and ordinary one-use proof conditions match. Normal admin issuance clears operator fields; neither web requests nor tools can issue this grant. Revocation, reissue and audit mismatch deny redemption. A successful proof enables the same administrator without creating a login.

The CLI opens the existing database without schema migration, starts no listener and changes no configuration, ownership or conversation content. File/SQL errors roll back; a crash can leave uncertain output, so operators must inspect/reissue rather than assume success or rollback. The command is not a complete deployed recovery path: the unchanged startup guard still rejects family mode and zero enabled administrators. Recovery-only startup/listener integration and physical-device proof must pass before release. No live recovery, restart or activation was performed.

## Multiple passkeys per account

Each account can register multiple passkeys; adding one never replaces an existing credential. GET `/account/factors` lists each key separately, and the own-factor DELETE route removes one credential while retaining the last usable-factor protection. Counts used by removal/enablement are restricted to the current RP ID and configured auth methods.

POST `/account/passkeys/register/start` accepts an empty object and requires recent TOTP/passkey authentication, matching browser Origin and account mutation rate limits. It returns WebAuthn options with required resident key/user verification, plus a random ceremony token. Existing credentials for that user and RP are excluded from registration options. `user_passkey_registrations` stores the token hash, immutable user ID, initiating login ID, RP, origin, challenge and five-minute expiry. At most five pending ceremonies per user are allowed; this does not limit registered keys to one.

POST `/account/passkeys/register/finish` accepts `{token,credential}`. The same account/login/origin must consume the grant before verification; failed proofs and replay require a new ceremony. After cryptographic verification, the service rechecks current login/account status and expiry, then inserts the credential without replacement. No new login cookie is issued. Role/enable changes, own-device revocation and factor removal clear affected pending registrations. A second login on the same account cannot complete the first browser's ceremony.

Tests use real P-256/COSE keys, CBOR registration attestation and signed login assertions for two credentials. Physical authenticator browser tests and recovery startup integration are still unfinished. Legacy single-user ceremony routes are unchanged; the family account endpoints use the separate durable flow above.

## Authentication maintenance

After access validation, startup immediately prunes expired transient authentication records and starts one unreferenced 60-second timer. Shutdown stops it. Cleanup deletes expired/invalid login sessions, expired invitations and enrolments, expired attempt budgets, and pending passkey ceremonies whose user/login no longer exists. It preserves confirmed factors, accounts and recovery audit records. Cleanup failure is logged and retried on the next interval; request-time expiry checks still enforce access independently.

`UserAuthFactors.rotateFactorEncryption(readNewKeyMaterial)` is an internal **offline confirmed-TOTP-factor re-encryption helper**, not an HTTP/tool action or live master-key switch. It decrypts and prepares every confirmed factor before any write, then checks the complete factor snapshot inside a write transaction. Wrong keys, concurrent factor changes or write errors abort without partial rotation. Success changes ciphertext/salt/nonce/revision, preserves the secret and last-used timestep, and revokes all logins/pending authentication ceremonies. It returns only the number of rotated factors.

Before an operator uses it:

1. Stop all runtime and authentication writers. Back up the full database and existing bootstrap key together; verify the backup can be opened.
2. Prepare the new key through a protected keychain/file reference. Do not put either key on a command line or in logs.
3. Re-encrypt confirmed factors with the helper. Separately re-encrypt any generic-keychain/other stores using the same bootstrap material; this helper does not modify them.
4. Change the configured bootstrap key only after every dependent store has been re-encrypted. Verify authentication with the new key before restarting for users.
5. If any part fails, restore the coordinated database/key backup while services remain stopped. Changing only the configured key can make stored credentials unreadable.

The helper does not enforce process shutdown and is not a complete operator rotation command: the operator must stop every writer and coordinate all dependent stores. Automatic key selection, dual-key runtime and a standalone rotation CLI are unavailable. The separate offline recovery command replaces lost factors; it does not rotate encryption keys. No live key rotation was performed during implementation.

## Model identity foundation

`RunAgentOptions.executionProvenance` is a server-owned contract containing initiating actor, session owner, chat, execution kind and optional non-secret login correlation. It must never be copied from a browser/model request body. The orchestrator validates it before hydration and holds projected identity in AsyncLocalStorage through the run. Family interactive provenance needs a current matching login. Scheduled provenance needs the [private one-shot dispatcher scope](scheduled-execution.md#internal-one-shot-dispatcher), a live durable handoff and exact stored prompt; an execution ID alone cannot authorise a model run. Other owner-labelled background kinds and isolated execution deny before hydration.

The [memory bootstrap boundary](memory-bootstrap.md) appends runtime username, display name, actor/owner IDs, role and workspace profile to system context. It requires matching configured mode and immutable live owner identity before family file reads, then rechecks during reads and before projection. Missing family identity cannot fall back to global memory. Personal sources use `notes/users/<immutable-user-id>/MEMORY.md` and `preferences.md`; `notes/family/MEMORY.md` is separately labelled shared reference. Single-user mode retains legacy memory paths. This is prompt selection on the deliberately shared filesystem; shared search, symlink confinement and per-user Dream need separate work.

Unmodified single-user callers keep their existing prompt and memory behaviour, and clear inherited execution identity. Text-only browser admission and per-message dequeue attribution use this contract. Other durable queue and job paths, direct side prompts, delegates and service grants must integrate it before family activation. The foundation tests the scoped authoriser, concurrent contexts and prompt hook. Identity propagation across every entry point has not been verified.

## Text-only family message admission

### Legacy scheduler restriction

#### Paused task-grant foundation

The internal `createFamilyScheduledTask` API requires a recent authenticated family owner and an active owned target. It atomically creates a paused one-shot agent task, its durable revision and an immutable grant. Input is exactly `{prompt,scheduled_for,allowed_tools}`: non-empty prompt up to 100 KiB UTF-8, canonical UTC timestamp within the next 366 days, and unique tool names within both the fixed family ceiling and current owner allowance. IDs are generated server-side. Shell/internal work, model overrides, notification delivery, recurring schedules and adoption of legacy tasks are unavailable.

The grant binds immutable owner and initiating-user IDs separately from the `scheduler` execution service, exact target/root branch IDs, task revision, actual payload hash, durable configuration hash and issued tool ceiling. It retains only the non-secret login ID as issuance correlation. Preflight survives logout and profile renaming; it intersects the issued tools with current policy and rechecks the owner, branches, payload and paused durable task head. Preflight is an internal record check, with no due-time, occurrence-claim, replay or delivery authority.

Owner revocation is append-only and idempotent. Account disable or role changes, task edits and task deletion permanently revoke existing grants. Restoring account state or the old prompt cannot restore the grant. Task/head activation is blocked by database triggers, including in single-user mode; existing ungranted single-user tasks are unchanged. [Pinned owner preparation and revocation routes](scheduled-execution.md#owner-task-preparation-api) and the [paused task panel](scheduled-execution.md#owner-task-panel) support explicit preparation, inspection and revocation without automatic polling or execution. Automatic dispatch, service actors acting for other owners, recovery and grant-aware migration remain release prerequisites.

#### Internal occurrence reservations

See [internal reservations](scheduled-execution.md#internal-occurrence-reservations) for the due-time check, 60-second lease, token rotation, policy narrowing and terminal consumption contract. These APIs leave tasks paused and do not authorise model execution or delivery.

#### Durable handoff and owner results

See [durable handoff and owner results](scheduled-execution.md#durable-handoff-and-owner-results) for atomic consumption-to-execution binding, the 15-minute settlement capability, exact retries and owner-only retrieval. [Explicit expiry recovery](scheduled-execution.md#explicit-expired-handoff-recovery) records terminal expired handoffs without replay. Automatic dispatch/recovery, cancellation, external delivery and running-model process-kill proof remain incomplete.

`startSchedulerLoop`, `pollScheduledRunsOnce` and `runScheduledTask` deny family and isolated modes, invalid access configuration and stale multi-user execution context before opening the scheduler store, claiming work or reading a task. Agent, shell and internal tasks use the same restriction. Queued work and lease-renewal callbacks check again before proceeding; single-user leases still renew while waiting in the queue.

After each asynchronous scheduler stage, a failed check stops later delivery, model/session restoration, result logging, recurrence advancement and source/claim settlement. Denial stops local lease timers without abandoning or rewriting a claim already committed. An in-flight provider, shell, Dream, delivery or store operation cannot be recalled by these checks; its internal work may finish. Stop all writers before changing modes. Legacy tasks have no owner grants, and the prepared-grant APIs above do not enable owner-aware scheduling or direct Dream execution.

### Legacy Dream restriction

The direct `runDreamAgentTurn` and `runDreamMaintenance` runners, `ensureDreamTask`, Dream workspace startup, `/dream` command and runtime Dream queue callbacks reject family and isolated modes, invalid access configuration and stale multi-user execution context. The check precedes option parsing, task lookup, backlog inspection, lock acquisition and artifact changes. Ordinary module configuration loading is unchanged. A caller-supplied agent pool cannot enable this path.

Dream rechecks after asynchronous backup loading, model selection/execution, index refresh and session disposal. Once denied, an invocation cannot resume when configuration changes back. Denial prevents subsequent backup writes, deterministic fallback, memory/state updates and chat/session reaping; it still releases the lock acquired by that invocation. The lock stays held through session disposal so a second Dream run cannot start during cleanup. Earlier work and already-started model/index/disposal operations cannot be recalled. Interrupted artifacts may remain for later operator review. Per-user Dream and shared-family consolidation, direct lower-level memory helpers and service grants still need integration. Stop all writers before changing modes.

### Legacy tool-output restriction

The high-level tool-output save, lookup, search, file-read, migration and pruning APIs reject family and isolated modes, invalid access configuration and stale multi-user context before accessing records or files. Direct `search_tool_output`, context-bash and `exec_batch` execution reject before reading parameters or invoking dependencies. Bash/batch callbacks and completions recheck access; denial stops later commands and suppresses partial results. Already-started commands and their internal effects cannot be recalled.

The context-mode tool-result hook skips unsupported modes before reading event fields, `fullOutputPath` or the process-wide cache. It checks again after summarisation and before saving or returning a replacement. The legacy provider-context hook also skips these modes and discards work if a check fails after an asynchronous step. Both preserve the original inline tool result/context; no error preview or new output handle is stored on denial. Cleanup startup declines unsupported modes, and a running retention timer stops on denial without pruning; an explicit later single-user start can resume it.

These restrictions do not assign owners to legacy records, partition cached summaries or enable family output search. Raw database helpers, filesystem access and arbitrary installed extensions remain trusted. Owner-aware output creation/retrieval, cache keys and migration still need implementation. Single-user search, previews, semantic fallback and retention behaviour are unchanged.

### Message and side-prompt execution paths

The exported `runSidePrompt` runner and `AgentPool.runSidePrompt` reject family and isolated modes before hydration, model selection, usage recording or output callbacks. They check the mode again after main-session hydration, side-session hydration and side synchronisation. A caller-supplied runtime or inherited execution identity cannot enable this unsupported path. HTTP side-prompt handlers also reject these modes before parsing the request. Owner-aware side admission, prompt identity and tool-policy enforcement are still required before side prompts can be enabled.

The bundled direct-model executor returned by `getRuntimeModelExecutor` also rejects family and isolated modes. Each `streamSimple` or `completeSimple` call checks the current mode before reading provider methods or composing options, including calls through a retained reference. A multi-user execution context cannot use this path after the configuration changes to single-user. Invalid access configuration throws. Single-user callbacks and payload sanitisation are unchanged. This check does not cancel an already-started request or govern arbitrary provider calls made by installed extensions. The context-mode hook now has its own restriction before cache access or semantic summarisation; it cannot use preview fallback to persist output after denial.

POST `/agent/:id/message?chat_jid=...` accepts `{content,request_id,thread_id?}`. A missing chat selects the live owned home; explicit blank, duplicate, unknown or foreign targets deny. Matching Origin and account cookie are required, with a 30/minute message bucket. Thread references must exist in the same chat. Payload identity fields, attachments/structured blocks, steering/mode, leading slash commands and `@` mentions are rejected in this initial path. Text is capped at 100 KiB of string length. `request_id` is an owner-local 1–128 character alphanumeric/underscore/hyphen idempotency key.

The message and `message_execution_authorities` record commit atomically. The record binds immutable actor/owner/login IDs, exact chat/message identity, content hash and thread reference. An admission retry returns the same interaction only for the same payload/target; it cannot transfer authority to another login after revocation. A separate explicit recovery operation below may bind a new login. No bearer token is stored in the authority record. The normal per-chat queue receives only a wake signal; every dequeue re-resolves authority from the selected persisted message before hydration. Current username/display name comes from the live account.

The full processing handler runs inside execution/chat context and passes the recovered provenance to the model orchestrator. Generic/direct family user writes and legacy non-web processing are denied; reply persistence requires current owner identity. The initial tool ceiling allows only `read`, `ls`, `find`, `grep`, owner-scoped `messages`, `session_status`, read-only `session_control` and discovery-only `chat`. The web handler and policy panel share `FAMILY_WEB_TOOLS`. When the run-tool controller has a family execution identity it enforces the same ceiling even if the caller omits a filter; supplied filters can only narrow it. Reactivation and recovery replacement are clamped, and missing active-tool controls throw before prompting. Other direct tool/model entry points, hydration/compaction side effects, extension registration and queued/service grants still need integrated verification. Shared filesystem reads are part of the accepted family trust boundary.

Family idle/background compaction, legacy deferred-followup materialisation, automatic special recovery continuations and stored-reply Web Push are disabled. Persisted plain-text messages drain one at a time. Revocation before dequeue blocks execution; revocation before reply persistence prevents commit. Failed runs are held without the legacy stale-failure skip path. Owner-authorised retry/skip is available through the recovery endpoint below. Attachments, steering, broader tools, push routing and process-kill replay proof still need integration. The separate text shell provides compose and held-input recovery controls. Startup continues to reject family mode.

### Explicit message retry and skip

GET `/agent/message-recovery?chat_jid=<owned>` returns only `{state}` (`idle`, `queued`, `working`, `blocked`) or `{state:"held",message_rowid}` for the oldest held input. Missing target selects home; blank, duplicate and foreign selectors deny. It requires live, not recent, authentication and changes no state. Failure strings, prompt text and login IDs are omitted. The text shell offers retry/skip with explicit skip confirmation; manual retries keep the same request ID until the target/action changes. All mutation predicates are rechecked on the chat lane, so a status response is not permission to execute.

POST `/agent/message-recovery` accepts exactly `{chat_jid,message_rowid,request_id,action}` with action `retry` or `skip`. It requires recent authentication, matching Origin and an active owned target. The request runs on the same `chat:<jid>` queue lane as processing; a 30-second wait bound or client abort cancels the queued operation before it can mutate state. The database rechecks account/login/ownership and requires no inflight/preflight run at commit.

Only the oldest unconsumed admitted message is eligible. A mismatched held-failure record, foreign message, changed payload or completed/skipped input cannot be rewound. `message_recovery_authorities` appends an immutable owner/message/login/action/idempotency record. Retry retains the cursor and clears the matching hold; dequeue uses the latest retry login while leaving the original admission unchanged. Skip advances only past that input, clears the hold and prevents future execution through an old retry grant. Both actions wake the lane so the next pending input can be processed.

Same-owner/request-key retries return the recorded operation without new effects; changing the target/action denies. Recovery never edits original admission or message content and does not issue a browser cookie. An expired or revoked retry login needs a new explicit recovery request. The API returns `{recovered:true,created,recovery_id,action,message_rowid}` on success; the text shell exposes it without accepting arbitrary row IDs.

### Migrated legacy inputs

Version-five [copy preparation](migration-copy.md#legacy-input-holds) records unconsumed legacy messages as immutable holds without creating normal execution authority. Discovery returns `{state:"legacy-held",message_rowid}` for the oldest matching dequeue input. `retry` and `skip` cannot act on these unadmitted rows. Explicit `dismiss-legacy` requires the current owner, recent authentication, matching Origin, an idle chat, the exact original hash/identity and the same serialized lane; it appends an idempotent dismissal audit without advancing the timestamp cursor. Family dequeue omits only that dismissed row, so equal-timestamp inputs remain separate. Held/dismissed originals can never execute or gain retry authority; original content and authorship stay unchanged. The owner must review history and send a new prompt if execution is wanted. Browser controls hide Retry and require dismissal confirmation; blur/identity changes clear confirmation and late responses. Non-migrated and single-user behaviour is unchanged; activation remains gated.

## Workspace and capability preview

GET `/account/workspace` requires a live family account and rejects query selectors and writes. It returns only policy metadata: routing mode, configured mode, stored activation marker, supported startup mode, shared/owner-selected resources, operation restrictions, fixed tool ceiling and broad Settings scopes. It does not read memory contents, enumerate installed add-ons/provider credentials, return configuration values or create a grant. Personal memory paths use the immutable account ID; family memory has its explicit shared path.

The Workspace and security panel keeps configured mode and the stored marker separate; neither enables family startup. It identifies shared workspace files, skills, add-ons, search and provider configuration, and states that file reads and personal-memory selection are not filesystem confinement. It distinguishes owned conversation access from administrator metadata operations and lists disabled terminal, shell, SQL/keychain/environment, add-on management, scheduling and notification surfaces in the admitted family preview. Active tools may be fewer than the fixed ceiling.

The workspace panel is read-only for administrators and members; it displays the account's effective allowed names, denials and revision. The separate administrator Tool restrictions panel can narrow the ceiling, and My preferences edits personal appearance/response guidance and empty-root model defaults. No mode selector, broader grant/profile editor or automatic restart is exposed. Complete setting/add-on scope classification, live session model controls, capability enforcement across all direct/queued entry points, personal Dream and notification routing remain release work. Close, backgrounding, navigation and identity replacement clear displayed state; malformed policy responses fail closed. Existing single-user Settings are unchanged.

### Per-account tool restrictions

GET `/admin/users/:id/tools` returns the fixed eight-name ceiling and target policy `{revision,denied,allowed}` after recent administrator authentication. PATCH accepts exactly `{confirm_username,expected_revision,denied_tools}` with matching Origin and account rate limits. Names must be unique members of the fixed ceiling. A stale revision rejects the write; an unchanged list at the current revision has no effect. A changed list increments the revision and records actor, target, old/new denials and time atomically. Failed audit writes roll back the policy. No label, username or role change removes restrictions.

No policy row means revision zero with the fixed preview ceiling. Corrupt rows, unknown stored names and missing schema fail closed. A run's execution authoriser reads and freezes the owner's policy before hydration; caller-provided policy fields in provenance are discarded. The run-tool controller intersects this snapshot with the fixed ceiling and any narrower caller filter. Active runs keep their snapshot through reactivation and recovery replacement; later runs use new revisions. This is a next-run restriction, not immediate cancellation of already admitted work. Account/login revocation has its existing separate checks.

Administrators may restrict their own model tools because browser account administration is independent and cannot be revoked by this list. Denying all eight names permits a text-only model run. Removing denials restores at most the preview ceiling, never shell, SQL, keychain, extra add-on tools or cross-user content. General registration filtering, a broader role/capability matrix, arbitrary direct extension enforcement and durable non-web service grants are unfinished. Shared filesystem and installed extensions remain trusted. The UI requires exact username and checkbox confirmation; stale/failed writes require refresh and are never automatically retried.

The direct `messages`, `chat` directory, `session_control` and `session_status` entry points also enforce the run snapshot through `requireFamilyToolAccess`. This covers the shared messages runner, transport directory registry, registered control/status tools and runtime owned-session inspection before SQL metadata or callbacks. The guard checks the fixed ceiling, snapshot allowance/denial, matching execution/chat source and current account/login/ownership. A stale family context cannot fall through into single-user reads after a configuration change. Known tool restrictions are independent: disabling chat discovery does not disable an otherwise permitted messages read.

Next-run semantics still apply: an existing run keeps its original allowance after an administrator edits the denial list; a new run uses the new revision. Live logout, disable, role changes or source ownership loss continue to deny immediately at these entry points. No fallback to the latest policy is used when a snapshot is absent, and no default chat supplies missing authority. These checks do not make raw SQL, filesystem access or installed extensions an account sandbox.

### Built-in file tools and SDK call interception

Family `createSessionInDir` requires an owned execution identity before preparing session files/resources and rechecks it around asynchronous resource loading and session construction. It installs SDK custom definitions for `read`, `ls`, `find`, `grep`, `write`, `edit`, `bash`, `powershell` and `local_bash`, with schemas/rendering/results supplied by the SDK. Every definition is bound to the session chat and validates the run policy and live source before execution, each streamed update and returning a result or error. Only permitted local read/search operations can run; file mutation and shell names remain outside the fixed ceiling. Revocation withholds later read output, though it cannot undo bytes already delivered or I/O already started.

The guarded definitions override both standard built-ins and extension registrations in the current SDK registry, including subsequent dynamic registrations. Caller-supplied built-in overrides are discarded in family sessions. Other caller-supplied SDK definitions are wrapped with the same name-policy check. The session's `tool_call` hook also blocks SDK-routed denied/unknown extension calls, and `user_bash` returns denial rather than executing `!` commands. Per-chat SSH factories are skipped before reading persisted SSH configuration, so family hydration does not initialise that shared remote shell. Existing single-user factories/definitions remain unchanged.

These are invocation checks, not code isolation: installed extensions can execute arbitrary code during loading or call OS APIs directly. Registration inventories, extension hooks outside tool dispatch, direct model/delegate entry points and durable queues still need reviewed integration. Allowed reads use the shared filesystem without path confinement or per-user volumes. The family startup gate remains required.

## Owner-scoped cross-session discovery and inspection

`chat action=directory` uses the current execution identity and chat context to list only active owned session aliases. It does not call installed remote/local directory providers in multi-user mode. The entries advertise no delivery modes: discovery is available, sending is not. Model hints describe this restriction rather than recommending unavailable sends.

`session_control` permits only `inspect` and `assess_stuck` for an active owned target, resolved by either one exact JID or one owner-local handle. The source must match the live execution/chat context; a claimed source, missing context, revoked login, foreign target or local alias miss cannot fall back to a global registry. Inspection returns activity/failure/cursor metadata without model hydration, provider inventory, session file paths or conversation text.

Cross-session sends are denied at the chat tool before attachment reads, at the transport registry before provider callbacks, and at the direct runtime relay. Mutating session-control operations (compact/abort/model switch/retry/skip/wake/unblock) are denied at both the tool and runtime handler. These writes need durable owner provenance across queues and target execution before being enabled. Legacy single-user relay and control behaviour is unchanged; family/isolated activation remains disabled.

## Owner-scoped store tools

In family execution, `messages` permits only search/get/grep/extract/diff. A private per-call query scope restricts all SQL read paths—including wildcard, hashtag, FTS, fallback LIKE, row-ID lookup and surrounding context—to active owned conversations before pagination. `chat_jid=all` or `*` never means other users. Omitted search/grep/extract/diff targets use the active source; omitted get targets may select owned row IDs across roots. Explicit foreign/unknown/archived/blank targets deny. Missing execution context and stale login identity cannot use global defaults.

Message add/post/delete/move and the direct post helper deny multi-user mode until write/attachment/delivery authority is integrated. Raw `introspect_sql` also denies before preparing any SQL; a read-only SQL statement is not an account boundary. `scheduled_tasks`, `schedule_task`, `/tasks` and `/scheduled` deny until task ownership and durable queued provenance exist.

`session_status` filters activity to the current owner's sessions and omits tool arguments even under the legacy `none` isolation setting. The full-isolation setting still disables visibility entirely. Owner-only `check` never reports an instance restart as safe, because it does not inspect other users' work. These tool-level checks do not restrict arbitrary shared-filesystem/shell access and do not enable the gated access modes.

## Activation and recovery

Access validation runs after database initialisation and before add-on runtime setup, background workers and listeners. This build permits only single-user configuration with a single-user activation marker. It never offers a flag to bypass the release gate.

A persisted multi-user marker with missing/reverted configuration fails closed. Missing marker rows, a removed marker table alongside existing users, and unknown access-schema versions also fail closed. The marker protects against accidental downgrade/config loss, not a malicious operator who can rewrite the database.

1. Back up configuration, `messages.db`, session files and credentials together before any eventual mode migration.
2. Do not remove activation state or edit it to bypass an error.
3. Recover matching configuration and a compatible binary from the verified backup, or use a future reviewed conversion workflow.
4. Never point a pre-multi-user binary at a family store: older binaries cannot enforce new ownership markers. Reverting to such a binary requires restoring its compatible single-user backup offline.

Changing a mode requires an explicit migration and managed restart. No mode conversion or activation occurs in this foundation. [#1133](https://github.com/rcarmo/piclaw/issues/1133) owns staged release enablement; [#1130](https://github.com/rcarmo/piclaw/issues/1130) owns the Settings controls.

## Reserved isolated configuration

`domains.access.isolation.component` selects `gateway` or `backend` only when `access.mode` is `isolated-containers`.

- Gateway: `signingKeyRef` and a non-empty `backends` registry of `{ id, ownerUserId, url }`. Backend and owner IDs must be unique.
- Backend: `backendId`, `ownerUserId`, `gatewayUrl` and `verificationKeyRef`.

References name future restricted control-plane key storage; never inline key material. URLs must use HTTPS without URL credentials, query or fragment. The parser validates component shape, not network reachability or cryptographic trust. Even a valid shape is rejected for execution in this foundation. The eventual gateway alone owns browser factors/sessions; tenant backends must never expose an anonymous single-user entry point.
