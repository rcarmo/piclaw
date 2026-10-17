import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import type { Result } from "../../src/service-effects/contracts/result.js";

export function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
// Keep the original provenance label: it participates in persisted idempotency request hashes.
export function effect<O extends string | null = null>(key: string, operationId: O = null as O, sourceSeq: number | null = null) {
  return { idempotencyKey: key, requestHash: "0".repeat(64), operationId, sourceSeq,
    provenanceRef: "qualification:host-handoff", redactionClass: "private" as const };
}
export function sealed<T extends { effect: { requestHash: string } }>(request: T): T {
  return { ...request, effect: { ...request.effect, requestHash: hashCanonicalRequest(JSON.parse(JSON.stringify(request)) as CanonicalJsonValue) } };
}
