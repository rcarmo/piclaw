import { afterEach, expect, test } from 'bun:test';
import { createTempWorkspace, importFresh, setEnv } from '../helpers.js';

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
});

test('server UI state persists theme, tint, meters, and output padding in global extension KV', async () => {
  const ws = createTempWorkspace('piclaw-ui-state-');
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await importFresh<typeof import('../../src/db.js')>('../../src/db.js', import.meta.url);
  db.initDatabase();
  const uiState = await importFresh<typeof import('../../src/channels/web/ui-state.js')>('../../src/channels/web/ui-state.js', import.meta.url);

  expect(await uiState.admitServerUiState({ ui_theme: { theme: 'dracula', tint: '#bd93f9' },
    ui_meters: { enabled: true, collapsed: true }, ui_output: { outputPad: 32 } }, () => {})).toEqual({
    ui_theme: { theme: 'dracula', tint: '#bd93f9' }, ui_meters: { collapsed: true }, ui_output: { outputPad: 24 },
  });

  expect(db.extensionKvGet('piclaw-ui', 'theme', 'global')).toEqual({
    theme: 'dracula',
    tint: '#bd93f9',
  });
  expect(db.extensionKvGet('piclaw-ui', 'meters', 'global')).toEqual({
    collapsed: true,
  });
  expect(db.extensionKvGet('piclaw-ui', 'output-pad', 'global')).toEqual({
    outputPad: 24,
  });
  expect(uiState.getServerUiState()).toEqual({
    ui_theme: { theme: 'dracula', tint: '#bd93f9' },
    ui_meters: { collapsed: true },
    ui_output: { outputPad: 24 },
  });

  db.closeDatabase(); ws.cleanup();
});

for (const mode of ['valid', 'revoked', 'cancelled'] as const) {
  test(`admitted HTTP theme route preserves persistence/event ordering: ${mode}`, async () => {
    const ws = createTempWorkspace('piclaw-ui-http-');
    restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
    const db = await import('../../src/db.js'); db.closeDatabase(); db.initDatabase();
    const state = await import('../../src/channels/web/ui-state.js');
    const { handleAgentRoutes } = await import('../../src/channels/web/http/dispatch-agent.js');
    const before = state.getServerUiThemeConfig(), events: unknown[] = [];
    const controller = new AbortController(); let current = true;
    const principal = {kind:'user',userId:'fixture',mode:'single-user',role:'admin',authentication:{method:'session',sessionId:'fixture'}};
    const channel = {
      authGateway:{isAuthEnabled:()=>true,getPrincipal:()=>current?principal:null},
      json:(payload:unknown,status=200)=>Response.json(payload,{status}),
      broadcastEvent(type:string,payload:unknown) {
        expect(state.getServerUiThemeConfig()).toEqual({theme:'monokai',tint:null});
        events.push({type,payload});
      },
    } as any;
    const req = new Request('https://example.test/agent/ui-state',{method:'POST',signal:controller.signal});
    req.json = async () => {
      if(mode==='revoked') current=false;
      if(mode==='cancelled') controller.abort(Error('fixture cancelled'));
      return {ui_theme:{theme:'monokai',tint:null}};
    };
    try {
      const pending = handleAgentRoutes(channel,req,'/agent/ui-state',new URL(req.url));
      if(mode==='valid') {
        expect(await (await pending)!.json()).toEqual({ok:true,ui_theme:{theme:'monokai',tint:null}});
        expect(events).toEqual([{type:'ui_theme',payload:{theme:'monokai',tint:null}}]);
        const read = await handleAgentRoutes(channel,new Request(req.url),'/agent/ui-state',new URL(req.url));
        expect((await read!.json() as any).ui_theme).toEqual({theme:'monokai',tint:null});
      } else {
        await expect(pending).rejects.toThrow(mode==='revoked'?'principal changed':'fixture cancelled');
        expect(events).toEqual([]);expect(state.getServerUiThemeConfig()).toEqual(before);
      }
    } finally {db.closeDatabase();ws.cleanup();}
  });
}
