import { setCompactionRuntimeConfig } from "../../src/core/config.js";

const next = setCompactionRuntimeConfig({
  autoCompactionEnabled: false,
  progressWatchdogEnabled: true,
  progressWatchdogTimeoutMs: 120_000,
});
console.log(JSON.stringify(next));
