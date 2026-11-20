import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempWorkspaceEnv } from "../../helpers.js";

import { serveStatic } from "../../../src/channels/web/http/static.js";
import { getRouteFlags, isPublicWidgetAssetPath, shouldSkipAuthCheck } from "../../../src/channels/web/http/route-flags.js";

for (const asset of ['common/js/vendor/three/three.module.min.js', 'common/js/vendor/three/three.core.min.js', 'common/js/vendor/remote-display-decoder.wasm', 'common/js/vendor/xterm/xterm.css', 'common/fonts/KaTeX_Main-Regular.woff2']) {
  test(`opaque widget dependency is public and credential-free CORS: ${asset}`, async () => {
    for (const encoding of ['', 'gzip', 'br, gzip']) {
      const req = new Request(`https://example.test/static/${asset}`, {headers: {Origin:'null', 'Accept-Encoding':encoding}});
      expect(shouldSkipAuthCheck(getRouteFlags(req, new URL(req.url).pathname), false)).toBe(true);
      const response = await serveStatic(asset, notFound, req);
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    }
  });
}

test('widget CORS never exposes authenticated bundles, API data, metadata or traversal', async () => {
  for (const path of ['/static/classic/dist/app.bundle.js', '/static/common/dist/family.bundle.js', '/agent/keychain', '/workspace/secret.js', '/static/common/js/vendor/three/three.meta.json', '/static/common/js/vendor/../../../classic/dist/app.bundle.js', '/static/common/js/vendor/%2e%2e/secret.js']) {
    expect(isPublicWidgetAssetPath(path)).toBe(false);
    expect(shouldSkipAuthCheck(getRouteFlags(new Request('https://example.test'), path), false)).toBe(false);
  }
  const response = await serveStatic('classic/dist/app.bundle.css', notFound);
  expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
});

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

test("large static assets use build-time sidecars or stream original bytes; HEAD never compresses", async () => {
  await withTempWorkspaceEnv("static-gzip-stream-", {}, async workspace => {
    const path = join(workspace.workspace, "bundle.js");
    const text = "/* vendor fixture */\n".repeat(200_000);
    writeFileSync(path, text);
    writeFileSync(join(workspace.workspace, "packed.js"), text);
    writeFileSync(join(workspace.workspace, "packed.js.gz"), Bun.gzipSync(new TextEncoder().encode(text)));
    // A fresh process reads the fixture's static root at module evaluation.
    const moduleUrl = new URL("../../../src/channels/web/http/static.ts", import.meta.url).href;
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", `
      import assert from 'node:assert/strict';
      const {serveStatic:serve} = await import(${JSON.stringify(moduleUrl)});
      Bun.gzipSync = () => { throw Error('Static fallback must not compress whole-file buffers'); };
      const request = (name, method) => new Request('https://example.test/static/'+name, {method, headers:{'Accept-Encoding':'br, gzip'}});
      const notFound = () => new Response(null,{status:404});
      for (const [name, encoding] of [['bundle.js',null],['packed.js','gzip']]) {
        const head = await serve(name, notFound, request(name,'HEAD'));
        assert.equal(head.status,200); assert.equal(head.headers.get('Content-Encoding'),encoding); assert.equal(head.body,null);
        for (let i=0;i<2;i++) {
          const get = await serve(name, notFound, request(name,'GET'));
          assert.equal(get.headers.get('Content-Encoding'),encoding);
          assert.equal(get.headers.get('Vary'),'Accept-Encoding');
          const body = encoding ? new Response(get.body.pipeThrough(new DecompressionStream('gzip'))) : get;
          assert.equal(await body.text(),'/* vendor fixture */\\n'.repeat(200_000));
        }
      }
    `], {env:{...process.env,PICLAW_WEB_STATIC_DIR:workspace.workspace},stderr:"pipe",stdout:"ignore"});
    const [exit, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exit, error).toBe(0);
  });
});

test("serveStatic serves vendored ESM modules with a JavaScript MIME type", async () => {
  const response = await serveStatic("common/js/vendor/xterm/xterm.mjs", notFound);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBeNull();
  expect(response.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
});

test("serveStatic preserves the wasm MIME type and bytes", async () => {
  const req = new Request("https://example.test/static/common/js/vendor/remote-display-decoder.wasm", {
    headers: { "Accept-Encoding": "gzip" },
  });

  const response = await serveStatic("common/js/vendor/remote-display-decoder.wasm", notFound, req);

  expect(response.status).toBe(200);
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
  expect(response.headers.get("Content-Type")).toBe("application/wasm");
  const body = response.headers.get("Content-Encoding") === "gzip"
    ? new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))) : response;
  const wasm = new Uint8Array(await body.arrayBuffer());
  expect(Array.from(wasm.slice(0, 4))).toEqual([0x00, 0x61, 0x73, 0x6d]);
});

test("serveStatic leaves already-compressed assets unencoded", async () => {
  const req = new Request("https://example.test/static/favicon.ico", {
    headers: { "Accept-Encoding": "gzip" },
  });

  const response = await serveStatic("favicon.ico", notFound, req);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBeNull();
  expect(response.headers.get("Vary")).toBeNull();
});

test("serveStatic adds Vary for compressible assets even without compression", async () => {
  const response = await serveStatic("classic/dist/app.bundle.css", notFound);

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Encoding")).toBeNull();
  expect(response.headers.get("Vary")).toBe("Accept-Encoding");
});
