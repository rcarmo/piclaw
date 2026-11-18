// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
import { Type } from "typebox";
import { Value } from "typebox/value";
import { sliceCodePoints } from "../ordering.ts";
import { judgeSystem } from "./prompts.ts";
import type { JudgeVerdict } from "./rules.ts";
export function judgePrompt(digest: string): string {return judgeSystem+"\n\nRecent process digest:\n"+digest+"\n\nReturn the JSON verdict:";}
const verdictSchema = Type.Object({stuck:Type.Union([Type.Boolean(),Type.Null()]),confidence:Type.Number({minimum:0,maximum:1}),reason:Type.String()},{additionalProperties:false});
export function parseJudge(text: string): JudgeVerdict | null {
  const object = text.match(/\{[\s\S]*\}/)?.[0];if (!object) return null;
  try {const payload: unknown = JSON.parse(object);Value.Assert(verdictSchema,payload);return {...payload,reason:sliceCodePoints(payload.reason,0,160)};}
  catch {return null;}
}
