// SPDX-License-Identifier: Apache-2.0
// Adapted from sakebomb/mcp-recall src/denylist.ts at 2db17d6d01d965e4181a8f18c674561baa588a24.
// No allowlist bypass: sensitive results remain available to the original call, never to recall.
import { containsSecret } from "./secrets.ts";
const sensitiveTools = ["mcp__recall__", "mcp__1password__", "mcp__bitwarden__", "mcp__lastpass__", "mcp__dashlane__", "mcp__keeper__", "mcp__hashicorp_vault__", "mcp__vault__", "mcp__doppler__", "mcp__infisical__"];
export function recallStorageAllowed(tool: string, raw: string): boolean {
  const name = tool.toLowerCase();
  return !sensitiveTools.some(prefix => name.startsWith(prefix))
    && !/secret|password|credential|token|api_key|access_key|private_key|signing_key|encrypt.*key|oauth|authenticate|env_var|dotenv/.test(name)
    && !containsSecret(raw)
    // Envelopes can contain JSON text escaped inside a text block.
    && !containsSecret(raw.replaceAll('\\"', '"'));
}
