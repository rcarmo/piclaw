import { isProxy } from "node:util/types";
import type { Api, AssistantMessage } from "../../src/durable-legacy-sdk.js";
import { classifyModelFailure, modelFailureDetail, parseModelFailure } from "./host-model-failure.js";
import { canonicalJson } from "../../src/utils/canonical-json.js";

type ReportingUsage = AssistantMessage["usage"] & {
  providerCost?: number;
  provider_cost?: number;
  reasoningTokens?: number;
  reasoning_tokens?: number;
  cacheReadReported?: boolean;
  cacheWriteReported?: boolean;
};
type TerminalOutcome = Omit<AssistantMessage, "usage" | "deferred" | "diagnostics" | "rawStopReason" | "stopReason"> & {
  usage: ReportingUsage;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
};
type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
const invalid = (): never => { throw new Error("Invalid terminal model outcome"); };

// Like the receipt owner's JSON validation, inspect descriptors, never invoke
// accessors/toJSON or proxy traps. Unknown fields are not traversed or retained.
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) invalid();
  }
  return value as Record<string, unknown>;
}
function field(value: Record<string, unknown>, key: string): unknown {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
function sequence(value: unknown): unknown[] {
  if (!value || typeof value !== "object" || isProxy(value) || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype) return invalid();
  const length = Object.getOwnPropertyDescriptor(value, "length")!.value;
  if (Reflect.ownKeys(value).length !== length + 1) return invalid();
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor?.enumerable || !("value" in descriptor)) return invalid();
    result.push(descriptor.value);
  }
  return result;
}
function text(value: unknown): string {
  return typeof value === "string" ? value : invalid();
}
function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : invalid();
}
function boolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalid();
}

// Arbitrary keys are meaningful ONLY within SDK tool arguments. Clone finite
// plain JSON explicitly; JSON.stringify would silently lose/alter invalid data.
type Content = AssistantMessage["content"][number];
type ToolArguments = Extract<Content, { type: "toolCall" }>["arguments"];
type JsonValue = ToolArguments[string];
function argument(value: unknown, ancestors = new Set<object>(), depth = 0): JsonValue {
  if (depth > 64) return invalid();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return finite(value);
  if (!value || typeof value !== "object" || isProxy(value) || ancestors.has(value)) return invalid();
  ancestors.add(value);
  const result = Array.isArray(value)
    ? sequence(value).map(item => argument(item, ancestors, depth + 1))
    : Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, argument(item, ancestors, depth + 1)]));
  ancestors.delete(value);
  return result;
}
function content(value: unknown): AssistantMessage["content"][number] {
  const source = record(value);
  switch (field(source, "type")) {
    case "text": {
      const result: Extract<Content, { type: "text" }> = { type: "text", text: text(field(source, "text")) };
      if (field(source, "textSignature") !== undefined) result.textSignature = text(field(source, "textSignature"));
      return result;
    }
    case "thinking": {
      const result: Extract<Content, { type: "thinking" }> = { type: "thinking", thinking: text(field(source, "thinking")) };
      if (field(source, "thinkingSignature") !== undefined) result.thinkingSignature = text(field(source, "thinkingSignature"));
      if (field(source, "redacted") !== undefined) result.redacted = boolean(field(source, "redacted"));
      return result;
    }
    case "toolCall": {
      const args = record(field(source, "arguments"));
      const result: Extract<Content, { type: "toolCall" }> = {
        type: "toolCall", id: text(field(source, "id")), name: text(field(source, "name")),
        arguments: Object.fromEntries(Object.entries(args).map(([key, item]) => [key, argument(item, new Set([args]))])),
      };
      for (const key of ["thoughtSignature", "namespace", "argumentsError"] as const) {
        if (field(source, key) !== undefined) result[key] = text(field(source, key));
      }
      return result;
    }
    default: return invalid();
  }
}
function usage(value: unknown): ReportingUsage {
  const source = record(value), cost = record(field(source, "cost"));
  const result: ReportingUsage = {
    input: finite(field(source, "input")), output: finite(field(source, "output")),
    cacheRead: finite(field(source, "cacheRead")), cacheWrite: finite(field(source, "cacheWrite")),
    totalTokens: finite(field(source, "totalTokens")),
    cost: { input: finite(field(cost, "input")), output: finite(field(cost, "output")),
      cacheRead: finite(field(cost, "cacheRead")), cacheWrite: finite(field(cost, "cacheWrite")), total: finite(field(cost, "total")) },
  };
  for (const key of ["reasoning", "cacheWrite1h", "providerCost", "provider_cost", "reasoningTokens", "reasoning_tokens"] as const) {
    if (field(source, key) !== undefined) result[key] = finite(field(source, key));
  }
  for (const key of ["cacheReadReported", "cacheWriteReported"] as const) {
    if (field(source, key) !== undefined) result[key] = boolean(field(source, key));
  }
  return result;
}
function freeze<T>(value: T): Immutable<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

