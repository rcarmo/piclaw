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

Entry paths must resolve to files inside the installed add-on package. Piclaw rejects lexical path traversal and symlinks that escape the package.

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

The unregister callback is idempotent. Add-on install/uninstall already requires a Piclaw restart; the registry is rebuilt from installed startup entries on the new process.

## Scoped data directory

```ts
const dataDir = messaging.getAddonDataDir("remote-peer");
```

The add-on ID must be a lowercase 1–64 character slug containing letters, digits, dots, underscores or hyphens. Piclaw creates `<PICLAW_DATA>/addons/<id>` and rejects path or symlink escapes. The add-on owns files under this directory, including its SQLite database and identity material.

The runtime API does not expose Piclaw's database handle. Relational add-on state belongs in an add-on-owned database; extension KV is suitable only for small preference values.
