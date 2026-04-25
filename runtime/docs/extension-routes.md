# Extension routes

_Last updated: 2026-03-16_

PiClaw extensions can register authenticated HTTP routes and serve custom web
assets or APIs from the piclaw process.

This is the mechanism used by:

- `office-viewer` to serve the lightweight JS Office viewer
- `editor-vendor` to serve CodeMirror directly from the editor extension vendor dir
- `csv-viewer` to serve a lightweight same-origin CSV/TSV table viewer

## When to use extension routes

Use an extension route when an extension needs one of these:

- a self-hosted web UI
- a custom JSON endpoint
- a static asset directory with custom headers
- a scoped security policy for a specific embedded app

Good examples:

- `/office-viewer/*` for self-hosted JS Office viewer assets and wrapper HTML
- `/editor-vendor/*` for lazily loaded browser-side vendor code
- `/example-assets/*` for extension-owned browser bundles

## Registration API

Route registration is exposed globally so workspace extensions can use it
without importing internal server modules directly.

```ts
const registerRoute = (globalThis as any).__piclaw_registerRoute;

registerRoute(prefix, handler, extensionDir);
```

### Parameters

- `prefix: string`
  - route prefix, for example `"/example-assets"`
  - leading `/` is recommended
- `handler: (req: Request, pathname: string) => Response | Promise<Response> | null`
  - receives the original request and the request pathname
  - return a `Response` to handle the request
  - return `null` to fall through to the next registered route
- `extensionDir: string`
  - path recorded for route introspection/debugging
  - usually the extension directory (`import.meta.dir`-derived)

## Dispatch model

Registered extension routes are matched by prefix.

A route handles requests when the pathname is:

- exactly the prefix
- starts with `prefix + "/"`
- starts with `prefix + "?"`

Examples:

- `/example-assets`
- `/example-assets/index.html`
- `/example-assets/view?path=foo.example`

## Security model

Extension routes are dispatched by the main web router after auth checks.
That means:

- authenticated users can access them
- unauthenticated users cannot
- mutating endpoints still need normal web security discipline

### Important responsibilities for extension authors

Extension routes must still protect themselves correctly:

- validate and sanitize relative paths
- block `..` traversal and absolute-path escapes
- set route-specific headers when needed
- require explicit method handling (`GET`, `HEAD`, `POST`, etc.)
- return proper error responses instead of throwing raw internals

### CSRF note

Authentication happens before extension-route dispatch, but extension handlers are
still responsible for fitting into the web security model for mutating routes.
In practice:

- pure asset routes are typically `GET`/`HEAD` only
- state-changing endpoints should be same-origin browser calls and should follow
  the same expectations as other authenticated web mutations

## Minimal static-file example

```ts
import { resolve, extname } from "node:path";
import { existsSync, realpathSync, statSync } from "node:fs";

const EXT_DIR = import.meta.dir;
const ASSET_DIR = resolve(EXT_DIR, "vendor");
const ROUTE_PREFIX = "/example-assets";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function handleRoute(req: Request, pathname: string): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let relative = pathname.replace(/^\/example-assets\/?/, "") || "index.html";
  const q = relative.indexOf("?");
  if (q >= 0) relative = relative.slice(0, q);

  if (relative.includes("..") || relative.startsWith("/")) {
    return new Response("Forbidden", { status: 403 });
  }

  const filePath = resolve(ASSET_DIR, relative);
  let realPath: string;
  try {
    realPath = realpathSync(filePath);
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  const realAssetDir = realpathSync(ASSET_DIR);
  if (!realPath.startsWith(realAssetDir + "/") && realPath !== realAssetDir) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!existsSync(realPath) || !statSync(realPath).isFile()) {
    return new Response("Not Found", { status: 404 });
  }

  return new Response(req.method === "HEAD" ? null : Bun.file(realPath), {
    headers: {
      "Content-Type": MIME_TYPES[extname(realPath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    },
  });
}

export default function exampleExtension() {
  const registerRoute = (globalThis as any).__piclaw_registerRoute;
  if (typeof registerRoute === "function") {
    registerRoute(ROUTE_PREFIX, handleRoute, EXT_DIR);
  }
}
```

## Introspection

PiClaw exposes the currently registered routes at:

- `GET /api/extension-routes`

Response shape:

```json
[
  {
    "prefix": "/example-assets",
    "extensionPath": "/workspace/.pi/extensions/example-addon"
  }
]
```

This is useful for:

- debugging route registration
- verifying reload/install behavior
- checking which extension currently owns a prefix

## Current reference implementations

- `extensions/viewers/office-viewer/index.ts`
- `src/channels/web/http/editor-vendor-route.ts`
- `src/channels/web/http/csv-viewer-route.ts`
- `src/channels/web/http/extension-routes.ts`
