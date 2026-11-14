import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function cssRuleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match?.[1] || "";
}

test("timeline hamburger dropdown uses available viewport height without a fixed desktop cap", () => {
  for (const relativePath of ['../../web/static/classic/css/workspace.css']) {
    const css = readFileSync(join(import.meta.dir, relativePath), "utf8");
    const body = cssRuleBody(css, ".timeline-menu-dropdown");

    expect(body).toContain("max-height: calc(100dvh - 48px);");
    expect(body).not.toContain("520px");
  }
});
