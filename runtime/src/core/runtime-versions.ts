import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getVersion } from "../cli.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("core.runtime-versions");

/** Versions of this running process, not the workspace checkout or latest release. */
export function getRuntimeVersions(): { piclaw: string; piAi: string; bun: string } {
  let piAi = "unknown";
  try {
    const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"));
    const metadata = JSON.parse(readFileSync(resolve(dirname(entry), "../package.json"), "utf8"));
    if (typeof metadata.version === "string") piAi = metadata.version;
  } catch (error) {
    // Metadata can be absent in a stripped deployment; never guess its version.
    log.warn("Unable to read pi-ai version", { operation: "runtime_versions.read", err: error });
  }
  return { piclaw: getVersion(), piAi, bun: Bun.version };
}
