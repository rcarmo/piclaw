import { describe, expect, test } from "bun:test";

import { PROVIDER_DEFS } from "../../src/agent-control/provider-defs.js";
import { bedrockOpus5Fixtures } from "../fixtures/bedrock-opus5.js";

describe("Amazon Bedrock Claude Opus 5", () => {
  test("provider definition stays external-auth and non-fatal without credentials", () => {
    expect(PROVIDER_DEFS.find((entry) => entry.id === "amazon-bedrock")).toMatchObject({
      name: "Amazon Bedrock",
      hasApiKey: false,
      hasOAuth: false,
      hasExternalAuth: true,
    });
  });

  test("catalog exposes regional inference profiles with native xhigh metadata", () => {
    const opusProfiles = bedrockOpus5Fixtures();

    expect(opusProfiles.map((model) => model.id).sort()).toEqual([
      "au.anthropic.claude-opus-5",
      "eu.anthropic.claude-opus-5",
      "global.anthropic.claude-opus-5",
      "in.anthropic.claude-opus-5",
      "us.anthropic.claude-opus-5",
    ]);
    for (const model of opusProfiles) {
      expect(model).toMatchObject({
        provider: "amazon-bedrock",
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        reasoning: true,
        thinkingLevelMap: expect.objectContaining({ xhigh: "xhigh", max: "max" }),
      });
    }
  });
});
