import {
  hashCanonicalRequest,
  type CanonicalJsonValue,
  type EffectIdentity,
} from "../contracts/common.js";
import type {
  AcceptCancellationRequest,
  AcceptSourceRequest,
  AppendOperationIntentRequest,
  BindHarnessRequest,
  ClaimNextSourceRequest,
  HarnessCorrelation,
  ListOpenOperationsRequest,
  RecordQueuedInputRequest,
} from "../contracts/service-work-store.js";

export type NormalisedMutationRequest =
  | AcceptSourceRequest
  | ClaimNextSourceRequest
  | AppendOperationIntentRequest
  | AcceptCancellationRequest
  | BindHarnessRequest
  | RecordQueuedInputRequest
  | FinishHarnessRequest;

export type MutationMethod =
  | "acceptSource"
  | "claimNext"
  | "appendIntent"
  | "acceptCancellation"
  | "bindHarness"
  | "finishHarness"
  | "recordQueuedInput";

const HASH = /^[0-9a-f]{64}$/;
const SOURCE_KINDS = new Set([
  "message",
  "steer",
  "follow_up",
  "continuation",
  "control",
  "cancellation",
  "scheduled_agent",
  "internal",
]);
const INTENT_KINDS = new Set([
  "open_harness",
  "prompt",
  "queue_input",
  "abort",
  "resume",
  "settle",
  "maintenance",
]);
const HARNESS_STATES = new Set([
  "not_started",
  "running",
  "suspended",
  "aborting",
  "finished",
]);
const QUEUE_KINDS = new Set(["steer", "follow_up", "next_run"]);
const QUEUE_STATES = new Set(["accepted", "queued", "consumed", "disposed"]);

