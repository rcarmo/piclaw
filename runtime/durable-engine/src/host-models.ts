import {
  createModels, createProvider, createAssistantMessageEventStream, normalizeContext,
  type Api, type Model, type Models, type SimpleStreamOptions,
  type TranscriptContext, type AssistantMessage, type AnyModel, type ModelType,
  type ImageModel, type ImageApi, type ClassifierModel, type ClassifierApi,
  type ImagesContext, type ImagesOptions, type AssistantImages,
  type ClassifierContext, type ClassifierOptions, type ClassifierResult, type Usage,
  type DeferredHandle, type DeferredFetchOptions, type DeferredCancelOptions,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "../../../node_modules/@earendil-works/pi-coding-agent";

export interface ModelRef { provider: string; id: string; type?: ModelType }
type Operation = "chat" | "generateImages" | "classify";
type HostPort = Pick<ModelRuntime, "getPhysicalModel" | "stream" | "streamSimple"> &
  Partial<Pick<ModelRuntime, "getModelOfType" | "generateImages" | "classify" | "streamDeferred" | "cancelDeferred">>;
type DeferredOperation = "fetchDeferred" | "cancelDeferred";
export interface HostModelPolicy {
  /** Invocation-local source fence retained through asynchronous credential resolution. */
  captureSourceGuard?(signal: AbortSignal | undefined): () => void;
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
  "reasoning", "thinkingBudgets", "toolChoice", "maxRetryDelayMs", "maxRetries",
]);
function requestOptions(options: SimpleStreamOptions = {}, deferred = false): SimpleStreamOptions {
  if (Object.getPrototypeOf(options) !== Object.prototype) throw new Error("Only JSON data is qualified");
  for (const [key, value] of Object.entries(options)) {
    if (key !== "signal" && value !== undefined && !optionKeys.has(key) && !(deferred && key === "deferred")) {
      throw new Error(`Unqualified request option: ${key}`);
    }
  }
  if (options.maxRetries !== undefined && options.maxRetries !== 0) {
    throw new Error("Transport retries are not qualified");
  }
  const { signal: _signal, ...rest } = options;
  return { ...data(rest), maxRetries: 0 };
}

function catalogCost(cost: AnyModel["cost"]): AnyModel["cost"] {
  const rates = (c: AnyModel["cost"]) => ({ input: c.input, output: c.output, cacheRead: c.cacheRead, cacheWrite: c.cacheWrite });
  return { ...rates(cost), tiers: cost.tiers?.map((tier) => ({ ...rates(tier), inputTokensAbove: tier.inputTokensAbove })) };
}
function usage(value?: Usage): Usage | undefined {
  return value && { input: value.input, output: value.output, cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite, totalTokens: value.totalTokens,
    cost: { input: value.cost.input, output: value.cost.output, cacheRead: value.cost.cacheRead,
      cacheWrite: value.cost.cacheWrite, total: value.cost.total } };
}
function operationOptions(operation: "generateImages" | "classify", options: ImagesOptions | ClassifierOptions = {}) {
  if (Object.getPrototypeOf(options) !== Object.prototype) throw new Error("Only JSON data is qualified");
  const allowed = new Set(["timeoutMs", "maxRetries", "maxRetryDelayMs",
    operation === "generateImages" ? "metadata" : "temperature"]);
  for (const [key, value] of Object.entries(options)) {
    if (key !== "signal" && value !== undefined && !allowed.has(key)) throw new Error("Unqualified request option");
  }
  if (options.maxRetries !== undefined && options.maxRetries !== 0) throw new Error("Transport retries are not qualified");
  const { signal: _signal, ...rest } = options;
  const safe = data(rest);
  const extra = operation === "generateImages" && "metadata" in safe ? { metadata: safe.metadata }
    : operation === "classify" && "temperature" in safe ? { temperature: safe.temperature } : {};
  return { timeoutMs: safe.timeoutMs, maxRetryDelayMs: safe.maxRetryDelayMs, ...extra, maxRetries: 0 };
}

