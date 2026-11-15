import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
const pins = {
  "index.ts": "887fd5457c104940a4e1ce132a621a16ef3ab4026f187fb4a576cae6ca86ec62",
  "deadline-checkpoint.ts": "e94f7cb065f321b06de33bfd7963011f03714c73437eedab634bce69f199c1db",
  "compat/chat-context.ts": "90e20fa38d72915a7cbf4eea4e4134788271e6eb52dfbcb813df05b6d60c3c44",
  "compat/extension-kv.ts": "04240517e9e8664cae2d2badb99f382100a7af3e12679cfce97087870881551c",
  "package.json": "71a58159deaa2193625f7a4ecd0094f9bc2e93bbd2d32c8b0365b5197f6b9547"
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