type TerminalPhysical = Readonly<{ provider: string; id: string; api: Api }>;
function terminalOutcome(message: unknown, expectedPhysical: TerminalPhysical, stored: boolean): Immutable<TerminalOutcome> {
  const source = record(message), expected = record(expectedPhysical);
  const provider = text(field(source, "provider")), model = text(field(source, "model")), api = text(field(source, "api"));
  if (!provider || !model || !api || provider !== text(field(expected, "provider"))
    || model !== text(field(expected, "id")) || api !== text(field(expected, "api"))
    || field(source, "role") !== "assistant") return invalid();
  const responseModel = field(source, "responseModel");
  if (responseModel !== undefined && responseModel !== model && responseModel !== `${provider}/${model}`) return invalid();
  const stopReason = field(source, "stopReason");
  if (stopReason !== "stop" && stopReason !== "length" && stopReason !== "toolUse" && stopReason !== "error" && stopReason !== "aborted") return invalid();
  if (field(source, "deferred") !== undefined) return invalid();
  const failed = stopReason === "error" || stopReason === "aborted";
  const result: TerminalOutcome = {
    role: "assistant", provider, model, api, stopReason,
    content: failed ? [] : sequence(field(source, "content")).map(content),
    usage: usage(field(source, "usage")), timestamp: finite(field(source, "timestamp")),
  };
  for (const key of ["responseModel", "responseId", "providerThinkingLevel"] as const) {
    if (field(source, key) !== undefined) result[key] = text(field(source, key));
  }
  const thinking = field(source, "thinkingLevel");
  if (thinking !== undefined) {
    if (thinking !== "off" && thinking !== "minimal" && thinking !== "low" && thinking !== "medium"
      && thinking !== "high" && thinking !== "xhigh" && thinking !== "max") return invalid();
    result.thinkingLevel = thinking;
  }
  if (field(source, "endTurn") !== undefined) result.endTurn = boolean(field(source, "endTurn"));
  if (field(source, "durationMs") !== undefined) result.durationMs = finite(field(source, "durationMs"));
  if (failed) {
    // Only SDK diagnostic scalars reach the classifier, never unknown cause/status
    // handles or private partial content. The existing bounded format is public.
    const errorMessage = field(source, "errorMessage");
    if (errorMessage !== undefined) text(errorMessage);
    if (stored) {
      if (parseModelFailure(errorMessage)?.phase !== "provider") return invalid();
      result.errorMessage = text(errorMessage);
    } else result.errorMessage = modelFailureDetail(classifyModelFailure("provider", { stopReason, errorMessage }));
  }
  if (stored && canonicalJson(result) !== canonicalJson(source)) return invalid();
  return freeze(result);
}

/** WIP producer projection, not billing validity. Negative finite telemetry is
 * retained as fact. Never pass an already-stored outcome through this classifier. */
export function projectTerminalOutcome(message: AssistantMessage, expectedPhysical: TerminalPhysical): Immutable<TerminalOutcome> {
  return terminalOutcome(message, expectedPhysical, false);
}

/** Decode an exact version-1 projected outcome after its receipt binding/hash
 * was verified. Shape validation supplies no permission to resume or dispatch.
 * Stored classifications are facts; never classify their redacted text again. */
export function decodeStoredTerminalOutcome(bodyJson: string, expectedPhysical: TerminalPhysical): Immutable<TerminalOutcome> {
  if (typeof bodyJson !== "string") return invalid();
  let value: unknown;
  try { value = JSON.parse(bodyJson); } catch { return invalid(); }
  return terminalOutcome(value, expectedPhysical, true);
}
