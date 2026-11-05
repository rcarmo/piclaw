import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = resolve(import.meta.dir, '../../src');
const retired = [
  ...['accounting', 'captured-provider', 'contracts', 'errors', 'executor', 'host', 'http', 'output', 'scope', 'validation'].map(name => `addons/child-request-${name}.ts`),
  'budget/shared-model-request-boundary.ts', 'budget/install-shared-request-boundary.ts',
];

test('unregistered child-request proxy and stream installer are absent from executable core', () => {
  for (const path of retired) expect(existsSync(resolve(source, path)), path).toBe(false);
});

test("native Delegate retains source authority without financial execution owners", () => {
  const runtime = readFileSync(resolve(source, "../durable-engine/src/default-application-runtime.ts"), "utf8");
  expect(runtime).toContain("createHostDelegateTool");
  expect(runtime).toContain("captureToolSource");
  for (const path of ["../durable-engine/src/host-request-accounting.ts", "budget/model-request-accounting.ts", "budget/request-cost-bound.ts", "budget/request-reservation-admission.ts", "db/budget-request-reservations.ts", "addons/operation-outbound-admission.ts"]) expect(existsSync(resolve(source,path)), path).toBe(false);
  expect(runtime).not.toContain("createChildRequestsApi");
  expect(runtime).not.toContain("installSharedRequestBoundary");
});
