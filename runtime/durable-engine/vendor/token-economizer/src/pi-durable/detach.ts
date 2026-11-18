// SPDX-License-Identifier: Apache-2.0
import { copyJson } from "@earendil-works/chord/json";
import type { JsonObject } from "@earendil-works/pi-durable";
/** SDK transaction drafts are proxies; structuredClone cannot detach them. */
export function detach<T extends JsonObject>(value:T):T {
  // SAFETY: T is a strict-JSON owner contract; copyJson preserves every value/key and rejects invalid JSON.
  return copyJson(value) as T;
}
