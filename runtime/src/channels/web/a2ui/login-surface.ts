/** Host-authored login surfaces: only safe controls are durable; action bindings are process-local. */
import { getChatJid } from '../../../core/chat-context.js';
import { CLASSIC_A2UI_CATALOG, type A2uiComponent, type A2uiSurfaceBlock } from './surface.js';

type Field = { key: string; label: string; placeholder?: string } & (
  | { options: { label: string; value: string }[] }
  | { value?: string; private?: boolean }
);
type LoginAction = {
  id: string; label: string; step: 'step1' | 'step1method' | 'step2' | 'step3'; data?: Record<string, string>;
  privateField?: 'auth_value' | 'apiKey';
};
const bindings = new Map<string, { chatJid: string; expires: number; actions: Map<string, LoginAction>; choices: Set<string> }>();

export function buildLoginSurface(fallback: string, text: string[], fields: Field[], actions: LoginAction[], expires = Date.now() + 600_000): A2uiSurfaceBlock {
  const surfaceId = crypto.randomUUID();
  const state = new Map<string, unknown>();
  const components: A2uiComponent[] = [];
  const children: string[] = [];
  for (const [i, line] of text.entries()) {
    const id = `text_${i}`;
    children.push(id);
    components.push({ id, component: 'Text', text: line });
  }
  const choices = new Set<string>();
  const context = Object.fromEntries(fields.filter(field => !('private' in field && field.private)).map(field => [field.key, { '@path': `/${field.key}` }]));
  for (const field of fields) {
    const id = `field_${field.key}`;
    children.push(id);
    if ('options' in field) {
      choices.add(field.key);
      state.set(field.key, field.options.length ? [field.options[0].value] : []);
      components.push({ id, component: 'ChoicePicker', label: field.label, options: field.options, value: { '@path': `/${field.key}` } });
    } else {
      if (!field.private) state.set(field.key, field.value ?? '');
      components.push({ id, component: 'TextField', label: field.label, ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.private ? { variant: 'obscured' } : { value: { '@path': `/${field.key}` } }) });
    }
  }
  for (const [i, action] of actions.entries()) {
    const child = `${action.id}_label`;
    children.push(action.id);
    components.push({ id: action.id, component: 'Button', child, variant: i === 0 ? 'primary' : 'default',
      action: { event: { name: `login-${action.id}`, context } } }, { id: child, component: 'Text', text: action.label });
  }
  const now = Date.now();
  for (const [id, value] of bindings) if (value.expires <= now) bindings.delete(id);
  if (actions.length) {
    if (bindings.size >= 128) bindings.delete(bindings.keys().next().value!);
    bindings.set(surfaceId, { chatJid: getChatJid(), expires, choices, actions: new Map(actions.map(action => [action.id, action])) });
    setTimeout(() => bindings.delete(surfaceId), Math.max(0, expires - now)).unref();
  }
  return { type: 'a2ui_surface', owner: 'login', revision: 1, state: actions.length ? 'active' : 'completed', fallback_text: fallback,
    surface: { surfaceId, catalogId: CLASSIC_A2UI_CATALOG, components: [{ id: 'root', component: 'Column', children }, ...components], dataModel: Object.fromEntries(state) } };
}

/** All fixed routing data comes from the initiating host, not from the client. */
export function resolveLoginSurfaceAction(chatJid: string, surfaceId: string, componentId: string) {
  const binding = bindings.get(surfaceId);
  if (!binding || binding.chatJid !== chatJid || Date.now() >= binding.expires) return undefined;
  const action = binding.actions.get(componentId);
  return action ? { ...action, choices: binding.choices } : undefined;
}

export function retireLoginSurface(surfaceId: string): void {
  bindings.delete(surfaceId);
}
