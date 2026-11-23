import { expect, test } from 'bun:test';
import { RendererRpcBroker, type RendererRpcPacket } from '../../../../src/channels/web/a2ui/renderer-rpc.js';

const scope = {chatJid:'web:rpc',conversationId:17,sessionId:'fixture-session'};
const packet = (functionCallId: string): RendererRpcPacket => ({message:{version:'1.0',callRendererFunction:{functionCallId,
  callFunction:{'@call':'inspectLabel',catalogId:'urn:fixture:rpc'}}}});
const value = (functionCallId: string) => ({version:'1.0' as const,rendererFunctionResponse:{functionCallId,value:null}});

test('only the exact live peer receives the call and can resolve its correlation', async () => {
  const broker = new RendererRpcBroker();
  const sent: RendererRpcPacket[] = [], otherPackets: RendererRpcPacket[] = [];
  const peer = broker.register(scope,() => {},call => sent.push(call),() => {});
  const other = broker.register(scope,() => {},call => otherPackets.push(call),() => {});
  try {
    const hash = broker.bind(peer.lease,scope)!;
    expect(hash).not.toBe(peer.lease);
    expect(broker.bind(peer.lease,{...scope,sessionId:'another-session'})).toBeUndefined();
    const pending = broker.invoke(hash,scope.chatJid,scope.conversationId,packet('one'),() => {});
    expect(sent).toEqual([packet('one')]);
    expect(otherPackets).toEqual([]);
    const metadata={a2uiRendererDataModel:{version:'1.0' as const,surfaces:{fixture:{memo:'private'}}}};
    let projections=0;
    const project=()=>{projections++;return metadata;};
    expect(broker.reply(other.lease,scope,value('one'),project)).toBe(false);
    expect(broker.reply(peer.lease,{...scope,conversationId:18},value('one'),project)).toBe(false);
    expect(projections).toBe(0);
    expect(broker.reply(peer.lease,scope,value('one'),project)).toBe(true);
    expect(await pending).toEqual({message:value('one'),metadata});
    expect(projections).toBe(1);
    expect(broker.reply(peer.lease,scope,value('one'))).toBe(false);
    expect(await broker.invoke(hash,scope.chatJid,scope.conversationId,packet('one'),() => {}))
      .toMatchObject({message:{rendererFunctionResponse:{functionCallId:'one',error:{code:'INVALID_FUNCTION_CALL'}}}});
    expect(sent).toHaveLength(1);
  } finally { peer.disconnect(); other.disconnect(); }
});

test('stale, cancelled, timed out and disconnected calls cannot consume replies', async () => {
  const broker = new RendererRpcBroker(25);
  let live = true, closed = 0;
  const peer = broker.register(scope,() => {},() => {},() => closed++);
  const hash = broker.bind(peer.lease,scope)!;
  const pending = broker.invoke(hash,scope.chatJid,scope.conversationId,packet('stale'),() => {
    if (!live) throw Error('Stale fixture');
  });
  live = false;
  expect(broker.reply(peer.lease,scope,value('stale'))).toBe(false);
  expect(await pending).toMatchObject({message:{rendererFunctionResponse:{error:{code:'INVALID_FUNCTION_CALL'}}}});
  const controller = new AbortController();
  const cancelled = broker.invoke(hash,scope.chatJid,scope.conversationId,packet('cancel'),() => {},controller.signal);
  controller.abort();
  expect(await cancelled).toMatchObject({message:{rendererFunctionResponse:{error:{code:'CANCELLED'}}}});
  expect(await broker.invoke(hash,scope.chatJid,scope.conversationId,packet('timeout'),() => {}))
    .toMatchObject({message:{rendererFunctionResponse:{error:{code:'TIMEOUT'}}}});
  expect(broker.reply(peer.lease,scope,value('timeout'))).toBe(false);
  const lost = broker.invoke(hash,scope.chatJid,scope.conversationId,packet('lost'),() => {});
  peer.disconnect();
  expect(await lost).toMatchObject({message:{rendererFunctionResponse:{error:{code:'CANCELLED'}}}});
  expect(broker.reply(peer.lease,scope,value('lost'))).toBe(false);
  expect(closed).toBe(1);
});
