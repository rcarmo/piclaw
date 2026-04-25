import { describe, test, expect, beforeAll } from "bun:test";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { isOverlayAvailable, createOverlayWorkspace, withOverlayWorkspace } from "./overlay-workspace";

describe("overlay-workspace", () => {
  test("isOverlayAvailable returns a boolean", () => {
    const result = isOverlayAvailable();
    expect(typeof result).toBe("boolean");
  });

  test("createOverlayWorkspace creates a workspace", () => {
    const base = mkdtempSync(join(tmpdir(), "overlay-test-base-"));
    writeFileSync(join(base, "test.txt"), "original");

    const overlay = createOverlayWorkspace(base, "overlay-test-");
    try {
      expect(existsSync(overlay.merged)).toBe(true);
      expect(typeof overlay.isOverlay).toBe("boolean");
      expect(typeof overlay.cleanup).toBe("function");

      if (overlay.isOverlay) {
        // Original file visible through overlay
        expect(readFileSync(join(overlay.merged, "test.txt"), "utf-8")).toBe("original");

        // Write to overlay doesn't affect original
        writeFileSync(join(overlay.merged, "new-file.txt"), "overlay-only");
        expect(existsSync(join(overlay.merged, "new-file.txt"))).toBe(true);
        expect(existsSync(join(base, "new-file.txt"))).toBe(false);

        // Modify existing file — original stays intact
        writeFileSync(join(overlay.merged, "test.txt"), "modified");
        expect(readFileSync(join(base, "test.txt"), "utf-8")).toBe("original");
        expect(readFileSync(join(overlay.merged, "test.txt"), "utf-8")).toBe("modified");

        // Upper dir captures changes
        expect(overlay.upperDir).toBeTruthy();
        expect(existsSync(join(overlay.upperDir!, "new-file.txt"))).toBe(true);
      } else {
        // Fallback: just a temp dir
        expect(existsSync(overlay.merged)).toBe(true);
      }
    } finally {
      overlay.cleanup();
    }

    // After cleanup, overlay is gone
    expect(existsSync(overlay.merged)).toBe(false);

    // Original untouched
    expect(readFileSync(join(base, "test.txt"), "utf-8")).toBe("original");

    // Cleanup base
    const { rmSync } = require("fs");
    rmSync(base, { recursive: true, force: true });
  });

  test("withOverlayWorkspace sets env vars and restores them", async () => {
    const base = mkdtempSync(join(tmpdir(), "overlay-env-test-"));
    writeFileSync(join(base, "marker.txt"), "exists");

    const prevWorkspace = process.env.PICLAW_WORKSPACE;

    let capturedWorkspace: string | undefined;
    let capturedIsOverlay: boolean | undefined;

    await withOverlayWorkspace(base, (overlay) => {
      capturedWorkspace = process.env.PICLAW_WORKSPACE;
      capturedIsOverlay = overlay.isOverlay;
      expect(process.env.PICLAW_WORKSPACE).toBe(overlay.merged);
    });

    // Env restored
    expect(process.env.PICLAW_WORKSPACE).toBe(prevWorkspace);
    expect(capturedWorkspace).toBeTruthy();

    const { rmSync } = require("fs");
    rmSync(base, { recursive: true, force: true });
  });

  test("overlay cleanup restores original state", () => {
    const base = mkdtempSync(join(tmpdir(), "overlay-restore-test-"));
    writeFileSync(join(base, "important.txt"), "do not lose");
    mkdirSync(join(base, "subdir"));
    writeFileSync(join(base, "subdir", "nested.txt"), "nested content");

    const overlay = createOverlayWorkspace(base, "overlay-restore-");
    try {
      if (overlay.isOverlay) {
        // Make destructive changes in the overlay
        writeFileSync(join(overlay.merged, "important.txt"), "DESTROYED");
        writeFileSync(join(overlay.merged, "subdir", "nested.txt"), "GONE");
        writeFileSync(join(overlay.merged, "junk.txt"), "should disappear");
      }
    } finally {
      overlay.cleanup();
    }

    // Everything intact
    expect(readFileSync(join(base, "important.txt"), "utf-8")).toBe("do not lose");
    expect(readFileSync(join(base, "subdir", "nested.txt"), "utf-8")).toBe("nested content");
    expect(existsSync(join(base, "junk.txt"))).toBe(false);

    const { rmSync } = require("fs");
    rmSync(base, { recursive: true, force: true });
  });
});
