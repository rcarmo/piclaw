// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
// Detector/extractor semantics ported from TokenEconomizer microskills/distiller.py.
import { RE2JS } from "re2js";
import { Type, type Static } from "typebox";
import type { Verdict } from "./lifecycle.ts";
export const DetectorSchema = Type.Object({ scope: Type.String(), fired: Type.Optional(Type.String()), confirm: Type.Optional(Type.String()), contradict: Type.Optional(Type.String()) }, { additionalProperties: false });
export const ExtractorSchema = Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }), kind: Type.Optional(Type.Enum(["cmd_regex", "out_regex", "cmd_count"])), pattern: Type.String({ minLength: 1, maxLength: 2048 }) }, { additionalProperties: false });
export type DetectorSpec = Static<typeof DetectorSchema>;
export type ExtractorSpec = Static<typeof ExtractorSchema>;
export type FactDigest = {
  iid: string; resolved: boolean | null; edited_files: string[]; n_cmds: number; cmd_templates: string[];
  check_commands: string[]; failed_commands: { cmd: string; error: string }[];
  missing_command: boolean; missing_dependency: boolean; bad_usage: boolean;
  _ran_tests: boolean; _cmd_blob: string; _out_blob: string;
  features: Record<string, boolean | number>;
};
export type PatternAdmission = { kind: "valid"; pattern: RE2JS } | { kind: "invalid"; reason: string };
/** Generated expressions are never passed to JavaScript RegExp/eval. This is the supported dialect. */
export function compilePattern(pattern: string): PatternAdmission {
  if (!pattern || pattern.length > 2048) return { kind: "invalid", reason: "empty-or-oversize-pattern" };
  if (/\(\?(?:[=!]|<[=!])|\\[1-9]|\\k[<{]/.test(pattern)) return { kind: "invalid", reason: "unsupported-lookaround-or-backreference" };
  // Python's Unicode shorthand/boundary semantics differ from RE2's ASCII forms. Reject rather than mislearn.
  if (/\\[wWbBdDsS]/.test(pattern)) return { kind: "invalid", reason: "use-explicit-character-classes-in-safe-dialect" };
  try { return { kind: "valid", pattern: RE2JS.compile(pattern) }; }
  catch (error) { return { kind: "invalid", reason: Error.isError(error) ? error.message : "unsupported-pattern" }; }
}
export function patternMatches(pattern: string | undefined, text: string): boolean {
  if (!pattern) return false;
  const compiled = compilePattern(pattern);
  return compiled.kind === "valid" && compiled.pattern.matcher(text).find();
}
export function genericPredicate(name: string, digest: FactDigest): boolean | null {
  switch (name) {
    case "ran_tests": return digest._ran_tests;
    case "ran_checks": return digest.check_commands.length > 0;
    case "command_failed": return digest.failed_commands.length > 0;
    case "missing_command": return digest.missing_command;
    case "missing_dependency": case "importerror": return digest.missing_dependency;
    case "bad_usage": case "badarg": return digest.bad_usage;
    case "edited": return digest.edited_files.length > 0;
    case "repro_written": return false;
    default: return null;
  }
}
export function sensed(name: string, digest: FactDigest): boolean {
  if (Object.hasOwn(digest.features, name)) return Boolean(digest.features[name]);
  return genericPredicate(name, digest) ?? patternMatches(name, digest._cmd_blob);
}
export type DetectorVerdict = { verdict: Verdict; fired: boolean; exercised: boolean };
export function detectorVerdict(spec: DetectorSpec, digest: FactDigest): DetectorVerdict {
  if (!sensed(spec.scope, digest)) return { verdict: null, fired: false, exercised: false };
  const blob = `${digest._cmd_blob}\n${digest._out_blob}`;
  if (patternMatches(spec.contradict, blob)) return { verdict: "contradict", fired: true, exercised: true };
  const fired = sensed(spec.fired || spec.scope, digest);
  return { verdict: patternMatches(spec.confirm, blob) ? "confirm" : null, fired, exercised: true };
}
export function extract(spec: ExtractorSpec, commands: { command: string; output: string }[]): boolean | number {
  const compiled = compilePattern(spec.pattern);
  if (compiled.kind === "invalid") return spec.kind === "cmd_count" ? 0 : false;
  const matches = commands.map(call => compiled.pattern.matcher(spec.kind === "out_regex" ? call.output : call.command).find());
  return spec.kind === "cmd_count" ? matches.filter(Boolean).length : matches.some(Boolean);
}
export function featurize(digest: FactDigest, extractors: ExtractorSpec[], commands: { command: string; output: string }[]): FactDigest {
  return { ...digest, features: Object.fromEntries(extractors.map(spec => [spec.name, extract(spec, commands)])) };
}
/** Historical blobs no longer retain pairing: assign the entire output to the first command. */
export function reparseCommands(digest: FactDigest): { command: string; output: string }[] {
  return digest._cmd_blob.split("\n").map((command, i) => ({ command, output: i === 0 ? digest._out_blob : "" }));
}
