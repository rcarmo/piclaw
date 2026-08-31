import { describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";

import { setEnv } from "../../helpers.js";
import {
  parseDirectVncTargetReference,
  parseVncTargets,
  VncSessionService,
} from "../../../src/channels/web/vnc/vnc-session-service.ts";

class FakeSocket extends EventEmitter {
  destroyed = false;
  write() { return true; }
  destroy(error?: Error) {
    this.destroyed = true;
    if (error) this.emit("error", error);
    this.emit("close");
  }
}

describe("VncSessionService", () => {
  test("parseVncTargets accepts object and array JSON formats", () => {
    const fromObject = parseVncTargets(JSON.stringify({
      lab: { host: "10.0.0.10", port: 5901, label: "Lab Desktop" },
    }));
    expect(fromObject).toHaveLength(1);
    expect(fromObject[0]).toMatchObject({ id: "lab", host: "10.0.0.10", port: 5901, label: "Lab Desktop" });

    const fromArray = parseVncTargets(JSON.stringify([
      { id: "printer", host: "10.0.0.20", port: 5900, label: "Printer Console", readOnly: true },
    ]));
    expect(fromArray).toHaveLength(1);
    expect(fromArray[0]).toMatchObject({ id: "printer", readOnly: true });
  });

  test("parseDirectVncTargetReference accepts host:port references", () => {
    expect(parseDirectVncTargetReference("192.168.1.137:5917")).toEqual({
      id: "192.168.1.137:5917",
      label: "192.168.1.137:5917",
      host: "192.168.1.137",
      port: 5917,
      readOnly: false,
    });
  });

  test("getSessionInfo exposes only allowlisted target metadata", () => {
    const service = new VncSessionService({
      allowDirectTargets: false,
      targets: [
        { id: "lab", label: "Lab Desktop", host: "10.0.0.10", port: 5901 },
        { id: "printer", label: "Printer Console", host: "10.0.0.20", port: 5900, readOnly: true },
      ],
    });

    const info = service.getSessionInfo();
    expect(info.enabled).toBe(true);
    expect(info.transport).toBe("websocket");
    expect(info.direct_connect_enabled).toBe(false);
    expect(info.targets).toEqual([
      { id: "lab", label: "Lab Desktop", readOnly: false },
      { id: "printer", label: "Printer Console", readOnly: true },
    ]);
    expect(JSON.stringify(info)).not.toContain("10.0.0.10");
    expect(JSON.stringify(info)).not.toContain("5901");
  });

  test("getSessionInfo can scope to a specific allowlisted target", () => {
    const service = new VncSessionService({
      allowDirectTargets: false,
      targets: [
        { id: "lab", label: "Lab Desktop", host: "10.0.0.10", port: 5901 },
      ],
    });

    const info = service.getSessionInfo("lab");
    expect(info.target).toEqual({ id: "lab", label: "Lab Desktop", read_only: false, direct_connect: false });
  });

  test("direct targets are accepted only when enabled", () => {
    const disabled = new VncSessionService({ allowDirectTargets: false });
    expect(disabled.resolveTargetReference("192.168.1.137:5917")).toBeNull();

    const enabled = new VncSessionService({ allowDirectTargets: true });
    expect(enabled.resolveTargetReference("192.168.1.137:5917")).toMatchObject({
      id: "192.168.1.137:5917",
      host: "192.168.1.137",
      port: 5917,
    });
    expect(enabled.getSessionInfo("192.168.1.137:5917").target).toEqual({
      id: "192.168.1.137:5917",
      label: "192.168.1.137:5917",
      read_only: false,
      direct_connect: true,
    });
  });

  test("prepares the stable cdp-browser target without enabling generic direct connect", async () => {
    let prepares = 0;
    const service = new VncSessionService({
      allowDirectTargets: false,
      managedCdpBrowserDesktop: {
        prepare: async () => {
          prepares += 1;
          return {
            ok: true as const,
            target: { id: "cdp-browser" as const, label: "CDP Browser" as const, host: "127.0.0.1" as const, port: 5907, readOnly: false as const },
            cdpPort: 9227,
            display: 93,
            reused: prepares > 1,
          };
        },
        shutdown: () => {},
      },
    });

    expect(service.resolveTargetReference("cdp-browser")).toBeNull();
    expect(await service.prepareTargetReference("cdp-browser")).toMatchObject({ ok: true, target: { port: 5907 } });
    expect(service.resolveTargetReference("cdp-browser")).toMatchObject({ host: "127.0.0.1", port: 5907 });
    expect(service.getSessionInfo("cdp-browser")).toMatchObject({
      enabled: true,
      ws_path: "/vnc/ws",
      targets: [{ id: "cdp-browser", label: "CDP Browser", readOnly: false }],
      target: {
      id: "cdp-browser",
      label: "CDP Browser",
      read_only: false,
      direct_connect: false,
      managed: true,
      },
    });
    expect(service.isDirectConnectEnabled()).toBe(false);
  });

  test("an explicitly configured cdp-browser target overrides managed startup", async () => {
    let managedPrepares = 0;
    const service = new VncSessionService({
      allowDirectTargets: false,
      targets: [{ id: "cdp-browser", label: "Bring-your-own browser", host: "127.0.0.1", port: 5999 }],
      managedCdpBrowserDesktop: {
        prepare: async () => {
          managedPrepares += 1;
          return { ok: false as const, error: "should not run", missingDependencies: [], platform: "darwin" as const };
        },
        shutdown: () => {},
      },
    });

    expect(await service.prepareTargetReference("cdp-browser")).toMatchObject({
      ok: true,
      target: { label: "Bring-your-own browser", port: 5999 },
    });
    expect(service.getTargets()).toEqual([{ id: "cdp-browser", label: "Bring-your-own browser", readOnly: false }]);
    expect(managedPrepares).toBe(0);
  });

  test("returns actionable managed-target diagnostics without affecting other VNC targets", async () => {
    const service = new VncSessionService({
      allowDirectTargets: false,
      targets: [{ id: "desk", label: "Desk", host: "10.0.0.1", port: 5901 }],
      managedCdpBrowserDesktop: {
        prepare: async () => ({
          ok: false as const,
          error: "Missing Chromium and x11vnc. Run /skill:cdp-browser-vnc-setup.",
          missingDependencies: ["x11vnc", "Chromium, Chrome, or Edge"],
          platform: "linux" as const,
        }),
        shutdown: () => {},
      },
    });

    expect(await service.prepareTargetReference("cdp-browser")).toEqual({
      ok: false,
      error: "Missing Chromium and x11vnc. Run /skill:cdp-browser-vnc-setup.",
      missingDependencies: ["x11vnc", "Chromium, Chrome, or Edge"],
      platform: "linux",
    });
    expect(await service.prepareTargetReference("desk")).toMatchObject({ ok: true, target: { id: "desk" } });
  });

  test("times out unreachable VNC targets instead of hanging indefinitely", async () => {
    const socket = new FakeSocket();
    const service = new VncSessionService({
      allowDirectTargets: true,
      connectTimeoutMs: 5,
      createSocket: () => socket as any,
    });
    const ws = {
      data: { kind: "vnc", token: "t", userId: "u", targetRef: "192.168.1.137:5917" },
      send: mock(() => {}),
      close: mock(() => {}),
    } as any;

    service.attachClient(ws);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(socket.destroyed).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
      type: "vnc.error",
      error: "Timed out connecting to VNC target 192.168.1.137:5917.",
    }));
    expect(ws.close).toHaveBeenCalled();
  });

  test("direct-target policy follows runtime config when no override is provided", async () => {
    const configModule = await import("../../../src/core/config.js");
    const restoreEnv = setEnv({
      PICLAW_WEB_VNC_ALLOW_DIRECT: undefined,
      PICLAW_VNC_ALLOW_DIRECT: undefined,
    });
    const previous = configModule.getWebRuntimeConfig().vncAllowDirect;

    try {
      configModule.setWebVncAllowDirect(false);
      const service = new VncSessionService();
      expect(service.isDirectConnectEnabled()).toBe(false);
      expect(service.resolveTargetReference("192.168.1.137:5917")).toBeNull();

      configModule.setWebVncAllowDirect(true);
      expect(service.isDirectConnectEnabled()).toBe(true);
      expect(service.resolveTargetReference("192.168.1.137:5917")).toMatchObject({
        id: "192.168.1.137:5917",
        host: "192.168.1.137",
        port: 5917,
      });
    } finally {
      configModule.setWebVncAllowDirect(previous);
      restoreEnv();
    }
  });
});
