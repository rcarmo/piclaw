import { extensionKvGet, extensionKvSet, extensionKvDelete, extensionKvList, extensionKvQuery, extensionKvClear } from "./extension-kv.js";
import { getExtensionKvStore, registerExtensionKvStore } from "../extension-kv-registry.js";

/** Startup only, before any extension factory can cache the legacy interop store. */
export function registerRootExtensionKvStore(): void {
  registerExtensionKvStore({ get: extensionKvGet, set: extensionKvSet, delete: extensionKvDelete,
    list: extensionKvList, query: extensionKvQuery, clear: extensionKvClear });
  const globals = globalThis as typeof globalThis & { __piclawRuntimeInterop?: Record<string, unknown> };
  const interop = (globals.__piclawRuntimeInterop ||= {});
  interop.getExtensionKvStore = getExtensionKvStore;
}
