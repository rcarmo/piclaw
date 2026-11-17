import { html, render, useEffect, useRef, useState } from '../../../web/src/vendor/preact-htm.js';
import { ChatSurface } from '../../../web/src/components/chat-surface.js';
import { useMainAppTimelineComposition } from '../../../web/src/ui/app-main-timeline-composition.js';
import { runTimelineLoadFlow } from '../../../web/src/ui/app-boot-load-orchestration.js';
import { cacheTimelineSnapshot } from '../../../web/src/ui/app-timeline-cache.js';
import { handleComposePost } from '../../../web/src/ui/app-main-shell-render.js';
import { jumpTimelineToLatest } from '../../../web/src/ui/timeline-latest.js';

const count = Number(new URLSearchParams(location.search).get('count')) || 30;
const posts = (chat: string) => Array.from({ length: count }, (_, index) => ({
  id: (chat === 'a' ? 1000 : chat === 'b' ? 2000 : 3000) + index,
  type: index % 2 ? 'agent' : 'user',
  data: { content: `${chat.toUpperCase()} message ${index + 1}\n\n${'Synthetic message text. '.repeat(14)}`, timestamp: '2026-09-20T12:00:00Z', sender_name: 'Fixture', is_bot_message: index % 2 === 1 },
}));
for (const chat of ['a', 'b']) cacheTimelineSnapshot(chat, { posts: posts(chat), has_more: false });
const services = { fetchCommands: async () => ({ commands: [] }) };
const capabilities = { speech: false, media: false, location: false, notifications: false, modelPicker: false, commands: false };
const queue = [];
const noOp = () => {};
function Fixture() {
  const [chat, setChat] = useState('a');
  const [search, setSearch] = useState(false);
  const timelineRef = useRef(null);
  const viewStateRef = useRef({});
  const queueIds = useRef(new Set());
  const timeline = useMainAppTimelineComposition({ timelineRef, viewStateRef, followupQueueRowIdsRef: queueIds, currentChatJid: chat, currentHashtag: null, searchQuery: null, followupQueueItems: queue });
  useEffect(() => {
    (window as any).timelineFixture = { replace: timeline.setPosts, refresh: timeline.refreshTimeline, loadMore: timeline.loadMore,
      preserve: timeline.preserveTimelineScroll, preserveTop: timeline.preserveTimelineScrollTop,
      arrive(post: any) { timeline.setPosts(previous => [...(previous || []), post]); timeline.scrollToBottom(); },
      // The compose acknowledgement, as the app shell wires it; the realtime row may arrive later.
      submitted(response: unknown) { handleComposePost({ response, viewStateRef, scrollToBottom: timeline.scrollToBottom, jumpToLatest: () => jumpTimelineToLatest(timelineRef.current) }); } };
    return () => { delete (window as any).timelineFixture; };
  }, [timeline.setPosts, timeline.refreshTimeline]);
  useEffect(() => {
    let cancelled = false;
    void runTimelineLoadFlow({ currentChatJid: chat, currentRootChatJid: chat, currentHashtag: null, searchQuery: null, searchScope: 'current', loadPosts: timeline.loadPosts, searchPosts: async () => ({ results: [] }), setPosts: timeline.setPosts, setHasMore: timeline.setHasMore, scrollToBottom: timeline.scrollToBottom, isCancelled: () => cancelled, onTimelineFirstPaint: () => { document.body.dataset.ready = chat; } });
    return () => { cancelled = true; };
  }, [chat, timeline.loadPosts, timeline.scrollToBottom]);
  return html`<div style="height:100vh;display:flex;flex-direction:column">
    <nav>${['a', 'b', 'c', 'd'].map(name => html`<button id=${`switch-${name}`} onClick=${() => { document.body.dataset.ready = ''; setSearch(false); setChat(name); }}>Chat ${name}</button>`)}
      <button id="refresh" onClick=${() => timeline.refreshTimeline()}>Refresh same chat</button>
      <button id="search" onClick=${() => setSearch(value => !value)}>Toggle search layout</button>
    </nav>
    <${ChatSurface} currentChatJid=${chat} reverse=${!search} posts=${timeline.posts} timelineRef=${timelineRef} timelineId="fixture-timeline" hasMore=${false}
      composeProps=${{ onPost: noOp, currentChatJid: chat, services, capabilities }} />
  </div>`;
}
render(html`<${Fixture} />`, document.getElementById('app')!);
