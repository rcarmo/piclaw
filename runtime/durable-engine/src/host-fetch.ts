import { Type } from "typebox";
import { defineTool, type ToolExecutionApi } from "@earendil-works/pi-durable";

/** Operator network tool. Private/LAN URLs are allowed, like the existing bash
 * capability. No ambient auth, cookies, arbitrary headers or redirect following.
 * GET only initially; all calls remain unsafe to replay despite the HTTP method.
 */
export function createHostFetch(options: {
  captureSource(api: ToolExecutionApi): Promise<() => void>;
  fetch?: (input: URL, init: RequestInit) => Promise<Response>;
}) {
  return defineTool({ name: "fetch", description: "Fetch an HTTP(S) URL as bounded UTF-8 text. Returns status, headers and body; use JSON.parse(result.body) for JSON. Operator/LAN access is allowed. GET only, no credentials or redirects.",
    parameters: Type.Object({ url: Type.String(), max_bytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1048576 })), timeout_ms: Type.Optional(Type.Integer({ minimum: 1, maximum: 30000 })) }),
    structuredOutputSchema: Type.Object({ url: Type.String(), status: Type.Number(), ok: Type.Boolean(), headers: Type.Record(Type.String(), Type.String()), body: Type.String() }),
    callers: ["tools"], replay: "unsafe",
    async execute(args, api, context) {
      const guard = await options.captureSource(api);
      const signal = context.abortSignal ? AbortSignal.any([context.abortSignal, AbortSignal.timeout(args.timeout_ms ?? 10000)]) : AbortSignal.timeout(args.timeout_ms ?? 10000);
      const check = () => { signal.throwIfAborted(); guard(); };
      const url = new URL(args.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw Error("Fetch requires an HTTP(S) URL without credentials");
      check();
      const response = await (options.fetch ?? globalThis.fetch)(url, { method: "GET", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal });
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        check();
        if (reader) for (;;) {
          const part = await reader.read();
          check();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > (args.max_bytes ?? 262144)) throw Error("Fetch response exceeds max_bytes");
          chunks.push(part.value);
        }
      } finally { await reader?.cancel(); }
      check();
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      // Do not disclose Set-Cookie or authentication challenge headers.
      const headers = Object.fromEntries(["content-type", "content-length", "etag", "last-modified"].flatMap(name => {
        const value = response.headers.get(name); return value === null ? [] : [[name, value]];
      }));
      const result = { url: url.href, status: response.status, ok: response.ok, headers, body: new TextDecoder().decode(bytes) };
      return { output: [{ type: "text" as const, text: result.body }], structuredOutput: result };
    },
  });
}
