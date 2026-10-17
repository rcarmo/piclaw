import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SESSIONS_DIR } from "../core/config.js";

/** Legacy filesystem identities only; importing paths must not load session construction. */
export function sanitiseJid(jid: string): string {
  return jid.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function ensureSessionDir(chatJid: string): string {
  const dir = join(SESSIONS_DIR, sanitiseJid(chatJid));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureNamedSessionDir(chatJid: string, name: string): string {
  const dir = join(SESSIONS_DIR, `${sanitiseJid(chatJid)}__${sanitiseJid(name)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
