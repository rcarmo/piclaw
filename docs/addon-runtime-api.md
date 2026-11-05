# Add-on runtime API

Installed add-ons can register process-wide services through the versioned runtime object:

```ts
const runtime = globalThis.__piclaw_runtime;
```

This API is available before add-on runtime entries load. Add-ons must feature-detect the required API and version rather than import Piclaw runtime source or private installed modules.

## Runtime entry loading

Declare runtime entries in the package manifest:

```json
{
  "pi": {
    "runtime": {
      "entries": ["runtime.ts"],
      "load": "startup"
    }
  }
}
```

`load` has two values:

- `"startup"` loads after Piclaw has started its WebChannel and wired the runtime messaging handlers, before chat warmup and crash recovery resume work. Use it for chat transports and other process-wide services that must exist before the first agent session.
- `"lazy"` loads when a status panel, config action or Adaptive Card intent first needs runtime contributions. It is the default when `load` is omitted and preserves existing add-on behaviour.

Piclaw applies the same package-entry policy to `pi.extensions`, `pi.web.entries` and `pi.runtime.entries`. Each declaration must be a non-empty relative string that resolves to a regular file inside both the lexical package directory and its realpath. Package-directory symlinks and file symlinks that stay inside the resolved package are supported. Absolute paths, traversal, missing files, directories and symlink escapes are ignored. Package roots are processed deterministically; declaration order and duplicate entries within each field are preserved.

Runtime entry registration lasts for the Piclaw process. Installing or uninstalling an add-on requires the normal Piclaw restart; the process rebuilds the registry from currently installed packages.

## Messaging API v1

Feature-detect the API before use:

```ts
const messaging = globalThis.__piclaw_runtime?.messaging;
if (messaging?.version !== 1) {
  throw new Error("Piclaw messaging API v1 is required.");
}
```

### Register a one-hop chat transport

```ts
const unregister = messaging.registerChatTransport({
  id: "remote-peer",
  kind: "bang",
  async directory() {
    return {
      transport: "remote-peer",
      generated_at: new Date().toISOString(),
      entries: [{ address: "lab!inbox", label: "Lab inbox", target_kind: "inbox", modes: ["queue"], status: "ready" }]
    };
  },
  async validate(request) {
    // Reject any address, mode or attachment outside the verified directory policy.
  },
  async send(request) {
    // request.address is a validated one-hop bang address.
    return {
      status: "queued",
      source_chat_jid: request.source_chat_jid,
      target_address: request.address.raw,
    };
  },
});
```

Installed add-ons may register only the `bang` transport. Core owns the local transport. Only one bang transport may be registered, and duplicate ownership fails explicitly. `directory()` feeds the built-in `chat({ action: "directory" })` result and agent system prompt. `validate()` runs immediately before `send()`. Transport attachments contain a filename, media type, exact byte count, SHA-256 digest and bytes; transports must enforce their advertised policy. The unregister callback is idempotent.

### Discover advertisable local agents

```ts
const agents = await messaging.listAdvertisableAgents();
```

The result contains non-archived web agent aliases and active status. It does not expose local chat JIDs.

### Resolve a local destination

```ts
const result = await messaging.resolveLocalTarget({
  target_agent_name: "research"
});
```

Provide exactly one of `target_agent_name` or `target_chat_jid`. Prefer agent aliases. Results are `resolved`, `not_found`, or `ambiguous`; v1 local aliases are unique, while `ambiguous` is retained for future resolvers.

### Deliver an authenticated peer message

```ts
const receipt = await messaging.deliverPeerMessage({
  target_agent_name: "research",
  content: "Please review this plan.",
  attachments: [{ filename: "plan.md", content_type: "text/markdown", size: bytes.length, sha256, data: bytes }],
  mode: "queue",
  source: {
    peer_instance_id: "immutable-authenticated-id",
    peer_fingerprint: "abc123-def456-ghi789",
    peer_alias: "lab",
    agent_name: "auditor",
    message_id: "rmsg_123",
    reply_address: "lab!@auditor"
  }
});
```

Call this only after the add-on has authenticated the peer. Piclaw validates bounded peer fields, resolves the local target, constructs the reserved `peer_message` content block, and delivers through the normal timeline/queue path. The add-on cannot supply content blocks or a source chat JID.

Message bodies are limited to 32 KiB. Peer delivery accepts at most four verified attachments, 16 MiB each and 32 MiB total. Piclaw recomputes SHA-256, persists each file as normal media, and attaches it to the queued/persisted message. Unknown modes default to `queue`. Peer delivery metadata uses `source: "addon.peer-message"` so queued and persisted messages remain attributable.

## External routes API v1

Startup runtime entries can register signed/non-browser transport endpoints through:

