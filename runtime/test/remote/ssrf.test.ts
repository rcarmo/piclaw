import { describe, expect, test } from "bun:test";
import { validateCallbackUrl } from "../../src/remote/ssrf.js";

// Always pass configOverride to isolate tests from the container's injected
// PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK env var.
const strict = { allowPrivateNetwork: false, allowHttp: false };

describe("validateCallbackUrl", () => {
  test("rejects localhost hostnames", async () => {
    const result = await validateCallbackUrl("https://localhost/callback", undefined, strict);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("hostname");
  });

  test("rejects private IPv4 literals", async () => {
    const result = await validateCallbackUrl("https://192.168.1.50/callback", undefined, strict);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("private or loopback");
  });

  test("rejects hostnames resolving to private ranges", async () => {
    const result = await validateCallbackUrl(
      "https://peer.example/callback",
      async () => ["127.0.0.1"],
      strict,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("private or loopback");
  });

  test("rejects unresolvable hostnames", async () => {
    const result = await validateCallbackUrl(
      "https://peer.example/callback",
      async () => { throw new Error("dns failed"); },
      strict,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("could not be resolved");
  });

  test("accepts publicly-routed resolved hosts", async () => {
    const result = await validateCallbackUrl(
      "https://peer.example/callback",
      async () => ["93.184.216.34"],
      strict,
    );
    expect(result.ok).toBe(true);
    expect(result.url?.hostname).toBe("peer.example");
  });
});
