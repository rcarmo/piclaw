import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { getWorkspaceDir } from "../../../src/core/config.js";
import { closeWebSocketQuietly, runCdpCleanup } from "./cdp-cleanup.ts";

export const CDP_PORTS = [9224, 9225, 9226, 9227, 9228, 9229, 9230, 9231, 9232, 9233] as const;
const MANAGED_CDP_STATE_FILENAME = "managed-desktop.json";

type BrowserLaunch = { command: string; name: string };
export type MaybeAbortSignal = AbortSignal | null | undefined;

function commandExists(command: string): boolean {
  try {
    const res = spawnSync(command, ["--version"], { stdio: "ignore" });
    return (res.status ?? 1) === 0;
  } catch {
    return false;
  }
}

function browserExists(candidate: BrowserLaunch): boolean {
  const looksLikePath = candidate.command.includes(path.sep) || candidate.command.includes("/") || candidate.command.includes("\\");
  return looksLikePath ? fs.existsSync(candidate.command) : commandExists(candidate.command);
}

export function findBrowser(): BrowserLaunch | null {
  const platform = process.platform;
  const candidates: BrowserLaunch[] = [];

  if (platform === "win32") {
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
    const local = process.env["LOCALAPPDATA"] ?? "";
    candidates.push(
      { command: path.join(pf86, "Microsoft/Edge/Application/msedge.exe"), name: "Edge" },
      { command: path.join(pf, "Microsoft/Edge/Application/msedge.exe"), name: "Edge" },
      { command: path.join(local, "Microsoft/Edge/Application/msedge.exe"), name: "Edge" },
      { command: path.join(pf, "Google/Chrome/Application/chrome.exe"), name: "Chrome" },
      { command: path.join(pf86, "Google/Chrome/Application/chrome.exe"), name: "Chrome" },
      { command: path.join(local, "Google/Chrome/Application/chrome.exe"), name: "Chrome" },
      { command: "msedge.exe", name: "Edge" },
      { command: "chrome.exe", name: "Chrome" },
    );
  } else if (platform === "darwin") {
    candidates.push(
      { command: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", name: "Edge" },
      { command: path.join(process.env.HOME ?? "", "Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"), name: "Edge" },
      { command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", name: "Chrome" },
      { command: path.join(process.env.HOME ?? "", "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"), name: "Chrome" },
      { command: "/Applications/Chromium.app/Contents/MacOS/Chromium", name: "Chromium" },
      { command: "Microsoft Edge", name: "Edge" },
      { command: "Google Chrome", name: "Chrome" },
      { command: "Chromium", name: "Chromium" },
    );
  } else {
    candidates.push(
      { command: "/usr/bin/microsoft-edge", name: "Edge" },
      { command: "/usr/bin/microsoft-edge-stable", name: "Edge" },
      { command: "/usr/bin/google-chrome", name: "Chrome" },
      { command: "/usr/bin/google-chrome-stable", name: "Chrome" },
      { command: "/usr/bin/chromium", name: "Chromium" },
      { command: "/usr/bin/chromium-browser", name: "Chromium" },
      { command: "/snap/bin/chromium", name: "Chromium" },
      { command: "microsoft-edge", name: "Edge" },
      { command: "microsoft-edge-stable", name: "Edge" },
      { command: "google-chrome", name: "Chrome" },
      { command: "google-chrome-stable", name: "Chrome" },
      { command: "chromium", name: "Chromium" },
      { command: "chromium-browser", name: "Chromium" },
    );
  }

  for (const candidate of candidates) {
    if (browserExists(candidate)) return candidate;
  }
  return null;
}

export function createAbortError(message = "Operation cancelled"): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal: MaybeAbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

export function bindAbortSignal(signal: MaybeAbortSignal, onAbort: () => void): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  const handler = () => onAbort();
  signal.addEventListener("abort", handler, { once: true });
  return () => signal.removeEventListener("abort", handler);
}

export function createTimedAbortSignal(timeout: number, signal?: MaybeAbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const unbind = bindAbortSignal(signal, () => controller.abort());
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      unbind();
    },
  };
}

