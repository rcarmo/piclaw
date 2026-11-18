// SPDX-License-Identifier: Apache-2.0
import { summarizeTestRun } from "./mcp-recall/tests.ts";
import { compilerDiagnosticsHandler } from "./mcp-recall/compilers.ts";
export const outputReducerRevision = "mcp-recall:2db17d6:kintsugi-v2";
export type OutputReduction = {text:string;reducer:string;originalBytes:number;reducedBytes:number};
/** Only single, explicit runner/compiler invocations. Shell programs, pipes and structured formats are untouched. */
export function outputFamily(command:string):"tests"|"compiler"|null {
  if (/[\n\r;&|<>`$(){}]/.test(command) || /(?:--?json|--reporter|--format|--watch|--list|--collect-only|\s-o\b)/.test(command)) return null;
  const cmd = command.trim();
  if (/^(?:(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test\b|(?:npx\s+|bunx\s+)?(?:jest|vitest)\b|(?:python[3]?\s+-m\s+)?pytest\b|go\s+test\b)/.test(cmd)) return "tests";
  if (/^(?:(?:npx\s+|bunx\s+)?(?:tsc|eslint|ruff)\b|cargo\s+(?:build|check|clippy)\b|go\s+(?:build|vet)\b)/.test(cmd)) return "compiler";
  return null;
}
function noise(line:string,family:"tests"|"compiler"):boolean {
  const t = line.trim();
  if (!t) return true;
  if (/\b(?:error|failed|failure|warning|exception|assertion)\b/i.test(t)) return false;
  if (family === "tests") return /^(?:\(pass\)\s|[✓✔]\s|PASS\s+\S|ok\s+\S|\?\s+\S+\s+\[no test files\]|[.]+\s*(?:\[\s*\d+%\])?$)/.test(t);
  return /^(?:Compiling|Checking|Downloading|Downloaded)\s+\S+\s+v\d/.test(t) || /^Finished\s+`(?:dev|release)`\s+profile/.test(t);
}
/** Reduced text is for model presentation only; never feed it back as learning evidence or a script result. */
export function reduceToolOutput(input:{command:string;output:string;exitCode:number|null;aborted?:boolean;timedOut?:boolean;truncated?:boolean;fullOutputPath:string}):OutputReduction|null {
  const family = outputFamily(input.command), raw = input.output;
  if (!family || input.exitCode === null || input.aborted || input.timedOut || input.truncated || raw.length < 1200 || raw.length > 256_000 || !input.fullOutputPath || /[\r\n]/.test(input.fullOutputPath)) return null;
  // Partial logs and structured payloads cannot support a reliable summary.
  if (/^\s*[\[{]/.test(raw) || /\[(?:Output|output) truncated:|Warning: truncated output/.test(raw)) return null;
  const source = {stdout:raw,stderr:"",exit_code:input.exitCode};
  const parsed = family === "tests" ? summarizeTestRun(source) : compilerDiagnosticsHandler("bash",source);
  if (!parsed || parsed.summary === raw) return null;
  if (family === "tests" && !parsed.summary.startsWith("test runner — FAIL") && (input.exitCode !== 0 || /\b[1-9]\d*\s+(?:fail|failed|errors?)\b/i.test(raw))) return null;
  // Keep every non-noise line verbatim: upstream clipped assertions, diagnostic codes and locations remain recoverable inline.
  const kept = raw.split("\n").filter(line => !noise(line,family));
  const headline = parsed.summary.split("\n")[0]!;
  const text = `${headline}\nExit code: ${input.exitCode}\n${kept.join("\n")}\n\n[Output reduced; full output: ${input.fullOutputPath}]`;
  const originalBytes = Buffer.byteLength(raw), reducedBytes = Buffer.byteLength(text);
  if (originalBytes-reducedBytes < 512 || reducedBytes > originalBytes*.8) return null;
  return {text,reducer:`${outputReducerRevision}:${family}`,originalBytes,reducedBytes};
}
