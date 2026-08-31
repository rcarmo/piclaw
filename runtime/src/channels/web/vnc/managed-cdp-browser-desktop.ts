import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { delimiter, join } from "node:path";

import { getWorkspaceDir } from "../../../core/config.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

export const MANAGED_CDP_VNC_TARGET_ID = "cdp-browser";
export const MANAGED_CDP_VNC_TARGET_LABEL = "CDP Browser";
export const MANAGED_CDP_PORTS = [9224, 9225, 9226, 9227, 9228, 9229, 9230, 9231, 9232, 9233] as const;
export const MANAGED_VNC_PORTS = [5901, 5902, 5903, 5904, 5905, 5906, 5907, 5908, 5909, 5910] as const;
export const MANAGED_X_DISPLAYS = Array.from({ length: 20 }, (_, index) => 90 + index);
export const MANAGED_CDP_STATE_FILENAME = "managed-desktop.json";

export interface ManagedCdpBrowserTarget {
  id: typeof MANAGED_CDP_VNC_TARGET_ID;
  label: typeof MANAGED_CDP_VNC_TARGET_LABEL;
  host: "127.0.0.1";
  port: number;
  readOnly: false;
}

export type ManagedCdpBrowserPrepareResult =
  | { ok: true; target: ManagedCdpBrowserTarget; cdpPort: number; display: number; reused: boolean }
  | { ok: false; error: string; missingDependencies: string[]; platform: NodeJS.Platform };

interface ManagedProcess {
  name: string;
  child: ChildProcess;
}

