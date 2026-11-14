const params = new URLSearchParams(location.search);

const label = params.get('label');
const block = { type: 'file', mime_type: 'application/octet-stream', ...(label === null ? {} : { filename: label }) };
const root = document.getElementById('app')!;
{
  const { html, render } = await import('../../../web/src/vendor/preact-htm.js');
  const { Post } = await import('../../../web/src/components/post.js');
  render(html`<${Post} post=${{ id: 42, chat_jid: 'web:test-exe-download', data: { type: 'agent_response', content: '', timestamp: '2026-11-04T10:00:00Z', media_ids: [417], content_blocks: [block] } }} />`, root);
}
