import { describe, expect, test } from "bun:test";

import { serveStatic } from "../../src/channels/web/http/static.js";
import {
  buildWidgetOpenDetail,
  buildWidgetTabFromOpenDetail,
} from "../../web/static/visual/frontend/src/app/widgetOpen.js";

describe("visual session tree widget", () => {
  test("opens a session tree artifact in the bundled authenticated viewer", () => {
    const detail = buildWidgetOpenDetail({
      type: "generated_widget",
      widget_id: "session-tree-1",
      title: "Session Tree",
      artifact: { kind: "session_tree", tree: { leafId: "leaf-1" } },
    });

    expect(detail).not.toBeNull();
    const tab = buildWidgetTabFromOpenDetail(detail!, "web:research & notes");
    expect(tab).toMatchObject({
      id: "widget-session-tree-1",
      type: "widget",
      widgetKind: "session_tree",
      widgetSrc: "/static/session-tree.html?chat_jid=web%3Aresearch%20%26%20notes",
    });
  });

  test("serves the viewer shell and its script and stylesheet", async () => {
    const notFound = () => new Response("missing", { status: 404 });
    const html = await serveStatic("session-tree.html", notFound);
    const script = await serveStatic("session-tree.js", notFound);
    const stylesheet = await serveStatic("session-tree.css", notFound);

    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(await html.text()).toContain('src="/static/session-tree.js"');

    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    const scriptText = await script.text();
    expect(scriptText).toContain('new URL("/agent/session-tree"');
    expect(scriptText).toContain('type: "piclaw:widget-submit"');

    expect(stylesheet.status).toBe(200);
    expect(stylesheet.headers.get("content-type")).toContain("text/css");
  });
});
