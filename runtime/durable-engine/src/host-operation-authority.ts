import { admitSqliteWrite, type SyncSqliteOperation } from "../../src/db/sqlite-async-admission.js";
import type { Database } from "bun:sqlite";
import type { HostConversationRuntime } from "./host-runtime.js";

type Capture = Awaited<ReturnType<HostConversationRuntime["captureToolSource"]>>;
/** Host-private constructor: capture MUST come from captureToolSource, not arguments. */
export function createHostOperationAuthority(root: Database, captured: Capture, assertAllowed: () => void, readonly = false, signal?: AbortSignal) {
  const { operation, inputs } = captured;
  const chatJid = operation.chatJid;
  if (!readonly && !operation.harness) throw Error("Bound host harness required for writes");
  const assertSourceCurrent = () => {
    assertAllowed();
    const current = readonly ? root.query(`SELECT 1 FROM service_effect_s01_operations o
      JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid AND c.active_operation_id=o.operation_id
      WHERE o.operation_id=? AND o.chat_jid=? AND o.version=? AND o.phase='executing'
      AND o.cancellation_source_id IS NULL`).get(operation.operationId, chatJid, operation.version)
      : root.query(`SELECT 1 FROM service_effect_s01_operations o
      JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid AND c.active_operation_id=o.operation_id
      WHERE o.operation_id=? AND o.chat_jid=? AND o.version=? AND o.phase='executing'
      AND o.cancellation_source_id IS NULL
      AND o.harness_operation_id=? AND o.harness_session_id=?`)
      .get(operation.operationId, chatJid, operation.version, operation.harness!.harnessOperationId,
        operation.harness!.sessionId);
    if (!current) throw Error("Stale host operation authority");
    if (readonly && operation.harness && !root.query(`SELECT 1 FROM service_effect_s01_operations
      WHERE operation_id=? AND harness_operation_id=? AND harness_session_id=?`).get(operation.operationId, operation.harness.harnessOperationId,
        operation.harness.sessionId))
      throw Error("Stale host harness authority");
    for (const input of inputs) {
      const source = root.query(`SELECT 1 FROM service_effect_s01_sources s
        JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
        WHERE os.operation_id=? AND s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=? AND s.state='claimed'`)
        .get(operation.operationId, chatJid, input.sourceSeq, input.sourceId, input.payloadRef);
      if (!source) throw Error("Stale host source authority");
    }
  };
  const assertCurrent = () => {
    assertSourceCurrent();
    const checked: unknown = captured.accountingBarrier?.();
    if (checked !== undefined) { void Promise.resolve(checked).catch(() => {}); throw Error('Accounting barrier must be synchronous'); }
  };
  return Object.freeze({ assertCurrent, assertSourceCurrent,
    async admitWrite<T>(body: SyncSqliteOperation<T>): Promise<T> {
      if (readonly) throw Error("Read-only host operation authority");
      return admitSqliteWrite<T>(root, body, assertCurrent, signal);
    },
    write: <T>(body: () => T): T => {
      if (readonly) throw Error("Read-only host operation authority");
      assertCurrent();
      if (!root.inTransaction) throw Error("Admitted host write transaction required");
      const result = body(); assertCurrent(); return result;
    },
  });
}

