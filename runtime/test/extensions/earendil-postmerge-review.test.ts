import { expect, test } from 'bun:test';
import { adoptedJsonl } from '../agent-pool/adopted-session-fixture';
import { inspectAdoptedSession } from '../../src/agent-pool/adopted-session';
import { buildSessionContext } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';

test('review: an SDK-valid content edit can remove tool calls without changing stopReason', () => {
  const {rows}=adoptedJsonl('/tmp/adopt', '/tmp/parent');
  const base = rows.slice(0,4);
  const call = { ...rows[4], id:'call', parentId:'user', message:{...rows[4].message,stopReason:'toolUse',content:[{type:'toolCall',id:'tc',name:'read',arguments:{}}]} };
  const result = {type:'message',id:'result',parentId:'call',timestamp:rows[4].timestamp,message:{role:'toolResult',toolCallId:'tc',toolName:'read',content:[{type:'text',text:'result'}],isError:false,timestamp:2}};
  const final = {...rows[4],id:'final',parentId:'result'};
  const entries = [...base,call,result,final,{type:'context_edit',id:'replace',parentId:'final',timestamp:rows[4].timestamp,targetId:'call',replacement:{content:[{type:'text',text:'Tool call summarised'}]}},{type:'context_edit',id:'omit',parentId:'replace',timestamp:rows[4].timestamp,targetId:'result',replacement:null}];
  const sdk=buildSessionContext(entries.slice(1) as any);
  expect(sdk.messages.some(m=>m.role==='assistant' && m.stopReason==='toolUse' && !m.content.some(p=>p.type==='toolCall'))).toBe(true);
  const jsonl=entries.map(r=>JSON.stringify(r)).join('\n')+'\n';
  expect(()=>inspectAdoptedSession(jsonl,createHash('sha256').update(jsonl).digest('hex'))).not.toThrow();
});
