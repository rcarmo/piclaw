import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/** Qualification candidates only; never resolve an installed/live profile. */
export function repoRoot(kind: "ADDONS" | "CORE") {
  const configured = process.env[`DURABLE_${kind}_ROOT`];
  if (configured) return realpathSync(configured);
  if (kind === "CORE") return realpathSync(resolve(import.meta.dir, "../../.."));
  throw Error("DURABLE_ADDONS_ROOT required: reviewed candidate checkout only");
}
