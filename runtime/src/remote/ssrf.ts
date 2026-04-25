/**
 * remote/ssrf.ts – Callback URL validation with SSRF protections.
 *
 * Validates callback URL scheme/host and rejects localhost, loopback, private,
 * and link-local IP targets (including DNS-resolved hostnames) before remote
 * interop callbacks are attempted.
 */

import { lookup } from "dns/promises";
import { isIP } from "net";
import { getRemoteInteropConfig } from "../core/config.js";

type ResolveHost = (hostname: string) => Promise<string[]>;

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4) return null;
  if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return [parts[0], parts[1], parts[2], parts[3]];
}

function isPrivateIpv4(host: string): boolean {
  const parts = parseIpv4(host);
  if (!parts) return false;
  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark/testing

  return false;
}

function isPrivateIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "::1" || lower === "::") return true;

  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice("::ffff:".length);
    return isPrivateIpv4(mapped);
  }

  const firstHextet = lower.split(":")[0];
  if (!firstHextet) return false;
  const value = Number.parseInt(firstHextet, 16);
  if (Number.isNaN(value)) return false;

  if ((value & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((value & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local

  return false;
}

function normalizeHostForLookup(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".local") || lower === "0.0.0.0") return true;
  if (lower === "::1" || lower.startsWith("[::1")) return true;
  return false;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((entry) => entry.address);
}

function isPrivateOrLoopbackAddress(address: string): boolean {
  const normalized = normalizeHostForLookup(address);
  const family = isIP(normalized);
  if (family === 4) return isPrivateIpv4(normalized);
  if (family === 6) return isPrivateIpv6(normalized);
  return false;
}

/** Validate callback URL input and ensure it resolves to public-routable hosts only. */
export async function validateCallbackUrl(
  raw: string | undefined,
  resolveHost: ResolveHost = defaultResolveHost,
  configOverride?: Readonly<Pick<import("../core/config.js").RemoteInteropConfig, "allowHttp" | "allowPrivateNetwork">>,
): Promise<{ ok: boolean; url?: URL; error?: string }> {
  if (!raw || typeof raw !== "string") {
    return { ok: false, error: "Missing callback_url." };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Invalid callback_url." };
  }

  const cfg = configOverride ?? getRemoteInteropConfig();

  if (url.protocol !== "https:" && !(cfg.allowHttp && url.protocol === "http:")) {
    return { ok: false, error: "callback_url must use https." };
  }

  // Dev/internal mode: skip private-IP checks for Docker-internal callback URLs.
  if (cfg.allowPrivateNetwork) {
    return { ok: true, url };
  }

  if (isBlockedHostname(url.hostname)) {
    return { ok: false, error: "callback_url hostname is not allowed." };
  }

  const hostForLookup = normalizeHostForLookup(url.hostname);
  if (isPrivateOrLoopbackAddress(hostForLookup)) {
    return { ok: false, error: "callback_url points to a private or loopback address." };
  }

  try {
    const resolved = await resolveHost(hostForLookup);
    if (!resolved.length) {
      return { ok: false, error: "callback_url hostname could not be resolved." };
    }
    if (resolved.some((address) => isPrivateOrLoopbackAddress(address))) {
      return { ok: false, error: "callback_url points to a private or loopback address." };
    }
  } catch {
    return { ok: false, error: "callback_url hostname could not be resolved." };
  }

  return { ok: true, url };
}
