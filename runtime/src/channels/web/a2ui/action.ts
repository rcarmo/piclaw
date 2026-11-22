/** Classic's subset of the v1.0 action message. Owning a post is a separate server check. */
import { a2uiBindingPath, evaluateA2uiValue, hasA2uiAgentFunction, readA2uiValue, type A2uiRemoteValueResolver } from "./functions.js";
export { a2uiBindingPath, readA2uiValue } from "./functions.js";
import { checkA2uiComponent } from "./checks.js";
import { a2uiInstanceId, projectA2uiTemplates } from "./templates.js";
import { a2uiDateTimeDisplay, a2uiDateTimeType, validA2uiDateTime, validA2uiEventTimestamp } from "./date-time.js";
import { a2uiSliderRange, type A2uiComponent, type A2uiMetadata, type A2uiSnapshot } from "./surface.js";
import { boundedRpcJson, readA2uiActionMetadata } from './rpc-json.js';
import type { CanonicalJsonValue } from '../../../service-effects/contracts/common.js';
import { isA2uiActionValue, type A2uiActionValue as ActionValue, type A2uiDraftEdit, type A2uiDraftPatch } from './drafts.js';
export { isA2uiActionValue } from './drafts.js';
import type { ClassicA2uiRendererCapabilities } from './capabilities.js';

export interface A2uiAction {
  surfaceId: string;
  sourceComponentId: string;
  name: string;
  timestamp: string;
  context: Record<string, CanonicalJsonValue>;
  userMessage?: string;
  metadata?: A2uiMetadata;
}

export interface A2uiActionMessage {
  version: "1.0";
  action: A2uiAction;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right || (Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((item, index) => item === right[index]));
}

type Projection = ReturnType<typeof projectA2uiTemplates>;

function eventDescriptor(projection: Projection, sourceComponentId: string, instancePath?: string) {
  const instanceId = a2uiInstanceId(sourceComponentId, instancePath);
  const identity = projection.instances.get(instanceId);
  if (identity?.id !== sourceComponentId || identity.instancePath !== instancePath) throw new Error('Invalid surface action');
  const source = projection.snapshot.components.find(({ id }) => id === instanceId);
  if (source?.component !== "Button" || !record(source.action) || !record(source.action.event)
    || typeof source.action.event.name !== "string") throw new Error("Invalid surface action");
  return { name: source.action.event.name, context: record(source.action.event.context) ? source.action.event.context : {},
    userMessage: source.action.event.userMessage, scope: identity.scope, source };
}

function isInput(component: A2uiComponent): boolean {
  return component.component === "TextField" || component.component === "CheckBox" || component.component === "ChoicePicker"
    || component.component === "Slider" || (component.component === "DateTimeInput" && a2uiDateTimeType(component) !== undefined);
}

function controlForPath(snapshot: A2uiSnapshot, path: string): A2uiComponent | undefined {
  return snapshot.components.find(component => isInput(component) && a2uiBindingPath(component.value) === path);
}

function validControlValue(control: A2uiComponent, value: ActionValue): boolean {
  if (control.component === "DateTimeInput") {
    const type = a2uiDateTimeType(control);
    // Drafts can be incomplete or temporarily outside their reactive bounds.
    // Bounds are checked against the full event edit overlay at admission.
    return !!type && validA2uiDateTime(type,value,undefined,undefined);
  }
  if (control.component === "CheckBox") return typeof value === "boolean";
  if (control.component === "Slider") {
    const range = a2uiSliderRange(control);
    if (typeof value !== "number" || !range || value < range.min || value > range.max) return false;
    if (range.step === undefined) return true;
    const snapped = range.min + Math.round((value - range.min) / range.step) * range.step;
    const rounding = 4 * Number.EPSILON * Math.max(Math.abs(range.min), Math.abs(range.max));
    return Math.abs(value - snapped) <= Math.min(rounding, range.step / 4);
  }
  if (control.component === "ChoicePicker") {
    return Array.isArray(value) && (control.variant === "multipleSelection" || value.length <= 1)
      && new Set(value).size === value.length && Array.isArray(control.options)
      && value.every((selected) => (control.options as unknown[]).some((option) => record(option) && option.value === selected));
  }
  return typeof value === "string" && (control.variant !== "number" || value === "" || /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value));
}

