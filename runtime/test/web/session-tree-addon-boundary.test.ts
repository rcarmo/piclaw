import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const runtimeRoot = join(import.meta.dir, "../..");

function source(relative: string): string {
  return readFileSync(join(runtimeRoot, relative), "utf8");
}

describe("session-tree add-on ownership boundary", () => {
  test("core contains no session-tree endpoint, renderer, or static viewer", () => {
    for (const relative of [
      "src/channels/web/agent/session-tree.ts",
      "web/src/components/session-tree-widget.ts",
      "web/static/session-tree.html",
      "web/static/session-tree.js",
      "web/static/session-tree.css",
    ]) {
      expect(existsSync(join(runtimeRoot, relative)), relative).toBe(false);
    }

    expect(source("src/channels/web/http/dispatch-agent.ts")).not.toContain("/agent/session-tree");
    expect(source("web/src/components/floating-widget-pane.ts")).not.toContain("SessionTreeWidget");
    expect(source("web/src/ui/generated-widget.ts")).not.toContain("session_tree");
    expect(source("web/static/visual/frontend/src/app/widgetOpen.ts")).not.toContain("session_tree");
    expect(source("web/static/visual/frontend/src/app/tabTypes.ts")).not.toContain("widgetSrc");
    expect(source("web/static/visual/frontend/src/components/WidgetPane.tsx")).not.toContain("widgetSrc");
  });

  test("generated web bundles contain no stale core session-tree implementation", () => {
    for (const relative of [
      "web/static/classic/dist/app.bundle.js",
      "web/static/classic/dist/app.bundle.js.map",
      "web/static/classic/dist/app.bundle.css",
      "web/static/visual/dist/app.bundle.js",
      "web/static/visual/dist/app.bundle.js.map",
    ]) {
      const built = source(relative);
      expect(built, relative).not.toContain("/agent/session-tree");
      expect(built, relative).not.toContain("session_tree");
      expect(built, relative).not.toContain("session-tree-widget");
    }
  });
});
