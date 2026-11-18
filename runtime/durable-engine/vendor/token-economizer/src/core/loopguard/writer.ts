// SPDX-License-Identifier: Apache-2.0
// Modified TypeScript port of Microsoft TokenEconomizer, revision 81e32e56bb3c4c1b4c9756b429be91e3960116ca; see ../../../LICENSE.
import { redact } from "../observations.ts";
import { sliceCodePoints } from "../ordering.ts";
import { writerSystem } from "./prompts.ts";
export function writerPrompt(digest: string): string {return writerSystem+"\n\nRecent process digest:\n"+digest+"\n\nWrite the redirect:";}
export function parseWriter(raw: string): string | null {
  const text = sliceCodePoints(raw.trim(),0,1200);if (!text || redact(text) !== text || /```|^\s*[#{[]|\bline(?:s)?\s+\d+/im.test(text)) return null;
  const advice = text.replace(/\b(?:do not|don'?t|never)\s+(?:stop|give up|reduce effort)\b/gi,"");
  return /\b(?:stop|give up|reduce effort|task (?:is )?(?:done|complete)|ignore (?:the )?(?:user|instructions))\b/i.test(advice) ? null : text;
}
