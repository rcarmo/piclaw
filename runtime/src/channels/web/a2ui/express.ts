/** Server-side compiler and admission policy. Never bundle the parser into Classic. */
import {
  ExpressParser,
  RendererState,
} from "@a2ui/agent";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import { MessageProcessor } from '@a2ui/web_core/processing';
import { CLASSIC_A2UI_FUNCTIONS, isClassicValueFunction } from "./functions.js";
import { isA2uiContextExpression, isClassicEntityName, isClassicFunctionName, mapA2uiActionExpressions, readClassicActionFunction } from './function-call.js';
import { absoluteA2uiPointer, scopedA2uiPointer } from "./data-path.js";
import { isA2uiEventString } from './rpc-json.js';
import { ClassicA2uiValidationError } from './protocol-errors.js';
import { a2uiChildReferences, overlayA2uiModel, projectA2uiTemplates, readA2uiTemplate } from "./templates.js";
import { CLASSIC_A2UI_CATALOG, CLASSIC_A2UI_PROPERTIES, a2uiSliderRange, readA2uiLink, readA2uiLinkTarget, type A2uiComponent, type A2uiSnapshot } from "./surface.js";

const MAX_SOURCE_BYTES = 16_384;
const MAX_SURFACE_BYTES = 32_768;
const MAX_COMPONENTS = 96;
const MAX_MESSAGES = 32;
const MAX_DEPTH = 24;
const ID = /^[\p{ID_Start}\p{ID_Continue}_-][\p{ID_Continue}_.-]{0,127}$/u;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const encoder = new TextEncoder();
const catalog = basicCatalog.withEntries(
  [...basicCatalog.components.values()].filter(component=>Object.hasOwn(CLASSIC_A2UI_PROPERTIES,component.name)),
  [...basicCatalog.functions.values()].filter(fn=>CLASSIC_A2UI_FUNCTIONS.includes(fn.name)),
);

/** Classic checks all component types itself. Undefined wire functions can route to the agent. */
class ClassicWireProcessor extends MessageProcessor {
  override processMessages(...[messages, context]: Parameters<MessageProcessor['processMessages']>): void {
    super.processMessages(messages, {...context,validationConfig:{...context?.validationConfig,allowUnknownElements:true}});
  }
}

function requireClassic(condition: unknown, reason: string, path?: string, code?: 'UNALLOWED_PARENT' | 'UNALLOWED_CHILD'): asserts condition {
  if (!condition) throw new ClassicA2uiValidationError(reason, path, code);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value) && !FORBIDDEN_KEYS.has(value);
}

