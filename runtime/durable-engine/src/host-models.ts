import { BudgetRequestError } from '../../src/db/budget-request-reservations.js';
import type { HostCodexModelServices } from "./host-codex-model-services.js";
import { createLogger } from "../../src/utils/logger.js";
import { taskModelRequestScope } from "./task-model-boundary-shim.js";
import { isPromise } from "node:util/types";
import { classifyModelFailure, modelFailureDetail, parseModelFailure, type ModelFailure, type ModelFailurePhase } from "./host-model-failure.js";
import type { ModelFailureEvidence } from "./host-model-failure-evidence.js";
const log = createLogger("durable.models");
import {
  createModels, createProvider, createAssistantMessageEventStream, normalizeContext,
  type Api, type Model, type Models, type SimpleStreamOptions,
  type TranscriptContext, type AssistantMessage, type AssistantMessageEvent, type AnyModel, type ModelType,
  type ImageModel, type ImageApi, type ClassifierModel, type ClassifierApi,
  type ImagesContext, type ImagesOptions, type AssistantImages,
  type ClassifierContext, type ClassifierOptions, type ClassifierResult, type Usage,
  type DeferredHandle, type DeferredFetchOptions, type DeferredCancelOptions,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../../src/durable-legacy-sdk.js";
import { MODEL_THINKING_LEVELS } from "@earendil-works/pi-ai/providers/model-schema";

export interface ModelRef { provider: string; id: string; type?: ModelType }
type Operation = "chat" | "generateImages" | "classify";
type HostPort = Pick<ModelRuntime, "getPhysicalModel" | "stream" | "streamSimple"> &
  Partial<Pick<ModelRuntime, "getModelOfType" | "generateImages" | "classify" | "streamDeferred" | "cancelDeferred">>;
type DeferredOperation = "fetchDeferred" | "cancelDeferred";
export interface HostModelEventObserver {
  /** Mandatory synchronous authority fence, independent of observer health. */
  assertCurrent(): void;
  /** Optional synchronous observation receives a detached event copy. */
  onEvent(event: AssistantMessageEvent): void;
}
export interface HostModelPolicy {
  /** Invocation-local source fence retained through asynchronous credential resolution. */
  captureSourceGuard?(signal: AbortSignal | undefined): (() => void) | Promise<() => void>;
  /** Resolve once after source capture; ordinary requests without observers do
   * not clone every streaming partial. Observer failure cannot change outcomes. */
  captureEventObserver?(requestSignal?: AbortSignal): HostModelEventObserver | undefined;
  retainFailure?(evidence: ModelFailureEvidence): string | Promise<string>;
  prepareRequest?(model: Model<Api>, options: SimpleStreamOptions | undefined, signal: AbortSignal): Promise<{
    readonly id?: string;
    /** Exact verified prior terminal; no transport or observer replay. */
    readonly recoveredTerminal?: AssistantMessage;
    /** Exact reservation/account/source fence, synchronous after every await. */
    assertRecoveredCurrent?(): void;
    /** Owner-lifetime retention only; supplies no permission for later effects. */
    retainTerminal(message: AssistantMessage): Promise<unknown>;
    dispatch(): Promise<void>; settle(message: AssistantMessage): Promise<void>; abandon(): Promise<void>;
  } | undefined>;
  /** Current source/model approval for an exact stored fact; grants no spend. */
  assertStoredOutcomeCurrent?(ref: ModelRef, signal: AbortSignal): void;
  /** Includes host model approval and budget admission; never auth/login approval. */
  authorize(ref: ModelRef, kind: Operation, signal: AbortSignal): Promise<void>;
  /** Synchronous approval/budget-generation check after host auth has resolved. */
  assertCurrent(ref: ModelRef, kind: Operation, signal: AbortSignal): void;
  /** Host must abort the grant generation on revocation (including in-flight work). */
  signal: AbortSignal;
  /** Host-owned durable reference authority. Never persist provider conversion data.
   * project must idempotently issue a non-secret reference; resolve must verify its operation/
   * account scope, including after reopen. No bridge-local registry is authority.
   * Cancel grants are explicit owner-cleanup grants, independent of spend approval.
   */
  codex?: HostCodexModelServices;
  deferred?: {
    project(handle: DeferredHandle, model: ModelRef): DeferredHandle;
    resolve(handle: DeferredHandle, model: ModelRef): DeferredHandle;
    authorize(model: ModelRef, operation: DeferredOperation, handle: DeferredHandle, signal: AbortSignal): Promise<void>;
    assertCurrent(model: ModelRef, operation: DeferredOperation, handle: DeferredHandle, signal: AbortSignal): void;
    signal: AbortSignal;
  };
}

// Only JSON data crosses package families; no provider/runtime/stream class is shared.
function data<T>(value: T): T {
  const check = (item: unknown): void => {
    if (item === undefined || item === null) return;
    if (typeof item === "object") {
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw new Error("Only JSON data is qualified");
      for (const child of Object.values(item)) check(child);
    } else if (!["string", "boolean", "number"].includes(typeof item) ||
      (typeof item === "number" && !Number.isFinite(item))) throw new Error("Only JSON data is qualified");
  };
  check(value);
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item === "function") throw new Error("Callbacks are not qualified");
    return item;
  }));
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const optionKeys = new Set([
  "temperature", "samplingParams", "maxTokens", "transport", "cacheRetention",
  "sessionId", "metadata", "timeoutMs", "websocketConnectTimeoutMs",
  "reasoning", "thinkingBudgets", "toolChoice", "maxRetryDelayMs", "maxRetries", "identity",
]);
function requestOptions(options: SimpleStreamOptions = {}, deferred = false): SimpleStreamOptions {
  if (Object.getPrototypeOf(options) !== Object.prototype) throw new Error("Only JSON data is qualified");
  for (const [key, value] of Object.entries(options)) {
    if (key !== "signal" && key !== "telemetry" && value !== undefined && !optionKeys.has(key) && !(deferred && key === "deferred")) {
      throw new Error(`Unqualified request option: ${key}`);
    }
  }
  if (options.maxRetries !== undefined && options.maxRetries !== 0) {
    throw new Error("Transport retries are not qualified");
  }
  // SDK spans stay in their originating island. The host transport retains its
  // own tracing; no span methods or callbacks cross this JSON-only bridge.
  const { signal: _signal, telemetry: _telemetry, ...rest } = options;
  return { ...data(rest), maxRetries: 0 };
}

