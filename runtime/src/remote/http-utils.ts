/**
 * remote/http-utils.ts – Shared HTTP/body parsing utilities for remote interop endpoints.
 */

/** Sliding-window rate limiter keyed by arbitrary client identifier. */
export class SlidingWindowLimiter {
  private windowMs: number;
  private limit: number;
  private entries = new Map<string, number[]>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(key: string, now = Date.now()): boolean {
    const list = this.entries.get(key) ?? [];
    const filtered = list.filter((t) => now - t < this.windowMs);
    if (filtered.length >= this.limit) {
      this.entries.set(key, filtered);
      return false;
    }
    filtered.push(now);
    this.entries.set(key, filtered);
    return true;
  }
}

/** Build a JSON response with standard content-type headers. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Validate JSON content-type requirements for remote API POST endpoints. */
export function requireJson(req: Request): string | null {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return "Content-Type must be application/json.";
  }
  return null;
}

/** Validate request content-length against a strict byte cap. */
export function checkContentLength(req: Request, maxBytes: number): { ok: true } | { ok: false; status: number; error: string } {
  const raw = req.headers.get("content-length");
  if (!raw) return { ok: true };
  const length = Number(raw);
  if (!Number.isFinite(length) || length < 0) {
    return { ok: false, status: 400, error: "Invalid Content-Length." };
  }
  if (length > maxBytes) {
    return { ok: false, status: 413, error: "Request too large." };
  }
  return { ok: true };
}

/** JSON-object shape used by remote HTTP body helper accessors. */
export type JsonBody = Record<string, unknown>;

/** Result payload for JSON body parse attempts. */
export type JsonParseResult = { data?: JsonBody; error?: string };

function asJsonBody(value: unknown): JsonBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonBody;
}

/** Read a string field from a parsed JSON object. */
export function getStringField(data: JsonBody | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

/** Read and trim a required string field from a parsed JSON object. */
export function getTrimmedStringField(data: JsonBody | undefined, key: string): string {
  return getStringField(data, key).trim();
}

/** Read and trim an optional string field from a parsed JSON object. */
export function getOptionalTrimmedStringField(data: JsonBody | undefined, key: string): string | null {
  const value = getTrimmedStringField(data, key);
  return value.length > 0 ? value : null;
}

/** Parse JSON bytes with a strict payload size limit. */
export function parseJsonBytes(buffer: Uint8Array, maxBytes: number): JsonParseResult {
  if (buffer.length > maxBytes) return { error: "Request too large." };
  if (buffer.length === 0) return { data: {} };
  try {
    const text = new TextDecoder().decode(buffer);
    return { data: asJsonBody(JSON.parse(text)) };
  } catch {
    return { error: "Invalid JSON." };
  }
}

async function readBoundedBodyBytes(req: Request, maxBytes: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value || []);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Read and parse JSON body content with a strict payload size limit. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<JsonParseResult> {
  try {
    const buffer = await readBoundedBodyBytes(req, maxBytes);
    if (!buffer) return { error: "Request too large." };
    return parseJsonBytes(buffer, maxBytes);
  } catch {
    return { error: "Invalid body." };
  }
}

/** Read raw request body bytes with an optional strict byte cap. */
export async function readBodyBytes(req: Request, maxBytes = Number.POSITIVE_INFINITY): Promise<Uint8Array> {
  try {
    if (!Number.isFinite(maxBytes)) return new Uint8Array(await req.arrayBuffer());
    const buffer = await readBoundedBodyBytes(req, maxBytes);
    return buffer ?? new Uint8Array(maxBytes + 1);
  } catch {
    return new Uint8Array();
  }
}
