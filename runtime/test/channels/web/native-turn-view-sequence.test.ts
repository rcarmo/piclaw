import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createNativeTurnView } from "../../../src/channels/web/agent/native-turn-view.js";
import { createToolTitleTracker } from "../../../src/channels/web/agent/agent-utils.js";
import { createToolCallSummaryResolver, toolCallSummary } from "../../../src/tool-call-summary.js";

function fixture() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE piclaw_durable_bindings_v1(operation_id,source_seq,source_id,chat_jid,conversation_id,submission_id);
    CREATE TABLE piclaw_durable_intent_bindings_v1(operation_id,chat_jid,conversation_id,submission_id);
      CREATE TABLE service_effect_s01_operations(operation_id,primary_source_seq); CREATE TABLE messages(id,chat_jid,thread_id);
    INSERT INTO service_effect_s01_operations VALUES('op',1); INSERT INTO messages VALUES('input','chat',NULL);
    INSERT INTO piclaw_durable_bindings_v1 VALUES('op',1,'input','chat',2,3);`);
  const events: any[] = [], panelEvents: any[] = [], draftBuffers: any[] = [];
  const render = createNativeTurnView(db, {
    broadcastEvent(event, data) { if (event === 'agent_status') events.push(data); else if (event === 'agent_draft') panelEvents.push(data); },
    updateDraftBuffer(turn, text, lines) { draftBuffers.push({ turn, text, lines }); },
  }, 'chat');
  const entries: any[] = [{ kind: 'host.accepted', data: { operationId: 'op' } }];
  const frame = (live: any) => render({ conversation: { id: 2 }, entries, docs: { 'pi.live': { run: { taskId: 4, inputs: [3] }, ...live } } });
  const complete = (id: string, output: string) => entries.push(
    { kind: 'pi.assistant', model: [{ role: 'assistant', content: [{ type: 'toolCall', id, name: 'exec_command', arguments: { cmd: `printf ${id}`, workdir: '/fixture', max_output_tokens: 2000 } }] }] },
    { kind: 'pi.tool-result', model: [{ role: 'toolResult', toolCallId: id, toolName: 'exec_command', content: [{ type: 'text', text: output }] }] },
  );
  const call = (id: string) => entries.push({ kind: 'pi.assistant', model: [{ role: 'assistant', content: [
    { type: 'toolCall', id, name: 'exec_command', arguments: { cmd: `printf ${id}`, workdir: '/fixture', max_output_tokens: 2000 } },
  ] }] });
  return { db, events, panelEvents, draftBuffers, entries, frame, complete, call };
}

test('native draft previews normalize logical lines without truncating content', () => {
  const long = 'x'.repeat(500);
  const cases = [
    { text: `${long}\n2\n3\n4\n5\n6\n7\n8\n9`, preview: `${long}\n2\n3\n4\n5\n6\n7\n8`, lines: 9 },
    { text: 'one\rtwo\rthree', preview: 'one\ntwo\nthree', lines: 1 },
    { text: 'one\r\ntwo\r\nthree', preview: 'one\ntwo\nthree', lines: 3 },
    { text: 'one\ntwo\n', preview: 'one\ntwo\n', lines: 3 },
  ];
  for (const item of cases) {
    const f = fixture();
    try {
      f.frame({ generation: { message: { content: [{ type: 'text', text: item.text }] } } });
      expect(f.panelEvents.at(-1)).toMatchObject({ text: item.preview, total_lines: item.lines });
      expect(f.draftBuffers.at(-1)).toMatchObject({ text: item.text, lines: item.lines });
    } finally { f.db.close(); }
  }
});

test('native command titles retain actual tool names and command parameters', () => {
  const titles = createToolTitleTracker();
  expect(titles.remember('one', 'exec_command', { cmd: 'printf one' })).toBe('exec_command: printf one');
  // Core does not invent an add-on-specific description without its provider.
  expect(titles.remember('two', 'exec_command', undefined)).toBe('exec_command');
  const summaries = createToolCallSummaryResolver([{ name: 'write_stdin', ...toolCallSummary(() => 'tool-supplied session caption') }]);
  expect(titles.remember('three', 'write_stdin', { session_id: 1, chars: '' }, summaries)).toBe('write_stdin: tool-supplied session caption');
  expect(titles.remember('four', 'write_stdin', { session_id: 1, chars: 'sensitive input' }, summaries)).toBe('write_stdin: tool-supplied session caption');
});

test('successive native tools cannot be replaced by reconstructed older completions', () => {
  const f = fixture();
  try {
    for (const id of ['one', 'two', 'three']) {
      const before = f.events.length;
      f.call(id);
      f.frame({ tools: [{ callId: id, name: 'exec_command', status: 'running', diagnostics: { transient: true } }] });
      expect(f.events.at(-1).tool_call_id).toBe(id);
      expect(f.events.at(-1).status).toBe('running');
      expect(f.events.at(-1).tool_name).toBe('exec_command');
      expect(f.events.at(-1).tool_args).toEqual({ cmd: `printf ${id}`, workdir: '/fixture', max_output_tokens: 2000 });
      expect(f.events.at(-1).title).toContain(`exec_command: printf ${id}`);
      expect(f.events.slice(before).filter(event => event.tool_call_id).every(event => event.tool_call_id === id)).toBe(true);
      f.complete(id, `output-${id}`);
      f.frame({ tools: [{ callId: id, name: 'exec_command', status: 'done', output: `output-${id}`, diagnostics: { transient: false } }] });
      expect(f.events.at(-1).tool_call_id).toBe(id);
      expect(f.events.at(-1).output_preview).toBe(`output-${id}`);
    }
    f.frame({ generation: { attempt: 0 } });
    expect(f.events.at(-1).tool_call_id).toBe('three');
    expect(f.events.at(-1).last_activity).toBe(true);
    const count = f.events.length;
    f.frame({ generation: { attempt: 0 } });
    expect(f.events.length).toBe(count);
  } finally { f.db.close(); }
});

test('a new optimiser receipt refreshes live activity without announcing a tool call', () => {
  const f = fixture();
  try {
    f.frame({ generation: { attempt: 0 } });
    f.entries.push({ id: 12, kind: 'piclaw.token-optimizer.operation', data: { id: 'receipt' } });
    f.frame({ generation: { attempt: 0 } });
    expect(f.events.at(-1)).toMatchObject({ type: 'thinking', optimizer_activity_entry: 12, active_tool_count: 0 });
    expect(f.events.at(-1)).not.toHaveProperty('tool_call_id');
    const count = f.events.length;
    f.frame({ generation: { attempt: 0 } });
    expect(f.events.length).toBe(count);
  } finally { f.db.close(); }
});

test('a live nested tool stays current when an older native slot disappears', () => {
  const f = fixture();
  try {
    f.frame({ tools: [{ callId: 'one', name: 'exec_command', status: 'running' }] });
    f.complete('one', 'old output');
    f.frame({ tools: [{ callId: 'one', name: 'exec_command', status: 'done', output: 'old output', diagnostics: { done: true } }] });
    f.frame({ tools: [{ callId: 'parent', name: 'codemode', status: 'running' }], nestedTools: [
      { callId: 'parent/read', parentCallId: 'parent', name: 'read', arguments: { path: 'new-file' }, status: 'running', output: 'new output' },
    ] });
    expect(f.events.at(-1).tool_call_id).toBe('parent/read');
    expect(f.events.at(-1).active_tool_count).toBe(2);
    expect(f.events.at(-1).output_preview).toBe('new output');
    expect(f.events.at(-1).tool_name).toBe('read');
    expect(f.events.at(-1).tool_args).toEqual({ path: 'new-file' });
  } finally { f.db.close(); }
});
