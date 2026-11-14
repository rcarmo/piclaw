
import { Post } from '../../../web/src/components/post.js';

const content = '[Image: picture.png]';
const root = document.getElementById('app')!;
// A clipped pane simulates a narrow split-window with a containing block.
// Modal ownership must never depend on the size or scroll position of this pane.
root.style.cssText = 'width:180px;height:160px;overflow:hidden;transform:translateZ(0);margin:40px 0 0 20px';
{
  const { html, render: classicRender } = await import('../../../web/src/vendor/preact-htm.js');
  const post = { id: 42, chat_jid: 'web:default', data: { type: 'user_message', content, media_ids: [1], content_blocks: [{ type: 'image', mime_type: 'image/png' }], timestamp: '2026-10-02T09:00:00Z' } };
  classicRender(html`<${Post} post=${post} />`, root);
}
