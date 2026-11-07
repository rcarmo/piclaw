import { h, render, useEffect, useRef, useState } from '../../../web/src/vendor/preact-htm.js';
import { useAgentStatusLifecycle } from '../../../web/src/ui/app-agent-status-lifecycle.js';
import { handleAppSseEvent } from '../../../web/src/ui/app-sse-events.js';
import { ComposeBox } from '../../../web/src/components/compose-box.js';
import { handleMessageResponseRefresh } from '../../../web/src/ui/app-auth-bootstrap.js';
import { isCompactionStatus } from '../../../web/src/ui/status-duration.js';
import { useAgentState } from '../../../web/src/ui/use-agent-state.js';
import { restoreContextUsage } from '../../../web/src/ui/app-status-refresh-orchestration.js';

// Real lifecycle hook, same bundled Preact as Classic. Only transport is gated.
function Fixture() {
  const { agentStatus: status, setAgentStatus: setStatus, agentDraft: draft, setAgentDraft: setDraft,
    agentThought: thought, setAgentThought: setThought, pendingRequest, setPendingRequest,
    pendingRequestRef, draftBufferRef, thoughtBufferRef, currentTurnIdRef } = useAgentState();
  const [connection, setConnection] = useState('connected');
  const agentStatusRef = useRef<any>(null);
  const requests = useRef<Array<(value: any) => void>>([]);
  const contextRequests = useRef<Array<(value: any) => void>>([]);
  const [contextUsage, setContextUsage] = useState(() => restoreContextUsage('web:hook-fixture'));
  const noop = () => {};
  const lifecycle = useAgentStatusLifecycle({
    currentChatJid: 'web:hook-fixture', activeChatJidRef: useRef('web:hook-fixture'),
    queueRefreshGenRef: useRef(0), dismissedQueueRowIdsRef: useRef(new Set()),
    getAgentQueueState: async () => ({}), setFollowupQueueItems: noop, clearQueuedSteerStateIfStale: noop,
    getAgentContext: () => new Promise(resolve => { contextRequests.current.push(resolve); }), setContextUsage, getAutoresearchStatus: null,
    setExtensionStatusPanels: noop, setPendingExtensionPanelActions: noop,
    getAgentStatus: () => new Promise(resolve => { requests.current.push(resolve); }),
    wasAgentActiveRef: useRef(false), viewStateRef: useRef(null), refreshTimeline: async () => {},
    clearAgentRunState: () => {
      agentStatusRef.current = null; currentTurnIdRef.current = null;
      draftBufferRef.current = ''; thoughtBufferRef.current = '';
    },
    agentStatusRef, pendingRequestRef, draftBufferRef, thoughtBufferRef,
    setAgentStatus: next => { agentStatusRef.current = next; setStatus(next); },
    setAgentDraft: setDraft, setAgentPlan: noop, setAgentThought: setThought,
    setPendingRequest, setExtensionWorkingState: noop,
    setActiveTurn: turn => { currentTurnIdRef.current = turn || null; },
    noteAgentActivity: noop, clearLastActivityFlag: noop,
    isAgentRunningRef: useRef(false), currentTurnIdRef,
    silentRecoveryRef: useRef({ inFlight: false, lastAttemptAt: 0, turnId: null }),
    silenceRefreshMs: 2000, lastAgentEventRef: useRef(null), lastSilenceNoticeRef: useRef(0),
    silenceWarningMs: 8000, silenceFinalizeMs: 60000, isCompactionStatus,
    serverVersionContext: {} as any, setConnectionStatus: setConnection, setStateAccessFailed: noop,
    setPendingRequestForConnection: noop, hasConnectedOnceRef: useRef(true),
  });
  const eventRefs = useRef<any>({
    // Kept only for the unchanged-source negative replay of the retired path.
    previewResyncPendingRef: { current: false }, previewResyncGenerationRef: { current: 0 },
    steerQueuedTurnIdRef: { current: null }, thoughtExpandedRef: { current: false }, draftExpandedRef: { current: false },
    draftThrottleRef: { current: 0 }, thoughtThrottleRef: { current: 0 }, viewStateRef: { current: null },
    followupQueueItemsRef: { current: [] }, dismissedQueueRowIdsRef: { current: new Set() },
    scrollToBottomRef: { current: null }, hasMoreRef: { current: false }, loadMoreRef: { current: null },
    lastAgentResponseRef: { current: null }, wasAgentActiveRef: { current: false },
  });
  const event = (type: string, data: any) => handleAppSseEvent(type, data, new Proxy({
    ...eventRefs.current, currentChatJid: 'web:hook-fixture', activeChatJidRef: { current: 'web:hook-fixture' },
    currentTurnIdRef, agentStatusRef, pendingRequestRef, draftBufferRef, thoughtBufferRef,
    setActiveTurn: (turn: string) => { currentTurnIdRef.current = turn; },
    // The setter stays asynchronous; the handler updates its shared projection ref.
    setAgentStatus: setStatus, setPendingRequest,
    // Baseline replay deliberately holds the retired connected-event fetch too.
    getAgentStatus: () => new Promise(resolve => { requests.current.push(resolve); }),
    setAgentDraft: setDraft, setAgentThought: setThought,
    clearAgentRunState: () => { agentStatusRef.current = null; currentTurnIdRef.current = null; },
  }, { get: (target, key) => key in target ? target[key] : noop }) as any);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('compose')) return;
    const source = new EventSource('/fixture-events');
    source.onmessage = message => { const payload = JSON.parse(message.data); event(payload.type, payload.data); };
    source.onopen = () => { (window as any).fixtureSseReady = true; };
    return () => source.close();
  }, []);
  (window as any).statusLifecycleFixture = {
    event,
    async manual(content = '/compact') {
      const response = await fetch('/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      const result = await response.json();
      if (content === '/compact') (window as any).manualDone = true;
      return result;
    },
    refresh: lifecycle.refreshAgentStatus,
    refreshContext: lifecycle.refreshContextUsage,
    connection: lifecycle.handleConnectionStatusChange,
    contextCount: () => contextRequests.current.length,
    releaseContext(index: number, payload: any) { contextRequests.current[index](payload); },
    count: () => requests.current.length,
    release(index: number, payload: any) { requests.current[index](payload); },
  };
  return h('div', {},
    h('output', { id: 'state' }, JSON.stringify({ status, draft, thought, connection, pendingRequest, context: contextUsage })),
    new URLSearchParams(location.search).has('compose') ? h(ComposeBox, {
      currentChatJid: 'web:hook-fixture',
      contextUsage: new URLSearchParams(location.search).has('projection') ? contextUsage : { tokens: 10000, contextWindow: 20000, percent: 50 },
      statusNotice: isCompactionStatus(status) ? status : null,
      isAgentActive: Boolean(status && status.type !== 'error'),
      services: {
        getAgentModels: async () => ({ models: [] }),
        fetchCommands: async () => ({ commands: [] }),
      },
      capabilities: { speech: false, media: false, location: false, notifications: false, modelPicker: false, commands: false },
      onMessageResponse: response => handleMessageResponseRefresh({ response, refreshActiveChatAgents: noop, refreshCurrentChatBranches: noop, refreshContextUsage: noop, refreshAutoresearchStatus: noop, refreshQueueState: noop }),
      onPost: noop,
      onSubmissionStateChange: submitting => { (window as any).manualDone = !submitting; },
    }) : status && status.type !== 'error' ? h('button', { id: 'stop', onClick: () => (window as any).statusLifecycleFixture.manual('/abort') }, 'Stop') : null);

}
render(h(Fixture, {}), document.getElementById('app')!);
