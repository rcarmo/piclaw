/** Historical provider-compaction record decoding. No provider execution or payload replay. */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const REMOTE_COMPACTION_SUMMARY_SENTINEL =
  "[Piclaw provider-native compaction state. The opaque canonical context is injected at request time.]";

const LOCAL_CONTINUITY_CHECKPOINT_PREFIX =
  "Earlier context was compacted locally. Preserve this continuity state together with the following events:\n\n";

export const REMOTE_COMPACTION_DETAILS_KIND = "piclaw.remote_compaction";
export const REMOTE_COMPACTION_DETAILS_VERSION = 1;
const REMOTE_COMPACTION_ADAPTER = "openai-responses-compact";
const MAX_REMOTE_COMPACTION_RESPONSE_CHARS = 16 * 1024 * 1024;

export interface RemoteCompactionUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface RemoteCompactionFileOperations {
  read: string[];
  written: string[];
  edited: string[];
}

export interface RemoteCompactionDetails {
  kind: typeof REMOTE_COMPACTION_DETAILS_KIND;
  version: typeof REMOTE_COMPACTION_DETAILS_VERSION;
  adapter: typeof REMOTE_COMPACTION_ADAPTER;
  provider: string;
  modelId: string;
  api: string;
  baseUrl: string;
  /** Historical canonical provider output, preserved without replay, summarisation or pruning. */
  output: Array<Record<string, unknown>>;
  /** Original deterministic file facts retained alongside opaque state. */
  fileOperations: RemoteCompactionFileOperations;
  usage?: RemoteCompactionUsage;
  createdAt: string;
}

export type RemoteCompactionFailureCode =
  | "disabled"
  | "unsupported"
  | "unavailable"
  | "auth"
  | "timeout"
  | "cancelled"
  | "malformed"
  | "provider_failure"
  | "incompatible"
  | "backoff";

function normalizedBaseUrl(value: unknown): string {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseUsage(value: unknown): RemoteCompactionUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const usage: RemoteCompactionUsage = {
    inputTokens: finiteNonNegative(raw.input_tokens),
    outputTokens: finiteNonNegative(raw.output_tokens),
    totalTokens: finiteNonNegative(raw.total_tokens),
  };
  return Object.values(usage).some((entry) => entry !== undefined) ? usage : undefined;
}

function parseFileOperationPaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 100_000) return null;
  const result: string[] = [];
  for (const path of value) {
    if (typeof path !== "string" || path.length === 0 || path.length > 16_384) return null;
    result.push(path);
  }
  return [...new Set(result)];
}

function parseFileOperations(value: unknown): RemoteCompactionFileOperations | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const read = parseFileOperationPaths(raw.read);
  const written = parseFileOperationPaths(raw.written);
  const edited = parseFileOperationPaths(raw.edited);
  return read && written && edited ? { read, written, edited } : null;
}

function validateCanonicalOutput(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const output: Array<Record<string, unknown>> = [];
  let hasCompactionItem = false;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (record.type === "compaction" || record.type === "compaction_summary" || record.type === "context_compaction") {
      if (typeof record.encrypted_content !== "string" || record.encrypted_content.length === 0) return null;
      hasCompactionItem = true;
    }
    output.push(record);
  }
  if (!hasCompactionItem) return null;
  try {
    if (JSON.stringify(output).length > MAX_REMOTE_COMPACTION_RESPONSE_CHARS) return null;
  } catch {
    return null;
  }
  return output;
}

export function parseRemoteCompactionDetails(value: unknown): RemoteCompactionDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.kind !== REMOTE_COMPACTION_DETAILS_KIND
    || raw.version !== REMOTE_COMPACTION_DETAILS_VERSION
    || raw.adapter !== REMOTE_COMPACTION_ADAPTER
    || typeof raw.provider !== "string"
    || typeof raw.modelId !== "string"
    || typeof raw.api !== "string"
    || typeof raw.baseUrl !== "string"
    || typeof raw.createdAt !== "string"
  ) return null;
  const output = validateCanonicalOutput(raw.output);
  const fileOperations = parseFileOperations(raw.fileOperations);
  if (!output || !fileOperations) return null;
  return {
    kind: REMOTE_COMPACTION_DETAILS_KIND,
    version: REMOTE_COMPACTION_DETAILS_VERSION,
    adapter: REMOTE_COMPACTION_ADAPTER,
    provider: raw.provider,
    modelId: raw.modelId,
    api: raw.api,
    baseUrl: normalizedBaseUrl(raw.baseUrl),
    output,
    fileOperations,
    usage: parseUsage(raw.usage),
    createdAt: raw.createdAt,
  };
}

export type LatestRemoteCompactionState =
  | { kind: "valid"; details: RemoteCompactionDetails }
  | { kind: "invalid"; message: string }
  | null;

export function getLatestRemoteCompactionState(entries: readonly SessionEntry[]): LatestRemoteCompactionState {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "compaction") continue;
    if (entry.summary !== REMOTE_COMPACTION_SUMMARY_SENTINEL) return null;
    const details = parseRemoteCompactionDetails(entry.details);
    return details
      ? { kind: "valid", details }
      : { kind: "invalid", message: "Persisted provider-native compaction details were malformed or unsupported" };
  }
  return null;
}

export function getLatestRemoteCompactionDetails(entries: readonly SessionEntry[]): RemoteCompactionDetails | null {
  const state = getLatestRemoteCompactionState(entries);
  return state?.kind === "valid" ? state.details : null;
}


/** Return only the explicitly marked readable checkpoint; never expose opaque provider state. */
export function extractRemoteCompactionReadableCheckpoint(details: RemoteCompactionDetails): string | null {
  for (const item of details.output) {
    if (item.type !== "message" || item.role !== "user" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const content = part as Record<string, unknown>;
      if (content.type !== "input_text" || typeof content.text !== "string") continue;
      if (!content.text.startsWith(LOCAL_CONTINUITY_CHECKPOINT_PREFIX)) continue;
      const checkpoint = content.text.slice(LOCAL_CONTINUITY_CHECKPOINT_PREFIX.length).trim();
      if (checkpoint) return checkpoint;
    }
  }
  return null;
}
