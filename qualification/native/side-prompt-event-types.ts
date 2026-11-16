// Compile-only regression in the existing qualification type project.
import type { AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { SidePromptOptions } from '../../runtime/src/agent-pool/contracts.js';

type Observer = NonNullable<SidePromptOptions['onEvent']>;
function nativeSideEvents(observer: Observer, event: AssistantMessageEvent) {
  observer(event);
  // @ts-expect-error Native model observers do not receive AgentSession lifecycle events.
  observer({ type: 'agent_start' });
  // @ts-expect-error Compaction session events have no side-model producer.
  observer({ type: 'compaction_start', reason: 'manual' });
  // @ts-expect-error Native deltas require their SDK contentIndex/partial fields.
  observer({ type: 'text_delta', delta: 'synthetic' });
  // @ts-expect-error Native delta text cannot be a number.
  observer({ type: 'text_delta', delta: 42 });
}
void nativeSideEvents;
