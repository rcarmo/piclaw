/**
 * SSRF tests verifying allowPrivateNetwork behavior.
 *
 * Uses the configOverride parameter of validateCallbackUrl so these
 * tests work reliably in any test sweep — no env var timing needed.
 */
import { describe, expect, test } from "bun:test";
import { validateCallbackUrl } from "../../src/remote/ssrf.js";

const privateNetworkCfg = { allowHttp: false, allowPrivateNetwork: true } as const;

describe("validateCallbackUrl with allowPrivateNetwork", () => {
  test("allows localhost when private network enabled", async () => {
    const result = await validateCallbackUrl("https://localhost/callback", undefined, privateNetworkCfg);
    expect(result.ok).toBe(true);
    expect(result.url?.hostname).toBe("localhost");
  });

  test("allows private IPv4 when private network enabled", async () => {
    const result = await validateCallbackUrl("https://192.168.1.50/callback", undefined, privateNetworkCfg);
    expect(result.ok).toBe(true);
  });

  test("allows .local hostnames when private network enabled", async () => {
    const result = await validateCallbackUrl("https://pibox-agent1.local/callback", undefined, privateNetworkCfg);
    expect(result.ok).toBe(true);
  });

  test("still rejects http:// unless allowHttp is also set", async () => {
    const result = await validateCallbackUrl("http://192.168.1.50/callback", undefined, privateNetworkCfg);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("https");
  });

  test("still rejects missing/invalid URLs", async () => {
    const result1 = await validateCallbackUrl(undefined, undefined, privateNetworkCfg);
    expect(result1.ok).toBe(false);

    const result2 = await validateCallbackUrl("not-a-url", undefined, privateNetworkCfg);
    expect(result2.ok).toBe(false);
  });
});
