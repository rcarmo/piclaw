import { expect, test } from 'bun:test';
import * as meters from '../../web/src/components/system-meters-hud.js';

const data = { io_pressure_some_percent: 25, io_pressure_full_percent: 8,
  io_pressure_some_series: [0, 25, 100], io_pressure_full_series: [0, 8, 50] };

test('I/O pressure uses the same fixed 0–100 scale for some/full history', () => {
  const meter = meters.resolveIoPressureMeter(data);
  expect(meter?.somePath).toBe('M 0.00 16.00 L 28.00 12.00 L 56.00 0.00');
  expect(meter?.fullPath).toBe('M 0.00 16.00 L 28.00 14.72 L 56.00 8.00');
  expect(meter?.title).toContain('some 25%');
  expect(meter?.title).toContain('full 8%');
  expect(meter?.title).toContain('10s average');
  expect(meter?.title).toContain('not disk utilisation');
});

test('zero pressure is valid; tiny stalls are not rounded to a misleading zero', () => {
  expect(meters.resolveIoPressureMeter({ ...data, io_pressure_some_percent: 0 })?.value).toBe('0%');
  expect(meters.resolveIoPressureMeter({ ...data, io_pressure_some_percent: 0.04 })?.value).toBe('0.04%');
});

test('absent or invalid pressure does not create a chart or turn null history into zero', () => {
  expect(meters.resolveIoPressureMeter({})).toBeNull();
  for (const value of [null, undefined, '', false, NaN, Infinity, -1, 101]) {
    expect(meters.resolveIoPressureMeter({ ...data, io_pressure_some_percent: value })).toBeNull();
    expect(meters.resolveIoPressureMeter({ ...data, io_pressure_some_series: [1, value, 2] })).toBeNull();
  }
  expect(meters.resolveIoPressureMeter({ ...data, io_pressure_some_series: [] })).toBeNull();
});

test('full pressure is optional and never inferred from some pressure', () => {
  const meter = meters.resolveIoPressureMeter({ ...data, io_pressure_full_percent: null });
  expect(meter?.somePath).toBeTruthy();
  expect(meter?.fullPath).toBe('');
  expect(meter?.title).toContain('full unavailable');
});

test('I/O meter bounds history to the most recent 30 points', () => {
  const meter = meters.resolveIoPressureMeter({ ...data, io_pressure_some_series: Array.from({ length: 40 }, (_, index) => index) });
  expect(meter?.somePath.split(' L ')).toHaveLength(30);
  expect(meter?.somePath).toStartWith('M 0.00 14.40');
});