export function normaliseMutationRequest(
  method: MutationMethod,
  input: unknown,
): NormalisedMutationRequest | null {
  try {
    const request = record(input);
    if (!request || !isBoundedTree(input)) return null;
    const effect = normaliseEffect(request.effect);
    if (!effect) return null;

    let normalised: NormalisedMutationRequest | null = null;
    if (
      method === "acceptSource" &&
      exactKeys(request, [
        "effect",
        "chatJid",
        "sourceId",
        "kind",
        "payloadRef",
        "targetOperationId",
        "parentSourceSeq",
        "acceptedAt",
        "createWakeIntent",
      ])
    ) {
      const kind = enumValue(request.kind, SOURCE_KINDS);
      if (!kind) return null;
      normalised = {
        effect,
        chatJid: requiredText(request.chatJid),
        sourceId: requiredText(request.sourceId),
        kind: kind as AcceptSourceRequest["kind"],
        payloadRef: requiredText(request.payloadRef),
        targetOperationId: requiredNullableText(request.targetOperationId),
        parentSourceSeq: requiredNullableSafeInteger(
          request.parentSourceSeq,
          1,
        ),
        acceptedAt: requiredInstant(request.acceptedAt),
        createWakeIntent: requiredBoolean(request.createWakeIntent),
      };
    } else if (
      method === "claimNext" &&
      exactKeys(request, [
        "effect",
        "chatJid",
        "expectedFrontier",
        "newOperationId",
        "claimedAt",
      ])
    ) {
      normalised = {
        effect,
        chatJid: requiredText(request.chatJid),
        expectedFrontier: requiredSafeInteger(request.expectedFrontier, 0),
        newOperationId: requiredText(request.newOperationId),
        claimedAt: requiredInstant(request.claimedAt),
      };
    } else if (
      method === "appendIntent" &&
      exactKeys(request, [
        "effect",
        "expectedVersion",
        "intentId",
        "kind",
        "payloadRef",
        "createdAt",
      ])
    ) {
      const kind = enumValue(request.kind, INTENT_KINDS);
      if (!kind || !effect.operationId) return null;
      normalised = {
        effect: { ...effect, operationId: effect.operationId },
        expectedVersion: requiredSafeInteger(request.expectedVersion, 1),
        intentId: requiredText(request.intentId),
        kind: kind as AppendOperationIntentRequest["kind"],
        payloadRef: requiredText(request.payloadRef),
        createdAt: requiredInstant(request.createdAt),
      };
    } else if (
      method === "acceptCancellation" &&
      exactKeys(request, [
        "effect",
        "expectedVersion",
        "sourceId",
        "sourceSeq",
        "cause",
        "requestedAt",
      ])
    ) {
      if (!effect.operationId) return null;
      normalised = {
        effect: { ...effect, operationId: effect.operationId },
        expectedVersion: requiredSafeInteger(request.expectedVersion, 1),
        sourceId: requiredText(request.sourceId),
        sourceSeq: requiredSafeInteger(request.sourceSeq, 1),
        cause: requiredText(request.cause),
        requestedAt: requiredInstant(request.requestedAt),
      };
    } else if (
      method === "bindHarness" &&
      exactKeys(request, [
        "effect",
        "expectedVersion",
        "sessionId",
        "lane",
        "harnessOperationId",
        "state",
        "watchGeneration",
      ])
    ) {
      const state = enumValue(request.state, HARNESS_STATES);
      if (!effect.operationId || !state) return null;
      normalised = {
        effect: { ...effect, operationId: effect.operationId },
        expectedVersion: requiredSafeInteger(request.expectedVersion, 1),
        sessionId: requiredText(request.sessionId),
        lane: requiredText(request.lane),
        harnessOperationId: requiredNullableText(request.harnessOperationId),
        state: state as BindHarnessRequest["state"],
        watchGeneration: requiredSafeInteger(request.watchGeneration, 0),
      };
    } else if (method === "finishHarness" && exactKeys(request, ["effect", "expectedVersion", "expectedHarness"])) {
      const harness = record(request.expectedHarness);
      if (!effect.operationId || !harness || !exactKeys(harness, ["sessionId", "lane", "harnessOperationId", "state", "watchGeneration"]) || harness.state !== "running") return null;
      normalised = {
        effect: { ...effect, operationId: effect.operationId }, expectedVersion: requiredSafeInteger(request.expectedVersion, 1),
        expectedHarness: { sessionId: requiredText(harness.sessionId), lane: requiredText(harness.lane),
          harnessOperationId: requiredText(harness.harnessOperationId), state: "running", watchGeneration: requiredSafeInteger(harness.watchGeneration, 0) },
      };
    } else if (
      method === "recordQueuedInput" &&
      exactKeys(request, [
        "effect",
        "expectedVersion",
        "sourceSeq",
        "queueKind",
        "harnessEntryId",
        "state",
      ])
    ) {
      const queueKind = enumValue(request.queueKind, QUEUE_KINDS);
      const state = enumValue(request.state, QUEUE_STATES);
      if (!effect.operationId || !queueKind || !state) return null;
      normalised = {
        effect: { ...effect, operationId: effect.operationId },
        expectedVersion: requiredSafeInteger(request.expectedVersion, 1),
        sourceSeq: requiredSafeInteger(request.sourceSeq, 1),
        queueKind: queueKind as RecordQueuedInputRequest["queueKind"],
        harnessEntryId: requiredNullableText(request.harnessEntryId),
        state: state as RecordQueuedInputRequest["state"],
      };
    }

    if (!normalised) return null;
    const expectedHash = hashCanonicalRequest(
      (method === "finishHarness" ? { method: "finishHarness.v1", ...normalised } : normalised) as unknown as CanonicalJsonValue,
    );
    if (effect.requestHash !== expectedHash) return null;
    return deepFreeze(normalised);
  } catch (caught) {
    void caught;
    return null;
  }
}

/** Host-only completion receipt. Caller must verify committed candidate outcomes for all claimed inputs. */
export interface FinishHarnessRequest {
  readonly effect: EffectIdentity & { readonly operationId: string };
  readonly expectedVersion: number;
  readonly expectedHarness: HarnessCorrelation;
}

export interface WithdrawUnclaimedSourceRequest {
  readonly effect: EffectIdentity;
  readonly chatJid: string;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly payloadRef: string;
  readonly actor: string;
}

