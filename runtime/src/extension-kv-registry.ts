/**
 * extension-kv-registry.ts — Global extension KV store singleton.
 *
 * Piclaw's runtime registers the DB-backed implementation during init.
 * Extensions (including addons) access it through the exported functions.
 * If the store hasn't been registered (e.g. standalone test), operations
 * fall back to an in-memory Map.
 */

import type { KvScope, KvQueryOptions } from "./db/extension-kv.js";

export interface ExtensionKvStore {
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

/** Get the registered KV store. */
export function getExtensionKvStore(): ExtensionKvStore {
  return registeredStore;
}
