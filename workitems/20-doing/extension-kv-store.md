---
id: extension-kv-store
title: Add a scoped key-value store for extensions
status: doing
priority: high
created: 2026-04-25
updated: 2026-04-25
estimate: M
risk: low
tags:
  - work-item
  - kanban
  - extensions
  - storage
  - addons
owner: smith
blocked-by: []
---

# Add a scoped key-value store for extensions

## Summary

Extensions currently have no persistence surface. Tools like proxmox and portainer
had to be wired into the monorepo with handler injection to access DB-stored
configs. Now that they've moved to piclaw-addons, they need a self-service
storage API.

## Design

### Single table, not per-extension tables

```sql
CREATE TABLE IF NOT EXISTS extension_kv (
  extension_id  TEXT NOT NULL,
  scope         TEXT NOT NULL DEFAULT 'chat',  -- 'chat' | 'global'
  scope_key     TEXT NOT NULL DEFAULT '',       -- chat_jid for chat scope, '' for global
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,                  -- JSON-serialized
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (extension_id, scope, scope_key, key)
);

CREATE INDEX IF NOT EXISTS idx_extension_kv_ext_scope
  ON extension_kv(extension_id, scope, scope_key);

CREATE INDEX IF NOT EXISTS idx_extension_kv_updated
  ON extension_kv(updated_at);
```

### Scoping model

| Scope | scope_key | Lifetime | Example |
|---|---|---|---|
| `chat` | chat JID | Per chat session | Proxmox API profile for `web:default` |
| `global` | `''` | Cross-session | Extension preferences, cached discovery results |

Each extension is isolated by `extension_id` — an extension can never read/write
another extension's keys.

### JSON indexing

SQLite's `json_extract()` enables querying within stored values without
deserializing in application code:

```sql
-- Find all proxmox configs with a specific base_url
SELECT key, value FROM extension_kv
WHERE extension_id = 'proxmox'
  AND scope = 'chat'
  AND json_extract(value, '$.base_url') = 'https://192.168.1.10:8006/api2/json';

-- List all chats with portainer configs
SELECT DISTINCT scope_key FROM extension_kv
WHERE extension_id = 'portainer'
  AND scope = 'chat'
  AND key = 'config';
```

### Extension API surface

```ts
interface ExtensionStorage {
  /** Get a typed value. Returns null if not found. */
  get<T = unknown>(key: string, scope?: StorageScope): Promise<T | null>;

  /** Set a value. Creates or overwrites. */
  set(key: string, value: unknown, scope?: StorageScope): Promise<void>;

  /** Delete a key. Returns true if it existed. */
  delete(key: string, scope?: StorageScope): Promise<boolean>;

  /** List keys matching an optional prefix. */
  list(prefix?: string, scope?: StorageScope): Promise<string[]>;

  /** Query values where a JSON path matches a value. */
  query<T = unknown>(options: {
    scope?: StorageScope;
    jsonPath: string;
    equals: unknown;
    limit?: number;
  }): Promise<Array<{ key: string; scopeKey: string; value: T }>>;

  /** Delete all keys for this extension in a scope. */
  clear(scope?: StorageScope): Promise<number>;
}

type StorageScope =
  | { kind: 'chat'; chatJid?: string }  // defaults to current chat
  | { kind: 'global' };
```

### How extensions use it

Registration:
```ts
export default function proxmoxExtension(pi: ExtensionAPI) {
  const storage = pi.storage;  // scoped to this extension automatically

  pi.registerTool({
    name: "proxmox",
    async execute(_id, params, _signal, _update, ctx) {
      if (params.action === "set") {
        await storage.set("config", {
          base_url: params.base_url,
          api_token_keychain: params.api_token_keychain,
          allow_insecure_tls: params.allow_insecure_tls,
        }, { kind: "chat" });
        return { content: [{ type: "text", text: "Stored." }] };
      }

      if (params.action === "get") {
        const config = await storage.get("config", { kind: "chat" });
        // ...
      }
    },
  });
}
```

