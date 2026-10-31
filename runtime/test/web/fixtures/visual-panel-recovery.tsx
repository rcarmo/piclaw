import { render } from 'preact';
import { AgentStatusPanel } from '../../../web/static/visual/frontend/src/components/AgentStatusPanel';
const fixture = { snapshot: {status:'idle',data:null} as any, calls: [] as string[], hold: false, release: null as null|(()=>void), branchRelease: null as null|(()=>void) };
(window as any).panelRecovery = fixture;
window.fetch = (async (input: any) => {
 const url=new URL(String(input),location.href);
 if(url.pathname==='/workspace/branch'){await new Promise<void>(resolve=>{fixture.branchRelease=resolve;});return Response.json({branch:'STALE_BRANCH'});}
 if(url.pathname!=='/agent/status')return Response.json({});
 fixture.calls.push(url.searchParams.get('chat_jid')!);
 const snapshot=structuredClone(fixture.snapshot);
 if(fixture.hold){fixture.hold=false;await new Promise<void>(resolve=>{fixture.release=resolve;});}
 return Response.json({status:snapshot,model:null,context:null,metrics:{},errors:[],agent_name:'Fixture'});
}) as typeof fetch;
render(<AgentStatusPanel/>,document.getElementById('root')!);
