// SPDX-License-Identifier: Apache-2.0
/** Python string ordering is by Unicode code point, not UTF-16 code unit. */
export function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left), b = Array.from(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}
export function sliceCodePoints(text: string, start: number, end?: number): string { return Array.from(text).slice(start, end).join(""); }
