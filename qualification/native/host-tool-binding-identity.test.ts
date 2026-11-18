import { expect, test } from "bun:test";
import { Type } from "../../runtime/durable-engine/qualification/ai.ts";
import { createHostTool, assertHostToolBinding } from "../../runtime/durable-engine/src/host-tools.ts";

function fixture() {
  let active = true;
  const definition = { name: "identity_probe", label: "Probe", description: "Probe", parameters: Type.Object({}),
    async execute() { return { content: [{ type: "text" as const, text: "ok" }], details: {} }; } };
  const registration = createHostTool(definition, {
    authority: { check() { if (!active) throw Error("revoked"); } }, effectFence: "host-effect-port",
    invoke(args, call) { call.assertAllowed(); return call.execute(call.toolCallId, args, call.signal, call.onUpdate, undefined as never); },
  });
  return { definition, registration, revoke() { active = false; } };
}
test("binding proof requires exact constructed bridge and exact definition", () => {
  const a = fixture(), b = fixture();
  expect(() => assertHostToolBinding(a.registration, a.definition)).not.toThrow();
  for (const registration of [{ ...a.registration }, {}, b.registration])
    expect(() => assertHostToolBinding(registration, a.definition)).toThrow("identity");
  expect(() => assertHostToolBinding(a.registration, { ...a.definition })).toThrow("identity");
});
test("binding proof rejects source definition mutation and revoked host authority", () => {
  const a = fixture(); a.definition.description = "changed";
  expect(() => assertHostToolBinding(a.registration, a.definition)).toThrow("identity");
  const b = fixture(); b.definition.execute = async () => ({ content: [], details: {} });
  expect(() => assertHostToolBinding(b.registration, b.definition)).toThrow("identity");
  const c = fixture(); c.revoke();
  expect(() => assertHostToolBinding(c.registration, c.definition)).toThrow("authority unavailable");
});

test('native bridge preserves the tool-owned summary callback as display metadata', async () => {
  const { toolCallSummary, readToolCallSummary, createToolCallSummaryResolver } = await import('../../runtime/src/tool-call-summary.ts');
  let executions = 0;
  const summarize = (args: any) => `owner wording for ${args.id}`;
  const definition = { name: 'summary_probe', label: 'Probe', description: 'Probe', parameters: Type.Object({ id: Type.Number() }),
    ...toolCallSummary(summarize), async execute() { executions++; return { content: [], details: {} }; } };
  const registration = createHostTool(definition, { authority: { check() {} }, effectFence: 'host-effect-port',
    invoke(args, call) { call.assertAllowed(); return call.execute(call.toolCallId, args, call.signal, call.onUpdate, undefined as never); } });
  expect(readToolCallSummary(registration)).toBe(summarize);
  expect(createToolCallSummaryResolver([registration])('summary_probe', { id: 7 })).toBe('owner wording for 7');
  expect(executions).toBe(0);
  expect(() => assertHostToolBinding(registration, definition)).not.toThrow();
  definition.callSummary = () => 'changed';
  expect(() => assertHostToolBinding(registration, definition)).toThrow('identity');
});

test('native summary registration cannot replace its captured callback or accept an async formatter', async () => {
  const { toolCallSummary } = await import('../../runtime/src/tool-call-summary.ts');
  const definition = { name: 'summary_probe', label: 'Probe', description: 'Probe', parameters: Type.Object({}),
    ...toolCallSummary(() => 'owner wording'), async execute() { return { content: [], details: {} }; } };
  const port = { authority: { check() {} }, effectFence: 'host-effect-port' as const,
    invoke(_args: any, call: any) { return call.execute(call.toolCallId, {}, call.signal, call.onUpdate, undefined); } };
  const registration = createHostTool(definition, port);
  Object.defineProperty(registration, 'callSummary', { value: () => 'substituted' });
  expect(() => assertHostToolBinding(registration, definition)).toThrow('identity');
  expect(() => createHostTool({ ...definition, callSummary: async () => 'bad' }, port)).toThrow('Synchronous tool call summary required');
});

test('binding validation rejects a newly-added metadata accessor without invoking it', () => {
  const probe = fixture(); let reads = 0;
  Object.defineProperty(probe.definition, 'callSummary', { enumerable: true, get() { reads++; return () => 'bad'; } });
  expect(() => assertHostToolBinding(probe.registration, probe.definition)).toThrow('identity');
  expect(reads).toBe(0);
});