function resolveDraftEdits(projection: Projection, drafts: readonly A2uiDraftEdit[]): Map<string, unknown> {
  const values = new Map<string, unknown>();
  for (const draft of drafts) {
    const id = a2uiInstanceId(draft.component_id, draft.instance_path);
    const identity = projection.instances.get(id);
    const control = projection.snapshot.components.find(item => item.id === id);
    const path = control && isInput(control) ? a2uiBindingPath(control.value) : undefined;
    if (!control || !path || identity?.id !== draft.component_id || identity.instancePath !== draft.instance_path || values.has(path)
      || !validControlValue(control,draft.value)) throw Error('Invalid draft control');
    values.set(path, draft.value);
  }
  return values;
}

export function validateA2uiDraftEdits(snapshot: A2uiSnapshot, drafts: readonly A2uiDraftEdit[]): Map<string, unknown> {
  return resolveDraftEdits(projectA2uiTemplates(snapshot), drafts);
}

function defaultControlValue(component: A2uiComponent | undefined): ActionValue {
  if (component?.component === "CheckBox") return false;
  if (component?.component === "ChoicePicker") return [];
  if (component?.component === "Slider") return a2uiSliderRange(component)?.min ?? null;
  return component ? "" : null;
}

export type A2uiDerivedResolver = (site:string)=>A2uiRemoteValueResolver | undefined;

function readActionValue(snapshot: A2uiSnapshot, descriptor: unknown, edits: ReadonlyMap<string,unknown>, instancePath: string | undefined,
  scope: string, remote?: A2uiRemoteValueResolver): unknown {
  return evaluateA2uiValue(snapshot,descriptor,edits,instancePath,scope,remote);
}

function resolveUserMessage(snapshot: A2uiSnapshot, descriptor: unknown, edits: ReadonlyMap<string, unknown>, instancePath: string | undefined, scope: string, remote?: A2uiRemoteValueResolver): string | undefined {
  const value = readActionValue(snapshot, descriptor, edits, instancePath, scope, remote);
  if (value === undefined || value === null) return;
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof text !== 'string' || text.length > 4096) throw new Error('Invalid action description');
  return text;
}

export function prepareA2uiActionEvaluation(source: A2uiSnapshot, sourceComponentId: string, edits: ReadonlyMap<string,unknown>, instancePath?: string, drafts: readonly A2uiDraftEdit[] = []) {
  const projection = projectA2uiTemplates(source);
  const { snapshot } = projection;
  const event = eventDescriptor(projection, sourceComponentId, instancePath);
  const contextBindings = Object.entries(event.context);
  const declaredEdits = resolveDraftEdits(projection, drafts);
  for (const [, binding] of contextBindings) {
    const path = a2uiBindingPath(binding);
    const control = path ? controlForPath(snapshot, path) : undefined;
    if (path && control) declaredEdits.set(path, readA2uiValue(snapshot, binding, edits) ?? defaultControlValue(control));
  }
  const derived = contextBindings.map(([key,value])=>({site:`context:${key}`,value}));
  derived.push({site:'userMessage',value:event.userMessage});
  return {projection,event,contextBindings,declaredEdits,derived};
}

