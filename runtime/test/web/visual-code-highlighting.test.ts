import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { highlightCodeToHtml as classic } from "../../web/src/utils/code-highlighting.js";
import { highlightCodeToHtml, applySyntaxHighlighting } from "../../web/static/visual/frontend/src/utils/code-highlighting";

const root = join(import.meta.dir, "../..");

test("Visual code fences use the shared theme roles without a deferred window global", () => {
  const code = 'async function launch(city) { return city.connect(42, true, "hello"); }';
  const html = highlightCodeToHtml(code, "javascript");
  expect(html).toBe(classic(code, "javascript"));
  for (const token of ["keyword", "function", "number", "bool", "string"]) expect(html).toContain(`tok-${token}`);
  expect(readFileSync(join(root, "web/static/visual/frontend/src/utils/code-highlighting.ts"), "utf8")).not.toContain("window.cmHighlight");
  expect(readFileSync(join(root, "web/static/visual/frontend/build.ts"), "utf8")).toContain('external: ["#editor-vendor/codemirror"]');
});

test('Visual code decoding is one pass and needs no browser DOM', () => {
  const html=applySyntaxHighlighting('<pre><code class="language-unknown">&amp;lt;literal&amp;gt; &amp;amp; &lt;b&gt;</code></pre>');
  expect(html).toContain('&amp;lt;literal&amp;gt; &amp;amp; &lt;b&gt;');
  const encoded=html.match(/data-code="([^"]*)"/)![1];
  expect(decodeURIComponent(escape(atob(encoded)))).toBe('&lt;literal&gt; &amp; <b>');
});

test("Visual keeps Bicep highlighting and escapes unknown or oversized code", () => {
  expect(highlightCodeToHtml('param region string = "west"', "bicep")).toContain('tok-');
  expect(highlightCodeToHtml('<script>alert("x")</script>', "unknown")).toContain("&lt;script&gt;");
  const huge = '<tag>'.repeat(20000);
  expect(highlightCodeToHtml(huge, "html")).toBe(classic(huge, "html"));
  expect(highlightCodeToHtml(huge, "html")).not.toContain('<span');
  expect(applySyntaxHighlighting('<pre><code class="language-js">const n = 42;</code></pre>')).toContain('tok-number');
});
