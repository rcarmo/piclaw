/** @jsxImportSource preact */

import {html,render as classicRender,useState as classicState} from '../../../web/src/vendor/preact-htm.js';
import {AgentStatus} from '../../../web/src/components/status';

let setClassic:(value:unknown)=>void=()=>{};
(window as any).delegateFixture={emit(detail:unknown){setClassic(detail);window.dispatchEvent(new CustomEvent('piclaw:agent-status',{detail}));},clear(){setClassic(null);window.dispatchEvent(new CustomEvent('piclaw:agent-turn-end'));}};
function Classic(){const[status,setStatus]=classicState<any>(null);setClassic=setStatus;return html`<${AgentStatus} status=${status} turnId="delegate-fixture"/>`;}
classicRender(html`<${Classic}/>`,document.getElementById('app')!);
