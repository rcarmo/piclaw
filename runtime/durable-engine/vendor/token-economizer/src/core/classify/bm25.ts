// SPDX-License-Identifier: Apache-2.0
import { compareCodePoints } from "../ordering.ts";
export type ToolDocument = {tool:string;tokens:string[]};
export type BM25 = {documents:ToolDocument[];frequency:Record<string,number>;averageLength:number};
export function buildBM25(documents: ToolDocument[]): BM25 {
  const frequency = new Map<string,number>();
  for (const document of documents) for (const token of new Set(document.tokens)) frequency.set(token,(frequency.get(token) ?? 0)+1);
  return {documents:structuredClone(documents),frequency:Object.fromEntries(frequency),averageLength:documents.length ? documents.reduce((sum,d) => sum+d.tokens.length,0)/documents.length : 0};
}
export function bm25Score(index: BM25,query: string[],document: ToolDocument): number {
  if (!index.documents.length || !query.length || !document.tokens.length || !index.averageLength) return 0;
  const frequency = new Map<string,number>();for (const token of document.tokens) frequency.set(token,(frequency.get(token) ?? 0)+1);
  let score = 0;
  for (const token of new Set(query)) {
    const tf = frequency.get(token) ?? 0, df = Object.hasOwn(index.frequency,token) ? index.frequency[token] : 0;if (!tf || !df) continue;
    const idf = Math.log(1+(index.documents.length-df+.5)/(df+.5));
    score += idf*tf*2.2/(tf+1.2*(1-.75+.75*document.tokens.length/index.averageLength));
  }
  return score;
}
export function lexicalKeeps(index: BM25,query: string[]): string[] {
  const scores = new Map<string,number>();for (const document of index.documents) scores.set(document.tool,Math.max(scores.get(document.tool) ?? 0,bm25Score(index,query,document)));
  const ranked = [...scores].filter(([,score]) => score > 0).sort(([a,x],[b,y]) => y-x || compareCodePoints(a,b)), threshold = ranked[Math.min(2,ranked.length-1)]?.[1];
  return threshold === undefined ? [] : ranked.filter(([,score]) => score >= threshold).map(([tool]) => tool);
}
/** Catalogue first, then at most sixteen distinct recent fit-only positive tasks per tool. */
export function lexicalCorpus(catalogue:ToolDocument[],fitTasks:ToolDocument[]):ToolDocument[] {
  const result:ToolDocument[] = [], seen = new Set<string>(), counts = new Map<string,number>();
  function add(row:ToolDocument) {const tokens = row.tokens.slice(0,256), key = JSON.stringify([row.tool,tokens]);if (seen.has(key) || result.length >= 4096) return false;seen.add(key);result.push({tool:row.tool,tokens});return true;}
  for (const row of catalogue) add(row);
  for (const row of [...fitTasks].reverse()) if ((counts.get(row.tool) ?? 0) < 16 && add(row)) counts.set(row.tool,(counts.get(row.tool) ?? 0)+1);
  return result;
}
