import type { Api, Model, ProviderStreams, SimpleStreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import { streamSimple as completions } from "@earendil-works/pi-ai/api/openai-completions";
import { streamSimple as responses } from "@earendil-works/pi-ai/api/openai-responses";
import { streamSimple as azure } from "@earendil-works/pi-ai/api/azure-openai-responses";
import { clampMaxTokensToContext, resolveSamplingParams } from "@earendil-works/pi-ai/api/simple-options";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { operationSignal, raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export type SimpleRequestPreview =
  | { readonly status: "bounded"; readonly maxOutputTokens: number; readonly reserveTokens: number; readonly authIndependent: boolean }
  | { readonly status: "unknown"; readonly reason: "unsupported" | "payload_hook" | "auth_dependent" | "missing_output_limit" | "invalid_output_limit" | "ambiguous_output_limit" | "request_override" };
type Preview = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) => Promise<SimpleRequestPreview>;
const unknown = (reason: Extract<SimpleRequestPreview, { status: "unknown" }>["reason"]): SimpleRequestPreview => Object.freeze({ status: "unknown", reason });
const outputFields = ["max_tokens", "max_completion_tokens", "max_output_tokens"];

/** Unmodified SDK adapter wrapper. Its own onPayload stops BEFORE a request.
 * No runtime-provider/auth callbacks or caller hooks run. The SDK constructs a local client;
 * a fail-closed provided fetch prevents transport even if its hook order changes.
 * Only the bounded summary escapes; no request payload is retained or returned.
 */
export const previewSdkRequest: Preview = async (model, context, options = {}) => {
  const signal = operationSignal(options.signal);
  signal.throwIfAborted();
  if (options.onPayload || options.onResponse || options.onProviderStreamEvent) return unknown("payload_hook");
  const sampling = resolveSamplingParams(model, options.reasoning ?? "off", options.samplingParams);
  if (["model", "messages", "input", "tools"].some(key => sampling && key in sampling)) return unknown("request_override");
  const maxField = model.api === "openai-completions" ? (model as Model<"openai-completions">).compat?.maxTokensField : undefined;
  const api = (model.api === "openai-completions" ? completions : model.api === "openai-responses" ? responses : model.api === "azure-openai-responses" ? azure : undefined) as ProviderStreams["streamSimple"] | undefined;
  if (!api) return unknown("unsupported");
  if (model.api === "openai-completions" && !maxField && outputFields.some(key => sampling && key in sampling)) return unknown("auth_dependent");
  // Official Responses auth may switch the request mode/omit its output field.
  if (model.api === "openai-responses" && model.provider === "openai") return unknown("auth_dependent");
  let captured: SimpleRequestPreview | undefined;
  const stop = new Error("Piclaw metadata-only request preview");
  let transportAttempted = false;
  const block = () => { transportAttempted = true; throw stop; };
  const fetch = Object.assign(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => block(), { preconnect: block });
  const safeModel = { ...model, headers: undefined };
  try {
    const stream = api(safeModel, context, { ...options, signal, apiKey: "piclaw-preview-not-a-credential", headers: {}, env: {},
      maxRetries: 0, fetch, telemetry: undefined, onResponse: undefined, onProviderStreamEvent: undefined,
      onPayload(payload) {
        const body = payload as Record<string, unknown>;
        const field = model.api === "openai-completions" ? maxField ?? outputFields.find(key => body[key] != null) : "max_output_tokens";
        const limit = field && body[field];
        if (outputFields.filter(key => body[key] != null).length > 1) captured = unknown("ambiguous_output_limit");
        else if (limit == null) captured = unknown("missing_output_limit");
        else if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit <= 0) captured = unknown("invalid_output_limit");
        else {
          // Derive the SDK's allowance from its PUBLIC clamp, never copy its
          // private safety constant or mistake the helper for the final cap.
          // An unsaturated probe avoids hiding that allowance behind the
          // clamp's one-token floor for a genuinely too-small candidate.
          const window = Number.MAX_SAFE_INTEGER;
          const room = clampMaxTokensToContext({ ...model, contextWindow: window }, context, window);
          const allowance = window - estimateContextTokens(context).tokens - room;
          captured = Number.isSafeInteger(allowance) && allowance >= 0 && Number.isSafeInteger(limit + allowance)
            ? Object.freeze({ status: "bounded", maxOutputTokens: limit, reserveTokens: limit + allowance, authIndependent: true })
            : unknown("invalid_output_limit");
        }
        throw stop;
      },
    });
    await raceWithAbortSignal(stream.result(), signal);
  } catch (error) { signal.throwIfAborted(); if (error !== stop) return unknown("unsupported"); }
  signal.throwIfAborted();
  return transportAttempted ? unknown("unsupported") : captured ?? unknown("unsupported");
};

type Runtime = Partial<Pick<ModelRuntime, "getProvider" | "getRegisteredNativeProvider" | "getRegisteredProviderConfig">>;
/** Public runtime inspection only. Unrecognised native/extension transports are
 * unknown; matching an API name alone never certifies their implementation.
 */
export async function previewHostRequest(runtime: Runtime, model: Model<Api>, context: TranscriptContext, options: SimpleStreamOptions): Promise<SimpleRequestPreview> {
  const signal = operationSignal(options.signal);
  signal.throwIfAborted();
  const provider = runtime.getProvider?.(model.provider);
  if (!provider || provider.id !== model.provider) return unknown("unsupported");
  const extension = runtime.getRegisteredProviderConfig?.(model.provider);
  if (extension?.streamSimple && extension.api === model.api) return unknown("unsupported");
  if (!runtime.getRegisteredNativeProvider || !runtime.getRegisteredProviderConfig || runtime.getRegisteredNativeProvider(model.provider)) return unknown("unsupported");
  const builtin = getBuiltinProviders().find(id => id === model.provider);
  if (!builtin || !getBuiltinModels(builtin).some(value => value.api === model.api)) return unknown("unsupported");
  return previewSdkRequest(model, context, options);
}
