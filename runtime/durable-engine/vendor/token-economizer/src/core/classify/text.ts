// SPDX-License-Identifier: Apache-2.0
import { compareCodePoints } from "../ordering.ts";
import { redact } from "../observations.ts";
export const tokeniserVersion = "text-v1";
export type AttachmentType = {extension:string;mimeType:string};
export type Tokenized = {tokens:string[];omitted:boolean};
const extensions = new Set(["txt","md","rst","json","yaml","yml","csv","tsv","xlsx","xls","ods","docx","pptx","pdf","png","jpg","jpeg","gif","webp","svg","html","css","js","ts","tsx","jsx","py","go","rs","java","sh","sql","zip"]);
function extensionToken(path: string): string {const extension = path.split(".").at(-1)?.toLowerCase() ?? "";return extensions.has(extension) ? ` <ext:${extension}>` : "";}
export function boundedProse(text: string) {
  const clean = redact(text), encoded = new TextEncoder().encode(clean);
  if (encoded.byteLength <= 4096) return {text:clean,omitted:false};
  let result = "", bytes = 0;
  for (const char of clean) {const size = new TextEncoder().encode(char).byteLength;if (bytes+size > 4096) break;result += char;bytes += size;}
  return {text:result,omitted:true};
}
export function tokenize(text: string,attachments: AttachmentType[] = []): Tokenized {
  const bounded = boundedProse(text);let prose = bounded.text, omitted = bounded.omitted;
  prose = prose.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g,() => {omitted = true;return " ";});
  prose = prose.normalize("NFKC").replace(/https?:\/\/[^\s<>"'`]+/gi," <url> ")
    .replace(/(?:[A-Za-z]:[\\/]|\/|~\/)[^\s<>"'`]+/g,path => ` <path>${extensionToken(path)} `)
    .replace(/\b(?:[\p{L}\p{N}_.-]+\/)+[\p{L}\p{N}_.-]+/gu,path => ` <path>${extensionToken(path)} `)
    .replace(/([\p{Ll}\p{Nd}])([\p{Lu}])/gu,"$1 $2").replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu,"$1 $2").toLowerCase();
  const tokens = Array.from(prose.match(/<(?:url|path|ext:[a-z0-9]+)>|[\p{L}\p{N}]+/gu) ?? []);
  for (const attachment of attachments.slice(0,32)) if (extensions.has(attachment.extension.toLowerCase())) tokens.push(`<ext:${attachment.extension.toLowerCase()}>`);
  return {tokens:tokens.slice(0,256),omitted:omitted || tokens.length > 256 || attachments.length > 32};
}
export function textInDomain(input: Tokenized,vocabulary: string[]): boolean {
  const lexical = [...new Set(input.tokens.filter(token => !token.startsWith("<")))], known = lexical.filter(token => vocabulary.includes(token)).length;
  return !input.omitted && known >= 3 && lexical.length > 0 && (lexical.length-known)/lexical.length <= .5;
}

export function fitVocabulary(rows:readonly {tokens:readonly string[]}[]):string[] {
  const frequency = new Map<string,number>();for (const row of rows) for (const token of new Set(row.tokens)) frequency.set(token,(frequency.get(token) ?? 0)+1);
  return [...frequency.keys()].sort((a,b) => frequency.get(b)!-frequency.get(a)! || compareCodePoints(a,b)).slice(0,2000);
}
