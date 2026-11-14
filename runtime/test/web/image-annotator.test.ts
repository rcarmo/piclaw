import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../..");
const source = readFileSync(resolve(repoRoot, "runtime/web/src/components/image-annotator.ts"), "utf8");
const classicCss = readFileSync(resolve(repoRoot, "runtime/web/static/classic/css/overlays.css"), "utf8");

test("image annotator renders as a centered modal with a clipped stage and protected toolbar", () => {
  expect(source).toContain('role="dialog"');
  expect(source).toContain('class="image-annotator-stage"');

  for (const css of [classicCss]) {
    expect(css).toContain(".post-inline-annotator {");
    expect(css).toContain("position: fixed;");
    expect(css).toContain("align-items: center;");
    expect(css).toContain("justify-content: center;");
    expect(css).toContain(".image-annotator-stage {");
    expect(css).toContain("overflow: hidden;");
    expect(css).toContain(".image-annotator-toolbar {");
    expect(css).toContain("z-index: 20;");
    expect(css).toContain("pointer-events: auto;");
  }
});

test("image annotator treats two-finger gestures as pinch instead of committed drawing", () => {
  expect(source).toContain("gestureModeRef");
  expect(source).toContain("beginPinch(e)");
  expect(source).toContain("cancelActiveDrawing()");
  expect(source).toContain("redrawAll(ctx, historyRef.current, canvas.width, canvas.height)");
  expect(source).toContain("suppressTouchDrawUntilRef.current = Date.now() + 250");
});

test("image annotator rasterizes SVG sources into a canvas before annotation/export", () => {
  expect(source).toContain("function isSvgImageSource(src: string, mimeType?: string): boolean");
  expect(source).toContain("const isSvgSource = isSvgImageSource(src, mimeType)");
  expect(source).toContain("sourceCanvasRef");
  expect(source).toContain("sctx.drawImage(img, 0, 0, w, h)");
  expect(source).toContain("image-annotator-source-raster-canvas");
  expect(source).toContain("const rasterSource = sourceRasterReady ? sourceCanvasRef.current : null");
  expect(source).toContain("if (rasterSource) octx.drawImage(rasterSource, 0, 0, out.width, out.height)");

  for (const css of [classicCss]) {
    expect(css).toContain(".image-annotator-source-raster-canvas {");
    expect(css).toContain("display: block;");
    expect(css).toContain(".image-annotator-source-hidden {");
    expect(css).toContain("display: none;");
  }
});

test("image annotator provides a crop tool that crops raster source plus annotations", () => {
  expect(source).toContain("type Tool = 'pen' | 'highlighter' | 'arrow' | 'rectangle' | 'text' | 'crop' | 'eraser'");
  expect(source).toContain("label: 'Crop'");
  expect(source).toContain("function normalizeCropRect");
  expect(source).toContain("function drawCropOverlay");
  expect(source).toContain("const handleApplyCrop = useCallback");
  expect(source).toContain("mctx.drawImage(sourceCanvas, rect.x, rect.y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)");
  expect(source).toContain("mctx.drawImage(drawCanvas, rect.x, rect.y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)");
  expect(source).toContain("historyRef.current = []");
  expect(source).toContain("title=\"Apply crop\"");
});
