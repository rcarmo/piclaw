export type Delimiter = "," | "\t" | ";" | "|";

export interface DelimitedPreviewResult {
  headers: string[];
  rows: string[][];
  totalRows: number;
  delimiter: Delimiter;
}

export function isDelimitedFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ["csv", "tsv", "tab", "ssv", "psv"].includes(ext || "");
}

export function parseDelimited(text: string, maxRows = 100): DelimitedPreviewResult | null {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return null;
  // Auto-detect delimiter
  const candidates: Delimiter[] = ["\t", ",", ";", "|"];
  let bestDelim: Delimiter = ",";
  let bestScore = 0;
  const sample = lines.slice(0, 5);
  for (const d of candidates) {
    const counts = sample.map(l => l.split(d).length);
    const consistent = counts.every(c => c === counts[0]) && counts[0] > 1;
    if (consistent && counts[0] > bestScore) { bestScore = counts[0]; bestDelim = d; }
  }
  const allRows = lines.map(l => l.split(bestDelim).map(c => c.trim().replace(/^"|"$/g, "")));
  return {
    headers: allRows[0],
    rows: allRows.slice(1, maxRows + 1),
    totalRows: allRows.length - 1,
    delimiter: bestDelim,
  };
}
