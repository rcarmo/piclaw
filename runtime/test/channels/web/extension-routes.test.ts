import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import "../../helpers.js";
import {
  clearExtensionRoutes,
  freezeExtensionRoutes,
  getRegisteredRoutes,
  handleExtensionRoutes,
  isExtensionRouteRegistryFrozen,
  registerExtensionRoute,
} from "../../../src/channels/web/http/extension-routes.js";
import { registerLazyViewerRoutes } from "../../../src/channels/web/http/lazy-viewer-routes.js";

beforeEach(() => {
  clearExtensionRoutes();
});

afterEach(() => {
  clearExtensionRoutes();
});

describe("extension route registry", () => {
  test("dedupes repeated registrations for the same prefix and extension path", async () => {
    const first = registerExtensionRoute("/example-addon", () => new Response("first"), "/ext/example-addon");
    const second = registerExtensionRoute("/example-addon", () => new Response("second"), "/ext/example-addon");

    expect(first).toBe("created");
    expect(second).toBe("updated");
    expect(getRegisteredRoutes()).toMatchObject([
      { prefix: "/example-addon", extensionPath: "/ext/example-addon" },
    ]);

    const response = await handleExtensionRoutes(new Request("http://localhost/example-addon/edit"), "/example-addon/edit");
    expect(response).not.toBeNull();
    expect(await response!.text()).toBe("second");
  });

  test("keeps distinct registrations when extension paths differ", () => {
    registerExtensionRoute("/example-addon", () => new Response("first"), "/ext/example-addon-a");
    registerExtensionRoute("/example-addon", () => new Response("second"), "/ext/example-addon-b");

    expect(getRegisteredRoutes()).toMatchObject([
      { prefix: "/example-addon", extensionPath: "/ext/example-addon-a" },
      { prefix: "/example-addon", extensionPath: "/ext/example-addon-b" },
    ]);
  });

  test("allows updates to an already-registered route after freeze", async () => {
    registerExtensionRoute("/example-addon", () => new Response("first"), "/ext/example-addon");
    freezeExtensionRoutes();

    const updated = registerExtensionRoute("/example-addon", () => new Response("second"), "/ext/example-addon");

    expect(updated).toBe("updated");
    const response = await handleExtensionRoutes(new Request("http://localhost/example-addon"), "/example-addon");
    expect(await response?.text()).toBe("second");
  });

  test("keeps registry open after startup viewer routes so workspace extensions can register during session load", async () => {
    registerLazyViewerRoutes();

    expect(isExtensionRouteRegistryFrozen()).toBe(false);

    const registered = (globalThis as any).__piclaw_registerRoute(
      "/workspace-addon",
      () => new Response("workspace route"),
      "/workspace/.pi/extensions/workspace-addon/index.ts"
    );

    expect(registered).toBe("created");
    expect(getRegisteredRoutes().map((route) => route.prefix)).toContain("/workspace-addon");

    const response = await handleExtensionRoutes(new Request("http://localhost/workspace-addon"), "/workspace-addon");
    expect(await response?.text()).toBe("workspace route");

    freezeExtensionRoutes();
    expect(isExtensionRouteRegistryFrozen()).toBe(true);
    expect(registerExtensionRoute("/late-addon", () => new Response("late"), "/ext/late")).toBe("rejected");
  });
});