function catalogCost(cost: AnyModel["cost"]): AnyModel["cost"] {
  const rates = (c: AnyModel["cost"]) => ({ input: c.input, output: c.output, cacheRead: c.cacheRead, cacheWrite: c.cacheWrite });
  return { ...rates(cost), tiers: cost.tiers?.map((tier) => ({ ...rates(tier), inputTokensAbove: tier.inputTokensAbove })) };
}
function requestCeilingFrame(model:Model<Api>):string{
  const cost=model.cost;
  if(!cost||cost.tiers!==undefined&&!Array.isArray(cost.tiers))return 'unqualified';
  const rates=(entry:typeof cost)=>[entry.input,entry.output,entry.cacheRead,entry.cacheWrite];
  return JSON.stringify([model.contextWindow,model.maxTokens,rates(cost),(cost.tiers??[]).map(tier=>[tier.inputTokensAbove,...rates(tier)])]);
}
function usage(value?: Usage): Usage | undefined {
  return value && { input: value.input, output: value.output, cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite, totalTokens: value.totalTokens,
    cost: { input: value.cost.input, output: value.cost.output, cacheRead: value.cost.cacheRead,
      cacheWrite: value.cost.cacheWrite, total: value.cost.total } };
}
function operationOptions(operation: "generateImages" | "classify", options: ImagesOptions | ClassifierOptions = {}) {
  if (Object.getPrototypeOf(options) !== Object.prototype) throw new Error("Only JSON data is qualified");
  const allowed = new Set(["timeoutMs", "maxRetries", "maxRetryDelayMs", "identity",
    operation === "generateImages" ? "metadata" : "temperature"]);
  for (const [key, value] of Object.entries(options)) {
    if (key !== "signal" && key !== "telemetry" && value !== undefined && !allowed.has(key)) throw new Error("Unqualified request option");
  }
  if (options.maxRetries !== undefined && options.maxRetries !== 0) throw new Error("Transport retries are not qualified");
  const { signal: _signal, telemetry: _telemetry, ...rest } = options;
  const safe = data(rest);
  const extra = operation === "generateImages" && "metadata" in safe ? { metadata: safe.metadata }
    : operation === "classify" && "temperature" in safe ? { temperature: safe.temperature } : {};
  return { timeoutMs: safe.timeoutMs, maxRetryDelayMs: safe.maxRetryDelayMs, identity: safe.identity, ...extra, maxRetries: 0 };
}

/** Inactive bridge: physical models; no credential transfer or production wiring.
 * Root and private 1.4.0 graphs remain physically separate. A private factory
 * owns the complete interface; JSON identity crosses, SDK spans stay local. Deferred execution
 * requires an explicit host reference authority. transformHeaders is a post-auth fence, NOT an
 * atomic send hook: the SDK awaits it and may dispatch in a later microtask.
 */
