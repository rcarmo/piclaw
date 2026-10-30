import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/utils/canonical-json.js";
import type { Context } from "@earendil-works/chord";
import type { AnyTask, RegistryReader, RegistrySnapshot, TaskDefinition, TaskRuntime } from "@earendil-works/pi-durable";

type Runtime = TaskRuntime<any, any, any, any>;
type Definition = TaskDefinition<any, any, any, any>;
/** Proposed SDK surface: task identity supplied by the scheduler, never by callers. */
export type TaskModelRequestScope = Pick<Runtime, "taskId" | "conversationId" | "signal"> & {
  readonly taskKind: string;
  readonly phase: string;
  /** Logical request identity from the real built-in task checkpoint. It is not
   * authority, dispatch evidence, or a hash of the rendered transport request. */
  readonly checkpointHash?: string;
};
const requests = new AsyncLocalStorage<TaskModelRequestScope>();

export function taskModelRequestScope(signal: AbortSignal | undefined): TaskModelRequestScope | undefined {
  const scope = requests.getStore();
  if (!scope || !signal || scope.signal !== signal) return undefined;
  signal.throwIfAborted();
  return scope;
}

/** HookApi has no public signal. Match its public IDs to the current wrapped
 * generation; never infer a signal from caller options or an unrelated task. */
export function taskModelHookScope(api: Pick<TaskModelRequestScope, "taskId" | "conversationId">): TaskModelRequestScope | undefined {
  const scope = requests.getStore();
  return scope?.taskKind === "pi.generation" && scope.taskId === api.taskId && scope.conversationId === api.conversationId ? scope : undefined;
}

/** TEMPORARY pi-durable 1.4 phase adapter. Replace with an SDK task-bound model-request
 * callback. Uses exported definitions and RegistryReader, without SDK file or
 * persisted-task mutation. Includes checkpoint recovery and every phase entry.
 * Supplies identity only: not dispatch, accounting or exactly-once proof.
 */
export function withTaskModelRequestScope(registry: RegistryReader): RegistryReader {
  const wrapped = new WeakMap<AnyTask, AnyTask>();
  const wrap = (task: AnyTask): AnyTask => {
    const previous = wrapped.get(task);
    if (previous) return previous;
    // RegistryReader intentionally erases task generics. Restore them only at
    // this executable-definition boundary; preserve input/checkpoint/outcomes.
    const definition = task.definition as Definition;
    const phases = Object.fromEntries(Object.entries(definition.phases).map(([phase, execute]) => [phase,
      (record: Parameters<typeof execute>[0], runtime: Runtime, context: Context) => {
        const requestPhase = definition.name === "pi.generation" && phase === "request"
          || definition.name === "pi.compaction" && phase === "summarize";
        const checkpointHash = requestPhase && record?.id === runtime.taskId && record.conversationId === runtime.conversationId
          && record.kind === definition.name && record.version === definition.version && record.state?.status === "running"
          && record.state.checkpoint?.phase === phase
          ? createHash("sha256").update(canonicalJson({ version: 1, kind: definition.name, taskVersion: definition.version,
            input: record.input, checkpoint: record.state.checkpoint })).digest("hex") : undefined;
        return requests.run(Object.freeze({
          taskId: runtime.taskId, conversationId: runtime.conversationId, signal: runtime.signal,
          taskKind: definition.name, phase, ...(checkpointHash ? { checkpointHash } : {}),
        }), () => execute(record, runtime, context));
      },
    ]));
    const result = { ...task, definition: { ...definition, phases } };
    wrapped.set(task, result);
    return result;
  };
  return {
    subscribe: listener => registry.subscribe(listener),
    snapshot() {
      const snapshot = registry.snapshot();
      return new Proxy(snapshot, { get(target, key) {
        if (key === "task") return (name: string) => { const task = target.task(name); return task && wrap(task); };
        if (key === "tasks") return () => target.tasks().map(wrap);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      } }) as RegistrySnapshot;
    },
  };
}
