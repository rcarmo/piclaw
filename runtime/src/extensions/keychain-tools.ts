/** Retained extension adapter for the read-only keychain inventory. */
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { keychainInstructions, keychainInventoryDescription, keychainInventoryParameters, readKeychainInventory } from "../secure/keychain-inventory.js";
import { toolCallSummary } from "../tool-call-summary.js";

export const keychainTools: ExtensionFactory = (pi) => {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${keychainInstructions}`,
  }));
  pi.registerTool({
    name: "keychain",
    label: "keychain",
    description: keychainInventoryDescription,
    promptSnippet: "keychain: list local credential references and shell variable names without reading values.",
    parameters: keychainInventoryParameters,
    ...toolCallSummary(() => "List entries"),
    async execute(_toolCallId, params) {
      return readKeychainInventory(params);
    },
  });
};
