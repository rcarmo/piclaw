import { html, render, useState } from '../../../web/src/vendor/preact-htm.js';
import { TurnActivity } from '../../../web/src/components/turn-activity.js';

// A tall timeline: the first reply is far below the fold until the test scrolls.
const posts = [
  { id: 41, chat_jid: 'web:fixture', data: { type: 'agent_response', turn_activity: true } },
  { id: 404, chat_jid: 'web:fixture', data: { type: 'agent_response', turn_activity: true } },
];
let remount = () => {};
function App() {
  const [generation, setGeneration] = useState(0);
  remount = () => setGeneration((value) => value + 1);
  return html`
    <div class="timeline" style="height:100vh;overflow:auto">
      <div style="flex:0 0 1600px;height:1600px" data-testid="spacer"></div>
      ${posts.map((post) => html`<article key=${`${generation}-${post.id}`} id=${`post-${post.id}`} class="post agent-post"><${TurnActivity} post=${post} chatJid=${post.chat_jid} /><p>Final answer ${post.id}</p></article>`)}
    </div>`;
}
render(html`<${App} />`, document.getElementById('app')!);
(window as any).turnActivityFixture = { remount: () => remount() };
