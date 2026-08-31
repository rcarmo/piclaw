import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MANAGED_CDP_VNC_TARGET_ID,
  ManagedCdpBrowserDesktop,
  resolveContainerRuntime,
} from "../../../src/channels/web/vnc/managed-cdp-browser-desktop.js";

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  pid: number;
  killCalls: string[] = [];

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal = "SIGTERM") {
    this.killed = true;
    this.killCalls.push(String(signal));
    return true;
  }
}

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), "piclaw-cdp-vnc-"));
}

describe("ManagedCdpBrowserDesktop", () => {
  test("resolves Docker, Podman, Kubernetes, and LXC container markers", () => {
    expect(resolveContainerRuntime({ dockerMarker: true })).toBe("docker");
    expect(resolveContainerRuntime({ podmanMarker: true })).toBe("podman");
    expect(resolveContainerRuntime({ systemdMarker: "lxc\n" })).toBe("lxc");
    expect(resolveContainerRuntime({ cgroup: "0::/kubepods/pod-1" })).toBe("kubepods");
    expect(resolveContainerRuntime({ cgroup: "0::/init.scope" })).toBeNull();
  });

  test("reports actionable missing Linux dependencies without spawning", async () => {
    const root = makeRoot();
    const spawns: string[] = [];
    try {
      const service = new ManagedCdpBrowserDesktop({
        platform: "linux",
        workspaceDir: root,
        commandExists: (command) => command === "Xvfb",
        browserCommand: () => null,
        spawnProcess: (command) => {
          spawns.push(command);
          return new FakeChild(1) as any;
        },
      });

      const result = await service.prepare();
      expect(result).toEqual({
        ok: false,
        error: "Managed CDP browser view is unavailable. Missing: x11vnc, xauth, Chromium, Chrome, or Edge. Run /skill:cdp-browser-vnc-setup for setup and bring-your-own guidance.",
        missingDependencies: ["x11vnc", "xauth", "Chromium, Chrome, or Edge"],
        platform: "linux",
      });
      expect(spawns).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports bring-your-own guidance on non-Linux hosts", async () => {
    const root = makeRoot();
    try {
      const service = new ManagedCdpBrowserDesktop({ platform: "darwin", workspaceDir: root });
      const result = await service.prepare();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("Linux only");
        expect(result.error).toContain("loopback VNC target");
        expect(result.platform).toBe("darwin");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("starts one loopback shared desktop and reuses it for concurrent viewers", async () => {
    const root = makeRoot();
    const children: FakeChild[] = [];
    const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
    const authority: Array<{ path: string; display: number }> = [];
    try {
      const service = new ManagedCdpBrowserDesktop({
        platform: "linux",
        workspaceDir: root,
        commandExists: () => true,
        browserCommand: () => "chromium",
        displayAvailable: (display) => display === 90,
        portAvailable: async (port) => port === 9224 || port === 5901,
        waitForDisplay: async () => true,
        waitForPort: async () => true,
        waitForCdp: async () => true,
        prepareXAuthority: (path, display) => authority.push({ path, display }),
        containerRuntime: () => null,
        spawnProcess: (command, args, env) => {
          const child = new FakeChild(100 + children.length);
          children.push(child);
          calls.push({ command, args, env });
          return child as any;
        },
      });

      const [first, concurrent] = await Promise.all([service.prepare(), service.prepare()]);
      const reused = await service.prepare();
      expect(first).toMatchObject({
        ok: true,
        target: { id: MANAGED_CDP_VNC_TARGET_ID, host: "127.0.0.1", port: 5901, readOnly: false },
        cdpPort: 9224,
        display: 90,
      });
      expect(concurrent).toEqual(first);
      expect(reused).toMatchObject({ ok: true, reused: true });
      expect(calls).toHaveLength(3);
      expect(calls[0]).toMatchObject({ command: "Xvfb" });
      expect(calls[0].args).toEqual(expect.arrayContaining([":90", "-nolisten", "tcp", "-auth"]));
      expect(calls[1]).toMatchObject({ command: "x11vnc" });
      expect(calls[1].args).toEqual(expect.arrayContaining(["-localhost", "-forever", "-shared", "-nopw", "-rfbport", "5901"]));
      expect(calls[2]).toMatchObject({ command: "chromium" });
      expect(calls[2].args).toEqual(expect.arrayContaining([
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9224",
        `--user-data-dir=${join(root, ".piclaw", "browser", "profile")}`,
      ]));
      expect(calls[2].args).not.toContain("--no-sandbox");
      expect(calls.every((call) => call.env.DISPLAY === ":90")).toBe(true);
      expect(calls.every((call) => call.env.XAUTHORITY?.includes(".piclaw/browser/Xauthority-90"))).toBe(true);
      expect(authority).toEqual([{ path: join(root, ".piclaw", "browser", "Xauthority-90"), display: 90 }]);

      service.shutdown();
      expect(children.every((child) => child.killed)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("shutdown fences an in-progress startup before it can publish a target", async () => {
    const root = makeRoot();
    let releaseCdp: (() => void) | null = null;
    const cdpReady = new Promise<void>((resolve) => { releaseCdp = resolve; });
    const children: FakeChild[] = [];
    try {
      const service = new ManagedCdpBrowserDesktop({
        platform: "linux",
        workspaceDir: root,
        commandExists: () => true,
        browserCommand: () => "chromium",
        displayAvailable: (display) => display === 90,
        portAvailable: async (port) => port === 9224 || port === 5901,
        waitForDisplay: async () => true,
        waitForPort: async () => true,
        waitForCdp: async () => { await cdpReady; return true; },
        prepareXAuthority: () => {},
        containerRuntime: () => null,
        spawnProcess: () => {
          const child = new FakeChild(300 + children.length);
          children.push(child);
          return child as any;
        },
      });

      const preparing = service.prepare();
      await Bun.sleep(0);
      service.shutdown();
      releaseCdp?.();
      const result = await preparing;
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining("cancelled") });
      expect(children.every((child) => child.killed)).toBe(true);
      expect((await service.prepare()).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("unexpected child exit stops siblings and permits a later restart", async () => {
    const root = makeRoot();
    const children: FakeChild[] = [];
    try {
      const service = new ManagedCdpBrowserDesktop({
        platform: "linux",
        workspaceDir: root,
        commandExists: () => true,
        browserCommand: () => "chromium",
        displayAvailable: (display) => display === 90,
        portAvailable: async (port) => port === 9224 || port === 5901,
        waitForDisplay: async () => true,
        waitForPort: async () => true,
        waitForCdp: async () => true,
        prepareXAuthority: () => {},
        containerRuntime: () => null,
        spawnProcess: () => {
          const child = new FakeChild(400 + children.length);
          children.push(child);
          return child as any;
        },
      });

      expect((await service.prepare()).ok).toBe(true);
      children[1].exitCode = 1;
      children[1].emit("exit", 1, null);
      expect(children[0].killed).toBe(true);
      expect(children[2].killed).toBe(true);
      expect((await service.prepare()).ok).toBe(true);
      expect(children).toHaveLength(6);
      service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("adds the explicit no-sandbox fallback only for recognised containers", async () => {
    const root = makeRoot();
    const calls: Array<{ command: string; args: string[] }> = [];
    try {
      const service = new ManagedCdpBrowserDesktop({
        platform: "linux",
        workspaceDir: root,
        commandExists: () => true,
        browserCommand: () => "chromium",
        displayAvailable: (display) => display === 90,
        portAvailable: async (port) => port === 9224 || port === 5901,
        waitForDisplay: async () => true,
        waitForPort: async () => true,
        waitForCdp: async () => true,
        prepareXAuthority: () => {},
        containerRuntime: () => "docker",
        spawnProcess: (command, args) => {
          calls.push({ command, args });
          return new FakeChild(200 + calls.length) as any;
        },
      });

      expect((await service.prepare()).ok).toBe(true);
      expect(calls.find((call) => call.command === "chromium")?.args).toContain("--no-sandbox");
      service.shutdown();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
