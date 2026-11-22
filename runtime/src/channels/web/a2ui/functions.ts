import { Catalog } from '@a2ui/web_core/catalog';
import { BASIC_FUNCTIONS } from '@a2ui/web_core/catalogs/basic/v1';
import { isSignal, peekValue } from '@a2ui/web_core/reactivity';
import type { DataContext } from '@a2ui/web_core/resolution';
import { readA2uiPath, scopedA2uiPointer } from './data-path.js';
import { CLASSIC_A2UI_CATALOG, type A2uiSnapshot } from './surface.js';

const pureFunctions = BASIC_FUNCTIONS.filter(fn => fn.name !== '@index' && fn.name !== 'openUrl' && !fn.requiresUserActivation);
const pureNames = new Set(pureFunctions.map(fn => fn.name));
const pureCatalog = new Catalog(CLASSIC_A2UI_CATALOG, '1.0', [], pureFunctions);
export const CLASSIC_A2UI_FUNCTIONS = [...pureNames, 'openUrl'];

export function isClassicValueFunction(name: unknown): name is string {
  return typeof name === 'string' && (name === '@index' || pureNames.has(name));
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function a2uiBindingPath(value: unknown): string | undefined {
  return record(value) && Object.hasOwn(value, '@path') && typeof value['@path'] === 'string' ? value['@path'] : undefined;
}

/** Shared, bounded evaluation. Merely rendering a surface cannot invoke an effect or remote call. */
export function readA2uiValue(snapshot: A2uiSnapshot, value: unknown, edits?: ReadonlyMap<string, unknown>, instancePath?: string, scope = '/', asArgument = false): unknown {
  let remaining = 256;
  function evaluate(input: unknown, depth: number, argument = false): unknown {
    if (--remaining < 0 || depth > 24) throw Error('A2UI expression limit exceeded');
    const path = a2uiBindingPath(input);
    if (path !== undefined) {
      const absolute = path.startsWith('/') ? path : scopedA2uiPointer(path, scope);
      if (absolute === undefined) return;
      return edits?.has(absolute) ? edits.get(absolute) : readA2uiPath(snapshot.dataModel, absolute);
    }
    if (record(input) && Object.hasOwn(input, '@call')) {
      const name = input['@call'];
      if (!isClassicValueFunction(name) || (input.catalogId !== undefined && (name === '@index' || input.catalogId !== CLASSIC_A2UI_CATALOG))) return;
      const args = record(input.args) ? Object.fromEntries(Object.entries(input.args).map(([key, arg]) => [key, evaluate(arg, depth + 1, true)])) : {};
      if (name === '@index') {
        if (!instancePath) return;
        const index = Number(instancePath.slice(instancePath.lastIndexOf('/') + 1));
        const offset = typeof args.offset === 'number' && Number.isFinite(args.offset) ? args.offset : 0;
        const result = index + offset;
        return Number.isFinite(result) ? result : undefined;
      }
      if (name === 'formatString' && (typeof args.value !== 'string' || args.value.length > 4096)) return;
      // The SDK only needs the scoped resolver for interpolation. It receives no
      // transport, action dispatcher, or window capability from this adapter.
      const context = {
        surface: { protocolVersion: '1.0' },
        resolveSignal: (part: unknown) => evaluate(part, depth + 1, true),
      } as unknown as DataContext;
      const result = pureCatalog.invoker(name, args, context);
      return isSignal(result) ? peekValue(result) : result;
    }
    if (argument && Array.isArray(input)) return input.map(item => evaluate(item, depth + 1, true));
    if (argument && record(input)) return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, evaluate(item, depth + 1, true)]));
    return input;
  }
  try { return evaluate(value, 0, asArgument); }
  catch { return undefined; }
}
