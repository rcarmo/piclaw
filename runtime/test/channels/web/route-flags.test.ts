import { describe, expect, test } from "bun:test";

import { getRouteFlags, shouldSkipAuthCheck } from "../../../src/channels/web/http/route-flags.js";

describe("web route flags", () => {
  test("marks the service worker script as a public shell route", () => {
    const flags = getRouteFlags(new Request("https://example.com/sw.js", { method: "GET" }), "/sw.js");

    expect(flags.isServiceWorker).toBe(true);
    expect(flags.isStaticAsset).toBe(false);
    expect(shouldSkipAuthCheck(flags, false)).toBe(true);
  });
});