/** Inactive bridge: physical models; no credential transfer or production wiring.
 * 1.2 and 1.3 public Models declarations match. A 1.3 factory owns the complete
 * interface; operation callbacks adapt public host dispatch. Deferred execution
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
      if (value !== undefined && !["signal", "timeoutMs", "maxRetries", "maxRetryDelayMs", ...(cancel ? [] : ["wait"])].includes(key)) throw new Error("Invalid options");
    }
    if (options.maxRetries !== undefined && options.maxRetries !== 0) throw new Error("Retries denied");
    const { signal: _signal, ...rest } = options;
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
    void (async () => {
      try {
        model = validatedChatModel(model);
        context = freeze(data(context));
        if (deferred) {
          if (!hostModelRuntime120.streamDeferred) throw new Error("Host operation unavailable");
          const admitted = await deferredAdmission(model, deferred.handle, deferred.options, "fetchDeferred");
          const stream = hostModelRuntime120.streamDeferred(admitted.physical, admitted.raw, admitted.options);
          for await (const event of stream) {
            if (event.type === "error") throw new Error("Host request failed");
            output.push("message" in event ? { ...data({ ...event, message: undefined }), message: projectMessage(event.message, model) }
              : "partial" in event ? { ...data({ ...event, partial: undefined }), partial: projectMessage(event.partial, model) } : data(event));
          }
          const result = await stream.result();
          if (result.stopReason === "error" || result.stopReason === "aborted") throw new Error("Host request failed");
          output.end(projectMessage(result, model));
          return;
        }
        const assertSource = policy.captureSourceGuard?.(options?.signal) ?? (() => {});
        assertSource();
        const ref = { provider: model.provider, id: model.id };
        const listed = catalog.find((m) => (m.type ?? "chat") === "chat" && m.provider === ref.provider && m.id === ref.id);
        if ((model.type ?? "chat") !== "chat") throw new Error("Wrong model type");
        if (!listed || listed.api !== model.api) throw new Error("Model is not approved");
        const signal = options?.signal
          ? AbortSignal.any([options.signal, policy.signal]) : policy.signal;
        const safeOptions = requestOptions(options, !!policy.deferred);
        signal.throwIfAborted();
        await policy.authorize(ref, "chat", signal);
        signal.throwIfAborted();
        assertSource();
        policy.assertCurrent(ref, "chat", signal);
        // Resolve the physical owner again, never accept caller model overrides/routing.
        const physical = hostModelRuntime120.getPhysicalModel(ref.provider, ref.id);
        if (!physical || physical.api !== listed.api) throw new Error("Model owner changed");
        const hostOptions = { ...safeOptions, signal, transformHeaders: (headers: Record<string, string | null>) => {
          signal.throwIfAborted();
          assertSource();
          policy.assertCurrent(ref, "chat", signal);
          return headers; // Host-only closure: never sent to 1.3 or a caller callback.
        } };
        const stream = simple
          ? hostModelRuntime120.streamSimple(physical, data(context), hostOptions)
          : hostModelRuntime120.stream(physical, data(context), hostOptions);
        for await (const event of stream) {
          if (event.type === "error") throw new Error("Host request failed");
          output.push("message" in event ? { ...data({ ...event, message: undefined }), message: projectMessage(event.message, model) }
            : "partial" in event ? { ...data({ ...event, partial: undefined }), partial: projectMessage(event.partial, model) } : data(event));
        }
        const result = await stream.result();
        if (result.stopReason === "error" || result.stopReason === "aborted") throw new Error("Host request failed");
        output.end(projectMessage(result, model));
      } catch {
        // Host errors can contain credentials/headers. Do not export them.
        const error: AssistantMessage = { role: "assistant", content: [], api: model.api,
          provider: model.provider, model: model.id, timestamp: Date.now(),
          stopReason: "error", errorMessage: "Host model request denied or failed",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        output.push({ type: "error", reason: "error", error });
        output.end(error);
      }
    })();
    return output;
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
    try {
      const hostOptions = await admit("generateImages", model, options);
      const physical = physicalOfType("image", model);
      if (!hostModelRuntime120.generateImages) throw new Error("Host operation is unavailable");
      const result = await hostModelRuntime120.generateImages(physical, data(context), hostOptions);
      if (result.stopReason !== "stop") throw new Error("Host request failed");
      return data({ api: model.api, provider: model.provider, model: model.id, stopReason: "stop" as const,
        timestamp: result.timestamp, responseId: result.responseId, usage: usage(result.usage),
        output: result.output.map((part) => part.type === "image"
          ? { type: "image" as const, data: part.data, mimeType: part.mimeType }
          : { type: "text" as const, text: part.text }) });
    } catch {
      return { api: model.api, provider: model.provider, model: model.id, output: [],
        stopReason: "error", errorMessage: "Host model request failed", timestamp: Date.now() };
    }
  };
  const classify = async (model: ClassifierModel<ClassifierApi>, context: ClassifierContext, options?: ClassifierOptions): Promise<ClassifierResult> => {
    try {
      const hostOptions = await admit("classify", model, options);
      const physical = physicalOfType("classifier", model);
      if (!hostModelRuntime120.classify) throw new Error("Host operation is unavailable");
      const result = await hostModelRuntime120.classify(physical, data(context), hostOptions);
      if (result.stopReason !== "stop") throw new Error("Host request failed");
      return data({ api: model.api, provider: model.provider, model: model.id, stopReason: "stop" as const,
        timestamp: result.timestamp, usage: usage(result.usage),
        answers: Object.fromEntries(Object.entries(result.answers).map(([key, answer]) => [key,
          answer.type === "choice" ? { type: answer.type, choice: answer.choice,
            probabilities: Object.fromEntries(Object.entries(answer.probabilities)), confidence: answer.confidence }
            : answer.type === "score" ? { type: answer.type, score: answer.score, confidence: answer.confidence }
              : { type: answer.type, probability: answer.probability }])) });
    } catch {
      return { api: model.api, provider: model.provider, model: model.id, answers: {},
        stopReason: "error", errorMessage: "Host model request failed", timestamp: Date.now() };
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
