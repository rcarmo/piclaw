/** Resolve one model/auth tuple shared by selective and progressive execution. */
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getCompactionRuntimeConfig } from "../../core/config.js";
import type { ModelRequestAuth } from "../../utils/model-auth.js";
import { resolveModelRequestAuth } from "../../utils/model-auth.js";

export type SmartCompactionModelRequest =
  | { ok: true; model: any; auth: Extract<ModelRequestAuth, { ok: true }> }
  | { ok: false; error: string };

export async function resolveSmartCompactionModelRequest(ctx: {
  model?: unknown;
}, modelRuntime: unknown, options: { resolveDirectRequestAuth?: boolean; useConfiguredModel?: boolean } = {}): Promise<SmartCompactionModelRequest> {
  if (!modelRuntime) return { ok: false, error: "No model runtime is available for smart compaction" };

  let model = ctx.model as any;
  if (options.useConfiguredModel) {
    const configured = getCompactionRuntimeConfig().compactionModel.trim();
    if (configured) {
      const separator = configured.indexOf("/");
      if (separator <= 0 || separator === configured.length - 1) {
        return { ok: false, error: `Configured compaction model must use provider/model syntax: ${configured}` };
      }
      const provider = configured.slice(0, separator);
      const modelId = configured.slice(separator + 1);
      model = (modelRuntime as Pick<ModelRuntime, "getModel">).getModel?.(provider, modelId);
      if (!model) return { ok: false, error: `Configured compaction model is unavailable: ${configured}` };
    }
  }
  if (!model) return { ok: false, error: "No model is available for smart compaction" };
  if (!options.resolveDirectRequestAuth) return { ok: true, model, auth: { ok: true } };

  const auth = await resolveModelRequestAuth(modelRuntime as any, model);
  if (!auth.ok) return { ok: false, error: auth.error };
  const resolvedModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
  return { ok: true, model: resolvedModel, auth };
}