```ts
const externalRoutes = globalThis.__piclaw_runtime?.externalRoutes;
if (externalRoutes?.version !== 1) {
  throw new Error("Piclaw external routes API v1 is required.");
}

const unregister = externalRoutes.register({
  addonId: "remote-peer",
  prefix: "/api/addons/remote-peer/v1",
  methods: ["GET", "POST"],
  maxBodyBytes: 32 * 1024 * 1024,
  bodyMode: "stream",
  async handler(req, pathname, context) {
    return new Response(JSON.stringify({ ok: true }));
  }
});
```

External routes are reserved for installed startup add-ons that authenticate their own transport requests. Piclaw dispatches `/api/addons/<id>/...` before browser session and CSRF guards, so these routes must not rely on browser authentication.

External routes use their own protocol authentication in supported single-user operation.

Core enforces:

- package ownership: `@scope/piclaw-addon-<id>` or `piclaw-addon-<id>` may claim only `/api/addons/<id>`;
- registration only during the owning package's `load: "startup"` import;
- startup freeze, duplicate/overlapping prefix rejection, and reset on process restart;
- `GET`/`POST` method allowlists;
- declared and streamed body caps, with a 64 MiB registration ceiling;
- optional `bodyMode: "stream"`, which preserves a bounded request stream for signed binary transfers instead of buffering the full request in core;
- a coarse 120 requests/minute source bucket per add-on;
- standard Piclaw request IDs, server timing and security headers;
- generic 500 responses when handlers throw.

The add-on remains responsible for protocol authentication, signatures, nonce/replay checks, trust state, endpoint-specific limits, payload validation, and response schemas.

Unknown paths within `/api/addons/` return JSON 404 without redirecting to browser login. Generic extension routes registered through `__piclaw_registerRoute` remain browser-authenticated and CSRF-protected.

Generic extension routes preserve registration order. For overlapping prefixes, dispatch calls matching handlers in that order until one returns a `Response`; returning `null` allows fall-through. Cross-owner exact and nested overlaps produce `web_extension_routes.register_conflict` warnings and appear in the registry freeze diagnostic, but registration is not rejected. External add-on routes use the stricter `/api/addons/<id>/...` registry and reject overlaps.

The unregister callback is idempotent. Add-on install/uninstall already requires a Piclaw restart; the registry is rebuilt from installed startup entries on the new process.

## Scoped data directory

```ts
const dataDir = messaging.getAddonDataDir("remote-peer");
```

The add-on ID must be a lowercase 1–64 character slug containing letters, digits, dots, underscores or hyphens. Piclaw creates `<PICLAW_DATA>/addons/<id>` and rejects path or symlink escapes. The add-on owns files under this directory, including its SQLite database and identity material.

The runtime API does not expose Piclaw's database handle. Relational add-on state belongs in an add-on-owned database; extension KV is suitable only for small preference values.

## Agent extension interop

Agent extensions loaded through Pi can feature-detect `globalThis.__piclawRuntimeInterop`. Piclaw keeps this compatibility bridge deliberately small; installed add-ons must not import Piclaw runtime source or private installed modules.

Catalogue-backed extensions may use:

```ts
const interop = globalThis.__piclawRuntimeInterop;
const registry = interop?.getModelRegistry?.();
const priceIsKnown = interop?.hasKnownModelCost?.(model.provider, model.id) ?? false;
const chatJid = interop?.getChatJid?.("") || "";
const sessionId = interop?.getSessionId?.(chatJid) || null;
const scopedModels = interop?.getScopedModels?.(chatJid) || [];
const stream = interop?.streamSimple?.(model, context, options);
```

- `getModelRegistry()` returns Piclaw's shared Pi `ModelRegistry`. Use its public catalogue, authentication and provider methods; do not mutate unrelated providers.
- `hasKnownModelCost(provider, modelId)` reports whether the effective model's price has a declared source. Built-in/native catalogue models return true. A `models.json` model returns true only when its exact model definition explicitly contains finite, non-negative input, output, cache-read and cache-write rates; omitted custom-model costs return false even though Pi normalises them to zero.
- `streamSimple(model, context, options)` dispatches through Piclaw's shared `ModelRuntime`, including composed provider authentication, configured headers, endpoint overrides and the model's native API implementation. It returns the normal `AssistantMessageEventStream`.
- `getSessionId(chatJid)` returns the active main or side-session ID, or `null` when that chat has no resident session.
- `getScopedModels(chatJid)` returns the active session's read-only scoped-model list. An empty list means Pi has no model scope; it does not mean that no model is allowed.

The registry object is process-scoped. Scoped models and session IDs are session-scoped snapshots and can change when a session is replaced. Resolve them for each operation rather than retaining them across lifecycle changes.

## Local caller context v1