### Security boundaries

- `extension_id` is set by the runtime when creating the storage context, not by the extension
- Extensions cannot override their own ID
- No cross-extension reads
- `scope_key` for chat scope defaults to the ambient chat JID (from `getChatJid()`)
- Global scope is available but rate-limited by key count (configurable, default 1000)
- Values are JSON-serialized; max value size configurable (default 64 KB)

### Migration path for proxmox/portainer

The existing `proxmox_configs` and `portainer_configs` tables can be migrated:

```sql
INSERT OR IGNORE INTO extension_kv (extension_id, scope, scope_key, key, value, created_at, updated_at)
SELECT
  'proxmox', 'chat', chat_jid, 'config',
  json_object(
    'base_url', base_url,
    'api_token_keychain', api_token_keychain,
    'allow_insecure_tls', allow_insecure_tls
  ),
  created_at, updated_at
FROM proxmox_configs;
```

After migration, the old tables can be dropped in a future release.

### Cleanup

- Chat branch deletion already cleans up config tables; extend it to `extension_kv WHERE scope = 'chat' AND scope_key = ?`
- Add TTL-based pruning for stale entries (configurable, default 30 days for chat-scoped, no TTL for global)

## Acceptance Criteria

- [ ] `extension_kv` table created during DB init
- [ ] `ExtensionStorage` interface exposed to extensions as `pi.storage`
- [ ] Storage is scoped by extension ID (runtime-assigned, not extension-controlled)
- [ ] Chat scope defaults to ambient chat JID
- [ ] Global scope available
- [ ] JSON query via `json_extract()` works
- [ ] Key listing with prefix filter
- [ ] Max value size enforced
- [ ] Max key count per extension enforced
- [ ] Chat branch deletion cleans up chat-scoped entries
- [ ] Migration from `proxmox_configs` / `portainer_configs` tables
- [ ] At least one addon (proxmox or portainer) uses the new API

## Implementation Checklist

- [ ] Add `extension_kv` table to `db/connection.ts`
- [ ] Create `db/extension-kv.ts` with get/set/delete/list/query/clear
- [ ] Create `ExtensionStorage` wrapper that binds extension_id
- [ ] Wire into `ExtensionAPI` or `ExtensionContext` (needs upstream coordination or local patch)
- [ ] Update chat branch cleanup in `db/chat-branches.ts`
- [ ] Add TTL pruning
- [ ] Write migration for existing proxmox/portainer config tables
- [ ] Update proxmox addon to use `pi.storage` instead of handler injection
- [ ] Update portainer addon to use `pi.storage` instead of handler injection
- [ ] Tests for isolation, scoping, JSON query, cleanup

## Test Plan

- [ ] State-machine test: get/set/delete/list/clear lifecycle
- [ ] Isolation test: extension A cannot read extension B's keys
- [ ] Scope test: chat scope uses ambient JID, global scope is cross-chat
- [ ] JSON query test: json_extract filtering works
- [ ] Cleanup test: chat branch deletion removes scoped entries
- [ ] Size limit test: oversized values rejected
- [ ] Key count limit test: excess keys rejected

## Open Questions

- Should `pi.storage` be on `ExtensionAPI` (available at registration time) or `ExtensionContext` (available at event time)?
  - Recommendation: `ExtensionAPI` so tools can use it during `execute()`
- Should the storage API be async even though SQLite is synchronous in Bun?
  - Recommendation: yes, for future-proofing if storage backend changes
- Should we expose raw SQL/JSON path queries or keep it to the typed API?
  - Recommendation: typed API only; raw queries are a security/isolation risk

## Links

- Related: proxmox/portainer addon carve-out (piclaw-addons `755e699`, `349217b`)
- Related: piclaw monorepo removal (`c6963cc5a`)
