import type { Api, Model } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

const IDS = [
  "au.anthropic.claude-opus-5",
  "eu.anthropic.claude-opus-5",
  "global.anthropic.claude-opus-5",
  "in.anthropic.claude-opus-5",
  "us.anthropic.claude-opus-5",
] as const;

/** Snapshot fixtures at module load before other tests can mutate shared catalog objects. */
const SNAPSHOT = (() => {
  const byId = new Map(getBuiltinModels("amazon-bedrock").map((model) => [model.id, model]));
  return IDS.map((id) => {
    const model = byId.get(id);
    if (!model) throw new Error(`Missing Amazon Bedrock Opus 5 catalog model: ${id}`);
    return {
      ...model,
      input: [...model.input],
      cost: { ...model.cost },
      thinkingLevelMap: { ...model.thinkingLevelMap },
      ...(model.compat ? { compat: { ...model.compat } } : {}),
      ...(model.headers ? { headers: { ...model.headers } } : {}),
    } as Model<Api>;
  });
})();

export function bedrockOpus5Fixtures(): Model<Api>[] {
  return SNAPSHOT.map((model) => ({ ...model, thinkingLevelMap: { ...model.thinkingLevelMap } } as Model<Api>));
}
