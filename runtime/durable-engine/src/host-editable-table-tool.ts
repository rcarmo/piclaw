import type { Database } from "bun:sqlite";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { TSchema } from "typebox";
import type { JsonValue } from "@earendil-works/chord/json";
import type { HostConversationRuntime } from "./host-runtime.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { createHostTool } from "./host-tools.js";

export interface EditableTableWidgetPort {
  readonly available: boolean;
  publishWidget(key: string, content: string[], options: { extension: string; surface: string; title: string; instructions: string; markdown_table: string; headers: string[]; rows: string[][] }): void;
}
export interface EditableTableNativeExports {
  createEditableTableTool(port?: EditableTableWidgetPort): ToolDefinition<TSchema, JsonValue>;
}
export type WidgetPublisher = (chatJid: string, key: string, content: string[], options: Parameters<EditableTableWidgetPort["publishWidget"]>[2]) => void;

export function createHostEditableTableTool(addon: EditableTableNativeExports, options: {
  root: Database;
  assertOwner(): void;
  runtime(): Pick<HostConversationRuntime, "captureToolSource" | "assertCapturedSourceCurrent">;
  publisher(): WidgetPublisher | undefined;
}) {
  const definition = addon.createEditableTableTool();
  if (definition.name !== "editable_table") throw Error("Expected installed editable_table tool");
  return createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      const params = structuredClone(args);
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const publisher = options.publisher();
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); }, true);
      const primary = captured.inputs.find(input => input.sourceSeq === captured.operation.primarySourceSeq);
      const check = () => {
        authority.assertCurrent();
        options.runtime().assertCapturedSourceCurrent(captured.inputs);
        if (!primary || (!captured.native && !captured.operation.harness) || !captured.inputs.length || captured.delegateModel ||
          !captured.operation.chatJid.startsWith("web:") || captured.inputs.some(input => !options.root.query("SELECT 1 FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=? AND kind='message'").get(input.chatJid, input.sourceSeq) ||
            input.chatJid !== captured.operation.chatJid || (!captured.native && input.operationId !== captured.operation.operationId) || input.branchId !== primary.branchId) ||
          !options.root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL AND handle_owner_id=''").get(primary.chatJid, primary.branchId))
          throw Error("Editable table requires current foreground web source");
        if (!publisher) throw Error("Editable table channel unavailable");
      };
      check();
      const tool = addon.createEditableTableTool({ available: true, publishWidget(key, content, widgetOptions) {
        check();
        publisher!(primary!.chatJid, key, content, widgetOptions);
        check();
      } });
      const result = await tool.execute(call.toolCallId, params, call.signal, call.onUpdate, undefined as never);
      check();
      return result;
    },
  }, { callers: ["model", "tools"] });
}
