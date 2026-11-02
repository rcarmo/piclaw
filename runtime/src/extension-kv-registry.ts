/**
 * extension-kv-registry.ts — Global extension KV store singleton.
 *
 * Piclaw's runtime registers the DB-backed implementation during init.
 * Extensions (including addons) access it through the exported functions.
 * If the store hasn't been registered (e.g. standalone test), operations
 * fall back to an in-memory Map.
 */

import type { SyncSqliteOperation } from "./db/sqlite-async-admission.js";
import { AsyncLocalStorage } from "node:async_hooks";
import type { KvScope, KvQueryOptions } from "./db/extension-kv.js";

/** Private host effect authority; never supplied through extension context. */
export interface ExtensionKvAuthority {
  readonly chatJid: string;
  readonly extensionId: string;
  readonly globalRead?: boolean;
  readonly globalWrite?: boolean;
  assertCurrent(): void;
  write<T>(body: () => T): T;
  admitWrite?<T>(body: SyncSqliteOperation<T>): Promise<T>;
}
const operationAuthority = new AsyncLocalStorage<ExtensionKvAuthority>();
let requireAuthority = false;
export function requireExtensionKvAuthority(): void { requireAuthority = true; }
export function withExtensionKvAuthority<T>(authority: ExtensionKvAuthority, body: () => T): T {
  return operationAuthority.run(authority, body);
}

export interface ExtensionKvStore {
  write?<T>(extensionId: string, body: SyncSqliteOperation<T>): Promise<T>;
  get<T = unknown>(extensionId: string, key: string, scope?: KvScope, scopeKey?: string): T | null;
  set(extensionId: string, key: string, value: unknown, scope?: KvScope, scopeKey?: string): void;
  delete(extensionId: string, key: string, scope?: KvScope, scopeKey?: string): boolean;
  list(extensionId: string, prefix?: string, scope?: KvScope, scopeKey?: string): string[];
  query<T = unknown>(extensionId: string, options: KvQueryOptions): Array<{ key: string; scopeKey: string; value: T }>;
  clear(extensionId: string, scope?: KvScope, scopeKey?: string): number;
}

// ── In-memory fallback for when DB isn't available ───────────────

class InMemoryKvStore implements ExtensionKvStore {
  private store = new Map<string, string>();
  private makeKey(extensionId: string, scope: string, scopeKey: string, key: string): string {
    return `${extensionId}\0${scope}\0${scopeKey}\0${key}`;
  }

  get<T = unknown>(extensionId: string, key: string, scope?: KvScope, scopeKey?: string): T | null {
    const k = this.makeKey(extensionId, scope || "chat", scopeKey || "", key);
    const v = this.store.get(k);
    return v ? JSON.parse(v) : null;
  }

  set(extensionId: string, key: string, value: unknown, scope?: KvScope, scopeKey?: string): void {
    const k = this.makeKey(extensionId, scope || "chat", scopeKey || "", key);
    this.store.set(k, JSON.stringify(value));
  }

  delete(extensionId: string, key: string, scope?: KvScope, scopeKey?: string): boolean {
    const k = this.makeKey(extensionId, scope || "chat", scopeKey || "", key);
    return this.store.delete(k);
  }

  list(extensionId: string, prefix?: string, scope?: KvScope, scopeKey?: string): string[] {
    const base = `${extensionId}\0${scope || "chat"}\0${scopeKey || ""}\0`;
    const keys: string[] = [];
    for (const k of this.store.keys()) {
      if (k.startsWith(base)) {
        const remainder = k.slice(base.length);
        if (!prefix || remainder.startsWith(prefix)) keys.push(remainder);
      }
    }
    return keys.sort();
  }

  query<T = unknown>(_extensionId: string, _options: KvQueryOptions): Array<{ key: string; scopeKey: string; value: T }> {
    return []; // In-memory fallback doesn't support JSON queries
  }

  clear(extensionId: string, scope?: KvScope, scopeKey?: string): number {
    const prefix = scopeKey
      ? `${extensionId}\0${scope || "chat"}\0${scopeKey}\0`
      : scope
        ? `${extensionId}\0${scope}\0`
        : `${extensionId}\0`;
    let count = 0;
    for (const k of [...this.store.keys()]) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        count++;
      }
    }
    return count;
  }
}

// ── Singleton ────────────────────────────────────────────────────

let registeredStore: ExtensionKvStore = new InMemoryKvStore();

/** Register the DB-backed KV store (called during piclaw runtime init). */
export function registerExtensionKvStore(store: ExtensionKvStore): void {
  registeredStore = store;
}

/** Reset the registry to an isolated in-memory store for monolithic test suites. */
export function resetExtensionKvStoreForTests(): void {
  registeredStore = new InMemoryKvStore();
  requireAuthority = false;
}

// One stable router, including for extensions that cache it during factory load.
// Registering a backing store never replaces the authority boundary.
function effect<T>(extensionId: string, scope: KvScope | undefined, scopeKey: string | undefined, write: boolean, body: () => T): T {
  const authority = operationAuthority.getStore();
  if (!authority) {
    if (requireAuthority) throw Error("Extension KV operation authority required");
    return body();
  }
  const check = () => {
    authority.assertCurrent();
    const chat = scope === "chat" && !!scopeKey && scopeKey === authority.chatJid;
    const global = scope === "global" && (scopeKey === undefined || scopeKey === "") && (write ? authority.globalWrite === true : authority.globalRead === true);
    if (extensionId !== authority.extensionId || !(chat || global))
      throw Error("Extension KV scope denied");
  };
  const invoke = () => { check(); const result = body(); check(); return result; };
  return write ? authority.write(invoke) : invoke();
}
const router: ExtensionKvStore = Object.freeze({
  async write<T>(extensionId: string, body: SyncSqliteOperation<T>): Promise<T> {
    const authority = operationAuthority.getStore();
    if (!authority) {
      if (requireAuthority) throw Error("Extension KV operation authority required");
      return body();
    }
    authority.assertCurrent();
    if (extensionId !== authority.extensionId || !authority.admitWrite) throw Error("Extension KV write admission unavailable");
    return authority.admitWrite<T>(() => { authority.assertCurrent(); const result = body(); authority.assertCurrent(); return result; });
  },
  get: <T>(id: string, key: string, scope?: KvScope, chat?: string) => effect(id, scope, chat, false, () => registeredStore.get<T>(id, key, scope, chat)),
  set: (id: string, key: string, value: unknown, scope?: KvScope, chat?: string) => effect(id, scope, chat, true, () => registeredStore.set(id, key, value, scope, chat)),
  delete: (id: string, key: string, scope?: KvScope, chat?: string) => effect(id, scope, chat, true, () => registeredStore.delete(id, key, scope, chat)),
  list: (id: string, prefix?: string, scope?: KvScope, chat?: string) => effect(id, scope, chat, false, () => registeredStore.list(id, prefix, scope, chat)),
  query: <T>(id: string, options: KvQueryOptions) => effect(id, options.scope, options.scopeKey, false, () => registeredStore.query<T>(id, options)),
  clear: (id: string, scope?: KvScope, chat?: string) => {
    if (operationAuthority.getStore()) throw Error("Extension KV bulk clear denied");
    return effect(id, scope, chat, true, () => registeredStore.clear(id, scope, chat));
  },
});

/** Get the stable authority-aware registry, not its mutable backing store. */
export function getExtensionKvStore(): ExtensionKvStore { return router; }
