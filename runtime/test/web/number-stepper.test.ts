import { expect, test } from 'bun:test';
import {
  clampNumberValue,
  normalizeNumberValue,
  stepNumberValue,
} from '../../web/src/components/settings/number-stepper.ts';

test('normalizeNumberValue falls back and clamps to bounds', () => {
  expect(normalizeNumberValue('', { fallback: 32, min: 1, max: 256 })).toBe(32);
  expect(normalizeNumberValue(999, { fallback: 32, min: 1, max: 256 })).toBe(256);
  expect(normalizeNumberValue(-5, { fallback: 32, min: 1, max: 256 })).toBe(1);
});

test('stepNumberValue increments and decrements within bounds', () => {
  expect(stepNumberValue(32, { direction: 1, step: 1, min: 1, max: 256 })).toBe(33);
  expect(stepNumberValue(32, { direction: -1, step: 1, min: 1, max: 256 })).toBe(31);
  expect(stepNumberValue(256, { direction: 1, step: 1, min: 1, max: 256 })).toBe(256);
  expect(stepNumberValue(1, { direction: -1, step: 1, min: 1, max: 256 })).toBe(1);
});

test('clampNumberValue enforces explicit bounds', () => {
  expect(clampNumberValue(10, { min: 20, max: 100 })).toBe(20);
  expect(clampNumberValue(120, { min: 20, max: 100 })).toBe(100);
  expect(clampNumberValue(50, { min: 20, max: 100 })).toBe(50);
});