`globalThis.__piclaw_runtime.localContext` provides scoped authority for local
single-operator add-ons. Feature-detect `version === 1`. Browser/model JSON cannot
supply an equivalent context. Family, isolated-container, remote and unprovenanced
agent execution return `null`.

Registered direct config handlers receive the context as optional argument three:

```ts
registerAddonConfigApi('example', 'read', {
  async get(_payload, req, context) {
    if (!context) throw new Error('Verified local context unavailable');
    return { targets: await context.listTargets() };
  },
});
```

The same context is available from `localContext.getRequestContext(req)` only
inside the registered handler for that exact authenticated, CSRF-checked request.
Internal-secret bypass requests do not acquire browser authority. A retained
context expires when its handler returns. Each method rechecks the original
session, access mode and canonical configured workspace; never obtain roots or
owner IDs from a posted payload.

Fields:

- `version: 1`, `accessMode: 'single-user'`.
- `ownerId`, `actorId`, `kind: 'operator' | 'agent'`.
- `workspaceRoot`: runtime-configured workspace realpath.
- `workspaceId`: SHA-256 of that canonical root, for local scope partitioning.
- Agent contexts also include `chatJid` and `chatIncarnation`. `actorId` is the
  persisted chat branch ID, never a model-supplied display name.
- A verified submission may also include immutable `reference: {addonId, intentId}`.
  It comes from the host authority ledger for this prompt, never from prompt text,
  tool arguments or public message blocks. Legacy submissions omit it.

Methods:

- `listTargets()` returns active-lifetime, nonarchived local web branches. Each
  target has `chatJid`, `incarnation`, `agentName`, `label` and activity hint `active`.
- `resolveTarget({chatJid?, agentName?, incarnation?})` accepts exactly one selector
  and returns a target or `null`. Supplying an incarnation requires an exact match.
  Aliases are picker conveniences; persist the chat JID and incarnation together.
- `enqueue({target: {chatJid, incarnation}, content, mode: 'queue', reference?})` is available
  only to operator contexts from POST handlers. Content is bounded to 32 KiB and
  cannot begin with a slash command or routed `@mention`. Current source, provider,
  grant and tool restrictions apply. Financial expense limits do not admit work;
  explicit Goal token limits remain separate. No source/caller/content-block override is accepted.
  Optional `reference` contains an `addonId` of 1–64 lowercase letters, digits,
  dots, underscores or hyphens (first character alphanumeric), and an `intentId`
  of 1–128 ASCII letters, digits, underscores, dots, colons or hyphens. The host
  stores this reference alongside the internal dispatch authority, not in public
  payload fields. Each add-on must check the referenced intent and its selected
  records; the host does not interpret add-on data.

`incarnation` is the existing `chat_branches.branch_id`. It survives ordinary
context rotation and alias changes; deleting/recreating a chat invalidates old
bindings. Target enumeration does not create or hydrate chats. Missing targets
and stale lifetimes fail closed.

Accepted dispatch returns `{status:'accepted', chatJid, incarnation, rowId,
threadId, queued}`. Acceptance means the host accepted the instruction, not that
an agent completed it. Preflight failures throw `AddonLocalContextError` with
`code` and `delivery:'rejected'`; uncertain errors after entering the queue are
`delivery:'unknown'`. Direct config responses preserve those fields (409/502).
An unknown attempt must be reconciled by the add-on; never retry automatically.
There is no durable idempotency-key or exactly-once API here.

`getToolContext()` grants agent authority only during a positively verified
local dispatch from this API. Core persists a body-free dispatch digest, target
lifetime and one-message binding in its generic authority ledger. The marker
survives SDK inbox placement/restart but is stripped from public and
model-authored message input. Direct steering, control-command or follow-up
injection into an active Pi session revokes its scoped authority. Ordinary legacy
prompts, scheduled/side turns and remote messages do not inherit the operator's
context merely because they name the same chat. In this initial version, ask the
operator to use the add-on's explicit dispatch action when tool context is absent.
The reference belongs only to the admitted prompt; nested and subsequent ordinary
prompts cannot inherit it. Add-ons needing per-submission scope must reject absent
or mismatched references, then enforce assignment, ownership, versions and limits.

No add-on activity subscription is introduced. Use explicit Refresh and refetch
on pane focus; do not introduce hidden recurring polling. Add-on review state
continues to belong in its own database under the scoped data directory.

## Authenticated sockets API v1

Startup entries can register browser WebSockets through
`globalThis.__piclaw_runtime.authenticatedSockets`. Feature-detect `version === 1`.
Core derives the owner from the installed package; `register()` accepts a relative
path, never a caller-supplied owner. A path such as `dictation/stream` becomes
`/agent/addons/<package-addon-id>/dictation/stream`.

