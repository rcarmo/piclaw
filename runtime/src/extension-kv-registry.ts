/**
 * extension-kv-registry.ts — Global extension KV store singleton.
 *
 * Piclaw's runtime registers the DB-backed implementation during init.
 * Extensions (including addons) access it through the exported functions.
 * Operations require an explicitly registered backing store.
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

// ── Singleton ────────────────────────────────────────────────────

let registeredStore: ExtensionKvStore | undefined;

/** Register the DB-backed KV store (called during piclaw runtime init). */
export function registerExtensionKvStore(store: ExtensionKvStore): void {
  registeredStore = store;
}

/** Clear test registration without manufacturing a persistence fallback. */
export function resetExtensionKvStoreForTests(): void {
  registeredStore = undefined;
  requireAuthority = false;
}

// One stable router, including for extensions that cache it during factory load.
// Registering a backing store never replaces the authority boundary.
function effect<T>(extensionId: string, scope: KvScope | undefined, scopeKey: string | undefined, write: boolean, body: () => T): T {
  const authority = operationAuthority.getStore();
  if (!authority && requireAuthority) throw Error("Extension KV operation authority required");
  if (!registeredStore) throw Error("Extension KV backing store required");
  if (!authority) return body();
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
    if (!authority && requireAuthority) throw Error("Extension KV operation authority required");
    if (!registeredStore) throw Error("Extension KV backing store required");
    if (!authority) return body();
    authority.assertCurrent();
    if (extensionId !== authority.extensionId || !authority.admitWrite) throw Error("Extension KV write admission unavailable");
    return authority.admitWrite<T>(() => {
      authority.assertCurrent();
      if (!registeredStore) throw Error("Extension KV backing store required");
      const result = body();
      authority.assertCurrent();
      if (!registeredStore) throw Error("Extension KV backing store required");
      return result;
    });
  },
  get: <T>(id: string, key: string, scope?: KvScope, chat?: string) => effect(id, scope, chat, false, () => registeredStore!.get<T>(id, key, scope, chat)),
  set: (id: string, key: string, value: unknown, scope?: KvScope, chat?: string) => effect(id, scope, chat, true, () => registeredStore!.set(id, key, value, scope, chat)),
  delete: (id: string, key: string, scope?: KvScope, chat?: string) => effect(id, scope, chat, true, () => registeredStore!.delete(id, key, scope, chat)),
  list: (id: string, prefix?: string, scope?: KvScope, chat?: string) => effect(id, scope, chat, false, () => registeredStore!.list(id, prefix, scope, chat)),
  query: <T>(id: string, options: KvQueryOptions) => effect(id, options.scope, options.scopeKey, false, () => registeredStore!.query<T>(id, options)),
  clear: (id: string, scope?: KvScope, chat?: string) => {
    if (operationAuthority.getStore()) throw Error("Extension KV bulk clear denied");
    return effect(id, scope, chat, true, () => registeredStore!.clear(id, scope, chat));
  },
});

/** Get the stable authority-aware registry, not its mutable backing store. */
export function getExtensionKvStore(): ExtensionKvStore { return router; }
