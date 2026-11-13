import { html, render, useState } from '../../../web/src/vendor/preact-htm.js';
import { LiveTurnActivity, TurnActivity } from '../../../web/src/components/turn-activity.js';
import { AgentStatus } from '../../../web/src/components/status.js';

// A tall timeline: the first reply is far below the fold until the test scrolls.
const posts = [
  { id: 41, chat_jid: 'web:fixture', data: { type: 'agent_response', turn_activity: true } },
  { id: 404, chat_jid: 'web:fixture', data: { type: 'agent_response', turn_activity: true } },
];
let remount = () => {};
let setLive = (_value: any) => {};
function App() {
  const [generation, setGeneration] = useState(0);
  const [live, setLiveState] = useState<any>(null);
  remount = () => setGeneration((value) => value + 1);
  setLive = setLiveState;
  return html`
    <div class="timeline" style="height:100vh;overflow:auto">
      <div style="flex:0 0 1600px;height:1600px" data-testid="spacer"></div>
      ${posts.map((post) => html`<article key=${`${generation}-${post.id}`} id=${`post-${post.id}`} class="post agent-post"><${TurnActivity} post=${post} chatJid=${post.chat_jid} /><p>Final answer ${post.id}</p></article>`)}
      ${live && html`<${LiveTurnActivity} chatJid="web:fixture" status=${live.status} draft=${live.draft} thought=${live.thought} turnId=${live.turnId}
        statusPane=${live.withStatusPane ? html`<${AgentStatus} status=${live.status} showLivePanels=${false} turnId=${live.turnId} showExtensionPanels=${false} />` : null} />`}
    </div>`;
}
render(html`<${App} />`, document.getElementById('app')!);
(window as any).turnActivityFixture = { remount: () => remount(), live: (value: any) => setLive(value) };