export interface ManagedCdpBrowserDesktopOptions {
  platform?: NodeJS.Platform;
  workspaceDir?: string;
  commandExists?: (command: string) => boolean;
  browserCommand?: () => string | null;
  displayAvailable?: (display: number) => boolean;
  portAvailable?: (port: number) => Promise<boolean>;
  waitForDisplay?: (display: number, timeoutMs: number, processes: readonly ChildProcess[]) => Promise<boolean>;
  waitForPort?: (port: number, timeoutMs: number) => Promise<boolean>;
  waitForCdp?: (port: number, timeoutMs: number) => Promise<boolean>;
  spawnProcess?: (command: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess;
  prepareXAuthority?: (path: string, display: number) => void;
  containerRuntime?: () => string | null;
}

const log = createLogger("web.managed-cdp-browser-desktop");

function defaultCommandExists(command: string): boolean {
  const candidates = command.includes("/")
    ? [command]
    : String(process.env.PATH || "").split(delimiter).filter(Boolean).map((entry) => join(entry, command));
  return candidates.some((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function defaultBrowserCommand(commandExists: (command: string) => boolean): string | null {
  for (const command of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "microsoft-edge", "microsoft-edge-stable"]) {
    if (commandExists(command)) return command;
  }
  return null;
}

function defaultDisplayAvailable(display: number): boolean {
  return !existsSync(`/tmp/.X11-unix/X${display}`) && !existsSync(`/tmp/.X${display}-lock`);
}

async function defaultPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function defaultWaitForDisplay(
  display: number,
  timeoutMs: number,
  processes: readonly ChildProcess[],
): Promise<boolean> {
  const socket = `/tmp/.X11-unix/X${display}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socket)) return true;
    if (processes.some((child) => child.exitCode !== null)) return false;
    await Bun.sleep(50);
  }
  return false;
}

async function defaultWaitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const finish = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(300, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });
    if (connected) return true;
    await Bun.sleep(100);
  }
  return false;
}

async function defaultWaitForCdp(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return true;
    } catch (error) {
      debugSuppressedError(log, "Managed Chromium CDP endpoint is not ready yet", error, {
        operation: "managed_cdp_browser.cdp_poll_not_ready",
        port,
      });
    }
    await Bun.sleep(100);
  }
  return false;
}

function defaultSpawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(command, args, { env, stdio: "ignore", detached: process.platform !== "win32" });
  child.unref();
  return child;
}

export function resolveContainerRuntime(options: {
  dockerMarker?: boolean;
  podmanMarker?: boolean;
  systemdMarker?: string;
  cgroup?: string;
}): string | null {
  if (options.dockerMarker) return "docker";
  if (options.podmanMarker) return "podman";
  const systemdMarker = String(options.systemdMarker || "").trim().toLowerCase();
  if (systemdMarker) return systemdMarker;
  const cgroup = String(options.cgroup || "").toLowerCase();
  for (const runtime of ["kubepods", "containerd", "docker", "podman", "lxc"]) {
    if (cgroup.includes(runtime)) return runtime;
  }
  return null;
}

export function detectContainerRuntime(): string | null {
  let systemdMarker = "";
  let cgroup = "";
  if (existsSync("/run/systemd/container")) {
    try {
      systemdMarker = readFileSync("/run/systemd/container", "utf8");
    } catch (error) {
      debugSuppressedError(log, "Could not read systemd container marker for managed Chromium", error, {
        operation: "managed_cdp_browser.systemd_container_detection_failed",
      });
    }
  }
  try {
    cgroup = readFileSync("/proc/1/cgroup", "utf8");
  } catch (error) {
    debugSuppressedError(log, "Could not inspect container runtime for managed Chromium", error, {
      operation: "managed_cdp_browser.container_detection_failed",
    });
  }
  return resolveContainerRuntime({
    dockerMarker: existsSync("/.dockerenv"),
    podmanMarker: existsSync("/run/.containerenv"),
    systemdMarker,
    cgroup,
  });
}

function defaultPrepareXAuthority(path: string, display: number): void {
  writeFileSync(path, "", { mode: 0o600 });
  chmodSync(path, 0o600);
  const cookie = randomBytes(16).toString("hex");
  const result = spawnSync("xauth", ["-f", path, "add", `:${display}`, ".", cookie], { stdio: "ignore" });
  if ((result.status ?? 1) !== 0) throw new Error("xauth could not create a private display cookie.");
}

export class ManagedCdpBrowserDesktop {
  private readonly platform: NodeJS.Platform;
  private readonly workspaceDir: string;
  private readonly commandExists: (command: string) => boolean;
  private readonly browserCommand: () => string | null;
  private readonly displayAvailable: (display: number) => boolean;
  private readonly portAvailable: (port: number) => Promise<boolean>;
  private readonly waitForDisplay: (display: number, timeoutMs: number, processes: readonly ChildProcess[]) => Promise<boolean>;
  private readonly waitForPort: (port: number, timeoutMs: number) => Promise<boolean>;
  private readonly waitForCdp: (port: number, timeoutMs: number) => Promise<boolean>;
  private readonly spawnProcess: (command: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess;
  private readonly prepareXAuthority: (path: string, display: number) => void;
  private readonly containerRuntime: () => string | null;
  private processes: ManagedProcess[] = [];
  private authorityPath: string | null = null;
  private statePath: string | null = null;
  private active: Extract<ManagedCdpBrowserPrepareResult, { ok: true }> | null = null;
  private startPromise: Promise<ManagedCdpBrowserPrepareResult> | null = null;
  private lifecycleGeneration = 0;
  private disposed = false;

  constructor(options: ManagedCdpBrowserDesktopOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.workspaceDir = options.workspaceDir ?? getWorkspaceDir();
    this.commandExists = options.commandExists ?? defaultCommandExists;
    this.browserCommand = options.browserCommand ?? (() => defaultBrowserCommand(this.commandExists));
    this.displayAvailable = options.displayAvailable ?? defaultDisplayAvailable;
    this.portAvailable = options.portAvailable ?? defaultPortAvailable;
    this.waitForDisplay = options.waitForDisplay ?? defaultWaitForDisplay;
    this.waitForPort = options.waitForPort ?? defaultWaitForPort;
    this.waitForCdp = options.waitForCdp ?? defaultWaitForCdp;
    this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
    this.prepareXAuthority = options.prepareXAuthority ?? defaultPrepareXAuthority;
    this.containerRuntime = options.containerRuntime ?? detectContainerRuntime;
  }

  async prepare(): Promise<ManagedCdpBrowserPrepareResult> {
    if (this.disposed) return this.failure("Managed CDP browser view is shutting down.", []);
    if (this.active && this.processes.every(({ child }) => child.exitCode === null && !child.killed)) {
      return { ...this.active, reused: true };
    }
    if (this.startPromise) return await this.startPromise;
    this.startPromise = this.start().finally(() => { this.startPromise = null; });
    return await this.startPromise;
  }

  private async start(): Promise<ManagedCdpBrowserPrepareResult> {
    this.stopProcesses();
    const generation = ++this.lifecycleGeneration;
    if (this.platform !== "linux") {
      return this.failure("Managed browser desktop is available on Linux only. Configure a browser with CDP and a loopback VNC target on this host.", []);
    }

    const browser = this.browserCommand();
    const missing = [
      !this.commandExists("Xvfb") ? "Xvfb" : null,
      !this.commandExists("x11vnc") ? "x11vnc" : null,
      !this.commandExists("xauth") ? "xauth" : null,
      !browser ? "Chromium, Chrome, or Edge" : null,
    ].filter((value): value is string => Boolean(value));
    if (missing.length > 0 || !browser) {
      return this.failure(`Managed CDP browser view is unavailable. Missing: ${missing.join(", ")}. Run /skill:cdp-browser-vnc-setup for setup and bring-your-own guidance.`, missing);
    }

    const display = MANAGED_X_DISPLAYS.find(this.displayAvailable);
    const cdpPort = await this.firstAvailablePort(MANAGED_CDP_PORTS);
    const vncPort = await this.firstAvailablePort(MANAGED_VNC_PORTS);
    if (display === undefined || cdpPort === null || vncPort === null) {
      return this.failure("Managed CDP browser view could not reserve a local display, CDP port, and VNC port.", []);
    }

    const stateDir = join(this.workspaceDir, ".piclaw", "browser");
    const profileDir = join(stateDir, "profile");
    this.statePath = join(stateDir, MANAGED_CDP_STATE_FILENAME);
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    chmodSync(stateDir, 0o700);
    chmodSync(profileDir, 0o700);
    const authorityPath = join(stateDir, `Xauthority-${display}`);
    this.authorityPath = authorityPath;
    const env = { ...process.env, DISPLAY: `:${display}`, XAUTHORITY: authorityPath };

    try {
      this.prepareXAuthority(authorityPath, display);
      this.track("Xvfb", this.spawnProcess("Xvfb", [`:${display}`, "-screen", "0", "1440x900x24", "-nolisten", "tcp", "-auth", authorityPath], env));
      if (!await this.waitForDisplay(display, 5_000, this.processes.map(({ child }) => child))) throw new Error("Xvfb did not create its display socket.");

      this.track("x11vnc", this.spawnProcess("x11vnc", [
        "-display", `:${display}`,
        "-auth", authorityPath,
        "-rfbport", String(vncPort),
        "-localhost", "-forever", "-shared", "-nopw", "-noxdamage",
      ], env));
      if (!await this.waitForPort(vncPort, 8_000)) throw new Error("x11vnc did not bind its loopback port.");

      const containerRuntime = this.containerRuntime();
      if (containerRuntime) {
        log.warn("Managed Chromium is running without its browser sandbox inside a container", {
          operation: "managed_cdp_browser.container_no_sandbox",
          containerRuntime,
        });
      }
      this.track("browser", this.spawnProcess(browser, [
        `--display=:${display}`,
        ...(containerRuntime ? ["--no-sandbox"] : []),
        "--remote-debugging-address=127.0.0.1",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "about:blank",
      ], env));
      if (!await this.waitForCdp(cdpPort, 12_000)) throw new Error("Chromium did not expose its loopback CDP endpoint.");
      if (this.disposed || generation !== this.lifecycleGeneration) throw new Error("Managed desktop startup was cancelled.");
      const exited = this.processes.find(({ child }) => child.exitCode !== null || child.killed);
      if (exited) throw new Error(`${exited.name} exited before managed desktop startup completed.`);
    } catch (error) {
      this.stopProcesses();
      const detail = error instanceof Error ? error.message : String(error);
      log.warn("Managed CDP browser desktop failed to start", { operation: "managed_cdp_browser.start_failed", err: error });
      return this.failure(`Managed CDP browser view failed to start: ${detail}`, []);
    }

    const active: Extract<ManagedCdpBrowserPrepareResult, { ok: true }> = {
      ok: true,
      target: { id: MANAGED_CDP_VNC_TARGET_ID, label: MANAGED_CDP_VNC_TARGET_LABEL, host: "127.0.0.1", port: vncPort, readOnly: false },
      cdpPort,
      display,
      reused: false,
    };
    try {
      writeFileSync(this.statePath, `${JSON.stringify({
        version: 1,
        cdpPort,
        display,
        vncPort,
        pid: this.processes.find(({ name }) => name === "browser")?.child.pid ?? null,
      })}\n`, { mode: 0o600 });
      chmodSync(this.statePath, 0o600);
    } catch (error) {
      this.stopProcesses();
      log.warn("Managed CDP browser desktop could not persist its state marker", {
        operation: "managed_cdp_browser.state_write_failed",
        err: error,
      });
      return this.failure("Managed CDP browser view failed to persist its private runtime state.", []);
    }
    this.active = active;
    log.info("Managed CDP browser desktop started", {
      operation: "managed_cdp_browser.started",
      display,
      cdpPort,
      vncPort,
      browser,
    });
    return active;
  }

  private failure(error: string, missingDependencies: string[]): ManagedCdpBrowserPrepareResult {
    return { ok: false, error, missingDependencies, platform: this.platform };
  }

  private async firstAvailablePort(ports: readonly number[]): Promise<number | null> {
    for (const port of ports) if (await this.portAvailable(port)) return port;
    return null;
  }

  private track(name: string, child: ChildProcess): void {
    this.processes.push({ name, child });
    child.once("exit", (code, signal) => {
      if (this.processes.some((entry) => entry.child === child)) {
        log.warn("Managed CDP browser process exited", {
          operation: "managed_cdp_browser.process_exit",
          process: name,
          code,
          signal,
        });
        this.active = null;
        this.lifecycleGeneration += 1;
        this.stopProcesses();
      }
    });
  }

  shutdown(): void {
    this.disposed = true;
    this.lifecycleGeneration += 1;
    this.stopProcesses();
  }

  private stopProcesses(): void {
    const processes = this.processes.splice(0).reverse();
    this.active = null;
    for (const { name, child } of processes) {
      if (child.exitCode !== null || child.killed) continue;
      try {
        const pid = child.pid;
        if (process.platform !== "win32" && Number.isFinite(pid)) process.kill(-Number(pid), "SIGKILL");
        else child.kill("SIGKILL");
      } catch (error) {
        try {
          child.kill("SIGKILL");
        } catch (fallbackError) {
          debugSuppressedError(log, "Failed to stop managed CDP browser process", fallbackError, {
            operation: "managed_cdp_browser.stop_failed",
            process: name,
            pid: child.pid ?? null,
            groupError: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    this.removeStateFiles();
  }

  private removeStateFiles(): void {
    for (const path of [this.authorityPath, this.statePath]) {
      if (!path) continue;
      try {
        rmSync(path, { force: true });
      } catch (error) {
        debugSuppressedError(log, "Failed to remove managed CDP browser state file", error, {
          operation: "managed_cdp_browser.remove_state_failed",
          path,
        });
      }
    }
    this.authorityPath = null;
    this.statePath = null;
  }
}
