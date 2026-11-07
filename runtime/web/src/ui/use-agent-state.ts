import { useRef, useState } from '../vendor/preact-htm.js';

export function useAgentState() {
  const [agentStatus, setAgentStatus] = useState(null);
  const [agentDraft, setAgentDraft] = useState({ text: '', totalLines: 0 });
  const [agentPlan, setAgentPlan] = useState('');
  const [agentThought, setAgentThought] = useState({ text: '', totalLines: 0 });
  const [pendingRequest, setPendingRequest] = useState(null);
  const [currentTurnId, setCurrentTurnId] = useState(null);
  const [steerQueuedTurnId, setSteerQueuedTurnId] = useState(null);

  const lastAgentEventRef = useRef(null);
  const lastSilenceNoticeRef = useRef(0);
  const isAgentRunningRef = useRef(false);
  const draftBufferRef = useRef('');
  const thoughtBufferRef = useRef('');
  const previewResyncGenerationRef = useRef(0);
  const pendingRequestRef = useRef(null);
  const stalledPostIdRef = useRef(null);
  const currentTurnIdRef = useRef(null);
  const steerQueuedTurnIdRef = useRef(null);
  const thoughtExpandedRef = useRef(false);
  const draftExpandedRef = useRef(false);

  return {
    agentStatus,
    setAgentStatus,
    agentDraft,
    setAgentDraft,
    agentPlan,
    setAgentPlan,
    agentThought,
    setAgentThought,
    pendingRequest,
    setPendingRequest,
    currentTurnId,
    setCurrentTurnId,
    steerQueuedTurnId,
    setSteerQueuedTurnId,
    lastAgentEventRef,
    lastSilenceNoticeRef,
    isAgentRunningRef,
    draftBufferRef,
    thoughtBufferRef,
    previewResyncGenerationRef,
    pendingRequestRef,
    stalledPostIdRef,
    currentTurnIdRef,
    steerQueuedTurnIdRef,
    thoughtExpandedRef,
    draftExpandedRef,
  };
}
