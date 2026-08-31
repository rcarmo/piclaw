#!/usr/bin/env bun
/**
 * SCRIPT_JDOC:
 * {
 *   "summary": "Check managed CDP browser VNC prerequisites.",
 *   "aliases": ["browser VNC check", "CDP desktop setup"],
 *   "domains": ["browser", "VNC", "desktop automation"],
 *   "verbs": ["check", "diagnose"],
 *   "nouns": ["Chromium", "Xvfb", "x11vnc", "xauth"],
 *   "keywords": ["cdp-browser", "VNC", "managed desktop"],
 *   "guidance": ["Read-only prerequisite check.", "Run before installing Linux packages."],
 *   "examples": ["check CDP browser VNC dependencies"],
 *   "kind": "read-only",
 *   "weight": "lightweight",
 *   "role": "entrypoint"
 * }
 */

import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

function commandExists(command: string): boolean {
  return String(process.env.PATH || "").split(delimiter).filter(Boolean).some((entry) => {
    try {
      accessSync(join(entry, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

const browser = [
  "chromium",
  "chromium-browser",
  "google-chrome",
  "google-chrome-stable",
  "microsoft-edge",
  "microsoft-edge-stable",
].find(commandExists) ?? null;

const dependencies = {
  Xvfb: commandExists("Xvfb"),
  x11vnc: commandExists("x11vnc"),
  xauth: commandExists("xauth"),
  browser: Boolean(browser),
};
const missing = Object.entries(dependencies).filter(([, available]) => !available).map(([name]) => name);
const managed = process.platform === "linux" && missing.length === 0;

console.log(JSON.stringify({
  platform: process.platform,
  managed,
  stablePanePath: "piclaw://vnc/cdp-browser",
  dependencies,
  browser,
  missing,
  guidance: process.platform !== "linux"
    ? "Managed mode is Linux-only; configure a loopback CDP browser and an allowlisted VNC target."
    : missing.length > 0
      ? `Install the missing dependencies: ${missing.join(", ")}.`
      : "Managed CDP browser VNC prerequisites are available.",
}, null, 2));

process.exitCode = managed ? 0 : 1;
