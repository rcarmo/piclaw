// Kintsugi b8469c29 MIT port; existing UI surfaces render these display-only entries.
import type {JsonValue} from "@earendil-works/chord/json";
import {defineDoc,defineEntry} from "@earendil-works/pi-durable";
import {fingerprint,redact} from "#token-optimizer/core";
import type {OperationSink,OptimizerOperation} from "#token-optimizer/pi-durable";
const isJsonObject=(value:unknown):value is import("@earendil-works/pi-durable").JsonObject=>value!==null&&typeof value==="object"&&!Array.isArray(value);
/** Display-only entries: never carry model messages, receipts or executable tools. */
export const OptimizerOperationEntry = defineEntry<OptimizerOperation>("piclaw.token-optimizer.operation");
const OperationWrites = defineDoc<{ recent: Record<string, string> }>({kind:"piclaw.token-optimizer.operation-writes",version:1,scope:"conversation",history:"latest",fork:"initial",initial:() => ({recent:{}}),checkpointWhen:() => false});

function displayData(value:JsonValue,depth = 0):JsonValue {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Recursive strict-JSON boundary: sanitize each representation before storing display data.
  if (typeof value === "string") {
    const text = redact(value);return text.length > 16_384 ? text.slice(0,16_384)+"\n[display truncated]" : text;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Preserve strict-JSON scalars; containers are recursively bounded below.
  if (value === null || typeof value !== "object") return value;
  if (depth >= 8) return "[display truncated]";
  if (Array.isArray(value)) return value.slice(0,64).map(item => displayData(item,depth+1));
  return Object.fromEntries(Object.entries(value).slice(0,64).map(([key,item]) => {
    const sensitive = !redact(JSON.stringify({[key]:"piclaw_sensitive_value"})).includes("piclaw_sensitive_value");
    return [key,sensitive ? "[REDACTED]" : displayData(item,depth+1)];
  }));
}

/** Written in the same transaction as the operation's state change, including failures and replay recovery. */
export const recordOptimizerOperation:OperationSink = async (tx,conversationId,operation) => {
  const writes = await tx.doc(OperationWrites,conversationId), key = fingerprint(operation.id);
  if (operation.status === "cancelled" && !writes.recent[key]) return; // No row for work that never started.
  const input = displayData(operation.input), output = displayData(operation.output);
  if (!isJsonObject(input)) throw new Error("Optimizer operation input must be an object");
  const signature = fingerprint(JSON.stringify([operation.name,operation.status,input,output]));
  if (writes.recent[key] === signature) return;
  await tx.appendEntry(OptimizerOperationEntry,conversationId,{data:{...operation,input,output}});
  writes.recent[key] = signature;
  // Only live/recent transitions need replay deduplication; the transcript retains the actual history.
  const keys = Object.keys(writes.recent);
  for (const old of keys.slice(0,Math.max(0,keys.length-256))) delete writes.recent[old];
};
