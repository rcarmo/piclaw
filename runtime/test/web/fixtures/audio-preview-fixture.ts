
const root = document.getElementById("app")!;
{
  const { html, render, useState } = await import("../../../web/src/vendor/preact-htm.js");
  const { AttachmentPreviewModal } = await import("../../../web/src/components/attachment-preview-modal.js");
  function Fixture() {
    const [id, setId] = useState(0);
    return html`<div>
      <button onClick=${() => setId(1)}>Preview voice.wav</button>
      <button onClick=${() => setId(2)}>Preview broken.mp3</button>
      ${id > 0 && html`<${AttachmentPreviewModal} mediaId=${id} info=${{ filename: id === 1 ? "voice.wav" : "broken.mp3", content_type: id === 1 ? "audio/wav" : "audio/mpeg" }} onClose=${() => setId(0)} />`}
    </div>`;
  }
  render(html`<${Fixture} />`, root);
}
