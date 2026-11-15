import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const web = join(import.meta.dir, "../../web");
const stylesheets = [
  ...readdirSync(join(web, "static/classic/css")).filter((name) => name.endsWith(".css")).map((name) => join(web, "static/classic/css", name)),
  ...readdirSync(join(web, "static/common/css")).filter((name) => name.endsWith(".css")).map((name) => join(web, "static/common/css", name)),
  ...readdirSync(join(web, "shared")).filter((name) => name.endsWith(".css")).map((name) => join(web, "shared", name)),
];
const rules = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").split("}")
  .map((chunk) => { const at = chunk.lastIndexOf("{"); return at < 0 ? null : { selector: chunk.slice(0, at).trim().split("\n").pop()!.trim(), body: chunk.slice(at + 1) }; })
  .filter((rule): rule is { selector: string; body: string } => Boolean(rule));

test("controls filled with the theme accent take the theme's contrast text, not fixed white", () => {
  // Avatars are not controls: the accent is only their fallback behind per-agent colours.
  const notControls = new Set([".post-avatar"]);
  const offenders: string[] = [];
  for (const file of stylesheets) for (const rule of rules(file)) {
    if (notControls.has(rule.selector)) continue;
    if (/background(?:-color)?\s*:\s*var\(--accent-color/.test(rule.body) && /(?:^|[;\s])color\s*:\s*(?:#fff\b|#ffffff\b|white\b)/i.test(rule.body)) {
      offenders.push(`${file.slice(web.length + 1)}: ${rule.selector}`);
    }
  }
  expect(offenders).toEqual([]);
});

test("the approval dialog follows the app theme, not the system colour scheme or fixed greys", () => {
  const css = readFileSync(join(web, "static/classic/css/agent.css"), "utf8");
  const request = rules(join(web, "static/classic/css/agent.css")).filter((rule) => rule.selector.includes(".agent-request"));
  expect(request.length).toBeGreaterThan(10);
  for (const rule of request) expect({ selector: rule.selector, fixed: rule.body.match(/#[0-9a-f]{3,6}\b(?![^(]*\))/gi) ?? [] })
    .toEqual({ selector: rule.selector, fixed: [] });
  const media = css.match(/@media \(prefers-color-scheme: light\)\s*\{[\s\S]*?\n\}/g) ?? [];
  expect(media.some((block) => block.includes(".agent-request"))).toBe(false);
});
