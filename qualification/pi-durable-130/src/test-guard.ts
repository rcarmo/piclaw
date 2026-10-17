import { resolve } from "node:path";
import { assertPathWithinTestFilesystemIsolation } from "../../../runtime/scripts/test-filesystem-isolation.js";

if (process.cwd() !== resolve(import.meta.dir, "..")) {
  throw new Error("Run qualification from its own package directory to load its bunfig");
}
if (process.env.PICLAW_TEST_FS_ISOLATION_ACTIVE !== "1") {
  throw new Error("Run bun run test through the isolated local-test launcher");
}
for (const key of ["HOME", "PICLAW_WORKSPACE", "PICLAW_STORE", "PI_CODING_AGENT_DIR"]) {
  const path = process.env[key];
  if (!path) throw new Error(`Missing isolated ${key}`);
  assertPathWithinTestFilesystemIsolation(path, process.env, { allowRoot: false });
}
// This is a test fail-fast guard, not a security sandbox for arbitrary code.
const denyNetwork = () => { throw new Error("Qualification forbids network access"); };
globalThis.fetch = Object.assign(denyNetwork, { preconnect: denyNetwork }) as typeof fetch;
globalThis.WebSocket = class { constructor() { denyNetwork(); } } as unknown as typeof WebSocket;
