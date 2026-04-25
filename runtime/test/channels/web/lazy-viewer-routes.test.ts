import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "../../helpers.js";

import { clearExtensionRoutes, getRegisteredRoutes, handleExtensionRoutes } from "../../../src/channels/web/http/extension-routes.js";
import { registerLazyViewerRoutes } from "../../../src/channels/web/http/lazy-viewer-routes.js";

describe("lazy viewer route registration", () => {
  beforeEach(() => {
    clearExtensionRoutes();
  });

  afterEach(() => {
    clearExtensionRoutes();
  });

  test("registers the office viewer route without loading it through session bootstrap", async () => {
    registerLazyViewerRoutes();

    expect(getRegisteredRoutes()).toEqual([
      expect.objectContaining({ prefix: "/office-viewer" }),
    ]);

    const officeResponse = await handleExtensionRoutes(
      new Request("http://localhost/office-viewer/", { method: "GET" }),
      "/office-viewer/",
    );
    expect(officeResponse).not.toBeNull();
    expect(officeResponse?.status).toBe(200);
    expect(officeResponse?.headers.get("Content-Type")).toContain("text/html");
  });
});
