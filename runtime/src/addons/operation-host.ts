import type { AgentOutput } from "../agent-pool/contracts.js";
import { readAccessConfig } from "../core/config-access.js";
import { readOperationsConfig } from "../core/config-operations.js";
import type { OperationHost,OperationPrincipal,OperationAdmission,OperationExecution,OperationResult } from "./operation-contracts.js";

/** Injectable AgentPool surface keeps operation tests provider-free. */
export interface OperationAgentPool {
  isDurableRuntime?():boolean;
  dispatchAddonOperation?(operationId:string,signal:AbortSignal,expectedInputSequence?:number):Promise<AgentOutput>;
  reconcileAddonOperation?(operationId:string,expectedInputSequence?:number):Promise<AgentOutput|null>;

}
export function authorizeAddonOperation(principal:Readonly<OperationPrincipal>,target:string,action:"admit"|"read"|"cancel"|"request",readConfig=readOperationsConfig):OperationAdmission {
  if (readAccessConfig().mode !== "single-user")
    return { decision: "rejected" };
  const config = readConfig();
  const configured = config.grants.find(
    (g) =>
      g.enabled &&
      g.addonId === principal.addonId &&
      g.principalId === principal.principalId &&
      g.target === target,
  );
  if (!config.enabled || !configured) return { decision: "rejected" };
  if ((action === "admit" || action === 'request') && configured.approvalRequired)
    return { decision: "approval_required" };
  const { revision, allowedTools, timeoutMs, maxToolCalls, parentWorkId } =
    configured;
  const grant = {
    revision,
    target,
    allowedTools,
    timeoutMs,
    maxToolCalls,
    parentWorkId,
  };
  return { decision: "allow", grant };
}

function operationResult(output:AgentOutput):OperationResult{
  if(output.status==='error'){
    if(output.failureCategory==='aborted')return{status:'cancelled',reason:'executor_cancelled'};
    return{status:'failed',reason:output.failureCategory==='timeout'?'execution_timeout':'execution_failed'};
  }
  if(output.requiresToolEnabledContinuation)return{status:'input_required',reason:'continuation_required'};
  return{status:'completed',output:output.result||''};
}

export function createOperationHost(
  pool: OperationAgentPool,
  readConfig = readOperationsConfig,
): OperationHost {
  const host: OperationHost = {
    authorize: (principal,target,action) => authorizeAddonOperation(principal,target,action,readConfig),
    async execute(input) {
      if(pool.isDurableRuntime?.()!==true || !pool.dispatchAddonOperation)throw Error('Native add-on execution unavailable');
      const output=await pool.dispatchAddonOperation(input.operationId,input.signal,input.inputSequence);
      return operationResult(output);
    },
  };
  if(pool.isDurableRuntime?.()===true)host.recover=async(input:OperationExecution)=>{
    if(!pool.reconcileAddonOperation)throw Error('Native add-on recovery unavailable');
    const output=await pool.reconcileAddonOperation(input.operationId,input.inputSequence);
    return output===null?null:operationResult(output);
  };
  return host;
}
