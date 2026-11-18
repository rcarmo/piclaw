// Kintsugi b8469c29 MIT port; attribution in mcp/UPSTREAM-LICENSE.
import {defineEntry,defineDoc,type JsonObject} from '@earendil-works/pi-durable';
import type {JsonValue} from '@earendil-works/chord/json';
export type OptimizerCallStart={phase:'start';name:string;arguments?:JsonValue;issuedAt?:number};
export type OptimizerCallEnd={phase:'end';isError:boolean;cancelled:boolean;durationMs?:number;output?:string;error?:string;details?:JsonObject};
export const optimizerCallEntry=defineEntry<{callId:string;key:string}&(OptimizerCallStart|OptimizerCallEnd)>('piclaw.optimizer-call');
export const OptimizerCallReceiptDoc=defineDoc({kind:'piclaw.optimizer-call-receipts',version:1,scope:'task',checkpointWhen:()=>false,initial:():Record<string,boolean>=>({})});
export const McpScriptOutputDoc=defineDoc({kind:'piclaw.mcp-script-output',version:1,scope:'task',checkpointWhen:()=>false,initial:():{calls:Record<string,boolean>;raw:string|null}=>({calls:{},raw:null})});
export type SavedOutputRead={status:'available';text:string;truncated:boolean}|{status:'unavailable'};
export type SavedOutputReader=(path:string)=>Promise<SavedOutputRead>;
export function stripTerminalEscapes(text:string){return text.replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\r/g,'');}
