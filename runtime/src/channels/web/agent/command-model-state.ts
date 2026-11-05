import type { AgentControlResult } from '../../../agent-control/agent-control-types.js';
import type { WebChannelLike } from '../core/web-channel-contracts.js';

/** Model/context metadata only. Execution state comes from the SDK watch. */
export async function resolveAndBroadcastModelStateForCommand(
  channel: Pick<WebChannelLike, 'agentPool' | 'broadcastEvent'>,
  chatJid: string,
  result: AgentControlResult,
) {
  let model = typeof result.model_label === 'string' ? result.model_label : null;
  let thinkingLevel = typeof result.thinking_level === 'string' ? result.thinking_level : null;
  let thinkingLevelLabel = typeof result.thinking_level_label === 'string' ? result.thinking_level_label : null;
  let supportsThinking: boolean | undefined;
  try {
    const current = await channel.agentPool.getAvailableModels(chatJid);
    model ??= current.current ?? null;
    thinkingLevel ??= current.thinking_level ?? null;
    thinkingLevelLabel ??= current.thinking_level_label ?? thinkingLevel;
    supportsThinking = current.supports_thinking;
  } catch {
    model ??= await channel.agentPool.getCurrentModelLabel(chatJid).catch(() => null);
  }
  channel.broadcastEvent('model_changed', {
    chat_jid: chatJid, model, thinking_level: thinkingLevel,
    thinking_level_label: thinkingLevelLabel ?? thinkingLevel, supports_thinking: supportsThinking,
  });
  return { model, thinkingLevel, thinkingLevelLabel: thinkingLevelLabel ?? thinkingLevel, supportsThinking };
}
