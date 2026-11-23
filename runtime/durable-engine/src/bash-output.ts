// Kintsugi b8469c29 MIT port; attribution in mcp/UPSTREAM-LICENSE.
import {Type} from 'typebox';
import {Value} from 'typebox/value';
const rootBashOutput=Type.Object({output:Type.String(),exit_code:Type.Integer(),truncated:Type.Boolean(),full_output_path:Type.Optional(Type.String())});
const portableBashOutput=Type.Object({output:Type.String(),exitCode:Type.Union([Type.Integer(),Type.Null()]),aborted:Type.Optional(Type.Boolean()),timedOut:Type.Optional(Type.Boolean()),truncated:Type.Optional(Type.Boolean())});
const savedPath=Type.Object({fullOutputPath:Type.String()});
/** JSON-only projection; scripts retain the Root SDK's original snake-case result. */
export function projectBashOutput(structured:unknown,details:unknown){
 const fullOutputPath=Value.Check(savedPath,details)?details.fullOutputPath:'';
 if(Value.Check(rootBashOutput,structured))return{output:structured.output,exitCode:structured.exit_code,truncated:structured.truncated,fullOutputPath:fullOutputPath||structured.full_output_path||'',aborted:false,timedOut:false};
 if(Value.Check(portableBashOutput,structured))return{output:structured.output,exitCode:structured.exitCode,aborted:structured.aborted,timedOut:structured.timedOut,truncated:structured.truncated,fullOutputPath};
 return null;
}
export type SavedOutputRead={status:'available';text:string;truncated:boolean}|{status:'unavailable'};
export type SavedOutputReader=(path:string)=>Promise<SavedOutputRead>;
export function stripTerminalEscapes(text:string){return text.replace(/\x1b\][^\x07]*?(?:\x07|\x1b\\)/g,'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\r/g,'');}
