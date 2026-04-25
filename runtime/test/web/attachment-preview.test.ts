import { describe, expect, test } from "bun:test";

import { HTML_ATTACHMENT_PREVIEW_SANDBOX } from "../../web/src/components/attachment-preview-modal.ts";
import { getAttachmentPreviewKind, getAttachmentPreviewLabel } from "../../web/src/ui/attachment-preview.js";

describe("attachment preview kind", () => {
  test("classifies ZIP files as archive previews", () => {
    expect(getAttachmentPreviewKind("application/zip", "bundle.zip")).toBe("archive");
    expect(getAttachmentPreviewKind("application/x-zip-compressed", "bundle.zip")).toBe("archive");
    expect(getAttachmentPreviewKind("application/octet-stream", "bundle.zip")).toBe("archive");
  });

  test("classifies .eml attachments as email previews", () => {
    expect(getAttachmentPreviewKind("message/rfc822", "message.eml")).toBe("eml");
    expect(getAttachmentPreviewKind("application/octet-stream", "message.eml")).toBe("eml");
  });

  test("classifies shell scripts and .sb files as text previews by filename", () => {
    expect(getAttachmentPreviewKind("application/octet-stream", "script.sh")).toBe("text");
    expect(getAttachmentPreviewKind("application/octet-stream", "workflow.sb")).toBe("text");
  });

  test("returns the ZIP archive preview label", () => {
    expect(getAttachmentPreviewLabel("archive")).toBe("ZIP archive preview");
    expect(getAttachmentPreviewLabel("eml")).toBe("Email preview");
  });

  test("HTML attachment previews do not run with same-origin iframe privileges", () => {
    expect(HTML_ATTACHMENT_PREVIEW_SANDBOX).toBe("allow-scripts");
    expect(HTML_ATTACHMENT_PREVIEW_SANDBOX.includes("allow-same-origin")).toBe(false);
  });
});
