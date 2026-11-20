// SPDX-License-Identifier: Apache-2.0
// Adapted from sakebomb/mcp-recall 2db17d6d01d965e4181a8f18c674561baa588a24.
// Changes: typed input and local adapters; execution/storage remain owned by Kintsugi.
import type { CompressionResult, Handler, RecallOutput } from "./input.ts";
import { shellHandler } from "./input.ts";
import { bashOutputText, extractStdout, extractStderr, MAX_BUILD_ERRORS } from "./input.ts";

// ---------------------------------------------------------------------------
// Test runners: pytest, jest, bun test, vitest, go test
// Detected by output pattern rather than command name.
// ---------------------------------------------------------------------------

export const testRunnerHandler: Handler = (
  toolName: string,
  output: RecallOutput
): CompressionResult => summarizeTestRun(output) ?? shellHandler(toolName, output);

/**
 * Summarises test-runner output, or returns null when it holds no test result
 * (no count line and no failing test). Also used for make/just recipes (#325).
 */
export function summarizeTestRun(output: RecallOutput): CompressionResult | null {
  const stdout = extractStdout(output);
  const stderr = extractStderr(output);
  const combined = `${stdout}\n${stderr}`.trim();
  const originalSize = Buffer.byteLength(bashOutputText(output), "utf8");

  // Collect failure blocks — lines that look like test failures/errors, plus the
  // message lines that say why (#308): a name alone does not tell Claude what to fix.
  // Message lines alone never decide the status: a passing run can print
  // `error: …` from the code under test.
  const failureLines: FailureLine[] = [];
  let failureNames = 0, passLines = 0, failLines = 0;
  // Detail lines still to take after a bun `error:` or a jest `●` line (#320).
  let detailBudget = 0;
  for (const line of combined.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (/^\(pass\)\s/.test(t)) passLines++;
    if (/^\(fail\)\s/.test(t)) failLines++;
    // pytest: FAILED src/test.py::test_name
    // jest/vitest: ✕ / ✗ / × test name  or  ● test name
    // bun: (fail) suite > test name
    const isName = /^(FAILED|FAIL)\s+/.test(t) ||
      /^[✕✗×●]\s/.test(t) ||
      /^\(fail\)\s/.test(t) ||
      /^--- FAIL:/.test(t);
    // bun's `error: …` precedes its (fail) line; pytest's `E   assert …` follows FAILED.
    // The pytest marker is tested on the untrimmed line: it is always flush-left,
    // and requiring that keeps indented prose starting with "E  " out.
    const isMessage = /^error:\s/.test(t) || /^E\s{2,}\S/.test(line);
    if (isName) {
      failureNames++;
      failureLines.push({ text: clipName(t), isName: true });
      detailBudget = t.startsWith("●") ? MAX_DETAIL_LINES : 0;
    } else if (isMessage) {
      failureLines.push({ text: t.slice(0, MAX_LINE), isName: false });
      if (/^error:\s/.test(t)) detailBudget = MAX_DETAIL_LINES;
    } else if (detailBudget > 0 && isDetail(t)) {
      failureLines.push({ text: t.slice(0, MAX_LINE), isName: false });
      detailBudget--;
    }
  }

  // Try to find a summary line
  let passed = 0, failed = 0, skipped = 0;
  let ranTotal: number | undefined;
  let foundSummary = false;

  for (const line of combined.split("\n")) {
    const t = line.trim();

    // bun: "X pass\nY fail" … "Ran N tests across M files."
    const bunPass = t.match(/^(\d+)\s+pass$/);
    const bunFail = t.match(/^(\d+)\s+fail$/);
    const bunRan = t.match(/^Ran\s+(\d+)\s+tests?\s+across\b/);
    if (bunPass) { passed = parseInt(bunPass[1]!); foundSummary = true; }
    if (bunFail) { failed = parseInt(bunFail[1]!); foundSummary = true; }
    if (bunRan) { ranTotal = parseInt(bunRan[1]!); foundSummary = true; }

    // pytest: "1 failed, 5 passed, 1 skipped, 2 warnings in 1.23s". The order
    // varies (pytest puts failed first), so read each count on its own (#308).
    if (/\b\d+\s+(?:passed|failed)\b.*\bin\s+\d+(?:\.\d+)?s\b/.test(t)) {
      const count = (word: string) => parseInt(t.match(new RegExp(String.raw`(\d+)\s+${word}\b`))?.[1] ?? "0");
      passed = count("passed");
      failed = count("failed");
      skipped = count("skipped");
      foundSummary = true;
    }

    // jest/vitest: "Tests: 5 passed, 2 failed, 7 total"
    const jestMatch = t.match(/Tests:\s+(?:(\d+)\s+failed,\s+)?(\d+)\s+passed(?:,\s+(\d+)\s+skipped)?/);
    if (jestMatch) {
      if (jestMatch[1]) failed = parseInt(jestMatch[1]);
      passed = parseInt(jestMatch[2]!);
      if (jestMatch[3]) skipped = parseInt(jestMatch[3]);
      foundSummary = true;
    }

    // go test: "ok  \tpackage\t0.123s" / "FAIL\tpackage\t0.123s"
    const goOk = t.match(/^ok\s+\S+/);
    const goFail = t.match(/^FAIL\s+\S+/);
    if (goOk) { passed++; foundSummary = true; }
    if (goFail) { failed++; foundSummary = true; }
  }

  if (!foundSummary && failureNames === 0) return null;

  // Without count lines (output cut by `tail`, or grepped), count bun's
  // per-test lines rather than report nothing.
  if (passed === 0) passed = passLines;
  if (failed === 0) failed = failLines;
  // A partial view must not invent a total: prefer the runner's own (#308).
  const total = ranTotal ?? passed + failed + skipped;
  // A failing test's name always means FAIL, even when no count line survived.
  const isFail = failed > 0 || failureNames > 0;
  const status = isFail ? "FAIL" : "pass";
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  // No count survived (e.g. a cut-off jest run): say so, rather than claim the
  // run produced no results.
  const summaryStr = parts.length > 0 ? parts.join(", ") : "no counts in output";

  const lines = [`test runner — ${status}: ${summaryStr}${total > 0 ? ` (${total} total)` : ""}`];
  if (isFail && failureLines.length > 0) {
    const kept = selectFailureLines(failureLines, MAX_BUILD_ERRORS);
    lines.push(`  failures:`);
    lines.push(...kept.map(l => `    ${l.text}`));
    if (failureLines.length > kept.length) {
      lines.push(`    … (+${failureLines.length - kept.length} more)`);
    }
  }

  return { summary: lines.join("\n"), originalSize };
}

