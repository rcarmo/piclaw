import './editor-theme-fixture';
import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { MarkdownPreview } from '../../../web/src/components/markdown-preview.js';

const editor = (window as any).editorFixture;
const subscribers = new Set<(text: string) => void>();
const content = () => editor.instance.view.state.doc.toString();
render(html`<${MarkdownPreview} getContent=${content}
  subscribeContentChange=${(callback: (text: string) => void) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }} path="heading-spacing.md" onClose=${() => {}} />`, document.querySelector('#preview'));

(window as any).headingFixture = {
  get ready() { return subscribers.size > 0; },
  setDocument(text: string) {
    const view = editor.instance.view;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } });
    subscribers.forEach(callback => callback(text));
  },
};
