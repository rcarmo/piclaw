// Ported from rcarmo/kintsugi b8469c29; MIT — see UPSTREAM-LICENSE.
import {Type,type Static} from "typebox";

export const mcpIdentitySchema=Type.String({pattern:"^[a-zA-Z0-9_-]{1,128}$"});
export const mcpAccessSchema=Type.Union([
  Type.Object({kind:Type.Literal("all")},{additionalProperties:false}),
  Type.Object({kind:Type.Literal("workspaces"),grants:Type.Array(Type.Object({workspaceId:mcpIdentitySchema,agentIds:Type.Union([Type.Literal("all"),Type.Array(mcpIdentitySchema,{minItems:1,maxItems:100})])},{additionalProperties:false}),{minItems:1,maxItems:100})},{additionalProperties:false}),
]);
export type McpAccess=Static<typeof mcpAccessSchema>;
export type McpWorkspaceGrant=Extract<McpAccess,{kind:"workspaces"}>["grants"][number];
interface McpAccessOwner {workspaceId:string;agentIds:string[];access?:McpAccess;enabled:boolean}
/** Legacy fields remain the credential/stdio anchor; an explicit access policy owns authorisation. */
export function mcpAccess(owner:McpAccessOwner):McpAccess {
  return owner.access??{kind:"workspaces",grants:[{workspaceId:owner.workspaceId,agentIds:owner.agentIds.length?[...owner.agentIds]:"all"}]};
}
export function canonicalMcpAccess(access:McpAccess):McpAccess {
  return access.kind==="all"?{kind:"all"}:{kind:"workspaces",grants:access.grants.map(grant=>({workspaceId:grant.workspaceId,agentIds:grant.agentIds==="all"?"all":[...new Set(grant.agentIds)].sort()} satisfies McpWorkspaceGrant)).sort((a,b)=>a.workspaceId.localeCompare(b.workspaceId))};
}
export function mcpWorkspaceAllowed(owner:McpAccessOwner,workspaceId:string):boolean {
  const access=mcpAccess(owner);
  return owner.enabled&&(access.kind==="all"||access.grants.some(grant=>grant.workspaceId===workspaceId));
}
export function mcpAgentAllowed(owner:McpAccessOwner|undefined,workspaceId:string,agentId:string):boolean {
  if(!owner?.enabled)return false;
  const access=mcpAccess(owner);
  return access.kind==="all"||access.grants.some(grant=>grant.workspaceId===workspaceId&&(grant.agentIds==="all"||grant.agentIds.includes(agentId)));
}
export function mcpAccessOverlaps(left:McpAccessOwner,right:McpAccessOwner):boolean {
  const a=mcpAccess(left),b=mcpAccess(right);
  return a.kind==="all"||b.kind==="all"||a.grants.some(grant=>b.grants.some(other=>other.workspaceId===grant.workspaceId));
}