export function actionValidationExpressions(evaluation: ReturnType<typeof prepareA2uiActionEvaluation>) {
  const {projection,event,contextBindings,declaredEdits}=evaluation;
  const paths=new Set(contextBindings.map(([,value])=>a2uiBindingPath(value)));
  return projection.snapshot.components.flatMap(component=>{
    const instance=projection.instances.get(component.id);
    if (!instance) return [];
    const path=isInput(component) ? a2uiBindingPath(component.value) : undefined;
    const values: unknown[]=[];
    if ((component===event.source || (path!==undefined && paths.has(path))) && Array.isArray(component['@checks']))
      values.push(...component['@checks'].map(rule=>rule?.condition));
    if (component.component==='DateTimeInput' && path && declaredEdits.has(path) && declaredEdits.get(path)!=='')
      values.push(component.min,component.max);
    return values.filter(hasA2uiAgentFunction).map(value=>({value,instance}));
  });
}

/** Send only context declared by this button. Neither edits nor snapshot leave the browser wholesale. */
export function buildA2uiAction(source: A2uiSnapshot, sourceComponentId: string, edits: ReadonlyMap<string, unknown>, timestamp: string, instancePath?: string, drafts: readonly A2uiDraftEdit[] = [], metadata?: A2uiMetadata, resolveRemote?: A2uiRemoteValueResolver, resolveDerived?: A2uiDerivedResolver): A2uiActionMessage {
  const {projection,event,contextBindings,declaredEdits}=prepareA2uiActionEvaluation(source,sourceComponentId,edits,instancePath,drafts);
  const {snapshot}=projection;
  const context = Object.fromEntries(contextBindings.map(([key, binding]) => {
    const path = a2uiBindingPath(binding);
    const control = path ? controlForPath(snapshot, path) : undefined;
    const value = readActionValue(snapshot,binding,declaredEdits,instancePath,event.scope,resolveDerived?.(`context:${key}`)) ?? defaultControlValue(control);
    return [key,boundedRpcJson(value)];
  }));
  const userMessage = resolveUserMessage(snapshot,event.userMessage,declaredEdits,instancePath,event.scope,resolveDerived?.('userMessage'));
  const message: A2uiActionMessage = { version: "1.0", action: {
    surfaceId: snapshot.surfaceId, sourceComponentId, name: event.name, timestamp, context,
    ...(userMessage === undefined ? {} : {userMessage}),
    ...(metadata === undefined ? {} : {metadata:readA2uiActionMetadata(metadata)}),
  } };
  validateProjectedA2uiAction(projection,message,instancePath,drafts,resolveRemote,resolveDerived);
  return message;
}

/** Re-resolve authority and field constraints from the stored descriptor, not browser declarations. */
export function validateA2uiAction(source: A2uiSnapshot, payload: unknown, instancePath?: string): A2uiAction {
  return validateA2uiActionWithEdits(source, payload, instancePath).action;
}

export function validateA2uiActionWithEdits(source: A2uiSnapshot, payload: unknown, instancePath?: string, drafts?: readonly A2uiDraftEdit[], resolveRemote?: A2uiRemoteValueResolver, resolveDerived?: A2uiDerivedResolver) {
  return validateProjectedA2uiAction(projectA2uiTemplates(source),payload,instancePath,drafts,resolveRemote,resolveDerived);
}

