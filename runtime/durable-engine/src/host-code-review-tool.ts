import { admitSqliteWrite, type SyncSqliteOperation } from "../../src/db/sqlite-async-admission.js";
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import type { ToolDefinition } from "../../src/durable-legacy-sdk.js";
import type { TSchema } from "@earendil-works/pi-ai";
import type { JsonValue } from "@earendil-works/chord";
import type { HostConversationRuntime } from "./host-runtime.js";
import { createHostOperationAuthority } from "./host-operation-authority.js";
import { createHostTool } from "./host-tools.js";

export interface CodeReviewNativeExports {
  createCodeReviewTool(policy: { resolve(): Promise<{
    service: unknown;
    identity: { ownerId: string; actorId: string; kind: "agent"; workspaceId: string; chatId: string;
      chatIncarnation: string; reference: { addonId: "code-review"; intentId: string } };
    workspaceRoot: string;
    assertCurrent(): void;
    write?<T>(body: SyncSqliteOperation<T>): T | Promise<T>;
  }> }): ToolDefinition<TSchema, JsonValue>;
  reviewService(): unknown;
  prepareReviewService(): Promise<unknown>;
  setReviewDatabaseSource(source: { database: Database; assertOwner(): void; admitWrite?<T>(body: SyncSqliteOperation<T>): Promise<T> }): () => void;
  closeReviewServices(): void;
}
const unavailable = () => ({ content: [{ type: "text" as const, text: "Unsupported Code Review action or arguments." }],
  details: { status: "unavailable" }, isError: true });

/** The installed PUBLIC factory owns schema and read execution. This adapter
 * supplies only root policy and exact accepted-message dispatch provenance. */
export function createHostCodeReviewTool(addon: CodeReviewNativeExports, options: {
  root: Database;
  cwd: string;
  assertOwner(): void;
  runtime(): Pick<HostConversationRuntime, "captureToolSource" | "assertCapturedSourceCurrent">;
}) {
  const definition = addon.createCodeReviewTool({ async resolve() { throw Error("Invocation-local Code Review authority required"); } });
  if (definition.name !== "code_review") throw Error("Expected installed Code Review tool");
  return createHostTool(definition, {
    authority: { check: options.assertOwner }, effectFence: "host-effect-port", replay: "unsafe",
    async invoke(args, call) {
      call.assertAllowed();
      if (!args || typeof args !== "object" || (Object.getPrototypeOf(args) !== Object.prototype && Object.getPrototypeOf(args) !== null))
        throw Error("Plain Code Review arguments required");
      const params = structuredClone(args) as Record<string, unknown>;
      // Reject unknown actions and client authority before SQL.
      const writing = ["reply", "edit", "deleteMessage", "resolve", "work"].includes(String(params.action));
      const allowed = writing ? ["action", "reviewId", "dispatchId", "threadId", "messageId", "requestId", "expectedVersion", "assignmentEpoch", "body", "explanation", "evidence", "fileId", "confirm", "state", "itemVersion", "threadVersion"] : ["action", "dispatchId", "reviewId", "threadId", "after", "limit"];
      if ((!writing && !["dispatches", "dispatch", "threads", "thread"].includes(String(params.action))) ||
        Object.keys(params).some(key => !allowed.includes(key))) return unavailable();
      const captured = await options.runtime().captureToolSource(call.conversationId, call.taskId, call.toolCallId);
      const authority = createHostOperationAuthority(options.root, captured, () => { call.assertAllowed(); options.assertOwner(); }, !writing);
      const primary = captured.inputs.find(input => input.sourceSeq === captured.operation.primarySourceSeq);
      const workspaceRoot = realpathSync(options.cwd);
      const check = () => {
        authority.assertCurrent();
        options.runtime().assertCapturedSourceCurrent(captured.inputs);
        if (!primary || !captured.operation.harness || !captured.inputs.length || realpathSync(options.cwd) !== workspaceRoot ||
          captured.inputs.some(input => input.chatJid !== captured.operation.chatJid || input.operationId !== captured.operation.operationId ||
            input.branchId !== primary.branchId || !options.root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL AND handle_owner_id='' AND chat_jid LIKE 'web:%'").get(input.chatJid, input.branchId)))
          throw Error("Stale Code Review source authority");
      };
      check();
      // Read the original host message, not model text, tool arguments, a busy
      // chat lookup, or an owner-wide review directory. No new authority ledger.
      const resolveReference = () => {
        check();
        const input = primary!;
        const row = (/^message-row:[1-9][0-9]*$/.test(input.payloadRef)
          ? options.root.query("SELECT id, content, content_blocks FROM messages WHERE rowid=? AND chat_jid=?").get(Number(input.payloadRef.slice(12)), input.chatJid)
          : input.payloadRef === `queued-source:${input.sourceId}`
            ? options.root.query("SELECT id, content, content_blocks FROM messages WHERE id=? AND chat_jid=?").get(input.sourceId, input.chatJid) : null) as { id: string; content: string; content_blocks: string | null } | null;
        if (!row || row.id !== input.sourceId) throw Error("Code Review dispatch source unavailable");
        const blocks = JSON.parse(row.content_blocks ?? "[]") as { type?: string; dispatch_id?: string }[];
        if (!Array.isArray(blocks) || blocks.some(block => block?.type === "peer_message")) throw Error("Code Review local dispatch required");
        const markers = blocks.filter(block => block?.type === "addon_local_dispatch");
        if (markers.length !== 1 || typeof markers[0]?.dispatch_id !== "string") throw Error("Code Review local dispatch required");
        const proof = options.root.query(`SELECT intent_id FROM addon_local_dispatch_authorities
          WHERE id=? AND chat_jid=? AND incarnation=? AND content_sha256=? AND (message_id IS NULL OR message_id=?) AND addon_id='code-review'`).get(
            markers[0].dispatch_id, input.chatJid, input.branchId, createHash("sha256").update(row.content).digest("hex"), row.id) as { intent_id: string } | null;
        if (!proof?.intent_id) throw Error("Code Review dispatch authority unavailable");
        return proof.intent_id;
      };
      const intentId = resolveReference();
      const native = addon.createCodeReviewTool({ async resolve() {
        check();
        if (resolveReference() !== intentId) throw Error("Code Review dispatch changed");
        const assertCurrent = () => { check(); if (resolveReference() !== intentId) throw Error("Code Review dispatch changed"); };
        const service = await addon.prepareReviewService(); assertCurrent();
        return Object.freeze({ service, workspaceRoot,
          identity: Object.freeze({ ownerId: "default", actorId: primary!.branchId, kind: "agent" as const, workspaceId: createHash("sha256").update(workspaceRoot).digest("hex"),
            chatId: primary!.chatJid, chatIncarnation: primary!.branchId, reference: Object.freeze({ addonId: "code-review" as const, intentId }) }),
          assertCurrent,
          ...(writing ? { write: <T>(body: SyncSqliteOperation<T>): Promise<T> => admitSqliteWrite<T>(options.root, () => {
            assertCurrent(); const result = body(); assertCurrent(); return result;
          }, assertCurrent, call.signal) } : {}),
        });
      } });
      const result = await native.execute(call.toolCallId, params, call.signal, call.onUpdate, undefined as never);
      check();
      return result;
    },
  }, { callers: ["model", "tools"] });
}
