import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { TSchema } from "typebox";
import type { JsonValue } from "@earendil-works/chord/json";
import type { HostConversationRuntime } from "./host-runtime.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { createHostTool } from "./host-tools.js";

export type WorkspaceFileOpener = (chatJid: string, path: string, label: string) => Promise<unknown>;
export interface DrawioNativeExports {
  handleRoute(req: Request, pathname: string): Response | Promise<Response> | null;
  createDrawioEditorTool(options?: { cwd: string; authority: { assertCurrent(): void; openWorkspaceFile?(path: string): Promise<any> } }): ToolDefinition<TSchema, JsonValue>;
  getDrawioVendorCacheDir(dataDir: string): string;
  bindDrawioVendorHost(options: { assertCurrent(): void; baseDir: string; cwd: string; cacheDir: string }): { prepare(): Promise<void>; close(): Promise<void> };
}

/** Filesystem effects are fenced, not SQL-transactional or exactly-once. */
export function createHostDrawioTool(addon: DrawioNativeExports, options: {
  root: Database; cwd: string; assertOwner(): void;
  runtime(): Pick<HostConversationRuntime, "captureToolSource" | "assertCapturedSourceCurrent">;
  opener(): WorkspaceFileOpener | undefined;
}) {
  const definition = addon.createDrawioEditorTool();
  if (definition.name !== "open_drawio_editor") throw Error("Expected installed Draw.io tool");
  return createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      const params = structuredClone(args);
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const opener = options.opener();
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); }, true);
      const primary = captured.inputs.find(input => input.sourceSeq === captured.operation.primarySourceSeq);
      const check = () => {
        authority.assertCurrent();
        options.runtime().assertCapturedSourceCurrent(captured.inputs);
        if (!primary || (!captured.native && !captured.operation.harness) || !captured.inputs.length || captured.delegateModel ||
          !captured.operation.chatJid.startsWith("web:") || captured.inputs.some(input =>
            input.chatJid !== captured.operation.chatJid || (!captured.native && input.operationId !== captured.operation.operationId) || input.branchId !== primary.branchId ||
            !options.root.query("SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=? AND kind='message'").get(input.chatJid, input.sourceSeq)) ||
          !options.root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL AND handle_owner_id=''").get(primary.chatJid, primary.branchId))
          throw Error("Draw.io requires current foreground web source");
      };
      check();
      const tool = addon.createDrawioEditorTool({ cwd: options.cwd, authority: {
        assertCurrent: check,
        async openWorkspaceFile(path) {
          check();
          if (!opener) throw Error("Draw.io channel opener unavailable");
          const result = await opener(primary!.chatJid, path, path.split("/").pop() || "diagram.drawio");
          check();
          return result;
        },
      } });
      const result = await tool.execute(call.toolCallId, params, call.signal, call.onUpdate, undefined as never);
      check();
      return result;
    },
  }, { callers: ["model", "tools"] });
}
