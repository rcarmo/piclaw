/**
 * test/overlay-workspace.ts — OverlayFS-based workspace isolation for tests.
 *
 * Mounts an overlay over a base directory so all writes go to a temporary
 * upper layer. Unmounting instantly restores the original state.
 *
 * Falls back gracefully to a plain temp directory copy if overlayfs is
 * not available (no root, no overlay module, non-Linux).
 */

import { execSync, spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, cpSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/** Remove a directory tree, using sudo if needed (overlay upper dirs may be root-owned). */
function sudoRm(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    try { spawnSync("sudo", ["rm", "-rf", dir], { timeout: 10000, stdio: "pipe" }); } catch {}
  }
}

export interface OverlayWorkspace {
  /** The merged mount point (or copy) — use this as the workspace root. */
  merged: string;
  /** Whether overlayfs is actually in use (vs. fallback copy). */
  isOverlay: boolean;
  /** Directory capturing all changes (only meaningful when isOverlay=true). */
  upperDir: string | null;
  /** Tear down: unmount overlay and clean up temp dirs. */
  cleanup: () => void;
}

let _overlayAvailable: boolean | null = null;

/** Probe whether overlayfs mounts work in this environment. */
export function isOverlayAvailable(): boolean {
  if (_overlayAvailable !== null) return _overlayAvailable;
  if (process.platform !== "linux") { _overlayAvailable = false; return false; }

  const probe = mkdtempSync(join(tmpdir(), "overlay-probe-"));
  try {
    mkdirSync(join(probe, "lower"));
    mkdirSync(join(probe, "upper"));
    mkdirSync(join(probe, "work"));
    mkdirSync(join(probe, "merged"));
    const result = spawnSync("sudo", [
      "mount", "-t", "overlay", "overlay",
      "-o", `lowerdir=${join(probe, "lower")},upperdir=${join(probe, "upper")},workdir=${join(probe, "work")}`,
      join(probe, "merged"),
    ], { timeout: 5000, stdio: "pipe" });
    if (result.status === 0) {
      spawnSync("sudo", ["umount", join(probe, "merged")], { timeout: 5000, stdio: "pipe" });
      _overlayAvailable = true;
    } else {
      _overlayAvailable = false;
    }
  } catch {
    _overlayAvailable = false;
  } finally {
    sudoRm(probe);
  }
  return _overlayAvailable;
}

/**
 * Create an isolated workspace backed by overlayfs.
 *
 * @param baseDir The directory to use as the read-only lower layer (e.g., /workspace).
 * @param prefix  Temp directory prefix.
 * @returns An OverlayWorkspace with a merged mount point and cleanup function.
 */
export function createOverlayWorkspace(
  baseDir: string,
  prefix = "piclaw-overlay-",
): OverlayWorkspace {
  const tmpBase = mkdtempSync(join(tmpdir(), prefix));

  if (isOverlayAvailable()) {
    const upper = join(tmpBase, "upper");
    const work = join(tmpBase, "work");
    const merged = join(tmpBase, "merged");
    mkdirSync(upper);
    mkdirSync(work);
    mkdirSync(merged);

    const result = spawnSync("sudo", [
      "mount", "-t", "overlay", "overlay",
      "-o", `lowerdir=${baseDir},upperdir=${upper},workdir=${work}`,
      merged,
    ], { timeout: 10000, stdio: "pipe" });

    if (result.status === 0) {
      return {
        merged,
        isOverlay: true,
        upperDir: upper,
        cleanup: () => {
          try { spawnSync("sudo", ["umount", "-l", merged], { timeout: 5000, stdio: "pipe" }); } catch (e) { void e; }
          sudoRm(tmpBase);
        },
      };
    }
    // Mount failed — fall through to copy fallback
  }

  // Fallback: create a temp workspace with store/data dirs (no copy of base needed)
  const workspace = tmpBase;
  mkdirSync(join(workspace, "store"), { recursive: true });
  mkdirSync(join(workspace, "data"), { recursive: true });
  return {
    merged: workspace,
    isOverlay: false,
    upperDir: null,
    cleanup: () => {
      rmSync(tmpBase, { recursive: true, force: true });
    },
  };
}

/**
 * Run a callback inside an overlayfs-isolated workspace.
 * Sets PICLAW_WORKSPACE/STORE/DATA env vars, runs the callback, then cleans up.
 */
export async function withOverlayWorkspace<T>(
  baseDir: string,
  run: (overlay: OverlayWorkspace) => Promise<T> | T,
): Promise<T> {
  const overlay = createOverlayWorkspace(baseDir);
  const prevWorkspace = process.env.PICLAW_WORKSPACE;
  const prevStore = process.env.PICLAW_STORE;
  const prevData = process.env.PICLAW_DATA;

  process.env.PICLAW_WORKSPACE = overlay.merged;
  process.env.PICLAW_STORE = join(overlay.merged, ".piclaw", "store");
  process.env.PICLAW_DATA = join(overlay.merged, ".piclaw", "data");

  try {
    return await run(overlay);
  } finally {
    if (prevWorkspace !== undefined) process.env.PICLAW_WORKSPACE = prevWorkspace;
    else delete process.env.PICLAW_WORKSPACE;
    if (prevStore !== undefined) process.env.PICLAW_STORE = prevStore;
    else delete process.env.PICLAW_STORE;
    if (prevData !== undefined) process.env.PICLAW_DATA = prevData;
    else delete process.env.PICLAW_DATA;
    overlay.cleanup();
  }
}
