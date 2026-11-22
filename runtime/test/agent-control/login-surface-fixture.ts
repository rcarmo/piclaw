import type { AgentControlCommand, AgentControlResult } from '../../src/agent-control/agent-control-types.js';
import { resolveLoginSurfaceAction } from '../../src/channels/web/a2ui/login-surface.js';
import { isA2uiSurfaceBlock } from '../../src/channels/web/a2ui/surface.js';

type Login = Extract<AgentControlCommand, {type:'login'}>;
export function loginSubmission(step: NonNullable<Login['interaction']>['step'], data: Record<string, unknown>): Login {
  return { type: 'login', raw: '/login', interaction: { step, data } };
}

/** Domain-only tests exercise the owned state machine without reimplementing HTTP admission. */
export function loginSurfaceData(chatJid: string, result: Pick<AgentControlResult, 'contentBlocks'>, componentId: string): Record<string, string> {
  const block = result.contentBlocks?.find(isA2uiSurfaceBlock);
  const data = block && resolveLoginSurfaceAction(chatJid, block.surface.surfaceId, componentId)?.data;
  if (!data) throw Error(`Missing login fixture action: ${componentId}`);
  return { ...data };
}
