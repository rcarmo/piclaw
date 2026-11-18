// SPDX-License-Identifier: Apache-2.0
// Selected fixes backported from microsoft/TokenEconomizer@7042ea89dd5e5ecbc67ad865ad6e256e61be8bf0 (#212, #213, #209).
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
import { unwrapShell } from "../microskills/observe.ts";
import { splitHeredocs } from "./shell-edits.ts";
import { rubyVerifyPattern, notRunPattern, prefixPattern, reportPattern, runFailedPattern, runPassedPattern, verifyPattern } from "./verification-patterns.ts";
function pieces(command: string) {
  command = splitHeredocs(unwrapShell(command)).shell;
  const parts = command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g,"Q").replace(/[(){}]/g," ").split(/(&&|\|\||\|&|(?<!>)\||;|\n)/);
  while (parts.length > 1 && !parts.at(-1)!.trim()) parts.splice(-2);
  return {parts,pipefail:command.includes("pipefail")};
}
const quietHeads = new Set(["cat","head","tail","less","more","wc","sort","uniq","cut","tr","nl","column","ls","tree","pwd","stat","file","du","which","type","whereis","grep","egrep","fgrep","rg","ag","jq","find","echo","printf","true",":","cd","pushd","popd","export","source",".","set","sed","git"]);
function quiet(stage: string): boolean {
  const words = (stage.trim()+" ").replace(prefixPattern,"").trim().split(/\s+/).filter(Boolean);if (!words.length) return true;
  const head = words[0].split("/").at(-1)!;
  if (!quietHeads.has(head)) return false;
  if (head === "git") return ["show","diff","log","status","grep","ls-files","blame","rev-parse","branch"].includes(words[1]);
  if (head === "sed") return !words.slice(1).some(word => /^(?:-[a-zA-Z]*i|--in-place)/.test(word));
  if (head === "find") return !words.slice(1).some(word => ["-delete","-exec","-execdir","-ok"].includes(word));
  return true;
}
export function exitStatusCovers(command: string): boolean {
  if (!command.trim()) return false;
  const {parts,pipefail} = pieces(command);
  for (let i = 0; i < parts.length-1; i += 2) if (parts[i+1] !== "&&" && !(pipefail && ["|","|&"].includes(parts[i+1])) && !quiet(parts[i])) return false;
  return true;
}
export type TestStatus = "own" | "hidden" | "mixed";
export function statusOfTests(command: string): TestStatus | null {
  const {parts,pipefail} = pieces(command), rank = {own:0,hidden:1,mixed:2};let found: TestStatus | null = null;
  for (let i = 0; i < parts.length; i += 2) {
    const stage = parts[i], stripped = stage.replace(prefixPattern,""), match = verifyPattern.exec(stripped) ?? rubyVerifyPattern.exec(stripped);
    if (!match || match.index !== 0 || notRunPattern.test(stage)) continue;
    let status: TestStatus = "own";
    for (let j = i+1; j+1 < parts.length; j += 2) {
      const separator = parts[j], then = parts[j+1];
      if (separator === "&&" || pipefail && ["|","|&"].includes(separator)) continue;
      if (["|","|&","||"].includes(separator)) {status = "hidden";break;}
      if (!reportPattern.test(then)) {status = "mixed";break;}status = "hidden";
    }
    if (found === null || rank[status] > rank[found]) found = status;
  }
  return found;
}
/** true is a failed runner, false a passing runner, null no usable runner summary. */
export function runnerVerdict(text: string): boolean | null {return runFailedPattern.test(text) ? true : runPassedPattern.test(text) ? false : null;}
