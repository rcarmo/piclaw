#!/usr/bin/env bun

import { existsSync, statSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";

import {
  MANAGED_CDP_STATE_FILENAME,
  ManagedCdpBrowserDesktop,
} from "../src/channels/web/vnc/managed-cdp-browser-desktop.js";
import { getWorkspaceDir } from "../src/core/config.js";

function openVncGreeting(port: number): Promise<{ socket: Socket; greeting: string }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    const fail = (error: Error) => {
      socket.removeAllListeners();
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(3_000, () => fail(new Error("VNC greeting timed out.")));
    socket.once("data", (chunk) => {
      socket.setTimeout(0);
      socket.removeAllListeners("error");
      resolve({ socket, greeting: chunk.toString("ascii") });
    });
    socket.once("error", fail);
  });
}

const workspaceDir = Bun.argv[2]?.trim() || getWorkspaceDir();
const service = new ManagedCdpBrowserDesktop({ workspaceDir });
let cdpPort: number | null = null;
try {
  const prepared = await service.prepare();
  if (!prepared.ok) throw new Error(prepared.error);
  cdpPort = prepared.cdpPort;

  const response = await fetch(`http://127.0.0.1:${prepared.cdpPort}/json/version`);
  if (!response.ok) throw new Error(`CDP returned HTTP ${response.status}.`);
  const version = await response.json() as Record<string, unknown>;
  if (typeof version.Browser !== "string" || !version.Browser.trim()) {
    throw new Error("CDP did not report a browser version.");
  }

  const viewers = await Promise.all([
    openVncGreeting(prepared.target.port),
    openVncGreeting(prepared.target.port),
  ]);
  try {
    for (const { greeting } of viewers) {
      if (!greeting.startsWith("RFB ")) throw new Error(`Unexpected VNC greeting: ${JSON.stringify(greeting)}`);
    }
  } finally {
    for (const { socket } of viewers) socket.destroy();
  }
  const greeting = viewers[0].greeting;

  const statePath = join(workspaceDir, ".piclaw", "browser", MANAGED_CDP_STATE_FILENAME);
  const stateMode = statSync(statePath).mode & 0o777;
  if (stateMode !== 0o600) throw new Error(`Managed state mode ${stateMode.toString(8)} is not 600.`);

  console.log(JSON.stringify({
    ok: true,
    target: prepared.target.id,
    browser: version.Browser,
    display: prepared.display,
    cdpPort: prepared.cdpPort,
    vncPort: prepared.target.port,
    vncProtocol: greeting.trim(),
    concurrentViewers: viewers.length,
    stateMode: stateMode.toString(8),
  }));
} finally {
  service.shutdown();
}

if (cdpPort !== null) {
  await Bun.sleep(500);
  const stillListening = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
    .then(() => true, () => false);
  if (stillListening) throw new Error("Managed Chromium CDP port remained open after shutdown.");
}

const statePath = join(workspaceDir, ".piclaw", "browser", MANAGED_CDP_STATE_FILENAME);
if (existsSync(statePath)) throw new Error("Managed browser state remained after shutdown.");
console.log(JSON.stringify({ shutdown: "clean" }));
