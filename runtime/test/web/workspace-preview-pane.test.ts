/**
 * test/web/workspace-preview-pane.test.ts – Resolution tests for workspace preview pane extensions.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { paneRegistry } from "../../web/src/panes/pane-registry.js";
import { editorPaneExtension } from "../../web/src/panes/editor-loader.js";
import {
  renderWorkspacePreviewMarkup,
  workspaceMarkdownPreviewPaneExtension,
  workspacePreviewPaneExtension,
} from "../../web/src/panes/workspace-preview-pane.js";
import { rewriteWorkspaceMarkdownImageSrc } from "../../web/src/ui/workspace-markdown-image.js";

const registeredIds = [
  editorPaneExtension.id,
  workspacePreviewPaneExtension.id,
  workspaceMarkdownPreviewPaneExtension.id,
];

function resetRegistry() {
  for (const id of registeredIds) {
    paneRegistry.unregister(id);
  }
}

describe("workspace preview pane extensions", () => {
  beforeEach(() => {
    resetRegistry();
  });

  afterEach(() => {
    resetRegistry();
  });

  test("editor pane does not claim view-mode preview contexts", () => {
    expect(editorPaneExtension.canHandle?.({ path: "notes/test.md", mode: "view" })).toBe(false);
    expect(editorPaneExtension.canHandle?.({ path: "notes/test.md", mode: "edit" })).toBe(1);
  });

  test("markdown preview override wins over the default preview pane", () => {
    paneRegistry.register(editorPaneExtension);
    paneRegistry.register(workspacePreviewPaneExtension);
    paneRegistry.register(workspaceMarkdownPreviewPaneExtension);

    const resolved = paneRegistry.resolve({
      path: "notes/test.md",
      mode: "view",
      preview: {
        kind: "text",
        content_type: "text/markdown",
        text: "# Hello",
      },
    });

    expect(resolved?.id).toBe("workspace-markdown-preview");
  });

  test("default preview pane handles non-markdown file previews", () => {
    paneRegistry.register(editorPaneExtension);
    paneRegistry.register(workspacePreviewPaneExtension);
    paneRegistry.register(workspaceMarkdownPreviewPaneExtension);

    const resolved = paneRegistry.resolve({
      path: "archive.bin",
      mode: "view",
      preview: {
        kind: "binary",
        content_type: "application/octet-stream",
      },
    });

    expect(resolved?.id).toBe("workspace-preview-default");
  });

  test("renderWorkspacePreviewMarkup includes inline metadata for binary previews", () => {
    const html = renderWorkspacePreviewMarkup({
      path: "artifacts/sample.zip",
      mode: "view",
      preview: {
        path: "artifacts/sample.zip",
        kind: "binary",
        content_type: "application/zip",
        size: 2048,
        mtime: "2026-03-14T09:00:00.000Z",
        truncated: true,
      },
    } as any);

    expect(html).toContain("type:</strong> application/zip");
    expect(html).toContain("kind:</strong> binary");
    expect(html).toContain("extension:</strong> zip");
    expect(html).toContain("path:</strong> artifacts/sample.zip");
    expect(html).toContain("content:</strong> truncated");
    expect(html).toContain("Binary file — download to view.");
  });

  test("renderWorkspacePreviewMarkup includes inline metadata for text previews", () => {
    const html = renderWorkspacePreviewMarkup({
      path: "notes/test.txt",
      mode: "view",
      preview: {
        path: "notes/test.txt",
        kind: "text",
        content_type: "text/plain",
        size: 128,
        mtime: "2026-03-14T09:00:00.000Z",
        text: "Hello",
      },
    } as any);

    expect(html).toContain("type:</strong> text/plain");
    expect(html).toContain("kind:</strong> text");
    expect(html).toContain("extension:</strong> txt");
    expect(html).toContain("path:</strong> notes/test.txt");
    expect(html).toContain("<code>Hello</code>");
  });

  test("workspace markdown images resolve relative to the Markdown file", () => {
    expect(rewriteWorkspaceMarkdownImageSrc("pasted.png", "notes/entry.md"))
      .toBe("/workspace/raw?path=notes%2Fpasted.png");
    expect(rewriteWorkspaceMarkdownImageSrc("../assets/diagram.png", "notes/daily/entry.md"))
      .toBe("/workspace/raw?path=notes%2Fassets%2Fdiagram.png");
    expect(rewriteWorkspaceMarkdownImageSrc("/shared/diagram.png", "notes/entry.md"))
      .toBe("/workspace/raw?path=shared%2Fdiagram.png");
    expect(rewriteWorkspaceMarkdownImageSrc("assets/diagram.png?v=2#crop", "notes/entry.md"))
      .toBe("/workspace/raw?path=notes%2Fassets%2Fdiagram.png&v=2#crop");
    expect(rewriteWorkspaceMarkdownImageSrc("https://example.com/diagram.png", "notes/entry.md"))
      .toBe("https://example.com/diagram.png");
  });
});
