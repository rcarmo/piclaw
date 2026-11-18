// Kintsugi 4afeac1e MIT port; see mcp/UPSTREAM-LICENSE.
import { defineDoc, type LiveState } from "@earendil-works/pi-durable";
import { runIdentity } from "#token-optimizer/pi-durable";

/** A saved Agent plan may outlive a task or be shared by sibling branches. */
export const OptimizerPlanBinding = defineDoc<{revision:number;task:string|null}>({
  kind:"piclaw.optimizer-plan-binding",version:1,scope:"conversation",history:"latest",fork:"initial",
  initial:() => ({revision:0,task:null}),checkpointWhen:() => true,
});

/** Include the latest placed inputs, including new instructions steering a busy run. */
export function optimizerPlanTask(run:LiveState["run"]):string|null {
  if (!run || run.afterRun) return null;
  const identity = runIdentity(run);
  return identity === null ? null : JSON.stringify([identity,run.inputs]);
}
