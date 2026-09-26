import {
  useAppShellEnvironmentEffects,
} from './app-shell-environment-effects.js';
import {
  useComposeReferenceOrchestration,
  type ComposeReferenceActions,
  type RemoveFileReferenceRef,
  type UseComposeReferenceOrchestrationOptions,
} from './app-compose-reference-orchestration.js';
import {
  useAgentActivityOrchestration,
} from './app-agent-activity-orchestration.js';
import {
  useChatPaneRuntimeOrchestration,
} from './app-chat-pane-runtime-orchestration.js';
import {
  useAgentRecoveryCallbacks,
  useViewStateRefSync,
} from './app-runtime-callbacks.js';

type RefBox<T> = { current: T };

export function bindComposeReferenceRemoval(options: {
  removeFileRefRef: RemoveFileReferenceRef;
  composeReferenceActions: Pick<ComposeReferenceActions, 'removeFileRef'>;
}) {
  const {
    removeFileRefRef,
    composeReferenceActions,
  } = options;

  removeFileRefRef.current = composeReferenceActions.removeFileRef;
}

export interface MainInteractionComposeReferences { composeReferenceActions: ComposeReferenceActions }

export function composeMainInteractionResult(options: {
  applyBranding: (...args: any[]) => any;
  composeReferenceActions: ComposeReferenceActions;
  agentActivity: Record<string, any>;
  chatPaneRuntime: Record<string, any>;
  recoveryCallbacks: Record<string, any>;
}) {
  return {
    applyBranding: options.applyBranding,
    composeReferenceActions: options.composeReferenceActions,
    ...options.agentActivity,
    ...options.chatPaneRuntime,
    recoveryCallbacks: options.recoveryCallbacks,
  };
}

export function useMainAppInteractionComposition(options: {
  environment: Record<string, any>;
  composeReferences: UseComposeReferenceOrchestrationOptions;
  agentActivity: Record<string, any>;
  chatPaneRuntime: Record<string, any>;
  recovery: Record<string, any>;
  viewState: {
    viewStateRef: RefBox<any>;
    currentHashtag: string | null;
    searchQuery: string | null;
    searchOpen: boolean;
  };
  removeFileRefRef: RemoveFileReferenceRef;
}) {
  const {
    environment,
    composeReferences,
    agentActivity,
    chatPaneRuntime,
    recovery,
    viewState,
    removeFileRefRef,
  } = options;

  const { applyBranding } = useAppShellEnvironmentEffects(environment);
  const composeReferenceActions = useComposeReferenceOrchestration(composeReferences);
  bindComposeReferenceRemoval({
    removeFileRefRef,
    composeReferenceActions,
  });

  const activityState = useAgentActivityOrchestration(agentActivity);
  const chatPaneRuntimeState = useChatPaneRuntimeOrchestration({
    ...chatPaneRuntime,
    clearLastActivityTimer: activityState.clearLastActivityTimer,
  });
  const recoveryCallbacks = useAgentRecoveryCallbacks(recovery);

  useViewStateRefSync(viewState);

  return composeMainInteractionResult({
    applyBranding,
    composeReferenceActions,
    agentActivity: activityState,
    chatPaneRuntime: chatPaneRuntimeState,
    recoveryCallbacks,
  });
}
