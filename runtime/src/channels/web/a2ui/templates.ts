import { absoluteA2uiPointer, readA2uiPath, scopedA2uiPointer } from './data-path.js';
import type { A2uiComponent, A2uiSnapshot } from './surface.js';

export function readA2uiTemplate(value: unknown): { componentId: string; path: string } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) return;
  const template = value as Record<string, unknown>;
  if (typeof template.componentId === 'string' && typeof template.path === 'string') {
    return { componentId: template.componentId, path: template.path };
  }
}

export function a2uiChildReferences(component: A2uiComponent): { id: string; template?: true; canWeight?: boolean }[] {
  const refs: { id: string; template?: true; canWeight?: boolean }[] = [];
  const canWeight = component.component === 'Row' || component.component === 'Column';
  if (Array.isArray(component.children)) for (const id of component.children) refs.push({ id, canWeight });
  const template = readA2uiTemplate(component.children);
  if (template) refs.push({ id:template.componentId, template:true, canWeight });
  if (typeof component.child === 'string') refs.push({ id:component.child });
  if (component.component === 'Tabs' && Array.isArray(component.tabs)) for (const tab of component.tabs) refs.push({ id:tab.child });
  if (component.component === 'Modal') {
    if (typeof component.trigger === 'string') refs.push({id:component.trigger});
    if (typeof component.content === 'string') refs.push({id:component.content});
  }
  return refs;
}

/** Instance paths belong to Piclaw's transport, never to the v1.0 component identifier. */
export function a2uiInstanceId(id: string, instancePath?: string): string {
  return instancePath ? `:${id}:${instancePath}` : id;
}

function scopeBindings(value: unknown, scope: string): unknown {
  if (Array.isArray(value)) return value.map(item => scopeBindings(item, scope));
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  if (Object.hasOwn(item, '@path')) {
    const path = scopedA2uiPointer(item['@path'], scope);
    if (path === undefined) throw Error('Invalid scoped A2UI binding');
    return { '@path': path };
  }
  return Object.fromEntries(Object.entries(item).map(([key, field]) => [key, scopeBindings(field, scope)]));
}

/** Resolve layout and bindings afresh from the committed revision, not from submitted context. */
export function projectA2uiTemplates(snapshot: A2uiSnapshot) {
  const definitions = new Map(snapshot.components.map(component => [component.id, component]));
  const instances = new Map<string, { id: string; scope: string; instancePath?: string }>();
  const projected: A2uiComponent[] = [];
  function walk(id: string, depth: number, scope: string, instancePath?: string): string | undefined {
    const definition = definitions.get(id);
    if (snapshot.progressive && (!definition || (definition.component === 'Button' && !definitions.has(String(definition.child))))) return;
    const instanceId = a2uiInstanceId(id, instancePath);
    if (!definition || depth > 24 || instances.size >= 384 || instances.has(instanceId)) throw Error('Invalid or oversized A2UI template tree');
    instances.set(instanceId, { id, scope, instancePath });
    const { '@metadata': _opaqueMetadata, ...properties } = definition;
    const component: A2uiComponent = { ...scopeBindings(properties, scope) as A2uiComponent, id: instanceId };
    projected.push(component);
    const child = (reference: string) => walk(reference, depth + 1, scope, instancePath);
    const template = readA2uiTemplate(definition.children);
    if (template) {
      const path = scopedA2uiPointer(template.path, scope);
      if (path === undefined) throw Error('Invalid A2UI template path');
      const rows = readA2uiPath(snapshot.dataModel, path);
      component.children = Array.isArray(rows) ? rows.map((_, index) => {
        const rowScope = `${path === '/' ? '' : path}/${index}`;
        if (!absoluteA2uiPointer(rowScope)) throw Error('Invalid A2UI template scope');
        return walk(template.componentId, depth + 1, rowScope, `${instancePath ?? ''}/${index}`);
      }).filter(id => id !== undefined) : [];
    } else if (Array.isArray(component.children)) component.children = component.children.map(child).filter(id => id !== undefined);
    if (typeof component.child === 'string') component.child = child(component.child);
    if (component.component === 'Tabs' && Array.isArray(component.tabs)) {
      component.tabs = component.tabs.map(tab => ({ ...tab, child: child(tab.child) })).filter(tab => tab.child !== undefined);
    }
    if (component.component === 'Modal') {
      if (typeof component.trigger === 'string') component.trigger = child(component.trigger);
      if (typeof component.content === 'string') component.content = child(component.content);
    }
    return instanceId;
  }
  walk('root', 0, '/');
  return { snapshot: { ...snapshot, components: projected }, instances };
}
