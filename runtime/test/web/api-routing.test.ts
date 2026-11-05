import { expect, test } from 'bun:test';

import { createReply, getAgents, sendAgentMessage } from '../../web/src/api.ts';

test('web API client uses preferred roster and reply paths', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: string | null }> = [];

  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      method: String(init?.method || 'GET'),
      body: init?.body ? String(init.body) : null,
    });
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await getAgents();
    await createReply(42, 'hello', [7], 'web:branch');
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(calls[0]).toEqual({
    url: '/agent/roster',
    method: 'GET',
    body: null,
  });
  expect(calls[1]).toEqual({
    url: '/post/reply?chat_jid=web%3Abranch',
    method: 'POST',
    body: JSON.stringify({ thread_id: 42, content: 'hello', media_ids: [7] }),
  });
});

test('only message submission preserves an exact committed-input error receipt; no request is retried',async()=>{
  const originalFetch=globalThis.fetch;let calls=0;
  const receipt={accepted:true,thread_id:17,error:'Input saved; SDK admission could not be confirmed.'};
  let body:unknown=receipt;
  globalThis.fetch=(async()=>{calls++;return Response.json(body,{status:503});}) as typeof fetch;
  try{
    expect(await sendAgentMessage('default','Accepted exactly once')).toEqual(receipt);expect(calls).toBe(1);
    await expect(getAgents()).rejects.toMatchObject({status:503,payload:receipt});expect(calls).toBe(2);
    for(const invalid of [{...receipt,thread_id:null},{...receipt,accepted:false}]){
      body=invalid;await expect(sendAgentMessage('default','Not confirmed')).rejects.toMatchObject({status:503,payload:invalid});
    }
    expect(calls).toBe(4);
  }finally{globalThis.fetch=originalFetch;}
});
