// SPDX-License-Identifier: Apache-2.0
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { JsonObject } from "@earendil-works/pi-ai";
import type { DecodedResult, ToolResultData } from "./domain.ts";
const argumentsSchema = Type.Object({command:Type.Optional(Type.String()),cmd:Type.Optional(Type.String()),pattern:Type.Optional(Type.String()),query:Type.Optional(Type.String()),path:Type.Optional(Type.String()),file_path:Type.Optional(Type.String()),filePath:Type.Optional(Type.String()),paths:Type.Optional(Type.Array(Type.String()))});
export type DecodedArguments = {command:string;targets:string[];coverage:"complete"|"partial"};
/** Default for conventional shell/file tools; a host can supply its own typed mapping. Never retain edit bodies. */
export function decodeArguments(args: JsonObject): DecodedArguments {
  if (!Value.Check(argumentsSchema,args)) return {command:"",targets:[],coverage:"partial"};
  const path = args.path ?? args.file_path ?? args.filePath;
  return {command:args.command ?? args.cmd ?? args.pattern ?? args.query ?? "",targets:args.paths ?? (path ? [path] : []),coverage:"complete"};
}
const rawOutputSchema = Type.Object({optimizerRawOutput:Type.String()});
const resultSchema = Type.Object({output:Type.Optional(Type.String()),exitCode:Type.Optional(Type.Union([Type.Integer(),Type.Null()])),timedOut:Type.Optional(Type.Boolean()),aborted:Type.Optional(Type.Boolean()),truncated:Type.Optional(Type.Boolean())});
/** Structured execution status takes precedence over isError or textual guesses. */
export function decodeResult(result: ToolResultData): DecodedResult {
  const details = Value.Check(resultSchema,result.details) ? result.details : null;
  const structured = Value.Check(resultSchema,result.structured) ? result.structured : null;
  const payload = structured ?? details;
  const scalar = Value.Check(Type.String(),result.structured) ? result.structured : null;
  const text = scalar ?? payload?.output ?? (Value.Check(rawOutputSchema,result.details) ? result.details.optimizerRawOutput : result.output);
  const aborted = result.diagnostics.some(d => ["aborted","abandoned","interrupted"].includes(d.code)), timedOut = result.diagnostics.some(d => ["timeout","timed_out"].includes(d.code));
  return {output:[text,...result.diagnostics.map(d => d.message)].filter(Boolean).join("\n"),exitCode:payload?.exitCode ?? null,timedOut:timedOut || payload?.timedOut === true,aborted:aborted || payload?.aborted === true,
    coverage:payload?.truncated || result.structured !== null && !structured && scalar === null ? "partial" : "complete"};
}
