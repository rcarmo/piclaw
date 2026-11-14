/**
 * scripts/stamp-cache-buster.ts
 *
 * Replaces all `?v=<digits|hex>` cache-buster query strings in index.html
 * with a content-derived hash of the app bundle files.  This guarantees
 * the buster changes if and only if the bundle content changes, regardless
 * of build timestamps or git operations on index.html.
 *
 * Also stamps the vendor importmap URL with a content-hash so browser
 * caches bust when the vendor bundle changes.
 *
 * Run automatically at the end of `build:web`.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

import { APP_ASSET_VERSION_REL_PATHS, computeAssetContentVersion } from "../src/utils/asset-content-version.js";
import { buildThemeBootstrap } from './theme-bootstrap.js';

{
  const path = resolve(import.meta.dir, "../web/static/classic/index.html");
  const original = readFileSync(path, 'utf8');
  const generated = `<!-- piclaw-theme-bootstrap-start -->\n    <script>${buildThemeBootstrap()}</script>\n    <!-- piclaw-theme-bootstrap-end -->`;
  const next = original.replace(/<!-- piclaw-theme-bootstrap-start -->[\s\S]*?<!-- piclaw-theme-bootstrap-end -->/, generated);
  if (next !== original) writeFileSync(path, next, 'utf8');
}

const INDEX = resolve(import.meta.dir, "../web/static/classic/index.html");
const APP_VERSION_FILES = APP_ASSET_VERSION_REL_PATHS.map((relPath) => resolve(import.meta.dir, "../web/static", relPath));

const stamp = computeAssetContentVersion(APP_VERSION_FILES, (file, error) => {
  if (existsSync(file)) {
    console.warn(`[cache-buster] failed to read ${file}: ${error instanceof Error ? error.message : error}`);
  }
}) || "dev";

const original = readFileSync(INDEX, "utf-8");
let html = original;

// 1. Stamp ?v= tokens on static bundle references.
//    Match both numeric stamps (?v=1234567890) and the build-time placeholder.
html = html.replace(/\?v=(?:[\da-f]+|__APP_ASSET_VERSION__)/g, `?v=${stamp}`);

// 2. Stamp the vendor importmap URL so browser caches bust on content changes.
//    Use the vendor bundle's sha256 prefix from the metadata file when available,
//    fall back to the build timestamp.
const VENDOR_META = resolve(import.meta.dir, "../extensions/viewers/editor/vendor/codemirror.meta.json");
let vendorStamp = stamp;
try {
  if (existsSync(VENDOR_META)) {
    const meta = JSON.parse(readFileSync(VENDOR_META, "utf-8"));
    if (meta.sha256) vendorStamp = meta.sha256.slice(0, 12);
  }
} catch (e) {
  console.warn(`[cache-buster] failed to read vendor metadata: ${e instanceof Error ? e.message : e}`);
}
html = html.replace(
  /(\/editor-vendor\/codemirror\.js)(\?v=[^"]*)?/g,
  `$1?v=${vendorStamp}`,
);

if (html !== original) {
  writeFileSync(INDEX, html, "utf-8");
  console.log(`[cache-buster] stamped index.html → v=${stamp}, vendor=${vendorStamp}`);
} else {
  console.log(`[cache-buster] no tokens changed in index.html`);
}