export async function sleepWithSignal(ms: number, signal?: MaybeAbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unbind();
      resolve();
    }, ms);
    const unbind = bindAbortSignal(signal, () => {
      clearTimeout(timer);
      reject(createAbortError());
    });
  });
}

export async function httpGet(url: string, timeout = 3000, signal?: MaybeAbortSignal): Promise<any> {
  throwIfAborted(signal);
  const request = createTimedAbortSignal(timeout, signal);
  try {
    const resp = await fetch(url, { signal: request.signal });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } finally {
    request.cleanup();
  }
}

export async function httpPut(url: string, timeout = 5000, signal?: MaybeAbortSignal): Promise<any> {
  throwIfAborted(signal);
  const request = createTimedAbortSignal(timeout, signal);
  try {
    const resp = await fetch(url, { method: "PUT", signal: request.signal });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } finally {
    request.cleanup();
  }
}

export function readManagedCdpPort(workspace = getWorkspaceDir()): number | null {
  const statePath = path.join(workspace, ".piclaw", "browser", MANAGED_CDP_STATE_FILENAME);
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const port = Number(parsed?.cdpPort);
    return parsed?.version === 1 && Number.isInteger(port) && (CDP_PORTS as readonly number[]).includes(port)
      ? port
      : null;
  } catch {
    return null;
  }
}

export async function findCdpPort(signal?: MaybeAbortSignal): Promise<number | null> {
  const managedPort = readManagedCdpPort();
  const ports = managedPort === null
    ? CDP_PORTS
    : [managedPort, ...CDP_PORTS.filter((port) => port !== managedPort)];
  for (const port of ports) {
    throwIfAborted(signal);
    try {
      const version = await httpGet(`http://localhost:${port}/json/version`, 2000, signal);
      if (version && typeof version === "object" && !Array.isArray(version)) {
        return port;
      }
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
    }
  }
  return null;
}

export async function ensureBrowser(signal?: MaybeAbortSignal): Promise<number | null> {
  const existing = await findCdpPort(signal);
  if (existing) return existing;

  const browser = findBrowser();
  if (!browser) return null;

  const port = CDP_PORTS[0];
  const args = [
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--disable-features=AutomationControlled",
  ];
  const proc = spawn(browser.command, args, { detached: true, stdio: "ignore" });
  proc.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    try {
      await httpGet(`http://localhost:${port}/json/version`, 1500, signal);
      return port;
    } catch (error) {
      if ((error as Error)?.name === "AbortError") throw error;
    }
    await sleepWithSignal(500, signal);
  }
  return null;
}

export async function getTargets(port: number, signal?: MaybeAbortSignal): Promise<any[]> {
  const targets = await httpGet(`http://localhost:${port}/json`, 3000, signal);
  if (!Array.isArray(targets)) return [];
  return targets.filter((target) => target.type === "page");
}

export async function connectToTab(port: number, match?: string, signal?: MaybeAbortSignal): Promise<{ ws: WebSocket; target: any }> {
  const pages = await getTargets(port, signal);
  throwIfAborted(signal);
  const target = match
    ? pages.find((page) => page.url?.includes(match) || page.title?.toLowerCase().includes(match.toLowerCase()))
    : pages[0];
  if (!target) throw new Error(`No tab matching "${match}". Available: ${pages.map((page) => page.title).join(", ")}`);

  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    let settled = false;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unbind();
      closeWebSocketQuietly(socket);
      reject(error);
    };
    const finishResolve = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unbind();
      resolve(socket);
    };
    const timeout = setTimeout(() => finishReject(new Error("WS timeout")), 5000);
    const unbind = bindAbortSignal(signal, () => finishReject(createAbortError()));
    socket.addEventListener("open", finishResolve);
    socket.addEventListener("error", () => finishReject(new Error("WS connect error")));
  });

  return { ws, target };
}

