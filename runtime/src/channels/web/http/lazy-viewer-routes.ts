import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { registerExtensionRoute } from "./extension-routes.js";

type ViewerRouteModule = {
  handleRoute(req: Request, pathname: string): Response | Promise<Response> | null;
};

const OFFICE_VIEWER_EXTENSION_PATH = resolve(import.meta.dir, "../../../../extensions/viewers/office-viewer/index.ts");
const OFFICE_VIEWER_EXTENSION_URL = pathToFileURL(OFFICE_VIEWER_EXTENSION_PATH).href;

async function loadViewerRoute(moduleUrl: string, req: Request, pathname: string): Promise<Response> {
  const mod = await import(moduleUrl) as ViewerRouteModule;
  return (await mod.handleRoute(req, pathname)) ?? new Response("Not Found", { status: 404 });
}

export function registerLazyViewerRoutes(): void {
  registerExtensionRoute(
    "/office-viewer",
    async (req, pathname) => await loadViewerRoute(OFFICE_VIEWER_EXTENSION_URL, req, pathname),
    OFFICE_VIEWER_EXTENSION_PATH,
  );
}