/** Host-only versioned identity; never aliases an existing public mutation hash. */
export function normaliseWithdrawalRequest(input: unknown): WithdrawUnclaimedSourceRequest | null {
  try {
    const value = record(input);
    if (!value || !isBoundedTree(input) || !exactKeys(value, ["effect", "chatJid", "sourceId", "sourceHash", "payloadRef", "actor"])) return null;
    const effect = normaliseEffect(value.effect);
    if (!effect || effect.operationId !== null || effect.sourceSeq !== null) return null;
    const request = { effect, chatJid: requiredText(value.chatJid), sourceId: requiredText(value.sourceId),
      sourceHash: requiredText(value.sourceHash), payloadRef: requiredText(value.payloadRef), actor: requiredText(value.actor) };
    if (!HASH.test(request.sourceHash) || effect.requestHash !== hashCanonicalRequest({ method: "withdrawUnclaimedSource.v1", ...request } as unknown as CanonicalJsonValue)) return null;
    return deepFreeze(request);
  } catch { return null; }
}

export interface AttachQueuedSourceRequest {
  readonly effect: EffectIdentity & { readonly operationId: string; readonly sourceSeq: number };
  readonly chatJid: string;
  readonly expectedVersion: number;
  readonly expectedHarness: HarnessCorrelation;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly payloadRef: string;
  readonly createdAt: string;
}

/** Concrete host transition only; no change to the public EF-S01 protocol. */
export function normaliseQueuedSourceAttachment(input: unknown): AttachQueuedSourceRequest | null {
  try {
    const value = record(input);
    if (!value || !isBoundedTree(input) || !exactKeys(value, ["effect", "chatJid", "expectedVersion", "expectedHarness", "sourceId", "sourceHash", "payloadRef", "createdAt"])) return null;
    const effect = normaliseEffect(value.effect);
    const harness = record(value.expectedHarness);
    if (!effect?.operationId || !effect.sourceSeq || !harness || !exactKeys(harness, ["sessionId", "lane", "harnessOperationId", "state", "watchGeneration"]) || harness.state !== "running") return null;
    const request: AttachQueuedSourceRequest = {
      effect: { ...effect, operationId: effect.operationId, sourceSeq: requiredSafeInteger(effect.sourceSeq, 1) },
      chatJid: requiredText(value.chatJid), expectedVersion: requiredSafeInteger(value.expectedVersion, 1),
      expectedHarness: { sessionId: requiredText(harness.sessionId), lane: requiredText(harness.lane),
        harnessOperationId: requiredText(harness.harnessOperationId), state: "running", watchGeneration: requiredSafeInteger(harness.watchGeneration, 0) },
      sourceId: requiredText(value.sourceId), sourceHash: requiredText(value.sourceHash),
      payloadRef: requiredText(value.payloadRef), createdAt: requiredInstant(value.createdAt),
    };
    if (!HASH.test(request.sourceHash) || effect.requestHash !== hashCanonicalRequest({ method: "attachQueuedSource.v1", ...request } as unknown as CanonicalJsonValue)) return null;
    return deepFreeze(request);
  } catch { return null; }
}

export function normaliseListRequest(
  input: unknown,
): Readonly<ListOpenOperationsRequest> | null {
  try {
    if (input === undefined) return Object.freeze({});
    const value = record(input);
    if (
      !value ||
      !exactKeys(value, ["chatJid", "limit", "afterOperationId"], true)
    )
      return null;
    const chatJid =
      value.chatJid === undefined ? undefined : text(value.chatJid);
    const afterOperationId =
      value.afterOperationId === undefined
        ? undefined
        : text(value.afterOperationId);
    const limit =
      value.limit === undefined ? undefined : safeInteger(value.limit, 1);
    if (
      chatJid === null ||
      afterOperationId === null ||
      limit === null ||
      (limit !== undefined && limit > 100)
    )
      return null;
    return Object.freeze({
      ...(chatJid ? { chatJid } : {}),
      ...(afterOperationId ? { afterOperationId } : {}),
      ...(limit ? { limit } : {}),
    });
  } catch (caught) {
    void caught;
    return null;
  }
}

export function normaliseReadIdentifier(input: unknown): string | null {
  try {
    return text(input);
  } catch (caught) {
    void caught;
    return null;
  }
}

