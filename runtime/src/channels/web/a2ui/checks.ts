import { A2uiExpressionFailure } from './functions.js';
import type { A2uiComponent } from './surface.js';

export interface A2uiCheckFinding {
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export function checkA2uiComponent(component: A2uiComponent, readCondition: (condition:unknown)=>unknown): A2uiCheckFinding[] {
  const rules = component['@checks'];
  if (!Array.isArray(rules)) return [];
  const findings: A2uiCheckFinding[] = [];
  for (const rule of rules.slice(0, 16)) {
    const { condition, message } = rule && typeof rule === 'object' ? rule : {};
    let value: unknown, failure: string | undefined;
    try { value=readCondition(condition); }
    catch (error) {
      if (!(error instanceof A2uiExpressionFailure)) throw error;
      failure=error.message;
    }
    const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    const result = typeof candidate?.valid === 'boolean' ? candidate : undefined;
    if (value === true || result?.valid === true) continue;
    const fallback = typeof message === 'string' ? message : undefined;
    const text = typeof result?.message === 'string' ? result.message : fallback ?? failure;
    findings.push({ message: (text || 'Validation failed').slice(0, 1024),
      severity: result?.severity === 'warning' || result?.severity === 'info' ? result.severity : 'error' });
  }
  return findings;
}
