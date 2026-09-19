import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildAttachmentPreviewModalClassName, HTML_ATTACHMENT_PREVIEW_SANDBOX } from "../../web/src/components/attachment-preview-modal.ts";
import { getAttachmentPreviewKind, getAttachmentPreviewLabel } from "../../web/src/ui/attachment-preview.js";
import { inferDelimitedPreviewDelimiter, parseDelimitedPreview } from "../../web/src/ui/delimited-preview.js";

const overlaysCss = readFileSync(path.join(import.meta.dir, "../../web/static/classic/css/overlays.css"), "utf8");

describe("attachment preview kind", () => {
  test("classifies PDF content types with parameters as PDF previews", () => {
    expect(getAttachmentPreviewKind("application/pdf; charset=binary", "report.bin")).toBe("pdf");
  });

  test("classifies ZIP files as archive previews", () => {
    expect(getAttachmentPreviewKind("application/zip", "bundle.zip")).toBe("archive");
    expect(getAttachmentPreviewKind("application/x-zip-compressed", "bundle.zip")).toBe("archive");
    expect(getAttachmentPreviewKind("application/octet-stream", "bundle.zip")).toBe("archive");
  });

  test("classifies .eml attachments as email previews", () => {
    expect(getAttachmentPreviewKind("message/rfc822", "message.eml")).toBe("eml");
    expect(getAttachmentPreviewKind("application/octet-stream", "message.eml")).toBe("eml");
  });

  test("classifies CSV and TSV attachments as table previews", () => {
    expect(getAttachmentPreviewKind("text/csv", "report.csv")).toBe("delimited");
    expect(getAttachmentPreviewKind("text/tab-separated-values", "audit.tsv")).toBe("delimited");
    expect(getAttachmentPreviewKind("application/octet-stream", "audit.tsv")).toBe("delimited");
  });

  test("classifies shell scripts, scratch buffers, and YAML files as text previews by filename", () => {
    expect(getAttachmentPreviewKind("application/octet-stream", "script.sh")).toBe("text");
    expect(getAttachmentPreviewKind("application/octet-stream", "workflow.sb")).toBe("text");
    expect(getAttachmentPreviewKind("application/octet-stream", "config.yaml")).toBe("text");
    expect(getAttachmentPreviewKind("application/octet-stream", "config.yml")).toBe("text");
  });

  test("classifies YAML content types as text previews", () => {
    expect(getAttachmentPreviewKind("text/yaml", "config.yaml")).toBe("text");
    expect(getAttachmentPreviewKind("text/x-yaml", "config.yml")).toBe("text");
  });

  test("classifies audio attachments by MIME type or common filename", () => {
    expect(getAttachmentPreviewKind("audio/wav", "recording.wav")).toBe("audio");
    expect(getAttachmentPreviewKind("audio/mpeg; codecs=mp3", "recording.bin")).toBe("audio");
    expect(getAttachmentPreviewKind("application/octet-stream", "recording.wav")).toBe("audio");
    expect(getAttachmentPreviewKind("application/octet-stream", "voice-note.m4a")).toBe("audio");
  });

  test("returns the audio player label", () => {
    expect(getAttachmentPreviewLabel("audio")).toBe("Audio player");
  });

  test("returns the ZIP archive preview label", () => {
    expect(getAttachmentPreviewLabel("archive")).toBe("ZIP archive preview");
    expect(getAttachmentPreviewLabel("eml")).toBe("Email preview");
    expect(getAttachmentPreviewLabel("delimited")).toBe("Table preview");
  });

  test("parses TSV attachments into headers and rows", () => {
    const preview = parseDelimitedPreview("name\tcount\nalpha\t1\nbeta\t2\n", { delimiter: "\t" });
    expect(preview.delimiter).toBe("\t");
    expect(preview.headers).toEqual(["name", "count"]);
    expect(preview.rows).toEqual([["alpha", "1"], ["beta", "2"]]);
    expect(preview.columnCount).toBe(2);
    expect(preview.rowCount).toBe(2);
  });

  test("parses quoted CSV cells and infers comma delimiter", () => {
    expect(inferDelimitedPreviewDelimiter("text/csv", "quoted.csv")).toBe(",");
    const preview = parseDelimitedPreview('name,note\n"alpha, one","line ""quoted"""\n', { delimiter: "," });
    expect(preview.headers).toEqual(["name", "note"]);
    expect(preview.rows).toEqual([["alpha, one", 'line "quoted"']]);
  });

  test("HTML attachment previews do not run with same-origin iframe privileges", () => {
    expect(HTML_ATTACHMENT_PREVIEW_SANDBOX).toBe("allow-scripts");
    expect(HTML_ATTACHMENT_PREVIEW_SANDBOX.includes("allow-same-origin")).toBe(false);
  });

  test("attachment previews expose a maximized lightbox class", () => {
    expect(buildAttachmentPreviewModalClassName(false)).toBe("image-modal attachment-preview-modal");
    expect(buildAttachmentPreviewModalClassName(true)).toBe("image-modal attachment-preview-modal maximized");
    expect(overlaysCss).toContain(".attachment-preview-modal.maximized");
    expect(overlaysCss).toContain(".attachment-preview-modal.maximized .attachment-preview-shell");
  });

  test("audio previews have responsive player styling", () => {
    expect(overlaysCss).toContain(".attachment-preview-audio-shell");
    expect(overlaysCss).toContain(".attachment-preview-audio");
    expect(overlaysCss).toContain("width: min(680px, 100%)");
  });
});