export function createHostModels(
  hostModelRuntime120: HostPort,
  approved: readonly ModelRef[],
  policy: HostModelPolicy,
): Models {
  const backing = createModels({ authContext: {
    env: async () => undefined, fileExists: async () => false,
  } });
  const catalog = approved.map((ref): AnyModel => {
    const type = ref.type ?? "chat";
    if (type !== "chat" && (typeof hostModelRuntime120.getModelOfType !== "function" ||
      typeof hostModelRuntime120[type === "image" ? "generateImages" : "classify"] !== "function")) {
      throw new Error("Host operation is unavailable");
    }
    // Host 1.2 has virtual routing only for chat; typed non-chat lookup is physical.
    const model = type === "chat" ? hostModelRuntime120.getPhysicalModel(ref.provider, ref.id)
      : hostModelRuntime120.getModelOfType?.(type, ref.provider, ref.id);
    if (!model || (model.type ?? "chat") !== type || model.provider !== ref.provider || model.id !== ref.id) {
      throw new Error("Approved physical model is unavailable");
    }
    const limits = model.inputLimits, images = limits?.images, resize = images?.resize;
    const base = { provider: model.provider, id: model.id, name: model.name, api: model.api,
      baseUrl: "https://host-bridge.invalid", input: model.input.map((mode) => {
        if (mode !== "text" && mode !== "image") throw new Error("Unsupported input mode");
        return mode;
      }), cost: catalogCost(model.cost), inputLimits: limits && {
        maxRequestBytes: limits.maxRequestBytes, images: images && {
          maxPerMessage: images.maxPerMessage, maxPerRequest: images.maxPerRequest,
          resize: resize && { maxWidth: resize.maxWidth, maxHeight: resize.maxHeight,
            maxBytes: resize.maxBytes, jpegQuality: resize.jpegQuality } } } };
    return freeze(data(model.type === "image" ? { ...base, type: "image", output: model.output.map((mode) => {
      if (mode !== "text" && mode !== "image") throw new Error("Unsupported output mode");
      return mode;
    }) } : model.type === "classifier" ? { ...base, type: "classifier", contextWindow: model.contextWindow }
      : { ...base, type: "chat", reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevelMap && Object.fromEntries(MODEL_THINKING_LEVELS
          .filter(level => model.thinkingLevelMap?.[level] !== undefined)
          .map(level => [level, model.thinkingLevelMap![level]])),
        contextWindow: model.contextWindow, maxTokens: model.maxTokens }));
  });
  const validatedChatModel = (model: Model<Api>): Model<Api> => {
    // Validate a detached JSON snapshot, then use only the immutable host catalog.
    const snapshot = freeze(data(model));
    const listed = catalog.find((m) => (m.type ?? "chat") === "chat" &&
      m.provider === snapshot.provider && m.id === snapshot.id);
    if (!listed || (snapshot.type ?? "chat") !== "chat" || listed.api !== snapshot.api) {
      throw new Error("Model not approved");
    }
    return listed as Model<Api>;
  };
  const publicHandle = (handle: DeferredHandle, model: Model<Api>) => {
    const safe = data(handle);
    if (Object.keys(safe).some((key) => !["provider", "modelId", "api", "id", "expiresAt", "pollAfterMs"].includes(key)) ||
      safe.provider !== model.provider || safe.modelId !== model.id || safe.api !== model.api ||
      typeof safe.id !== "string" || !safe.id ||
      (safe.expiresAt !== undefined && typeof safe.expiresAt !== "number") ||
      (safe.pollAfterMs !== undefined && typeof safe.pollAfterMs !== "number")) throw new Error("Invalid deferred reference");
    return freeze(safe);
  };
  const deferredOptions = (options: DeferredFetchOptions = {}, cancel = false) => {
    if (Object.getPrototypeOf(options) !== Object.prototype) throw new Error("Invalid options");
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && !["signal", "telemetry", "identity", "timeoutMs", "maxRetries", "maxRetryDelayMs", ...(cancel ? [] : ["wait"])].includes(key)) throw new Error("Invalid options");
    }
    if (options.maxRetries !== undefined && options.maxRetries !== 0) throw new Error("Retries denied");
    const { signal: _signal, telemetry: _telemetry, ...rest } = options;
    return { ...data(rest), maxRetries: 0 };
  };
  const projectMessage = (message: AssistantMessage, model: Model<Api>): AssistantMessage => {
    const { deferred, ...rest } = message;
    if (!deferred) return data(rest);
    if (!policy.deferred) throw new Error("Deferred authority unavailable");
    if (deferred.provider !== model.provider || deferred.modelId !== model.id || deferred.api !== model.api) throw new Error("Wrong deferred owner");
    return { ...data(rest), deferred: publicHandle(policy.deferred.project(deferred, model), model) };
  };
  const deferredAdmission = async (model: Model<Api>, handle: DeferredHandle,
    options: DeferredFetchOptions | undefined, operation: DeferredOperation) => {
    model = validatedChatModel(model);
    const safe = deferredOptions(options, operation === "cancelDeferred");
    const reference = publicHandle(handle, model);
    const authority = policy.deferred;
    if (!authority) throw new Error("Deferred authority unavailable");
    const signal = options?.signal ? AbortSignal.any([options.signal, authority.signal]) : authority.signal;
    signal.throwIfAborted();
    // Host scope verification happens before credentials are consulted.
    const raw = authority.resolve(reference, model);
    if (raw.provider !== model.provider || raw.modelId !== model.id || raw.api !== model.api) throw new Error("Wrong deferred owner");
    await authority.authorize(model, operation, reference, signal);
    const fence = () => { signal.throwIfAborted(); authority.assertCurrent(model, operation, reference, signal); };
    fence();
    const physical = hostModelRuntime120.getPhysicalModel(model.provider, model.id);
    if (!physical || physical.provider !== model.provider || physical.id !== model.id || physical.api !== model.api) throw new Error("Model owner changed");
    return { physical, raw, options: { ...safe, signal, transformHeaders: (headers: Record<string, string | null>) => { fence(); return headers; } } };
  };
  const relay = (simple: boolean, model: Model<Api>, context: TranscriptContext,
    options?: SimpleStreamOptions, deferred?: { handle: DeferredHandle; options?: DeferredFetchOptions }) => {
    const output = createAssistantMessageEventStream();
    let terminalUsage: Usage | undefined;
    let phase: ModelFailurePhase = "validation";
    let providerFailure: ModelFailure | undefined;
    let dispatchBudgetFailure: ModelFailure | undefined;
    let providerError: unknown;
    let scope: ReturnType<typeof taskModelRequestScope>;
    let codex: Awaited<ReturnType<HostCodexModelServices["bind"]>> | undefined;
    let request: Awaited<ReturnType<NonNullable<HostModelPolicy["prepareRequest"]>>>;
    let transportAbort: AbortController | undefined;
    let providerResult: { result(): Promise<AssistantMessage> } | undefined;
    let retentionAttempted = false;
    const retainTerminal = async (message: AssistantMessage) => {
      if (!request || retentionAttempted) return;
      retentionAttempted = true; // Never retry an entered retention callback on drain.
      await request.retainTerminal(message);
    };
    const captureTerminalUsage = (message: AssistantMessage) => {
      if (message.provider !== model.provider || message.model !== model.id || message.api !== model.api) return;
      const responseModel = message.responseModel ?? message.model;
      if (responseModel !== model.id && responseModel !== `${model.provider}/${model.id}`) return;
      const projected = usage(message.usage);
      if (!projected || ![projected.input, projected.output, projected.cacheRead, projected.cacheWrite, projected.totalTokens,
        ...Object.values(projected.cost)].every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)) return;
      terminalUsage = projected;
    };
    void (async () => {
      try {
        scope = taskModelRequestScope(options?.signal);
        model = validatedChatModel(model);
        context = freeze(data(context));
        if (deferred) {
          phase = "admission";
          if (!hostModelRuntime120.streamDeferred) throw new Error("Host operation unavailable");
          const admitted = await deferredAdmission(model, deferred.handle, deferred.options, "fetchDeferred");
          phase = "provider";
          const stream = hostModelRuntime120.streamDeferred(admitted.physical, admitted.raw, admitted.options);
          for await (const event of stream) {
            if (event.type === "error") { providerError = event.error; captureTerminalUsage(event.error); providerFailure = classifyModelFailure("provider", event.error); await request?.settle(event.error); throw new Error("Host request failed"); }
            if (event.type === "done") await request?.settle(event.message);
          output.push("message" in event ? { ...data({ ...event, message: undefined }), message: projectMessage(event.message, model) }
              : "partial" in event ? { ...data({ ...event, partial: undefined }), partial: projectMessage(event.partial, model) } : data(event));
          }
          const result = await stream.result();
          if (result.stopReason === "error" || result.stopReason === "aborted") { providerError = result; captureTerminalUsage(result); providerFailure = classifyModelFailure("provider", result); await request?.settle(result); throw new Error("Host request failed"); }
          output.end(projectMessage(result, model));
          return;
        }
        const hasImages = context.messages.some(message =>
          Array.isArray(message.content) && message.content.some(block => block.type === "image"));
        phase = "source";
        const assertSource = await policy.captureSourceGuard?.(options?.signal) ?? (() => {});
        assertSource();
        const observer = policy.captureEventObserver?.(options?.signal);
        let observerDetached = false;
        const assertEventCurrent = () => {
          if (!observer) return;
          phase = "source";
          const checked: unknown = observer.assertCurrent();
          if (checked !== undefined) {
            if (isPromise(checked)) void Promise.prototype.catch.call(checked, () => {});
            throw new TypeError("Model event authority must be synchronous");
          }
          phase = "provider";
        };
        const ref = { provider: model.provider, id: model.id };
        const listed = catalog.find((m) => (m.type ?? "chat") === "chat" && m.provider === ref.provider && m.id === ref.id);
        if ((model.type ?? "chat") !== "chat") throw new Error("Wrong model type");
        if (!listed || listed.api !== model.api) throw new Error("Model is not approved");
        transportAbort = new AbortController();
        const signal = AbortSignal.any([policy.signal, transportAbort.signal, ...(options?.signal ? [options.signal] : [])]);
        const safeOptions = requestOptions(options, !!policy.deferred);
        signal.throwIfAborted();
        phase = "admission";
        if (policy.prepareRequest) request = await policy.prepareRequest(model, { ...safeOptions, signal: options?.signal }, signal);
        if (request?.recoveredTerminal) {
          phase = 'source';
          captureTerminalUsage(request.recoveredTerminal);
          if (request.recoveredTerminal.stopReason === 'error' || request.recoveredTerminal.stopReason === 'aborted')
            providerFailure = parseModelFailure(request.recoveredTerminal.errorMessage);
          const guard = policy.assertStoredOutcomeCurrent, requestGuard = request.assertRecoveredCurrent?.bind(request);
          if (!guard || !requestGuard) throw Error('Stored model outcome authority unavailable');
          const checkStored = () => {
            phase = 'source'; signal.throwIfAborted(); assertSource();
            for (const check of [requestGuard, () => guard.call(policy, ref, signal)]) {
              const checked: unknown = check();
              if (checked !== undefined) {
                if (isPromise(checked)) void Promise.prototype.catch.call(checked, () => {});
                throw TypeError('Stored model outcome authority must be synchronous');
              }
            }
            const physical = hostModelRuntime120.getPhysicalModel(ref.provider, ref.id);
            if (!physical || (physical.type ?? 'chat') !== 'chat' || physical.provider !== ref.provider ||
              physical.id !== ref.id || physical.api !== listed.api) throw Error('Model owner changed');
            assertEventCurrent(); phase = 'source';
          };
          checkStored();
          const result = projectMessage(request.recoveredTerminal, model);
          checkStored();
          if (result.stopReason === 'error' || result.stopReason === 'aborted') output.push({ type: 'error', reason: result.stopReason, error: result });
          else if (result.stopReason === 'stop' || result.stopReason === 'length' || result.stopReason === 'toolUse') output.push({ type: 'done', reason: result.stopReason, message: result });
          else throw Error('Stored model outcome is not terminal');
          output.end(result); return;
        }
        await policy.authorize(ref, "chat", signal);
        signal.throwIfAborted();
        assertSource();
        policy.assertCurrent(ref, "chat", signal);
        // Resolve the physical owner again, never accept caller model overrides/routing.
        const assertPhysicalCompatible = () => {
          const current = hostModelRuntime120.getPhysicalModel(ref.provider, ref.id);
          if (!current || (current.type ?? "chat") !== "chat" || current.provider !== ref.provider ||
            current.id !== ref.id || current.api !== listed.api || current.reasoning !== (listed as Model<Api>).reasoning ||
            MODEL_THINKING_LEVELS.some(level => current.thinkingLevelMap?.[level] !== (listed as Model<Api>).thinkingLevelMap?.[level]) ||
            (hasImages && !current.input.includes("image"))) throw new Error("Model owner changed");
          if(requestCeilingFrame(current)!==requestCeilingFrame(listed as Model<Api>))throw new BudgetRequestError('budget_denied');
          return current;
        };
        const physical = freeze(data(assertPhysicalCompatible()));
        phase = "conversion";
        codex = await policy.codex?.bind(physical, signal, options?.signal);
        const hostOptions = { ...safeOptions, ...codex?.options, signal, transformHeaders: async (headers: Record<string, string | null>) => {
          try{
            signal.throwIfAborted();
            assertSource();
            policy.assertCurrent(ref, "chat", signal);
            assertPhysicalCompatible();
            await request?.dispatch();
            signal.throwIfAborted(); assertSource(); policy.assertCurrent(ref, "chat", signal); assertPhysicalCompatible();
            return codex ? codex.headers(headers) : headers; // Host-only closure: never sent to 1.3 or a caller callback.
          }catch(error){
            // Host admission may be serialised into an ordinary provider error
            // by the root transport. Retain only its exact budget classification.
            const failure=classifyModelFailure('admission',error);if(failure.category==='budget')dispatchBudgetFailure=failure;
            throw error;
          }
        } };
        phase = "provider";
        const stream = simple
          ? hostModelRuntime120.streamSimple(physical, codex ? codex.context(data(context)) : data(context), hostOptions)
          : hostModelRuntime120.stream(physical, codex ? codex.context(data(context)) : data(context), hostOptions);
        providerResult = stream;
        let terminalReason: Extract<AssistantMessageEvent, { type: "done" }>["reason"] | undefined;
        for await (const event of stream) {
          // The stream owns its complete result. Capture validated facts before
          // fences/UI work, without fallible serialization ahead of accounting.
          if (event.type === "error" || event.type === "done") {
            const message = event.type === "error" ? event.error : event.message;
            captureTerminalUsage(message);
            if (event.type === "done") terminalReason = event.reason;
            if (event.type === "error" || message.stopReason === "error" || message.stopReason === "aborted") {
              providerError = message;
              providerFailure = dispatchBudgetFailure ?? classifyModelFailure("provider", message);
            }
            // Retain original paid facts before mandatory fences or optional UI.
            // This database owner is independent of request/source cancellation.
            phase = 'accounting'; await retainTerminal(message); phase = 'provider';
          }
          assertEventCurrent();
          if (observer && !observerDetached) {
            try {
              const observed: unknown = observer.onEvent(data(event));
              if (isPromise(observed)) {
                void Promise.prototype.catch.call(observed, () => {});
                throw new TypeError("Model event observer must be synchronous");
              }
            } catch {
              observerDetached = true;
              log.warn("Native model observer detached", { operation: "durable_model.observer_failed", eventType: event.type,
                taskId: scope?.taskId, conversationId: scope?.conversationId });
            }
          }
          if (event.type === "error" || event.type === "done") continue;
          output.push("partial" in event ? { ...data({ ...event, partial: undefined }), partial: projectMessage(event.partial, model) } : data(event));
        }
        const result = await stream.result();
        captureTerminalUsage(result);
        if (result.stopReason === "error" || result.stopReason === "aborted") { providerError = result; providerFailure = dispatchBudgetFailure??classifyModelFailure("provider", result); }
        phase = 'accounting'; await retainTerminal(result); phase = 'provider';
        assertEventCurrent();
        phase = "accounting";
        await request?.settle(result);
        phase = "conversion";
        await codex?.finish();
        phase = 'source'; signal.throwIfAborted(); assertSource(); assertEventCurrent();
        if (providerFailure) { phase = "provider"; throw new Error("Host request failed"); }
        phase = 'conversion'; const message = projectMessage(result, model);
        phase = 'source'; signal.throwIfAborted(); assertSource(); assertEventCurrent();
        if (terminalReason !== undefined) output.push({ type: "done", reason: terminalReason, message });
        output.end(message);
      } catch (cause) {
        // Authority/projection failure must not leave the physical request running
        // after its SDK observer has ended. Optional UI failures never reach here.
        transportAbort?.abort(cause);
        if (providerResult) {
          let terminal: AssistantMessage | undefined;
          try {
            terminal = await providerResult.result();
            captureTerminalUsage(terminal);
            if (terminal.stopReason === "error" || terminal.stopReason === "aborted") {
              providerError = terminal;
              providerFailure = dispatchBudgetFailure ?? classifyModelFailure("provider", terminal);
            }
          } catch (error) {
            providerError ??= error;
            providerFailure ??= classifyModelFailure("provider", error);
            log.warn("Native provider result drain failed", { operation: "durable_model.provider_drain_failed",
              taskId: scope?.taskId, conversationId: scope?.conversationId });
          }
          if (terminal) {
            try { await retainTerminal(terminal); }
            catch {
              log.warn('Native drained terminal retention remains unresolved', { operation: 'durable_model.cleanup_failed', phase: 'accounting',
                taskId: scope?.taskId, conversationId: scope?.conversationId });
            }
          }
        }
        // Preserve the provider reason even when accounting/conversion fails next.
        const failure = providerFailure ? { ...providerFailure, phase } : classifyModelFailure(phase, cause);
        let evidenceId: string | undefined;
        try {
          const retained = await policy.retainFailure?.({ provider: model.provider, model: model.id, requestId: request?.id,
            scope: scope ? { conversationId: scope.conversationId, taskId: scope.taskId, kind: scope.taskKind } : undefined, failure, providerFailure, error: cause, providerError: providerError ?? (phase === "provider" ? cause : undefined) });
          if (retained !== undefined) { modelFailureDetail({ ...failure, evidenceId: retained }); evidenceId = retained; }
        } catch {
          log.warn("Native model failure evidence could not be retained", { operation: "durable_model.evidence_failed", phase, taskId: scope?.taskId, conversationId: scope?.conversationId });
        }
        log.warn("Native model request failed", { operation: "durable_model.request_failed", provider: model.provider,
          model: model.id, taskId: scope?.taskId, conversationId: scope?.conversationId, ...failure, ...(evidenceId ? { evidenceId } : {}) });
        try { await codex?.finish(); } catch {
          log.warn("Native model conversion cleanup remains unresolved", { operation: "durable_model.cleanup_failed", phase: "conversion", taskId: scope?.taskId, conversationId: scope?.conversationId });
        }
        // Persist only the bounded classification; never provider text or partial output.
        const error: AssistantMessage = { role: "assistant", content: [], api: model.api,
          provider: model.provider, model: model.id, timestamp: Date.now(),
          stopReason: "error", errorMessage: modelFailureDetail({ ...failure, ...(evidenceId ? { evidenceId } : {}) }),
          usage: terminalUsage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        output.push({ type: "error", reason: "error", error });
        // Finish reconciliation before publishing the terminal failure. An
        // uncertain accounting write leaves its durable hold intact. SDK error
        // terminals also cover unsent auth failures: only the reservation knows
        // whether to release an unsent request or retain a dispatched hold.
        try { await request?.abandon(); } catch {
          log.warn("Native model accounting remains unresolved", { operation: "durable_model.cleanup_failed", phase: "accounting", taskId: scope?.taskId, conversationId: scope?.conversationId });
        }
        output.end(error);
      }
    })();
    return output;
  };
  const operationFailure = async (model: AnyModel, phase: ModelFailure["phase"], cause: unknown, signal?: AbortSignal, providerError?: unknown) => {
    const failure = classifyModelFailure(phase, providerError ?? cause);
    let evidenceId: string | undefined;
    try {
      const scope = taskModelRequestScope(signal);
      const retained = await policy.retainFailure?.({ provider: model.provider, model: model.id,
        scope: scope ? { conversationId: scope.conversationId, taskId: scope.taskId, kind: scope.taskKind } : undefined,
        failure, error: cause, providerError: providerError ?? (phase === "provider" ? cause : undefined) });
      if (retained !== undefined) { modelFailureDetail({ ...failure, evidenceId: retained }); evidenceId = retained; }
    } catch {
      log.warn("Native model failure evidence could not be retained", { operation: "durable_model.evidence_failed", phase });
    }
    log.warn("Native model request failed", { operation: "durable_model.request_failed", provider: model.provider, model: model.id, ...failure, ...(evidenceId ? { evidenceId } : {}) });
    return modelFailureDetail({ ...failure, ...(evidenceId ? { evidenceId } : {}) });
  };
  const operationModel = (operation: "generateImages" | "classify", model: AnyModel) => {
    const type = operation === "generateImages" ? "image" : "classifier";
    const listed = catalog.find((m) => m.type === type && m.provider === model.provider && m.id === model.id);
    if (!listed || model.type !== type || listed.api !== model.api) throw new Error("Model is not approved");
    data(model);
    return listed;
  };
  const admit = async (operation: "generateImages" | "classify", model: AnyModel,
    options?: ImagesOptions | ClassifierOptions) => {
    const listed = operationModel(operation, model);
    const type = operation === "generateImages" ? "image" : "classifier";
    const safe = operationOptions(operation, options);
    const ref = { provider: listed.provider, id: listed.id, type } as const;
    const signal = options?.signal ? AbortSignal.any([options.signal, policy.signal]) : policy.signal;
    signal.throwIfAborted();
    await policy.authorize(ref, operation, signal);
    signal.throwIfAborted();
    policy.assertCurrent(ref, operation, signal);
    return { ...safe, signal, transformHeaders: (headers: Record<string, string | null>) => {
      signal.throwIfAborted();
      policy.assertCurrent(ref, operation, signal);
      return headers;
    } };
  };
  const physicalOfType = <T extends "image" | "classifier">(type: T, model: AnyModel) => {
    const physical = hostModelRuntime120.getModelOfType?.(type, model.provider, model.id);
    if (!physical || physical.type !== type || physical.api !== model.api ||
      physical.provider !== model.provider || physical.id !== model.id) throw new Error("Model owner changed");
    return physical;
  };
  const images = async (model: ImageModel<ImageApi>, context: ImagesContext, options?: ImagesOptions): Promise<AssistantImages> => {
    let phase: ModelFailure["phase"] = "admission", providerError: unknown;
    try {
      const hostOptions = await admit("generateImages", model, options);
      const physical = physicalOfType("image", model);
      if (!hostModelRuntime120.generateImages) throw new Error("Host operation is unavailable");
      phase = "provider";
      const result = await hostModelRuntime120.generateImages(physical, data(context), hostOptions);
      if (result.stopReason !== "stop") throw new Error("Host request failed");
      return data({ api: model.api, provider: model.provider, model: model.id, stopReason: "stop" as const,
        timestamp: result.timestamp, responseId: result.responseId, usage: usage(result.usage),
        output: result.output.map((part) => part.type === "image"
          ? { type: "image" as const, data: part.data, mimeType: part.mimeType }
          : { type: "text" as const, text: part.text }) });
    } catch (cause) {
      return { api: model.api, provider: model.provider, model: model.id, output: [],
        stopReason: "error", errorMessage: await operationFailure(model, phase, cause, options?.signal, providerError), timestamp: Date.now() };
    }
  };
  const classify = async (model: ClassifierModel<ClassifierApi>, context: ClassifierContext, options?: ClassifierOptions): Promise<ClassifierResult> => {
    let phase: ModelFailure["phase"] = "admission", providerError: unknown;
    try {
      const hostOptions = await admit("classify", model, options);
      const physical = physicalOfType("classifier", model);
      if (!hostModelRuntime120.classify) throw new Error("Host operation is unavailable");
      phase = "provider";
      const result = await hostModelRuntime120.classify(physical, data(context), hostOptions);
      if (result.stopReason !== "stop") throw new Error("Host request failed");
      return data({ api: model.api, provider: model.provider, model: model.id, stopReason: "stop" as const,
        timestamp: result.timestamp, usage: usage(result.usage),
        answers: Object.fromEntries(Object.entries(result.answers).map(([key, answer]) => [key,
          answer.type === "choice" ? { type: answer.type, choice: answer.choice,
            probabilities: Object.fromEntries(Object.entries(answer.probabilities)), confidence: answer.confidence }
            : answer.type === "score" ? { type: answer.type, score: answer.score, confidence: answer.confidence }
              : { type: answer.type, probability: answer.probability }])) });
    } catch (cause) {
      return { api: model.api, provider: model.provider, model: model.id, answers: {},
        stopReason: "error", errorMessage: await operationFailure(model, phase, cause, options?.signal, providerError), timestamp: Date.now() };
    }
  };
  const fetchDeferred = (model: Model<Api>, handle: DeferredHandle, options?: DeferredFetchOptions) =>
    relay(false, model, normalizeContext({ messages: [] }), undefined, { handle, options });
  const cancelDeferred = async (model: Model<Api>, handle: DeferredHandle, options?: DeferredCancelOptions) => {
    try {
      if (!hostModelRuntime120.cancelDeferred) throw new Error("Host operation unavailable");
      const admitted = await deferredAdmission(model, handle, options, "cancelDeferred");
      await hostModelRuntime120.cancelDeferred(admitted.physical, admitted.raw, admitted.options);
    } catch { throw new Error("Host deferred cancellation denied or failed"); }
  };
  for (const id of new Set(catalog.map((model) => model.provider))) {
    backing.setProvider(createProvider({ id, models: catalog.filter((m) => m.provider === id),
      auth: { apiKey: { name: "Host-owned authority (not credentials)",
        resolve: async () => ({ auth: {}, source: "host-bridge-keyless" }) } },
      images: Object.fromEntries(catalog.filter((m) => m.provider === id && m.type === "image")
        .map((m) => [m.api, { generateImages: images }])),
      classifiers: Object.fromEntries(catalog.filter((m) => m.provider === id && m.type === "classifier")
        .map((m) => [m.api, { classify }])),
      api: {
        fetchDeferred, cancelDeferred,
        stream: (model, context, options) => relay(false, model, context, options),
        streamSimple: (model, context, options) => relay(true, model, context, options),
      },
    }));
  }
  // Public factory implementation, not a partial Models cast. Guard mutation/auth UI
  // and request transforms before factory auth; getProvider exposes only our proxy.
  const chatMethods = new Set(["stream", "streamSimple", "complete", "completeSimple"]);
  return new Proxy(backing, {
    get(target, key) {
      if (["login", "logout", "setProvider", "deleteProvider", "clearProviders"].includes(String(key))) {
        return () => { throw new Error("Host auth UI/mutation is a separate scope"); };
      }
      const value = Reflect.get(target, key);
      // Bypass factory request preparation: no caller transforms/auth callbacks may run.
      if (key === "streamDeferred") return fetchDeferred;
      if (key === "fetchDeferred") return (model: Model<Api>, handle: DeferredHandle, options?: DeferredFetchOptions) => fetchDeferred(model, handle, options).result();
      if (key === "cancelDeferred") return cancelDeferred;
      if (key === "generateImages" || key === "classify") return async (
        model: AnyModel, context: ImagesContext | ClassifierContext, options?: ImagesOptions | ClassifierOptions,
      ) => {
        try {
          // Factory auth consumes transforms, so validate and copy BEFORE calling it.
          operationModel(key, model);
          const safe = operationOptions(key, options);
          return await Reflect.apply(value, target, [data(model), data(context), { ...safe, signal: options?.signal }]);
        } catch {
          return { api: model.api, provider: model.provider, model: model.id,
            ...(key === "generateImages" ? { output: [] } : { answers: {} }),
            stopReason: "error", errorMessage: "Host model request denied or failed", timestamp: Date.now() };
        }
      };
      if (chatMethods.has(String(key))) return (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => {
        const safeModel = validatedChatModel(model);
        const safeOptions = requestOptions(options, !!policy.deferred);
        return Reflect.apply(value, target, [safeModel, freeze(data(context)), { ...safeOptions, signal: options?.signal }]);
      };
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
  });
}
