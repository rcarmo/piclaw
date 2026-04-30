import { expect, test } from "bun:test";
import "../../helpers.js";
import { handleRoute } from "../../../src/channels/web/http/html-viewer-route.js";
test("HTML viewer iframe allows scripts without same-origin privileges", async () => {
  const response = handleRoute(
    new Request("http://localhost/html-viewer/?path=site/index.html", { method: "GET" }),
    "/html-viewer/",
  );

  expect(response).not.toBeNull();
  expect(response?.status).toBe(200);
  const body = await response!.text();
  expect(body).toContain('sandbox="allow-scripts allow-forms allow-popups"');
  expect(body).not.toContain("allow-same-origin");
});