function validateProjectedA2uiAction(projection: Projection, payload: unknown, instancePath?: string, drafts: readonly A2uiDraftEdit[] = [], resolveRemote?: A2uiRemoteValueResolver, resolveDerived?: A2uiDerivedResolver): { action: A2uiAction; edits: ReadonlyMap<string, unknown> } {
  const { snapshot } = projection;
  if (!record(payload) || payload.version !== "1.0" || Object.keys(payload).length !== 2 || !record(payload.action)) {
    throw new Error("Invalid surface action");
  }
  const action = payload.action;
  if (Object.keys(action).length !== 5 + Number(Object.hasOwn(action, 'userMessage')) + Number(Object.hasOwn(action, 'metadata'))
    || action.surfaceId !== snapshot.surfaceId || typeof action.sourceComponentId !== "string"
    || !validA2uiEventTimestamp(action.timestamp)
    || !record(action.context)) throw new Error("Invalid surface action");
  const metadata = readA2uiActionMetadata(action.metadata);
  const event = eventDescriptor(projection, action.sourceComponentId, instancePath);
  if (event.name !== action.name || Object.keys(event.context).length !== Object.keys(action.context).length) {
    throw new Error("Invalid surface action");
  }
  const boundValues = resolveDraftEdits(projection, drafts);
  const submittedPaths = new Set<string>();
  const derived: [string,unknown,CanonicalJsonValue][]=[];
  const context: Record<string,CanonicalJsonValue>={};
  for (const [key, binding] of Object.entries(event.context)) {
    const input = action.context[key];
    const path = a2uiBindingPath(binding);
    const control = path ? controlForPath(snapshot, path) : undefined;
    if (!Object.hasOwn(action.context,key)) throw Error('Invalid form value');
    const canonical=boundedRpcJson(input);
    Object.defineProperty(context,key,{value:canonical,enumerable:true});
    if (!path || !control) derived.push([key,binding,canonical]);
    else {
      if (!isA2uiActionValue(input) || !validControlValue(control, input)) throw new Error('Invalid form value');
      if (boundValues.has(path) && !sameValue(boundValues.get(path), input)) throw new Error("Conflicting form values");
      boundValues.set(path, input);
      submittedPaths.add(path);
    }
  }
  for (const [key,binding,input] of derived) {
    const expected=boundedRpcJson(readActionValue(snapshot,binding,boundValues,instancePath,event.scope,resolveDerived?.(`context:${key}`)) ?? null);
    if (JSON.stringify(input)!==JSON.stringify(expected)) throw Error('Invalid form value');
  }
  for (const component of snapshot.components) {
    const path = isInput(component) ? a2uiBindingPath(component.value) : undefined;
    const instance=projection.instances.get(component.id);
    if (component.component==='DateTimeInput' && path && boundValues.has(path) && boundValues.get(path)!=='') {
      const type=a2uiDateTimeType(component);
      const lower=readActionValue(snapshot,component.min,boundValues,instance?.instancePath,instance?.scope ?? '/',resolveRemote);
      const upper=readActionValue(snapshot,component.max,boundValues,instance?.instancePath,instance?.scope ?? '/',resolveRemote);
      if (!type || (lower!=null && hasA2uiAgentFunction(component.min) && !a2uiDateTimeDisplay(lower,type))
        || (upper!=null && hasA2uiAgentFunction(component.max) && !a2uiDateTimeDisplay(upper,type))
        || !validA2uiDateTime(type,boundValues.get(path),lower,upper)) throw Error('Invalid form value');
    }
    if (component !== event.source && (path === undefined || !submittedPaths.has(path))) continue;
    const error = checkA2uiComponent(component,condition=>evaluateA2uiValue(snapshot,condition,boundValues,instance?.instancePath,instance?.scope,resolveRemote))
      .find(finding=>finding.severity==='error');
    if (error) throw new Error(error.message);
  }
  const userMessage = resolveUserMessage(snapshot,event.userMessage,boundValues,instancePath,event.scope,resolveDerived?.('userMessage'));
  if (userMessage !== action.userMessage) throw new Error('Invalid action description');
  return { edits: boundValues, action: {
    surfaceId: snapshot.surfaceId, name: event.name, sourceComponentId: action.sourceComponentId, timestamp: action.timestamp,
    ...(userMessage === undefined ? {} : {userMessage}), context,
    ...(metadata === undefined ? {} : {metadata}),
  } };
}

/** Piclaw transport metadata is not part of the A2UI protocol message. */
export interface A2uiActionRequest {
  chat_jid: string;
  post_id: number;
  thread_id: number;
  revision: number;
  request_id: string;
  message: A2uiActionMessage;
  instance_path?: string;
  a2ui_drafts?: A2uiDraftPatch[];
  rpc_receipts?: string[];
  rpc_derived_receipts?: Record<string,string[]>;
  renderer_peer?: string;
  metadata?: { a2uiRendererCapabilities: ClassicA2uiRendererCapabilities };
  private_code?: string;
  private_value?: string;
}
