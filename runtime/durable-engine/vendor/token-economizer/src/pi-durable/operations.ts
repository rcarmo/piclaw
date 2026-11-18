// SPDX-License-Identifier: Apache-2.0
import type { JsonValue } from "@earendil-works/chord/json";
import type { ConversationId, JsonObject, Tx } from "@earendil-works/pi-durable";
/** Optional transactional display sink. Operations never become model messages or tool results. */
export type OptimizerOperation = {
  id: string;
  name: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled" | "unknown";
  startedAt: number;
  at: number;
  input: JsonObject;
  output: JsonValue;
};
export type OperationSink = (tx: Tx, conversationId: ConversationId, operation: OptimizerOperation) => Promise<void>;
