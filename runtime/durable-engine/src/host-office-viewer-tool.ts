import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { TSchema } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord";
import { realpathSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { HostConversationRuntime } from "./host-runtime.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { createHostTool } from "./host-tools.js";

/** Pinned registered execute has plain arguments, no context and no internal
 * await: its only effects are synchronous filesystem existence checks and URL
 * construction. This bounded workspace-only port does not widen raw HTTP policy.
 * Never change cwd: absolute arguments also work when host cwd differs in tests. */
export function createHostOfficeViewerTool(definition: ToolDefinition<TSchema, JsonValue>, options: {
  root: Database;
  workspace: string;
  assertOwner(): void;
  runtime(): Pick<HostConversationRuntime, "captureToolSource" | "assertCapturedSourceCurrent">;
}) {
  if (definition.name !== "open_office_viewer") throw Error("Expected installed open_office_viewer tool");
  return createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      const params = structuredClone(args) as { path: string };
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); }, true);
      const primary = captured.inputs.find(input => input.sourceSeq === captured.operation.primarySourceSeq);
      const check = () => {
        authority.assertCurrent();
        options.runtime().assertCapturedSourceCurrent(captured.inputs);
        if (!primary || (!captured.native && !captured.operation.harness) || !captured.inputs.length || captured.delegateModel ||
          !captured.operation.chatJid.startsWith("web:") || captured.inputs.some(input =>
            !options.root.query("SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=? AND kind='message'").get(input.chatJid, input.sourceSeq) ||
            input.chatJid !== captured.operation.chatJid || (!captured.native && input.operationId !== captured.operation.operationId) || input.branchId !== primary.branchId) ||
          !options.root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL AND handle_owner_id=''").get(primary.chatJid, primary.branchId))
          throw Error("Office viewer requires current foreground web source");
      };
      check();
      if (typeof params.path !== "string") throw Error("Expected Office path");
      const workspace = realpathSync(options.workspace);
      const inside = (path: string) => { const rel = relative(workspace, path); return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel); };
      const callerPath = resolve(workspace, params.path.replace(/^@/, ""));
      if (!inside(callerPath)) throw Error("Office path outside workspace");
      check();
      const canonical = realpathSync(callerPath);
      if (!inside(canonical)) throw Error("Office path outside workspace");
      check();
      if (!statSync(canonical).isFile()) throw Error("Office path is not a regular file");
      // No await between the last fence and the actual registered execute body.
      check();
      const result = await call.execute(call.toolCallId, { path: callerPath }, call.signal, call.onUpdate, undefined as never);
      check();
      return result;
    },
  }, { callers: ["model", "tools"] });
}
