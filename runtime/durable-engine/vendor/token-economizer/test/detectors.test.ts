import { expect, test } from "bun:test";
import { Value } from "typebox/value";
import { Type } from "typebox";
import { compilePattern, detectorVerdict, DetectorSchema, extract, ExtractorSchema, patternMatches, reparseCommands } from "../src/core/microskills/detectors.ts";
import fixtures from "./fixtures/detectors.json";
import extractors from "./fixtures/extractors.json";
for (const fixture of fixtures.cases) test(`upstream detector ${fixtures.cases.indexOf(fixture)}`, () => {
  Value.Assert(DetectorSchema, fixture.input.spec);
  Value.Assert(Type.Union([Type.Enum(["confirm", "contradict"]), Type.Null()]), fixture.expected.verdict);
  const result = detectorVerdict(fixture.input.spec, fixture.input.digest);
  expect(result.verdict).toBe(fixture.expected.verdict);
  expect(result.fired).toBe(fixture.expected.fired);
  expect(result.exercised).toBe(fixture.expected.exercised);
});
for (const fixture of extractors.cases) test(`upstream extractor ${extractors.cases.indexOf(fixture)}`, () => {
  Value.Assert(ExtractorSchema, fixture.input.spec);
  expect(extract(fixture.input.spec, fixture.input.commands)).toEqual(fixture.expected);
});
test("safe dialect rejects unsupported or invalid expressions with reasons", () => {
  for (const pattern of ["(?=secret)", "(?<=secret)", "(x)\\1", "[", "x".repeat(2049), "\\w+", "\\bword\\b"]) {
    const result = compilePattern(pattern);
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason.length).toBeGreaterThan(0);
  }
  expect(patternMatches("(a+)+$", "a".repeat(100_000)+"!")).toBe(false);
  expect(patternMatches("(?i)É", "é")).toBe(true);
});
test("retro-featurization assigns all historical output to the first command", () => {
  const digest = { ...fixtures.cases[0].input.digest, _cmd_blob: "first\nsecond", _out_blob: "one\ntwo\nthree" };
  expect(reparseCommands(digest)).toEqual([{ command: "first", output: "one\ntwo\nthree" }, { command: "second", output: "" }]);
});