function isSurfaceId(value: unknown): value is string {
  // Surface identities are opaque strings, not catalogue identifiers.
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function checkPath(value: unknown, allowRoot = false): void {
  requireClassic(typeof value === 'string' && value.length <= 256 && absoluteA2uiPointer(value, allowRoot), "unsupported data path");
}

function checkJson(value: unknown, depth = 0, opaqueMetadata = false): void {
  requireClassic(depth <= MAX_DEPTH, "too deeply nested");
  if (value === null || typeof value === "boolean" || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return;
  if (Array.isArray(value)) {
    requireClassic(value.length <= MAX_COMPONENTS, "array too large");
    for (const item of value) checkJson(item, depth + 1, opaqueMetadata);
    return;
  }
  requireClassic(record(value), "expected JSON values");
  const entries = Object.entries(value);
  requireClassic(entries.length <= MAX_COMPONENTS, "object too large");
  for (const [key, item] of entries) {
    if (!opaqueMetadata) requireClassic(!FORBIDDEN_KEYS.has(key), 'unsupported key');
    checkJson(item, depth + 1, opaqueMetadata || key === 'metadata' || key === '@metadata');
  }
}

function checkMetadata(value: unknown): void {
  if (value === undefined) return;
  requireClassic(record(value) && allowedKeys(value, ['extensions']), 'invalid extension metadata');
  requireClassic(value.extensions === undefined || (record(value.extensions) && Object.keys(value.extensions).every(key =>
    /^[\p{XID_Start}_][\p{XID_Continue}]*$/u.test(key))), 'invalid extension identifier');
}

function containsCall(value: unknown, name?: string): boolean {
  if (Array.isArray(value)) return value.some(item => containsCall(item, name));
  return record(value) && ((Object.hasOwn(value, '@call') && (name === undefined || value['@call'] === name))
    || Object.values(value).some(item => containsCall(item, name)));
}

function checkArgumentNames(args: unknown) {
  requireClassic(args===undefined || (record(args) && Object.keys(args).every(isClassicEntityName)), 'invalid function arguments');
}

function checkValueCalls(value: unknown, allowRemote = false): void {
  if (Array.isArray(value)) return value.forEach(item=>checkValueCalls(item,allowRemote));
  if (!record(value)) return;
  if (Object.hasOwn(value,'@path')) {
    requireClassic(Object.keys(value).length===1 && scopedA2uiPointer(value['@path'])!==undefined,'unsupported data binding');
    return;
  }
  if (Object.hasOwn(value, '@call')) {
    const name = value['@call'];
    requireClassic((isClassicValueFunction(name) || (allowRemote && isClassicFunctionName(name) && name!=='openUrl'))
      && allowedKeys(value, ['@call', 'args', 'catalogId'])
      && (value.catalogId === undefined || (name !== '@index' && value.catalogId === CLASSIC_A2UI_CATALOG)), 'unsupported function in a value');
    const args = value.args;
    checkArgumentNames(args);
    if (name === '@index' && record(args)) requireClassic(allowedKeys(args, ['offset']) && (args.offset === undefined
      || typeof args.offset === 'number' || (record(args.offset) && (Object.hasOwn(args.offset, '@path') || isClassicValueFunction(args.offset['@call'])
        || (allowRemote && isClassicFunctionName(args.offset['@call']))))), 'invalid @index arguments');
  }
  Object.values(value).forEach(item=>checkValueCalls(item,allowRemote));
}

function checkComponents(value: unknown): asserts value is A2uiComponent[] {
  requireClassic(Array.isArray(value) && value.length <= MAX_COMPONENTS, 'too many components', '/components');
  const componentId=(id:unknown): id is string => isClassicEntityName(id) && !FORBIDDEN_KEYS.has(id);
  const ids = new Set<string>();
  for (const [index, component] of value.entries()) {
    const path = `/components/${index}`;
    requireClassic(record(component) && componentId(component.id) && !ids.has(component.id), 'invalid or duplicate component id', `${path}/id`);
    const name = component.component;
    requireClassic(typeof name === 'string' && Object.hasOwn(CLASSIC_A2UI_PROPERTIES, name), 'unsupported component', `${path}/component`);
    requireClassic(component['@catalogId']===undefined || component['@catalogId']===CLASSIC_A2UI_CATALOG,
      'unsupported component catalogue',`${path}/@catalogId`);
    requireClassic(allowedKeys(component, ["id", "component", "@catalogId", "weight", "@accessibility", "@checks", "@metadata", ...CLASSIC_A2UI_PROPERTIES[name as A2uiComponent["component"]]]), "unsupported component property", path);
    checkMetadata(component['@metadata']);
    const checks = component['@checks'];
    if (checks !== undefined) requireClassic(['Button','TextField','CheckBox','ChoicePicker','Slider','DateTimeInput'].includes(name)
      && Array.isArray(checks) && checks.length <= 16 && checks.every(rule => record(rule) && allowedKeys(rule, ['condition','message'])
        && record(rule.condition) && (Object.hasOwn(rule.condition, '@path') || isClassicFunctionName(rule.condition['@call']))
        && (rule.message === undefined || (typeof rule.message === 'string' && rule.message.length <= 1024))), 'invalid checks');
    const a11y = component['@accessibility'];
    if (a11y !== undefined) requireClassic(record(a11y) && allowedKeys(a11y, ['label', 'description', 'hidden', 'live']), 'invalid accessibility descriptor');
    requireClassic(component.weight === undefined || (typeof component.weight === 'number' && component.weight >= 0), "invalid layout weight");
    for (const [key, value] of Object.entries(component)) {
      if (key === '@metadata') continue;
      const call = key === 'action' ? readClassicActionFunction(value) : undefined;
      if (call) {
        checkArgumentNames(call.args);
        checkValueCalls(call.args,call.name!=='openUrl');
      } else if (key==='action') {
        mapA2uiActionExpressions(value,part=>{ checkValueCalls(part,true); return part; });
      } else checkValueCalls(value,true);
    }
    ids.add(component.id);
    if (name === "Row" || name === "Column" || name === "List") {
      const template = readA2uiTemplate(component.children);
      requireClassic((Array.isArray(component.children) && component.children.every(componentId)) ||
        (template && componentId(template.componentId) && scopedA2uiPointer(template.path) !== undefined), "invalid child list or template");
    }
    if (name === "Tabs") {
      requireClassic(Array.isArray(component.tabs) && component.tabs.length > 0 && component.tabs.every(tab =>
        record(tab) && allowedKeys(tab, ["title", "child"]) && componentId(tab.child)), "invalid tabs");
    }
    if (name === "Modal") requireClassic(componentId(component.trigger) && componentId(component.content), "invalid modal references");
    if (name === 'Button' || name === 'Card') requireClassic(componentId(component.child),'invalid child reference',`${path}/child`);
    if (name === "Slider") requireClassic(a2uiSliderRange(component as A2uiComponent), "invalid slider interval");
    if (name === "Button") {
      const { action } = component;
      const target = readA2uiLinkTarget(action);
      if (target !== undefined) {
        requireClassic(typeof target === 'string' ? !!readA2uiLink(action) : record(target) &&
          (Object.hasOwn(target, '@path') || isClassicValueFunction(target['@call'])), 'unsafe or invalid link target');
        continue;
      }
      const call = readClassicActionFunction(action);
      if (call) {
        requireClassic(call.name !== 'openUrl', 'unsafe or invalid link target');
        continue;
      }
      requireClassic(record(action) && allowedKeys(action, ["event"]) && record(action.event)
        && allowedKeys(action.event, ["name", "context", "userMessage"]) && isA2uiEventString(action.event.name), "expected a server event");
      const { context } = action.event;
      requireClassic(context===undefined || (record(context) && Object.keys(context).every(isA2uiEventString)
        && Object.values(context).every(value=>!record(value) || isA2uiContextExpression(value)
          || Object.keys(value).every(key=>!/^@([^@]|$)/.test(key)))), 'unsupported event context');
    }
  }
}

/** Compile the upstream DSL (bare tool source); compilation alone never grants admission. */
export function compileA2uiExpress(source: string, surfaceId: string): unknown[] {
  requireClassic(isId(surfaceId), "invalid surface id");
  requireClassic(source.length <= MAX_SOURCE_BYTES && encoder.encode(source).length <= MAX_SOURCE_BYTES, "Express source too large");
  // Bound the grammar's recursion before calling ANTLR. Ignore delimiters in its comments and strings.
  let depth = 0;
  const tokens = /[rR]"""[\s\S]*?"""|"""(?:\\[\s\S]|[^\\])*?"""|[rR]"[^\r\n"]*"|"(?:\\[\s\S]|[^"\\])*"|\/\*[\s\S]*?\*\/|(?:#|\/\/)[^\r\n]*|[()[\]{}]/g;
  for (const [token] of source.matchAll(tokens)) {
    if (token.length !== 1) continue;
    if ("([{".includes(token)) requireClassic(++depth <= MAX_DEPTH, "Express source too deeply nested");
    else if (")]}".includes(token)) depth--;
  }
  return projectComponentEnvelope(new ExpressParser(catalog,surfaceId,'1.0').compile(source),'wire');
}

const surfaceOperations = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"] as const;

export function readA2uiDraftSurfaceId(messages: readonly unknown[]): string | undefined {
  const first = messages[0];
  const source = record(first) && record(first.createSurface) ? first.createSurface.surfaceId : undefined;
  return isSurfaceId(source) ? source : undefined;
}

/** A new publication uses a host-assigned ID. Rebind only the protocol envelope of its single draft surface. */
export function bindA2uiDraftId(messages: readonly unknown[], surfaceId: string): unknown[] {
  requireClassic(messages.length > 0 && messages.length <= MAX_MESSAGES, 'invalid draft batch size');
  const source = readA2uiDraftSurfaceId(messages);
  requireClassic(source, 'first draft message requires a surface ID', '/surfaceId');
  return messages.map(message => {
    requireClassic(record(message), 'invalid draft message');
    const operation = surfaceOperations.find(name => Object.hasOwn(message, name));
    requireClassic(operation, 'unsupported draft operation');
    const body = message[operation];
    requireClassic(record(body) && body.surfaceId === source, 'draft batch targets a different surface');
    return { ...message, [operation]: { ...body, surfaceId } };
  });
}

type EventLiterals = Map<string,Record<string,unknown>>;

/** Adapt @-prefixed descriptors and isolate structured literals from the SDK's recursive expression scan. */
function projectComponentEnvelope(messages:readonly unknown[], destination:'wire' | EventLiterals): unknown[] {
  return structuredClone(messages).map(message => {
    if (!record(message)) return message;
    const body = message.createSurface ?? message.updateComponents;
    if (record(body) && Array.isArray(body.components)) {
      for (const item of body.components) if (record(item)) {
        for (const key of ['catalogId','accessibility','checks','metadata'] as const) {
          const [from,to]=destination==='wire' ? [key,`@${key}`] : [`@${key}`,key];
          if (Object.hasOwn(item,from)) {
            item[to]=item[from];
            delete item[from];
          }
        }
        if (destination!=='wire' && typeof item.id==='string') {
          destination.delete(item.id); // Component updates replace definitions, including prior literals.
          const event=record(item.action) ? item.action.event : undefined;
          if (!record(event) || !record(event.context)) continue;
          const literals=Object.entries(event.context).filter(([,value])=>
            Array.isArray(value) || (record(value) && !isA2uiContextExpression(value)));
          if (!literals.length) continue;
          destination.set(item.id,Object.fromEntries(literals));
          for (const [key] of literals) event.context[key]='';
        }
      }
    }
    return message;
  });
}

/** Apply exactly one owned surface's bounded batch to a detached snapshot. */
export function applyA2uiMessages(surfaceId: string, messages: readonly unknown[], previous?: A2uiSnapshot, allowProgressive = false): A2uiSnapshot | null {
  const progressive = previous ? previous.progressive === true : allowProgressive;
  requireClassic(isSurfaceId(surfaceId) && messages.length > 0 && messages.length <= MAX_MESSAGES, "invalid surface or batch size");
  checkJson(messages);
  requireClassic(encoder.encode(JSON.stringify(messages)).length <= MAX_SURFACE_BYTES, "batch too large");
  const state = progressive ? RendererState.of(new ClassicWireProcessor([catalog])) : new RendererState([catalog]);
  const eventLiterals: EventLiterals=new Map();
  if (previous) {
    requireClassic(previous.surfaceId === surfaceId, "snapshot belongs to another surface");
    // Validate the rehydrated snapshot too and detach the SDK's mutable data model from it.
    verifySnapshot(previous);
    const { progressive: _hostFlag, components, ...body } = previous;
    const restored = state.apply(projectComponentEnvelope([{ version: "1.0", createSurface: {
      ...body, ...(components.length ? { components } : {}),
    } }],eventLiterals));
    if (!progressive) state.checkTopology(restored);
  }

  let exists = !!previous;
  for (const [index, message] of messages.entries()) {
    requireClassic(record(message) && message.version === "1.0", "expected a v1.0 message");
    const operation = surfaceOperations.find((name) => Object.hasOwn(message, name));
    requireClassic(operation && allowedKeys(message, ["version", operation]), "unsupported operation");
    const body = message[operation];
    requireClassic(record(body) && body.surfaceId === surfaceId, "batch targets a different surface");
    if (operation === "createSurface") {
      requireClassic(!exists && index === 0 && (body.catalogId === undefined || body.catalogId === CLASSIC_A2UI_CATALOG)
        && allowedKeys(body, ["surfaceId", "catalogId", "components", "dataModel", "sendDataModel", "metadata"])
        && (body.sendDataModel === undefined || typeof body.sendDataModel === 'boolean'), "unsupported surface creation");
      checkMetadata(body.metadata);
      if (body.components !== undefined) checkComponents(body.components);
      exists = true;
    } else {
      requireClassic(exists, "surface does not exist");
      if (operation === "updateComponents") {
        requireClassic(allowedKeys(body,['surfaceId','components']),'invalid component update');
        checkComponents(body.components);
      }
      if (operation === "updateDataModel") {
        requireClassic(allowedKeys(body, ["surfaceId", "path", "value"]) && Object.hasOwn(body, "value"), "invalid data update");
        if (body.path !== undefined) checkPath(body.path, true);
      }
      if (operation === "deleteSurface") {
        requireClassic(previous && index === messages.length - 1 && allowedKeys(body,['surfaceId']), "delete must finish an existing surface's batch");
        exists = false;
      }
    }
  }
  const touched = state.apply(projectComponentEnvelope(messages,eventLiterals));
  if (!progressive) state.checkTopology(touched);
  if (!exists) return null;

  const result = state.getSurface(surfaceId)!;
  const snapshot: A2uiSnapshot = {
    surfaceId,
    ...(result.defaultCatalog ? { catalogId: CLASSIC_A2UI_CATALOG } : {}),
    ...(progressive ? { progressive: true } : {}),
    ...(result.sendDataModel ? { sendDataModel: true } : {}),
    ...(result.metadata === undefined ? {} : { metadata: result.metadata }),
    components: Array.from(result.componentsModel.values, ({ id, type, properties, metadata }) => {
      const {accessibility,checks,...rest}=properties;
      const literals=eventLiterals.get(id);
      const action=rest.action;
      if (literals && record(action) && record(action.event)) {
        const event=action.event, context=event.context;
        if (record(context)) rest.action={...action,event:{...event,context:{...context,...literals}}};
      }
      return { ...rest, id, component: type, ...(result.defaultCatalog ? {} : { '@catalogId': CLASSIC_A2UI_CATALOG }), ...(accessibility === undefined ? {} : { '@accessibility': accessibility }),
        ...(checks === undefined ? {} : { '@checks': checks }), ...(metadata === undefined ? {} : { '@metadata': metadata }) } as A2uiComponent;
    }),
    // SDK deletion leaves an empty array slot; persisted JSON represents it as null without shifting indices.
    dataModel: JSON.parse(JSON.stringify(result.dataModel.get("/"))),
  };
  verifySnapshot(snapshot);
  return snapshot;
}

/** Apply already validated control edits; use the same pointer and size policy as wire updates. */
export function applyA2uiControlEdits(snapshot: A2uiSnapshot, edits: ReadonlyMap<string, unknown>): A2uiSnapshot {
  if (!edits.size) return snapshot;
  const overlay=overlayA2uiModel(snapshot,edits);
  const updated: A2uiSnapshot={...overlay,dataModel:JSON.parse(JSON.stringify(overlay.dataModel))};
  verifySnapshot(updated);
  return updated;
}

function verifySnapshot(snapshot: A2uiSnapshot): void {
  checkJson(snapshot);
  requireClassic((snapshot.catalogId === undefined || snapshot.catalogId === CLASSIC_A2UI_CATALOG) && record(snapshot.dataModel)
    && encoder.encode(JSON.stringify(snapshot)).length <= MAX_SURFACE_BYTES, "invalid snapshot or snapshot too large");
  checkMetadata(snapshot.metadata);
  // A data-model object is not an expression, even if it has directive-shaped keys.
  checkComponents(snapshot.components);
  const components = new Map(snapshot.components.map((item) => [item.id, item]));
  const componentPaths = new Map(snapshot.components.map((item, index) => [item.id, `/components/${index}`]));
  if (snapshot.progressive) {
    // Buffered definitions are not reachable yet, but still must not contain cycles or unbounded chains.
    const heights = new Map<string, number>();
    const visiting = new Set<string>();
    function height(id: string, depth: number): number {
      requireClassic(depth <= MAX_DEPTH + 1 && !visiting.has(id), 'expected a bounded component tree');
      const known = heights.get(id);
      if (known !== undefined) return known;
      const item = components.get(id);
      if (!item) return 0;
      requireClassic(depth <= MAX_DEPTH, 'expected a bounded component tree');
      visiting.add(id);
      const result = 1 + Math.max(0, ...a2uiChildReferences(item).map(ref => height(ref.id, depth + 1)));
      visiting.delete(id);
      requireClassic(result + depth <= MAX_DEPTH + 1, 'expected a bounded component tree');
      heights.set(id, result);
      return result;
    }
    for (const id of components.keys()) height(id, 0);
  }
  const seen = new Set<string>();
  function walk(id: string, depth: number, canWeight = false, inTemplate = false): void {
    const item = components.get(id);
    if (!item && snapshot.progressive) return;
    requireClassic(item && !seen.has(id) && depth <= MAX_DEPTH, "expected a bounded component tree");
    seen.add(id);
    requireClassic(item.weight === undefined || canWeight, 'layout weight requires a Row or Column parent', `${componentPaths.get(id)}/weight`, 'UNALLOWED_PARENT');
    if (!inTemplate) for (const [key, value] of Object.entries(item)) {
      if (key==='@metadata') continue;
      const check=(part:unknown)=>{ requireClassic(!containsCall(part,'@index'),'@index requires a template instance'); return part; };
      if (key==='action') mapA2uiActionExpressions(value,check);
      else check(value);
    }
    if (item.component === 'Button' && typeof item.child === 'string') {
      const childKind = components.get(item.child)?.component;
      requireClassic((snapshot.progressive && childKind === undefined) || childKind === 'Text' || childKind === 'Icon', 'button labels must be text or icons', `${componentPaths.get(id)}/child`, 'UNALLOWED_CHILD');
    }
    for (const ref of a2uiChildReferences(item)) walk(ref.id, depth + 1, ref.canWeight, inTemplate || ref.template);
  }
  walk("root", 0);
  requireClassic(snapshot.progressive || seen.size === components.size, "unreachable components");
  try { projectA2uiTemplates(snapshot); }
  catch { throw new ClassicA2uiValidationError('Invalid or oversized A2UI template tree', '/components'); }
}