export async function withConnectedTab<T>(
  port: number,
  match: string | undefined,
  run: (ws: WebSocket, target: any) => Promise<T>,
  signal?: MaybeAbortSignal,
): Promise<T> {
  const { ws, target } = await connectToTab(port, match, signal);
  try {
    return await run(ws, target);
  } finally {
    closeWebSocketQuietly(ws);
  }
}

export function cdpSend(ws: WebSocket, method: string, params?: any, signal?: MaybeAbortSignal): Promise<any> {
  return cdpSendWithTimeout(ws, method, params, signal, 15_000);
}

export function cdpSendWithTimeout(
  ws: WebSocket,
  method: string,
  params?: any,
  signal?: MaybeAbortSignal,
  timeoutMs = 15_000,
): Promise<any> {
  throwIfAborted(signal);
  const id = Math.floor(Math.random() * 100_000);
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      unbind();
      ws.removeEventListener("message", handler);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`CDP command timed out: ${method}`));
    }, timeoutMs);
    const unbind = bindAbortSignal(signal, () => {
      cleanup();
      reject(createAbortError());
    });
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        if (msg.id === id) {
          cleanup();
          if (msg.error) {
            const message = String(msg.error?.message || msg.error?.code || "CDP command failed");
            const error = new Error(`CDP command failed for ${method}: ${message}`);
            (error as any).cdpError = msg.error;
            reject(error);
            return;
          }
          resolve(msg.result ?? null);
        }
      } catch {
        return;
      }
    };
    ws.addEventListener("message", handler as EventListener);
  });
}

export async function openTab(port: number, url: string, signal?: MaybeAbortSignal): Promise<any> {
  return httpPut(`http://localhost:${port}/json/new?${encodeURIComponent(url)}`, 5000, signal);
}

export async function closeTab(port: number, targetId: string, signal?: MaybeAbortSignal): Promise<void> {
  await httpPut(`http://localhost:${port}/json/close/${targetId}`, 5000, signal);
}

export interface PrintToPdfOptions {
  port: number;
  outPath: string;
  match?: string;
  url?: string;
  waitMs?: number;
  printBackground?: boolean;
  preferCSSPageSize?: boolean;
  landscape?: boolean;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  signal?: MaybeAbortSignal;
}

export async function printToPdf(options: PrintToPdfOptions): Promise<{ file: string; title?: string; url?: string }> {
  const {
    port,
    outPath,
    match,
    url,
    waitMs = 1500,
    printBackground = true,
    preferCSSPageSize = true,
    landscape = false,
    displayHeaderFooter = false,
    headerTemplate = "<span></span>",
    footerTemplate = "<span></span>",
    marginTop = 0,
    marginBottom = 0,
    marginLeft = 0,
    marginRight = 0,
    signal,
  } = options;

  let createdTargetId: string | null = null;
  let createdMatch: string | undefined;
  try {
    if (url) {
      const target = await openTab(port, url, signal);
      createdTargetId = target?.id ?? null;
      createdMatch = createdTargetId ? undefined : url;
      await sleepWithSignal(waitMs, signal);
    }

    const result = await withConnectedTab(port, match ?? createdMatch, async (ws, target) => {
      await cdpSend(ws, "Page.enable", undefined, signal);
      if (url && !createdTargetId) {
        await cdpSend(ws, "Page.navigate", { url }, signal);
        await sleepWithSignal(waitMs, signal);
      }
      const printed = await cdpSend(ws, "Page.printToPDF", {
        printBackground,
        preferCSSPageSize,
        landscape,
        displayHeaderFooter,
        headerTemplate,
        footerTemplate,
        marginTop,
        marginBottom,
        marginLeft,
        marginRight,
      }, signal);
      if (!printed?.data) throw new Error("Failed to render PDF");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, Buffer.from(printed.data, "base64"));
      return { file: outPath, title: target?.title, url: target?.url };
    }, signal);

    return result;
  } finally {
    if (createdTargetId) {
      await runCdpCleanup(
        () => closeTab(port, createdTargetId, signal),
        { port, targetId: createdTargetId },
      );
    }
  }
}
