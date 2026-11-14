import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { FloatingWidgetPane } from '../../../web/src/components/floating-widget-pane.js';

const content = `<iframe src="/child"></iframe><script>
window.result = {};
window.violations = [];
addEventListener('securitypolicyviolation', event => violations.push(event.effectiveDirective));
(async () => {
  const response = await fetch('/fixture.wasm');
  const { instance } = await WebAssembly.instantiateStreaming(response);
  result.answer = instance.exports.answer();
  const three = await import('/static/common/js/vendor/three/three.module.min.js');
  result.module = new three.Vector3(1, 2, 3).lengthSq() === 14;
  await import('/static/common/js/vendor/beautiful-mermaid.js');
  result.mermaid = (await globalThis.beautifulMermaid.renderMermaid('graph TD\\n A-->B')).includes('<svg');
  await WebAssembly.compileStreaming(fetch('/static/common/js/vendor/remote-display-decoder.wasm'));
  try { await fetch('http://localhost:1/blocked'); result.crossOrigin = 'allowed'; }
  catch { result.crossOrigin = 'blocked'; }
  try { eval('1+1'); result.eval = 'allowed'; }
  catch { result.eval = 'blocked'; }
  const child = document.createElement('iframe'); child.src = 'http://localhost:1/blocked-frame'; document.body.append(child);
  result.ready = true;
})().catch(error => { result.error = String(error); result.ready = true; });
</script>`;
(window as any).widgetEvents = [];
window.addEventListener('piclaw:widget-submission', e => (window as any).widgetEvents.push({ kind: 'widget.submit', payload: (e as CustomEvent).detail }));
window.addEventListener('piclaw:widget-close', () => (window as any).widgetEvents.push({ kind: 'widget.close' }));

const source = new URL(location.href).searchParams.get('static') ? 'message' : 'live';
const styledContent='<link rel="stylesheet" href="/fixture.css"><div id="styled">Styled</div>'+content;
const widget = { title: 'Runtime fixture', widgetId: 'runtime-fixture', source, status: 'final', artifact: { kind: 'html', html: styledContent } };
function mount() {
  {
    render(html`<${FloatingWidgetPane} widget=${widget} onClose=${() => {}} onWidgetEvent=${(data: any) => (window as any).widgetEvents.push(data)} />`, document.getElementById('app')!);
  }
}
(window as any).widgetFixture = { mount, dispose() { render(null, document.getElementById('app')!); } };
mount();
