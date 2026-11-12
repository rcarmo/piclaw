import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { bindTimelineLatest, jumpTimelineToLatest } from '../ui/timeline-latest.js';
import { AttachmentPreviewModal } from './attachment-preview-modal.js';
import { BtwPanel } from './btw-panel.js';
import { ComposeBox } from './compose-box.js';
import { FloatingWidgetPane } from './floating-widget-pane.js';
import { AgentRequestModal, AgentStatus } from './status.js';
import { Timeline } from './timeline.js';
import { LiveTurnActivity } from './turn-activity.js';

export interface ChatSurfaceProps {
  [key: string]: any;
}

/**
 * The one production conversation component tree shared by single-user and
 * family modes. Authorization remains in the injected data/action adapters.
 */
export function ChatSurface(props: ChatSurfaceProps) {
  const [latestState, setLatestState] = useState({ away: false, hasNew: false });
  const latestController = useRef<ReturnType<typeof bindTimelineLatest> | null>(null);
  useEffect(() => {
    setLatestState({ away: false, hasNew: false });
    const root = props.timelineRef?.current;
    if (root && props.reverse !== false) {
      const binding = bindTimelineLatest(root, setLatestState); latestController.current = binding;
      binding.noteLatest(Math.max(0, ...(props.posts || []).map(post => Number(post.id) || 0)));
      return () => { binding.dispose(); if (latestController.current === binding) latestController.current = null; };
    }
  }, [props.currentChatJid, props.posts === null, props.reverse]);
  useEffect(() => { latestController.current?.noteLatest(Math.max(0, ...(props.posts || []).map(post => Number(post.id) || 0))); }, [props.posts]);
  const {
    posts,
    currentChatJid,
    hasMore = false,
    onLoadMore,
    timelineRef,
    timelineId,
    onHashtagClick,
    onMessageRef,
    onScrollToMessage,
    onFileRef,
    onPostClick,
    onDeletePost,
    onOpenWidget,
    onOpenAttachmentPreview,
    onSaveAnnotations,
    onSubmitCardAction,
    renderPostAccessory,
    postCapabilities,
    emptyMessage,
    agents,
    user,
    reverse = true,
    removingPostIds,
    searchQuery,
    agentStatus,
    isCompactionStatus = () => false,
    agentDraft,
    agentPlan,
    agentThought,
    pendingRequest,
    intent,
    currentTurnId,
    steerQueued = false,
    onPanelToggle,
    extensionPanels = [],
    pendingExtensionPanelActions = new Set(),
    onExtensionPanelAction,
    btwSession,
    onCloseBtw,
    onRetryBtw,
    onInjectBtw,
    floatingWidget,
    onCloseWidget,
    onWidgetEvent,
    attachmentPreview,
    onCloseAttachmentPreview,
    composeProps = {},
    composeKey,
    composeId,
    onPendingRequestRespond,
    loadStatusWorkspaceBranch,
  } = props;

  // The running turn lives in the timeline (Kintsugi-style); the status row keeps
  // only its compact line, tool icons and git indicators.
  const liveStatus = isCompactionStatus(agentStatus) ? null : agentStatus;
  const liveTurn = reverse !== false && !searchQuery
    ? html`<${LiveTurnActivity} chatJid=${currentChatJid} status=${liveStatus} draft=${agentDraft} thought=${agentThought} turnId=${currentTurnId} />`
    : null;

  return html`
    <${Timeline}
      key=${currentChatJid}
      footer=${liveTurn}
      posts=${posts}
      hasMore=${hasMore}
      onLoadMore=${onLoadMore}
      timelineRef=${timelineRef}
      timelineId=${timelineId}
      onHashtagClick=${onHashtagClick}
      onMessageRef=${onMessageRef}
      onScrollToMessage=${onScrollToMessage}
      onFileRef=${onFileRef}
      onPostClick=${onPostClick}
      onDeletePost=${onDeletePost}
      onOpenWidget=${onOpenWidget}
      onOpenAttachmentPreview=${onOpenAttachmentPreview}
      onSaveAnnotations=${onSaveAnnotations}
      onSubmitCardAction=${onSubmitCardAction}
      renderPostAccessory=${renderPostAccessory}
      postCapabilities=${postCapabilities}
      emptyMessage=${emptyMessage}
      agents=${agents}
      user=${user}
      reverse=${reverse}
      removingPostIds=${removingPostIds}
      searchQuery=${searchQuery}
    />
    <${AgentStatus}
      status=${liveStatus}
      showLivePanels=${false}
      draft=${agentDraft}
      plan=${agentPlan}
      thought=${agentThought}
      pendingRequest=${pendingRequest}
      intent=${intent}
      turnId=${currentTurnId}
      steerQueued=${steerQueued}
      onPanelToggle=${onPanelToggle}
      showExtensionPanels=${false}
      loadWorkspaceBranch=${loadStatusWorkspaceBranch}
    />
    <${BtwPanel}
      session=${btwSession}
      onClose=${onCloseBtw}
      onRetry=${onRetryBtw}
      onInject=${onInjectBtw}
    />
    <${FloatingWidgetPane}
      widget=${floatingWidget}
      onClose=${onCloseWidget}
      onWidgetEvent=${onWidgetEvent}
    />
    ${attachmentPreview && html`
      <${AttachmentPreviewModal}
        mediaId=${attachmentPreview.mediaId}
        info=${attachmentPreview.info}
        onClose=${onCloseAttachmentPreview}
      />
    `}
    <${AgentStatus}
      extensionPanels=${Array.from(extensionPanels)}
      pendingPanelActions=${pendingExtensionPanelActions}
      onExtensionPanelAction=${onExtensionPanelAction}
      turnId=${currentTurnId}
      steerQueued=${steerQueued}
      onPanelToggle=${onPanelToggle}
      showCorePanels=${false}
      loadWorkspaceBranch=${loadStatusWorkspaceBranch}
    />
    <div id=${composeId} class="chat-surface-compose">
      <${ComposeBox} key=${composeKey} ...${composeProps} onJumpToLatest=${reverse ? () => jumpTimelineToLatest(timelineRef?.current) : undefined} timelineAway=${latestState.away} timelineHasNew=${latestState.hasNew} />
    </div>
    <${AgentRequestModal}
      request=${pendingRequest}
      onRespond=${onPendingRequestRespond}
    />
  `;
}
