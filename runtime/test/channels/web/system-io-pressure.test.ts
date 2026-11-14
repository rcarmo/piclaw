import { expect, test } from 'bun:test';
import * as metrics from '../../../src/channels/web/agent/system-metrics.js';

const psi = (some: string, full = '0.00') => `some avg10=${some} avg60=0.00 avg300=0.00 total=123\nfull avg10=${full} avg60=0.00 avg300=0.00 total=45\n`;

test('Linux I/O PSI preserves some/full avg10 percentages, including zero and fractions', () => {
  expect(metrics.parseLinuxIoPressure(psi('23.45', '8.02'))).toEqual({ somePercent: 23.45, fullPercent: 8.02 });
  expect(metrics.parseLinuxIoPressure(psi('0.00'))).toEqual({ somePercent: 0, fullPercent: 0 });
  expect(metrics.parseLinuxIoPressure(psi('100.00', '100.00'))).toEqual({ somePercent: 100, fullPercent: 100 });
  expect(metrics.parseLinuxIoPressure('some avg300=7.00 avg10=0.04 avg60=2.00 total=123')).toEqual({ somePercent: 0.04, fullPercent: null });
});

test('Linux I/O PSI rejects absent or malformed some values instead of fabricating zero', () => {
  for (const value of ['', 'NaN', 'Infinity', '-1', '100.01', '1.2junk']) {
    expect(metrics.parseLinuxIoPressure(psi(value))).toBeNull();
  }
  expect(metrics.parseLinuxIoPressure('')).toBeNull();
  expect(metrics.parseLinuxIoPressure('full avg10=2.00 avg60=1.00')).toBeNull();
  expect(metrics.parseLinuxIoPressure(psi('2.00', 'invalid'))).toEqual({ somePercent: 2, fullPercent: null });
});

test('I/O pressure is optional on non-Linux, missing, unreadable or unsupported proc files', () => {
  let reads = 0;
  const read = () => { reads++; return psi('4.00', '1.00'); };
  expect(metrics.readLinuxIoPressure('win32', read)).toBeNull();
  expect(metrics.readLinuxIoPressure('darwin', read)).toBeNull();
  expect(reads).toBe(0);
  expect(metrics.readLinuxIoPressure('linux', read)).toEqual({ somePercent: 4, fullPercent: 1 });
  expect(reads).toBe(1);
  expect(metrics.readLinuxIoPressure('linux', () => { throw Error('unavailable'); })).toBeNull();
  expect(metrics.readLinuxIoPressure('linux', () => 'not supported')).toBeNull();
});

test('I/O pressure histories are bounded, independent copies and cleared across unavailable samples', () => {
  let pressure = { somePercent: 10, fullPercent: 2 } as { somePercent: number; fullPercent: number | null } | null;
  const sampler = new metrics.SystemMetricsSampler(2, 2000, () => null, () => pressure);
  const first = sampler.readSnapshot(null, [], false);
  expect(first.io_pressure_some_series).toEqual([10]);
  first.io_pressure_some_series[0] = 99;
  pressure = { somePercent: 20, fullPercent: 3 };
  const second = sampler.readSnapshot(null, [], false);
  expect(second.io_pressure_some_series).toEqual([10, 20]);
  pressure = { somePercent: 30, fullPercent: null };
  expect(sampler.readSnapshot(null, [], false)).toMatchObject({
    io_pressure_some_percent: 30, io_pressure_some_series: [20, 30],
    io_pressure_full_percent: null, io_pressure_full_series: [],
  });
  pressure = null;
  expect(sampler.readSnapshot(null, [], false)).toMatchObject({
    io_pressure_some_percent: null, io_pressure_full_percent: null,
    io_pressure_some_series: [], io_pressure_full_series: [],
  });
  pressure = { somePercent: 0, fullPercent: 0 };
  expect(sampler.readSnapshot(null, [], false)).toMatchObject({
    io_pressure_some_percent: 0, io_pressure_full_percent: 0,
    io_pressure_some_series: [0], io_pressure_full_series: [0],
  });
});

test('system-metrics endpoint exposes pressure for general UI polling without enabling GPU readers', async () => {
  const sampler = new metrics.SystemMetricsSampler(2, 2000, () => { throw Error('must not read GPU'); }, () => ({ somePercent: 0.04, fullPercent: 0 }));
  const response = metrics.handleSystemMetricsRequest({ json: Response.json }, sampler, null);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    io_pressure_some_percent: 0.04, io_pressure_full_percent: 0,
    io_pressure_some_series: [0.04], io_pressure_full_series: [0],
  });
});
