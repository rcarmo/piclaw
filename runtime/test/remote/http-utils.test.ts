import { expect, test } from "bun:test";
import "../helpers.js";
import { readBodyBytes, readJsonBody } from "../../src/remote/http-utils.js";

function streamRequest(chunks: string[]): Request {
  return new Request("http://localhost/api/remote/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

test("readJsonBody rejects streaming bodies once the byte cap is exceeded", async () => {
  const result = await readJsonBody(streamRequest(["{\"a\":", "\"123456789\"}"]), 8);
  expect(result).toEqual({ error: "Request too large." });
});

test("readBodyBytes returns a cap sentinel without allocating the full stream", async () => {
  const bytes = await readBodyBytes(streamRequest(["1234", "5678", "90"]), 8);
  expect(bytes.length).toBe(9);
});
