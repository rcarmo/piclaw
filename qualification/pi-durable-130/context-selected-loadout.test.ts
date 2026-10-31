import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { AgentDoc, defineExtension, defineTool, type ToolRegistration } from '../../runtime/durable-engine/qualification/durable.ts';
import { Type } from '../../runtime/durable-engine/qualification/ai.ts';
import { openFixture, context } from './src/fixture.js';
import { assertModelContextFits, projectModelContext } from '../../runtime/durable-engine/src/host-model-context.ts';

test('context admission excludes callable-only schemas while preserving actual selected schemas', async () => {
  const f = await openFixture({ acquired: true });
  try {
    const visible = defineTool({ name: 'visible', description: 'Small offered tool', parameters: Type.Object({}),
      execute: async () => ({}) });
    const hidden = Array.from({ length: 16 }, (_, i) => defineTool({ name: `nested_only_${i}`,
      description: 'NESTED_ONLY_SCHEMA'.repeat(512), parameters: Type.Object({}), callers: ['tools'],
      execute: async () => ({}) }));
    f.registry.install(defineExtension({ name: 'selected-context-probe', tools: [visible, ...hidden] }));
    await f.root.configure({ extensions: null, tools: null, modelTools: [visible] }, context);
    const resolved = await f.root.agent(context);
    const doc = await f.harness.snapshot(AgentDoc, f.root.id, context);
    const messages = [{ role: 'user' as const, content: 'Synthetic bounded context', timestamp: 0 }];
    expect(resolved.tools.map(t => t.name)).toEqual(['visible']);
    expect(hidden.every(t => resolved.callable.some(c => c.name === t.name))).toBe(true);
    const schema = (t: ToolRegistration) => ({ name: t.name, description: t.description, parameters: t.parameters });
    const offeredBytes = Buffer.byteLength(JSON.stringify([messages, doc, resolved.tools.map(schema)]));
    const registryBytes = Buffer.byteLength(JSON.stringify([messages, doc, f.registry.snapshot().tools().map(({ tool }) => schema(tool))]));
    expect(registryBytes - offeredBytes).toBeGreaterThan(100000);
    const target = { contextWindow: offeredBytes + 8192 + 10000 + 1000, maxTokens: 10000 };
    expect(offeredBytes + 8192 + target.maxTokens).toBeLessThan(target.contextWindow);
    const projected = await projectModelContext({ ...(await f.root.context(context)), messages },
      { conversationId: f.root.id, agent: resolved, env: undefined, read: f.harness }, context);
    expect(() => assertModelContextFits(projected, target)).not.toThrow();
    const allSchemas = f.registry.snapshot().tools().map(({ tool }) => schema(tool));
    expect(() => assertModelContextFits([...messages, { role: 'system', content: '', toolsAdded: allSchemas, timestamp: 1 }], target)).toThrow('Candidate context estimate exceeded');
    expect(await f.harness.snapshot(AgentDoc, f.root.id, context)).toEqual(doc);
    expect(f.host.modelCalls).toBe(0);
  } finally { await f.harness.close(context); }
});