```ts
const sockets = globalThis.__piclaw_runtime?.authenticatedSockets;
if (sockets?.version !== 1) throw new Error('Authenticated sockets v1 required');
const unregister = sockets.register({
  path: 'dictation/stream',
  maxMessageBytes: 64 * 1024,
  maxQueuedBytes: 256 * 1024,
  maxSessionMs: 60_000,
  maxConnections: 1,
  async authorize({ principal, request, signal }) {
    return { chatJid: new URL(request.url).searchParams.get('chat_jid') };
  },
  async open({ principal, scope, signal, send, close }) {
    return {
      async message(frame) { /* Validate and consume one text/binary frame. */ },
      async dispose() { /* Await capture, workers and other owned resources. */ },
    };
  },
});
```

The upgrade requires an authenticated user session and an exact HTTP(S) Origin,
including scheme, host and port. Proxy headers are used only under the existing
trusted-proxy setting. Missing, opaque, foreign and malformed Origins fail.
Internal-secret, anonymous, family and isolated-container requests fail. Core
resolves the authorised chat against its live local branch registry and derives
the workspace identity. Add-ons must validate their own protocol and query fields;
a query parameter does not grant scope. Use same-origin browser cookies; do not
put credentials in URLs, messages or subprotocols.

Registration limits are positive integers. The ceilings are 1 MiB per frame,
4 MiB queued bytes, 300 seconds and 16 connections. Empty frames consume one queue
unit. Core copies binary frames, preserves text/binary frame boundaries and calls
handlers in FIFO order. Outbound sends also retain order and queue capacity.
Transport rejection fails the send; v1 has no automatic retry or reconnect.

Core rechecks session identity, access mode, workspace and chat incarnation before
frame delivery and outbound sends, and polls idle connections once per second.
Unregister, expiry, logout, socket close and server shutdown abort the session.
Cleanup awaits authorisation, opening, queued handlers, sends and `dispose()`;
connection capacity remains reserved until actual disposal completes. A rejected
or non-cooperative cleanup retains its reservation. Providers must honour the
abort signal and settle owned work. Shutdown can wait for a non-cooperative add-on.
Failed startup registration rolls back socket routes. Registrations and retained
registration callbacks expire with their startup import scope.

This API supplies transport hooks only. It supplies no recogniser, inference
worker, audio codec, TTS engine or separate listener.

## Composer dictation API v1

An installed `pi.web.entries` module can export `async register(api)`. Core passes
an owner-bound browser API. Feature-detect `api.composerDictationVersion === 1`,
register a provider, then select it only after an explicit user choice:

```ts
export async function register(api) {
  if (api.composerDictationVersion !== 1) throw new Error('Dictation v1 required');
  const remove = api.registerComposerDictationProvider({
    id: 'example-dictation', label: 'Example dictation',
    availability: () => ({ available: true }),
    async start({ signal, chatJid, updateSegment, setState }) {
      return {
        async finish() {
          // Flush recogniser output and apply every final segment before resolving.
          updateSegment({ segmentId: 'one', text: 'Final text', final: true });
          return { status: 'finished' };
        },
        async cancel() { /* Await microphone and recogniser cleanup. */ },
      };
    },
  });
  // Call from the add-on's opt-in settings action, never silently at registration.
  // api.selectComposerDictationProvider('example-dictation');
  // api.selectComposerDictationProvider(null); // Restore native mic behaviour.
}
```

The global compatibility API cannot register or select dictation providers.
Duplicate IDs, foreign selection and a second selected provider fail. Removal is
idempotent and cancels its active session. A failed `register(api)` rolls back its
dictation registrations. Both composer skins retain their existing mic and Send
controls. Without a selected provider they retain native speech behaviour; a
selected provider's error never falls back to native recognition.

Core owns draft writes and Send. Providers report bounded segments through
`updateSegment({segmentId, text, final})`, which returns `{applied:boolean}`.
IDs are limited to 128 characters, segments to 65,536 characters, the session to
256 segments and the combined insertion to 131,072 characters. Repeated final
segments are idempotent. Edits outside the owned span move its anchor; overlapping
edits, chat changes and stale callbacks cancel or reject insertion. Start and
finish waits have a 15-second deadline. Cancellation aborts callbacks immediately
and retains ownership until actual cleanup, including late startup completion.

Button, Enter and steering submission paths share the finish barrier. A provider
must resolve `finish()` only after applying its final segments. Failure preserves
the draft and rejects that pending Send; an explicit later Send can retry. Provider
finish never submits, clears the draft or controls the host's Send button. Existing
failed-send draft restoration remains owned by each composer.

The shipped self-contained hook declarations are at
`piclaw/runtime/public/addon-hooks` (TypeScript bundler resolution). See the
[connected dictation example](development/dictation-hooks-example.md) for explicit
opt-in, audio draining, final application and disposal without composer DOM access.
