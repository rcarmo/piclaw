// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
import type { Observation } from "../types.ts";
import { redact } from "../observations.ts";
import { compareCodePoints, sliceCodePoints } from "../ordering.ts";
import type { FactDigest } from "./detectors.ts";
import { shellEditTargets } from "../loopguard/shell-edits.ts";
export const checkCommand = /\b(?:pytest|py\.test|tox|nox|unittest|runtests\.py|jest|vitest|mocha|rspec|phpunit|ctest|tsc|eslint|prettier|ruff|flake8|pylint|mypy|pyright|golangci-lint|cmake|ninja|bazel)\b|(?:^|[\s;&|(])make\b|\b(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:test|build|lint|check|typecheck)\b|\b(?:cargo|go|mvn|gradle|gradlew|dotnet|mix|swift)\s+(?:test|build|check|vet|clippy|compile|package|verify)\b/;
const testCommand = /\b(?:pytest|py\.test|tox|nox|unittest|runtests\.py|jest|vitest|mocha|rspec|phpunit|ctest)\b|\b(?:make|npm|yarn|pnpm|bun|cargo|go|mvn|gradle|gradlew|dotnet|mix|swift|rake)\s+(?:run\s+)?test\b/;
const missingCommand = /command not found|: not found\b|is not recognized as/i;
const missingDependency = /ModuleNotFoundError|No module named|ImportError|Cannot find module|ERR_MODULE_NOT_FOUND|cannot find package|could not find (?:package|crate|module|gem)|unresolved import|cannot load such file|undefined reference to|fatal error: [^\n]*: No such file/i;
const badUsage = /^usage:|unrecognized arguments?|no such option|unknown (?:option|flag|command)|invalid option|unexpected argument|error: argument/im;
export function relativeText(text: string, roots: string[], home: string): string {
  for (const root of [...new Set(roots)].filter(Boolean).sort((a,b) => b.length-a.length)) text = text.replaceAll(`${root}/`,"").replaceAll(root,".");
  text = text.replace(/^cd \.\s*(?:&&|;)\s*/,"");
  return home && home !== "/" ? text.replaceAll(home,"~") : text;
}
export function templates(commands: string[], cap = 12): string[] {
  const result: string[] = [];
  for (const command of commands) {
    if (!command.trim()) continue;
    const head = sliceCodePoints(command.trim().replace(/\s+/g," "),0,80).replace(/\/testbed\/\S+/g,"<path>");
    if (!result.includes(head)) result.push(head);
    if (result.length >= cap) break;
  }
  return result;
}
export function commandFailed(output: string): boolean {
  const exit = /\bexit(?:ed with)?(?: code| status)?[:=\s]+(\d+)/i.exec(output);
  return exit ? Number(exit[1]) !== 0 : missingCommand.test(output) || missingDependency.test(output) || /Traceback \(most recent call last\)|^\w*Error\b/m.test(output);
}
export function errorSignature(output: string, roots: string[], home: string): string {
  for (const line of output.split(/\r?\n/)) if (/\b(?:error|failed|failure|fatal|exception|traceback|cannot|not found|denied|refused|panic)\b/i.test(line) || missingCommand.test(line)) {
    const normalized = relativeText(line.trim(),roots,home).replace(/0x[0-9a-f]+/gi,"<hex>").replace(/(?<![\w.~])\/[^\s'"`:,)]+/g,"<path>").replace(/\b\d+\b/g,"N");
    return sliceCodePoints(normalized.trim().replace(/\s+/g," "),0,120);
  }
  return "";
}
/** Receipts enrich proposals; they do not establish that every requested deliverable was met. */
export function workEvidence(observations:readonly Observation[],answeredTurns:number,root:string):NonNullable<FactDigest["work"]> {
  const latest = observations.slice(-64);
  const tools = [...new Set(latest.filter(call => call.coverage === "complete" && call.outcome === "success").map(call => call.semantic))].sort(compareCodePoints);
  const boundary = latest.findLastIndex(call => call.semantic === "edit" || call.semantic === "shell" && shellEditTargets(call.command).length > 0 || call.verification === "failed" || call.coverage !== "complete");
  const checksAfterLastEdit = templates(latest.slice(boundary+1).filter(call => call.semantic === "shell" && call.verification === "passed" && call.outcome === "success" && call.exitCode === 0).map(call => relativeText(redact(call.command),[root],"")),4);
  return {answeredTurns:Math.min(64,answeredTurns),tools,checksAfterLastEdit};
}
export function genericDigest(observations: Observation[], iid: string, roots: string[], home: string): FactDigest {
  const commands = observations.filter(call => call.semantic === "shell"), out = commands.map(call => redact(call.output)).join("\n");
  const failed: FactDigest["failed_commands"] = [], seen = new Set<string>();
  for (const call of commands) if (call.outcome === "failure" || call.outcome === "timedOut" || call.exitCode !== null && call.exitCode !== 0 || call.outcome === "unknown" && commandFailed(call.output)) {
    const row = {cmd:templates([relativeText(redact(call.command),roots,home)],1)[0] ?? "",error:errorSignature(redact(call.output),roots,home)}, key = JSON.stringify(row);
    if (!seen.has(key)) {seen.add(key);failed.push(row);}
  }
  const edited = observations.filter(call => call.semantic === "edit" || call.semantic === "shell").flatMap(call => call.targets).map(path => path.replaceAll("\\","/").split("/").at(-1)!).filter(Boolean);
  return {iid,resolved:null,edited_files:[...new Set(edited)].sort(compareCodePoints),n_cmds:commands.length,cmd_templates:templates(commands.map(call => relativeText(redact(call.command),roots,home))),check_commands:templates(commands.filter(call => checkCommand.test(call.command)).map(call => relativeText(redact(call.command),roots,home))).slice(0,6),
    failed_commands:failed.slice(0,6),missing_command:missingCommand.test(out),missing_dependency:missingDependency.test(out),bad_usage:badUsage.test(out),_ran_tests:commands.some(call => testCommand.test(call.command)),_cmd_blob:commands.map(call => redact(call.command)).join("\n"),_out_blob:out,features:{}};
}
