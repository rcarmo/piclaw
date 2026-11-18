// SPDX-License-Identifier: Apache-2.0
import {Type,type Static} from "typebox";
import {Value} from "typebox/value";
type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export const McpOutputProfileSchema=Type.Object({
  name:Type.String({minLength:1,maxLength:64}),tool:Type.String({minLength:1,maxLength:128,pattern:"^[a-zA-Z0-9_.*-]+$"}),
  kind:Type.Enum(["json-list","browser-snapshot","text"]),path:Type.Optional(Type.String({maxLength:256,pattern:"^[a-zA-Z0-9_.-]*$"})),
  fields:Type.Optional(Type.Array(Type.String({minLength:1,maxLength:128,pattern:"^[a-zA-Z0-9_.-]+$"}),{maxItems:24})),maxItems:Type.Optional(Type.Integer({minimum:1,maximum:20})),
},{additionalProperties:false});
export const McpRecallSettingsSchema=Type.Object({mode:Type.Enum(["off","observe","active"]),maxAgeDays:Type.Integer({minimum:1,maximum:90}),maxItems:Type.Integer({minimum:1,maximum:256}),maxBytes:Type.Integer({minimum:4096,maximum:16*1024*1024}),profiles:Type.Array(McpOutputProfileSchema,{maxItems:32})},{additionalProperties:false});
export type McpOutputProfile=Static<typeof McpOutputProfileSchema>;
export type McpRecallSettings=Static<typeof McpRecallSettingsSchema>;
export const defaultMcpRecallSettings=():McpRecallSettings=>({mode:"off",maxAgeDays:7,maxItems:128,maxBytes:8*1024*1024,profiles:[]});
const fields=["id","key","number","name","title","state","status","url","html_url","path","message","description","body"];
const objectSchema=Type.Record(Type.String(),Type.Unknown());
const object=(value:JsonValue|undefined):value is {[key:string]:JsonValue}=>Value.Check(objectSchema,value);
function at(value:JsonValue,path:string):JsonValue|undefined {
  let item:JsonValue|undefined=value;
  for(const key of path.split(".").filter(Boolean)){
    if(["__proto__","prototype","constructor"].includes(key)||!object(item)||!Object.hasOwn(item,key))return;
    item=item[key];
  }
  return item;
}
function parse(text:string):JsonValue|undefined {
  try{
    // SAFETY: JSON.parse produces only JSON values; property traversal below is own-property-only.
    return JSON.parse(text) as JsonValue;
  }catch{return undefined;}
}
const shortened=(value:JsonValue,max=240)=>{const text=JSON.stringify(value);return text.length<=max?text:text.slice(0,max)+"… [abbreviated]";};
function matches(pattern:string,name:string):boolean {const parts=pattern.split("*");let offset=0;for(const [index,part] of parts.entries()){const found=name.indexOf(part,offset);if(found<0||index===0&&found!==0)return false;offset=found+part.length;}return pattern.endsWith("*")||offset===name.length;}
export type McpSummary={text:string;handler:string;originalBytes:number;reducedBytes:number};
/** Summaries are explicitly incomplete views of tool data, never replacement script values or inferred facts. */
export function summarizeMcpOutput(input:{tool:string;text:string;profiles?:readonly McpOutputProfile[];isError?:boolean}):McpSummary|null {
  const raw=input.text;if(input.isError||raw.length<1600||raw.length>1024*1024)return null;
  const parsed=parse(raw),profile=input.profiles?.find(item=>matches(item.tool,input.tool));
  // Keep failures verbatim rather than guessing which diagnostic lines can be discarded.
  if(object(parsed)&&(parsed.isError===true||Boolean(parsed.error)||Array.isArray(parsed.errors)&&parsed.errors.length>0)||/^(?:\s*)(?:Traceback|(?:\w*Error|Exception):|error\[|error:|warning:)/im.test(raw))return null;
  const kind=profile?.kind??(/snapshot|accessibility/i.test(input.tool)?"browser-snapshot":parsed!==undefined?"json-list":"text");
  let body:string;
  if(kind==="json-list"&&parsed!==undefined){
    const selected=profile?.path?at(parsed,profile.path):parsed;
    const list=Array.isArray(selected)?selected:object(selected)?["items","results","data","issues","nodes","repositories","messages"].map(key=>selected[key]).find(Array.isArray):undefined;
    if(list){
      const visible=list.slice(0,profile?.maxItems??8),selectedFields=profile?.fields??fields;
      body=`Array: ${list.length} items; showing ${visible.length} abbreviated items.\n`+visible.map((item,index)=>{
        if(!object(item))return `${index}: ${shortened(item)}`;
        const parts=selectedFields.flatMap(field=>{const value=at(item,field);return value===undefined?[]:[`${field}: ${shortened(value)}`];});
        return `${index}: ${parts.length?parts.join(" · "):shortened(item,600)}`;
      }).join("\n");
      if(object(selected))body+=`\nTop-level keys: ${Object.keys(selected).slice(0,24).join(", ")}`;
    }else if(object(selected))body=`Object keys: ${Object.keys(selected).slice(0,32).join(", ")}\n`+Object.entries(selected).slice(0,12).map(([key,value])=>`${key}: ${Array.isArray(value)?`array (${value.length} items)`:shortened(value)}`).join("\n");
    else body=shortened(selected??parsed,2000);
  }else if(kind==="browser-snapshot"){
    const lines=raw.split("\n"),important=lines.filter(line=>/\b(?:ref=|https?:\/\/)|^\s*-?\s*(?:heading|button|link|textbox|checkbox|combobox)\b/.test(line));
    body=`Snapshot: ${lines.length} lines. Selected headings/controls/links (abbreviated):\n`+(important.length?important:lines).slice(0,24).map(line=>line.length>240?line.slice(0,240)+"… [abbreviated]":line).join("\n");
  }else {
    const lines=raw.split("\n"),visible=lines.length>16?[...lines.slice(0,10),"… [middle omitted]",...lines.slice(-4)]:lines;
    body=`Text: ${lines.length} lines (abbreviated).\n`+visible.map(line=>line.length>240?line.slice(0,240)+"… [abbreviated]":line).join("\n");
  }
  const text=`MCP tool data — incomplete overview; retrieve the original before relying on omitted details.\n${body.slice(0,5000)}`;
  const originalBytes=new TextEncoder().encode(raw).byteLength,reducedBytes=new TextEncoder().encode(text).byteLength;
  return originalBytes-reducedBytes>=512&&reducedBytes<=originalBytes*.8?{text,handler:profile?`profile:${profile.name}`:`builtin:${kind}`,originalBytes,reducedBytes}:null;
}
