import { randomUUID, createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { previewSessionRecordingRedaction } from "../../src/session-recordings/session-recordings.js";
import type { ModelFailure } from "./host-model-failure.js";

export type ModelFailureEvidence = {
  provider: string; model: string; requestId?: string;
  scope?: { conversationId: number; taskId: number; kind: string };
  failure: ModelFailure; providerFailure?: ModelFailure;
  error: unknown; providerError?: unknown;
};

/** Keep error fields only: never serialize the provider message, prompt, partial
 * answer, headers, credentials or opaque thinking/signature fields. */
function errorFields(error: unknown, seen = new Set<object>(), depth = 0): Record<string, unknown> {
  if (typeof error === "string") return { message: error.slice(0, 8192) };
  if (!error || typeof error !== "object") return { message: typeof error === "function" ? "Non-error value" : String(error).slice(0, 1024) };
  if (depth >= 4 || seen.has(error)) return { message: "Error cause omitted" };
  seen.add(error);
  const input = error as Record<string, unknown>, output: Record<string, unknown> = {};
  const read = (key: string): unknown => { try { return input[key]; } catch { return undefined; } };
  for (const key of ["name", "code", "status", "statusCode", "stopReason", "errorMessage", "message", "stack"]) {
    const value = read(key);
    if (typeof value === "string") output[key] = value.slice(0, key === "stack" ? 4096 : 8192);
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
  }
  const cause = read("cause");
  if (cause !== undefined) output.cause = errorFields(cause, seen, depth + 1);
  const children=read('errors');
  const aggregate=()=>{
    try{if(!Array.isArray(children))return;return Array.from({length:Math.min(children.length,4)},(_,index)=>errorFields(children[index],seen,depth+1));}
    catch{return[{message:'Aggregate errors unreadable'}];}
  };
  const nested=aggregate();if(nested)output.errors=nested;
  return output;
}

function redact(value: unknown): unknown {
  const { data } = previewSessionRecordingRedaction(value, { mode: "redacted", redaction: { maxStringLength: 8192 } });
  function visit(item: unknown): unknown {
    if (typeof item === "string") return item
      .replace(/https?:\/\/[^\s"<>]+/gi, "[URL redacted]")
      // A labelled payload can be structured or unquoted. Discard its tail;
      // attempting to regex-parse nested request JSON can leave prompt fragments.
      .replace(/\b((?:signature|thinking|prompt|messages?|content|input|output|partial(?:[_-]?(?:output|answer))?|headers|request(?:[_-]?body)?|credentials|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*)[\s\S]*/gi, "$1[REDACTED]");
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    return item;
  }
  return visit(data);
}

/** Bounded provider explanation for the timeline. Error fields only, with the
 * same credential/payload redaction as private receipts; no stacks or output. */
export function modelFailureUpstreamMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) return;
  const fields = errorFields(error);
  const message = fields.errorMessage ?? fields.message ?? fields.code;
  if (typeof message !== "string" || !message.trim()) return;
  const safe = (redact(message) as string).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim();
  // Truncate AFTER redaction so a credential/payload label cannot lose its value.
  const bytes = Buffer.from(safe, "utf8");
  return bytes.length > 512 ? bytes.subarray(0, 512).toString("utf8") + " [truncated]" : safe || undefined;
}

/** Private durable diagnostic receipts. This is not a usage settlement and must
 * never release a reservation or authorize/replay provider/tool work. */
export function retainModelFailureEvidence(directory: string, input: ModelFailureEvidence): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw Error("Model failure evidence directory is not private");
  const id = randomUUID();
  const errors = { error: errorFields(input.error), ...(input.providerError === undefined ? {} : { providerError: errorFields(input.providerError) }) };
  const details = redact({ provider: input.provider.slice(0, 256), model: input.model.slice(0, 512),
    requestId: input.requestId?.slice(0, 1024) ?? null,
    scope: input.scope ? { ...input.scope, kind: input.scope.kind.slice(0, 128) } : null,
    failure: input.failure, providerFailure: input.providerFailure ?? null, errors }) as Record<string, unknown>;
  const body = JSON.stringify({ schema: 1, id, at: new Date().toISOString(), ...details,
    originalErrorSha256: createHash("sha256").update(JSON.stringify(errors)).digest("hex") });
  const fd = openSync(join(directory, `${id}.json`), "wx", 0o600);
  try { writeFileSync(fd, body + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  const dir = openSync(directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
  return id;
}
