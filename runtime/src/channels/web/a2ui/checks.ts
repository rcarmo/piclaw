import { a2uiBindingPath, readA2uiValue } from './functions.js';
import type { A2uiComponent, A2uiSnapshot } from './surface.js';

export interface A2uiCheckFinding {
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export function checkA2uiComponent(snapshot: A2uiSnapshot, component: A2uiComponent, edits?: ReadonlyMap<string, unknown>, instance?: { scope: string; instancePath?: string }): A2uiCheckFinding[] {
  const rules = component['@checks'];
  if (!Array.isArray(rules)) return [];
  const findings: A2uiCheckFinding[] = [];
  for (const rule of rules.slice(0, 16)) {
    const { condition, message } = rule && typeof rule === 'object' ? rule : {};
    const value = readA2uiValue(snapshot, condition, edits, instance?.instancePath, instance?.scope);
    const result = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
    if (value === true || result?.valid === true) continue;
    const fallback = typeof message === 'string' ? message : undefined;
    const detail = typeof result?.message === 'string' ? result.message : undefined;
    const text = a2uiBindingPath(condition) !== undefined ? detail ?? fallback : fallback ?? detail;
    findings.push({ message: (text || 'Validation failed').slice(0, 1024),
      severity: result?.severity === 'warning' || result?.severity === 'info' ? result.severity : 'error' });
  }
  return findings;
}
