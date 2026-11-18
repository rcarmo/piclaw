import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
const pins = {
  "compat/chat-context.ts": "90e20fa38d72915a7cbf4eea4e4134788271e6eb52dfbcb813df05b6d60c3c44",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
  "compat/tool-call-summary.ts": "a3b717a0538e5fae5e8572b02e289d5b799574ba9bff51b63a6bb29ff5772051",
  "deadline-checkpoint.ts": "e94f7cb065f321b06de33bfd7963011f03714c73437eedab634bce69f199c1db",
  "index.ts": "f4e2f2cb4c640e626063dc363e741d30f92987d7c562823a050f6230f35254c0",
  "package.json": "ce6eb162d880bc54dbff78414255cd593bb7eb3f76f0fd7069c7b34ac35a4e72",
  "summary.ts": "4f3b3c80faecff868c7df9a7a3a79f1b8ae19216dbb1a6ffc94ea68afb2a6d31"
};
export function installGoalFixture(dir: string): string {
  const source = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!source) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  const pkg = join(dir, ".pi/extensions/node_modules/@rcarmo/piclaw-addon-goal");
  for (const [file, expected] of Object.entries(pins)) {
    const bytes = readFileSync(join(source, "addons/goal", file));
    if (createHash("sha256").update(bytes).digest("hex") !== expected) throw Error("Goal fixture source changed");
    const target = join(pkg, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes);
  }
  symlinkSync(join(import.meta.dir, "../../node_modules"), join(pkg, "node_modules"), "dir");
  return pkg;
}
