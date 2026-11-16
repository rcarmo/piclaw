import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const [marker, pid] = process.argv.slice(2);
writeFileSync(pid!, String(process.pid));
let first: { id: number | string; result: unknown } | undefined;
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (!Object.hasOwn(message, "id")) continue;
  let result: unknown = {};
  if (message.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
  else if (message.method === "tools/list") result = { tools: [{ name: "echo", description: "Echo fixture", inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] }, annotations: { readOnlyHint: true } }] };
  else if (message.method === "tools/call") { appendFileSync(marker!, "call\n"); result = { content: [{ type: "text", text: message.params.arguments.message }], ...(message.params.arguments.message === "MCP_ERROR_SENTINEL" ? { isError: true } : {}) }; }
  if (message.method === "tools/call" && message.params.arguments.message === "MCP_DISCONNECT") process.exit(0);
  if (message.method === "tools/call" && message.params.arguments.message === "MCP_FIRST") {
    first = { id: message.id, result };
    continue; // Require the second call before completing either.
  }
  if (message.method === "tools/call" && message.params.arguments.message === "MCP_CATALOG_CHANGED") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }) + "\n");
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
  if (message.method === "tools/call" && message.params.arguments.message === "MCP_SECOND" && first) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...first }) + "\n");
    first = undefined;
  }
}
