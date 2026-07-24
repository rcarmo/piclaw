import { describe, expect, test } from "bun:test";

import "../helpers.js";
import { parseNonNegativeIntStrict, parsePositiveIntStrict } from "../../src/utils/strict-int.js";

describe("strict integer configuration parsing", () => {
  const fallback = 42;

  test.each([
    ["1", 1],
    ["01", 1],
    ["0007", 7],
    [" 12 ", 12],
    [0, fallback],
    ["0", fallback],
    ["12abc", fallback],
    ["4000oops", fallback],
    ["1.5", fallback],
    ["0x10", fallback],
    ["+12", fallback],
    ["-12", fallback],
    ["", fallback],
    ["   ", fallback],
    ["Infinity", fallback],
    ["NaN", fallback],
    [Number.POSITIVE_INFINITY, fallback],
    [Number.NaN, fallback],
    [Number.MAX_SAFE_INTEGER + 1, fallback],
  ] as Array<[unknown, number]>)("parsePositiveIntStrict(%p)", (value, expected) => {
    expect(parsePositiveIntStrict(value, fallback)).toBe(expected);
  });

  test.each([
    ["0", 0],
    [0, 0],
    ["0000", 0],
    ["7", 7],
    [" 8 ", 8],
    ["0abc", fallback],
    ["12abc", fallback],
    ["1.5", fallback],
    ["0x10", fallback],
    ["+0", fallback],
    ["-0", fallback],
    ["", fallback],
    ["Infinity", fallback],
    ["NaN", fallback],
    [Number.MAX_SAFE_INTEGER + 1, fallback],
  ] as Array<[unknown, number]>)("parseNonNegativeIntStrict(%p)", (value, expected) => {
    expect(parseNonNegativeIntStrict(value, fallback)).toBe(expected);
  });
});
