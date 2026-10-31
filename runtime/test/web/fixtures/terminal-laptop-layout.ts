import { html, render, useEffect, useRef } from '../../../web/src/vendor/preact-htm.js';
import { ChatSurface } from '../../../web/src/components/chat-surface.js';
import { useSplitters } from '../../../web/src/ui/use-splitters.js';
import { terminalTabPaneExtension } from '../../../web/src/panes/terminal-pane.js';
import { applyStoredPaneLayout } from '../../../web/src/ui/app-branch-pane-orchestration.js';
const posts=Array.from({length:8},(_,i)=>({id:i+1,type:'user',data:{content:'A readable message with a long path /workspace/example/deeply-nested/source-file-that-should-wrap.ts',timestamp:'2026-10-29T00:00:00Z'}}));
const services={fetchCommands:async()=>({commands:[]}),getAgentModels:async()=>({current:'provider/a-very-long-model-name-that-needs-to-truncate',thinking_level:'high',supports_thinking:true,model_options:[]})};
function Fixture(){
 const shell=useRef(null),timeline=useRef(null),host=useRef(null),sidebar=useRef(280),editor=useRef(500),dock=useRef(200);
 const splitters=useSplitters({appShellRef:shell,sidebarWidthRef:sidebar,editorWidthRef:editor,dockHeightRef:dock});
 useEffect(()=>{const terminal=terminalTabPaneExtension.mount(host.current,{mode:'view'});Object.assign(window,{terminalLayout:{terminal,shell:shell.current,restore(width:number){editor.current=0;applyStoredPaneLayout({editorOpen:true,shellElement:shell.current,editorWidthRef:editor,dockHeightRef:dock,sidebarWidthRef:sidebar,readStoredNumber:key=>key==='editorWidth'?width:null});}}});return()=>terminal.dispose();},[]);
 return html`<div class="app-shell workspace-collapsed editor-open" ref=${shell} style="--editor-width:500px;--sidebar-width:280px">
 <aside class="workspace-sidebar">Workspace</aside><div class="workspace-splitter"></div>
 <section class="editor-pane-container"><div class="tab-strip">Terminal</div><div class="editor-pane-host" ref=${host}></div></section>
 <div class="editor-splitter" onMouseDown=${splitters.handleEditorSplitterMouseDown} onTouchStart=${splitters.handleEditorSplitterTouchStart}></div>
 <main class="container"><${ChatSurface} currentChatJid="web:fixture" posts=${posts} timelineRef=${timeline} hasMore=${false}
 composeProps=${{currentChatJid:'web:fixture',onPost:()=>{},services,agentModels:{current:'provider/a-very-long-model-name-that-needs-to-truncate',thinking_level:'high'},capabilities:{speech:true,media:true,location:true,notifications:true,modelPicker:true,commands:false}}}/></main>
 </div>`;
}
render(html`<${Fixture}/>`,document.getElementById('app')!);