export function semanticSourceHash(request: AcceptSourceRequest): string {
  return hashCanonicalRequest({
    chatJid: request.chatJid,
    sourceId: request.sourceId,
    kind: request.kind,
    payloadRef: request.payloadRef,
    targetOperationId: request.targetOperationId,
    parentSourceSeq: request.parentSourceSeq,
    acceptedAt: request.acceptedAt,
    createWakeIntent: request.createWakeIntent,
    provenanceRef: request.effect.provenanceRef,
    redactionClass: request.effect.redactionClass,
  });
}

export function semanticIntentHash(
  request: AppendOperationIntentRequest,
): string {
  return hashCanonicalRequest({
    operationId: request.effect.operationId,
    intentId: request.intentId,
    kind: request.kind,
    payloadRef: request.payloadRef,
    createdAt: request.createdAt,
  });
}

function normaliseEffect(input: unknown): EffectIdentity | null {
  const value = record(input);
  if (
    !value ||
    !exactKeys(value, [
      "idempotencyKey",
      "requestHash",
      "operationId",
      "sourceSeq",
      "provenanceRef",
      "redactionClass",
    ])
  )
    return null;
  const redactionClass = enumValue(
    value.redactionClass,
    new Set(["public", "private", "secret"]),
  );
  const requestHash =
    typeof value.requestHash === "string" && HASH.test(value.requestHash)
      ? value.requestHash
      : null;
  const operationId = nullableText(value.operationId);
  const sourceSeq = nullableSafeInteger(value.sourceSeq, 0);
  if (
    !redactionClass ||
    !requestHash ||
    operationId === undefined ||
    sourceSeq === undefined
  )
    return null;
  return Object.freeze({
    idempotencyKey: requiredText(value.idempotencyKey),
    requestHash,
    operationId,
    sourceSeq,
    provenanceRef: requiredText(value.provenanceRef),
    redactionClass: redactionClass as EffectIdentity["redactionClass"],
  });
}

function isBoundedTree(
  input: unknown,
  depth = 0,
  seen = new Set<object>(),
): boolean {
  if (depth > 8) return false;
  if (input === null || typeof input === "string" || typeof input === "boolean")
    return true;
  if (typeof input === "number") return Number.isFinite(input);
  if (typeof input !== "object") return false;
  if (seen.has(input)) return false;
  seen.add(input);
  if (Array.isArray(input)) {
    if (Object.keys(input).length !== input.length) return false;
    return input.every((entry) => isBoundedTree(entry, depth + 1, seen));
  }
  const value = record(input);
  if (!value) return false;
  return Object.values(value).every((entry) =>
    isBoundedTree(entry, depth + 1, seen),
  );
}

function record(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const output: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      typeof key !== "string"
    )
      return null;
    output[key] = descriptor.value;
  }
  return output;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  allowMissing = false,
): boolean {
  const keys = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return allowMissing
    ? keys.every((key) => allowed.includes(key))
    : keys.length === allowed.length &&
        keys.every((key, index) => key === allowed[index]);
}
function text(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.trim().length > 0
    ? value
    : null;
}
function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : (text(value) ?? undefined);
}
function safeInteger(value: unknown, minimum: number): number | null {
  return Number.isSafeInteger(value) && (value as number) >= minimum
    ? (value as number)
    : null;
}
function nullableSafeInteger(
  value: unknown,
  minimum: number,
): number | null | undefined {
  return value === null ? null : (safeInteger(value, minimum) ?? undefined);
}
function enumValue(
  value: unknown,
  allowed: ReadonlySet<string>,
): string | null {
  return typeof value === "string" && allowed.has(value) ? value : null;
}
function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? value
    : null;
}
function requiredText(value: unknown): string {
  const result = text(value);
  if (result === null) throw new TypeError();
  return result;
}
function requiredNullableText(value: unknown): string | null {
  const result = nullableText(value);
  if (result === undefined) throw new TypeError();
  return result;
}
function requiredSafeInteger(value: unknown, minimum: number): number {
  const result = safeInteger(value, minimum);
  if (result === null) throw new TypeError();
  return result;
}
function requiredNullableSafeInteger(
  value: unknown,
  minimum: number,
): number | null {
  const result = nullableSafeInteger(value, minimum);
  if (result === undefined) throw new TypeError();
  return result;
}
function requiredInstant(value: unknown): string {
  const result = instant(value);
  if (result === null) throw new TypeError();
  return result;
}
function requiredBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new TypeError();
  return value;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
