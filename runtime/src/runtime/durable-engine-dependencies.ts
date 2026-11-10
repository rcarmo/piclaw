import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DURABLE_ENGINE_DIRECTORY = fileURLToPath(new URL("../../durable-engine/", import.meta.url));
export const DURABLE_ENGINE_SDK_PACKAGES = ["chord", "pi-ai", "pi-codemode", "pi-durable", "pi-telemetry"] as const;

/** Check the private dependency island before importing or opening native storage. */
export function assertDurableEngineDependencies(directory = DURABLE_ENGINE_DIRECTORY): void {
  try {
    for (const shortName of DURABLE_ENGINE_SDK_PACKAGES) {
      const name = `@earendil-works/${shortName}`, version = "1.5.2";
      const installed = JSON.parse(readFileSync(join(directory, "node_modules", name, "package.json"), "utf8"));
      if (installed.name !== name || installed.version !== version) {
        throw new Error(`Expected private ${name}@${version}`);
      }
    }
  } catch (cause) {
    throw new Error("Durable engine dependencies are missing or incompatible. Reinstall Piclaw; legacy fallback is disabled.", { cause });
  }
}
