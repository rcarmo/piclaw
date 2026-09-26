const { StandaloneEditorInstance } = new URLSearchParams(location.search).has('bundle')
  ? await import('/static/classic/dist/editor.bundle.js')
  : await import('../../../extensions/viewers/editor/editor-extension');
import * as theme from '../../../web/src/ui/theme';
import { WEB_THEME_PRESETS } from '../../../src/core/ui-theme-catalogue';
import { importVSCodeTheme, applyTheme } from '../../../web/static/visual/frontend/src/utils/theme-importer';
import { SearchQuery, setSearchQuery, openSearchPanel } from '#editor-vendor/codemirror';
import { revealText } from '../../../extensions/viewers/editor/search-reveal';
const skin = new URLSearchParams(location.search).get('skin') || 'classic';
localStorage.setItem('piclaw_vim_mode', 'false');
localStorage.setItem('piclaw_md_live_preview', 'true');
theme.initTheme({ skin: skin as 'classic' | 'visual' });
let instance: any;
const prose = 'Plain text selection must track the active theme. Repeat selection here.\n\n';
const markdown = prose + '# Heading\n\n**Strong** and *emphasis* with `inline code`.\n\n```javascript\nconst greeting = "hello"; // comment\nfunction greet(name) { return greeting + name + 42; }\n```\n\n> [!warning] Warning\n> Body text\n\n| Name | Value |\n| --- | --- |\n| plain | **bold** |\n\nUnresolved [^missing].\n';
function mount(mode = 'preview') {
  instance?.dispose();
  document.querySelector('#editor')!.innerHTML = '';
  localStorage.setItem('piclaw_md_live_preview', mode === 'preview' ? 'true' : 'false');
  localStorage.setItem('piclaw_vim_mode', mode === 'vim' ? 'true' : 'false');
  const path = ['preview','raw','diff'].includes(mode) ? 'fixture.md' : mode === 'code' ? 'fixture.js' : 'fixture.txt';
  const content = mode === 'code' ? 'const greeting = "hello"; // comment\nfunction greet(name) { return greeting + name + 42; }' : mode === 'large' ? prose.repeat(800) : markdown;
  instance = new StandaloneEditorInstance(document.querySelector('#editor')!, { path, content, viewState: {cursorLine:1,cursorCol:1,scrollTop:0} } as any);
  if(mode === 'diff') {
    instance.view.dispatch({ changes: {from:0,to:5,insert:'Changed'} });
    instance.setDiffMode("saved");
  }
}
Object.assign(window, { editorFixture: {
  ...theme, presets:WEB_THEME_PRESETS, importVSCodeTheme, applyTheme, mount,
  views: () => [instance.view, instance.baselineView].filter(Boolean),
  select: (from=0,to=10) => { instance.view.dispatch({selection:{anchor:from,head:to}}); instance.view.focus(); },
  search: () => { openSearchPanel(instance.view); instance.view.dispatch({effects:setSearchQuery.of(new SearchQuery({search:'selection'}))}); },
  reveal: () => revealText(instance.view, 'selection'),
  get instance() {return instance;},
}});
mount();