interface FailureLine {
  text: string;
  isName: boolean;
}

/** Detail lines kept after one bun `error:` or jest `●` line (#320). */
const MAX_DETAIL_LINES = 4;
const MAX_LINE = 160;
const NAME_HEAD = 60;

/** Expected/Received values and `-`/`+` diff lines; not the `- Expected  - 1` diff legend. */
function isDetail(t: string): boolean {
  if (/^[-+]\s+(Expected|Received)\s+[-+]\s*\d+$/.test(t)) return false;
  return /^(Expected|Received)\b/.test(t) || /^[-+]\s/.test(t);
}

/**
 * bun names are `describe > it`, so parameterised cases differ at the end:
 * drop the timing, then clip from the middle so the end survives (#320).
 */
function clipName(t: string): string {
  const name = t.replace(/\s+\[\d+(?:\.\d+)?m?s\]$/, "");
  if (name.length <= MAX_LINE) return name;
  return `${name.slice(0, NAME_HEAD)} … ${name.slice(-(MAX_LINE - NAME_HEAD - 3))}`;
}

/**
 * Up to `max` lines in their original order. Every failure name comes first in
 * priority, so detail never pushes a later failure out of the list; the room
 * left goes to the earliest failures' messages.
 */
function selectFailureLines(entries: FailureLine[], max: number): FailureLine[] {
  if (entries.length <= max) return entries;
  const names = entries.filter(e => e.isName).length;
  let detailRoom = Math.max(0, max - names);
  let nameRoom = max;
  return entries.filter(e => {
    if (e.isName) return nameRoom-- > 0;
    if (detailRoom > 0 && nameRoom > 0) { detailRoom--; nameRoom--; return true; }
    return false;
  });
}
