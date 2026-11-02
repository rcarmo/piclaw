import {expect,test,spyOn} from 'bun:test';
import '../../helpers.js';
import {UiBridge} from '../../../src/channels/web/theming/ui-bridge.js';
import {handleAgentRespondRequest,type UiEndpointsContext} from '../../../src/channels/web/endpoints/ui-endpoints.js';

function fixture() {
  const events: {type:string;payload:any}[]=[];
  const bridge = new UiBridge({broadcastEvent:(type,payload)=>{events.push({type,payload});}});
  const respond = (payload:unknown) => handleAgentRespondRequest(new Request('https://example.test/agent/respond',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),
  }),{json:(payload:unknown,status=200)=>Response.json(payload,{status}),handleUiResponse:bridge.handleUiResponse.bind(bridge)} as UiEndpointsContext);
  return {events,bridge,respond};
}

test('workspace opener requires acknowledgement and reports UI timeout', async () => {
  const {events,bridge}=fixture(); let expire!:()=>void;
  const originalSetTimeout=globalThis.setTimeout;
  const timer=spyOn(globalThis,'setTimeout').mockImplementation(((callback:()=>void,ms:number)=>{
    expect(ms).toBe(15000);expire=callback;return originalSetTimeout(()=>{},60000);
  }) as typeof setTimeout);
  try {
    const result=bridge.openWorkspaceFile('web:default','diagram.drawio','Diagram');
    const pending=[...bridge.pendingUiRequests.values()][0]!;clearTimeout(pending.timeoutId);
    expect(events[0]?.payload.options).toEqual({timeout:15000,action:'open_workspace_file',path:'diagram.drawio',label:'Diagram',target:'tab'});
    expire();
    expect(await result).toEqual({ok:false,opened:false,reason:'ui_timeout',detail:'The browser did not confirm opening the workspace file.'});
    expect(bridge.pendingUiRequests.size).toBe(0);expect(events.at(-1)?.type).toBe('extension_ui_timeout');
    for(const value of [null,false,{}, {ok:true,opened:true,target:'tab'}, {ok:false,opened:false,reason:'blocked'}]) {
      const opened=bridge.openWorkspaceFile('web:default','diagram.drawio','Diagram');
      const [id,request]=[...bridge.pendingUiRequests.entries()][0]!;clearTimeout(request.timeoutId);
      bridge.pendingUiRequests.delete(id);request.resolve(value);
      expect(await opened).toEqual(value && typeof value==='object' && 'ok' in value ? value :
        {ok:false,opened:false,reason:'ui_not_opened',detail:'The browser did not confirm opening the workspace file.'});
    }
  } finally {timer.mockRestore();bridge.stop();}
});

test('workspace opener routes real response endpoint ACKs by chat and consumes each request once', async () => {
  const {events,bridge,respond}=fixture();
  try {
    for(const outcome of [{ok:true,opened:true,target:'tab'},{ok:false,opened:false,reason:'blocked'},null]) {
      const opened=bridge.openWorkspaceFile('web:owner','notes/index.md','Notes');
      const request=events.at(-1)!.payload;
      expect(events.at(-1)!.type).toBe('extension_ui_request');expect(request.kind).toBe('custom');expect(request.title).toBe('Custom UI');
      expect(await (await respond({request_id:request.request_id,chat_jid:'web:other',outcome})).json()).toEqual({status:'unknown_request'});
      expect(bridge.pendingUiRequests.size).toBe(1);
      expect(await (await respond({request_id:request.request_id,chat_jid:'web:owner',outcome})).json()).toEqual({status:'ok'});
      expect(await opened).toEqual(outcome??{ok:false,opened:false,reason:'ui_not_opened',detail:'The browser did not confirm opening the workspace file.'});
      expect(await (await respond({request_id:request.request_id,chat_jid:'web:owner',outcome})).json()).toEqual({status:'unknown_request'});
      expect(bridge.pendingUiRequests.size).toBe(0);
    }
    // Preserve the established optional-chat response contract.
    const opened=bridge.openWorkspaceFile('web:owner','notes/index.md','Notes'), request=events.at(-1)!.payload;
    expect(await (await respond({request_id:request.request_id,outcome:{opened:true}})).json()).toEqual({status:'ok'});
    expect(await opened).toEqual({opened:true});
  } finally {bridge.stop();}
});

test('workspace opener stop rejects pending work and clears its timer', async () => {
  const {bridge,respond}=fixture(), clear=spyOn(globalThis,'clearTimeout');
  const opened=bridge.openWorkspaceFile('web:owner','notes/index.md','Notes');
  const result=opened.then(()=>null,error=>error);
  const [id,pending]=[...bridge.pendingUiRequests.entries()][0]!;
  try {
    bridge.stop();expect((await result)?.message).toBe('Web channel stopped');expect(bridge.pendingUiRequests.size).toBe(0);
    expect(clear).toHaveBeenCalledWith(pending.timeoutId);
    expect(await (await respond({request_id:id,outcome:{ok:true}})).json()).toEqual({status:'unknown_request'});
  } finally {clear.mockRestore();}
});

test('workspace opener exposes no legacy SDK context, editor/theme cache or expiry owner', () => {
  const {bridge}=fixture();
  for(const key of ['createUiContext','clearChatState','editorTextByChat','themeByChat','fallbackTheme','chatStateTouchedAtByChat'])
    expect(key in bridge).toBe(false);
});

test('legacy web UI context/fallback modules and synchronous theme export are retired', async () => {
  expect(await Bun.file(new URL('../../../src/channels/web/ui-context.ts',import.meta.url)).exists()).toBe(false);
  expect(await Bun.file(new URL('../../../src/channels/web/theming/theme.ts',import.meta.url)).exists()).toBe(false);
  const state=await import('../../../src/channels/web/ui-state.js');
  expect('setServerUiThemeConfig' in state).toBe(false);
});
