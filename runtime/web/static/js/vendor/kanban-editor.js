(()=>{function GK(K,N){if(!K)return K;let J=K.lanes.find((F)=>F.id===N.fromLaneId),$=K.lanes.find((F)=>F.id===N.toLaneId);if(!J||!$)return K;let W=J.cards.findIndex((F)=>F.id===N.cardId);if(W===-1)return K;let H=J.cards[W];if(!H)return K;let Y=Number.isFinite(N.toIndex)?Number(N.toIndex):$.cards.length;if(N.fromLaneId===N.toLaneId){let F=[...J.cards],[y]=F.splice(W,1);if(!y)return K;let V=Math.max(0,Math.min(Y,J.cards.length)),T=V>W?V-1:V;if(T===W)return K;return F.splice(T,0,y),{...K,lanes:K.lanes.map((U)=>U.id===N.fromLaneId?{...U,cards:F}:U)}}let Z=[...$.cards.filter((F)=>F.id!==N.cardId)],O=Math.max(0,Math.min(Y,Z.length));return Z.splice(O,0,H),{...K,lanes:K.lanes.map((F)=>{if(F.id===N.fromLaneId)return{...F,cards:F.cards.filter((y)=>y.id!==N.cardId)};if(F.id===N.toLaneId)return{...F,cards:Z};return F})}}function JK(K,N){if(!K||N.fromLaneId===N.toLaneId)return K;let J=K.lanes.findIndex((Y)=>Y.id===N.fromLaneId),$=K.lanes.findIndex((Y)=>Y.id===N.toLaneId);if(J===-1||$===-1)return K;let W=[...K.lanes],[H]=W.splice(J,1);if(!H)return K;return W.splice($,0,H),{...K,lanes:W}}var{h:FK,render:QK}=preact,{useState:B,useEffect:w,useCallback:r,useRef:t}=preactHooks,q=htm.bind(FK),h=null,s=null,m=null,d=0,f=null,D=null,WK=new Map,b=null,a=null;function c(K){if(typeof crypto<"u"&&typeof crypto.randomUUID==="function")return`${K}-${crypto.randomUUID()}`;return`${K}-${Date.now()}-${Math.random().toString(36).slice(2,11)}`}var x={grip:q`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>`,plus:q`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,plusCircle:q`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,trash:q`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,archive:q`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`,restore:q`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,moreVertical:q`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,check:q`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,x:q`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`};function qK(K){if(!K.startsWith(`---
`))return K;let N=K.indexOf(`
---
`,4);return N===-1?K:K.slice(N+5)}function VK(K){let N=K.indexOf("%% kanban:settings");if(N===-1)return{settings:{},content:K};let J=K.indexOf("```",N);if(J===-1)return{settings:{},content:K};let $=K.indexOf("```",J+3);if($===-1)return{settings:{},content:K};let W=K.slice(J+3,$).trim(),H={};try{H=JSON.parse(W)}catch{}let Y=K.indexOf("%%",$+3),Z=Y===-1?$+3:Y+2,O=`${K.slice(0,N).trimEnd()}
${K.slice(Z).trimStart()}`.trim();return{settings:H,content:O}}function n(K){if(K.startsWith("\\#")||K.startsWith("\\---"))return K;if(K.startsWith("#")||K.startsWith("---"))return`\\${K}`;return K}function e(K){if(K.startsWith("\\#")||K.startsWith("\\---"))return K.slice(1);return K}function OK(K){return String(K||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function yK(K){let N=String(K||"").trim();if(!N)return"#";if(N.startsWith("#")||N.startsWith("/"))return N;try{let J=new URL(N,window.location.origin);if(["http:","https:","mailto:","tel:"].includes(J.protocol))return J.toString()}catch{}return"#"}function ZK(K){return K.replace(/\n/g,"<br>")}function HK(K){let N=String(K||""),J=WK.get(N);if(J)return J;let $=OK(N),W=ZK($),H=globalThis?.marked;try{if(H?.parse)W=String(H.parse($,{gfm:!0,breaks:!0,headerIds:!1,mangle:!1})||"")}catch{W=ZK($)}return W=W.replace(/<a\s+([^>]*?)href=(['"])(.*?)\2([^>]*)>/gi,(Y,Z,O,F,y)=>{let V=yK(F);return`<a ${Z}href=${O}${V}${O}${y} target="_blank" rel="noopener noreferrer">`}),WK.set(N,W),W}function UK(){if(typeof document>"u")return null;if(a)return a;let K=document.createElement("canvas");return K.width=1,K.height=1,a=K,K}function XK(){if(typeof document>"u")return null;if(b?.isConnected)return b;let K=document.createElement("div");return K.className="kanban-plugin__drag-preview",document.body.appendChild(K),b=K,K}function o(K,N){let J=XK();if(!J)return;J.style.left=`${Math.round(Number(K||0)+18)}px`,J.style.top=`${Math.round(Number(N||0)+18)}px`}function zK(K,N){let J=XK();if(!J)return;J.innerHTML=`
    <div class="kanban-plugin__item kanban-plugin__item--drag-preview ${K.checked?"is-complete":""}">
      <div class="kanban-plugin__item-content-wrapper">
        <div class="kanban-plugin__item-title-wrapper">
          <div class="kanban-plugin__item-prefix-button-wrapper">
            <div class="kanban-plugin__item-checkbox ${K.checked?"is-checked":""}">${K.checked?"✓":""}</div>
          </div>
          <div class="kanban-plugin__item-title kanban-plugin__item-markdown">${HK(K.title)}</div>
        </div>
      </div>
    </div>`,J.classList.add("is-visible"),o(Number(N?.clientX||0),Number(N?.clientY||0))}function i(){b?.classList.remove("is-visible")}function NK(){i(),b?.remove(),b=null}function $K(K){let N={lanes:[],archive:[],settings:{}},J=qK(K),$=VK(J);N.settings=$.settings,J=$.content;let W=J.split(/\n---\n/);if(N.lanes=jK(W[0]),W.length>1){let H=W.slice(1).join(`
---
`),Z=jK(H).find((O)=>O.title.toLowerCase()==="archive");if(Z)N.archive=Z.cards}return N}function jK(K){let N=[],J=K.split(/(?=^## )/gm).filter(($)=>$.trim());for(let $ of J){let W=$.split(`
`),H=W[0].match(/^## (.+)$/);if(!H)continue;let Y={id:c("lane"),title:H[1].trim(),cards:[]},Z=null,O="";for(let F=1;F<W.length;F++){let y=W[F],V=y.match(/^- \[(.)\] (.*)$/);if(V){if(Z)Z.title=O.trim(),Y.cards.push(Z);Z={id:c("card"),title:e(V[2]),checkChar:V[1],checked:V[1]!==" "},O=e(V[2])}else if(Z&&y.match(/^\s+\S/))O+=`
`+e(y.replace(/^\s+/,""))}if(Z)Z.title=O.trim(),Y.cards.push(Z);N.push(Y)}return N}function KK(K){let N=["---","","kanban-plugin: board","","---",""];for(let J of K.lanes){N.push(`## ${J.title}`,"");for(let $ of J.cards){let W=`[${$.checked?$.checkChar!==" "?$.checkChar:"x":" "}]`,H=$.title.split(`
`);N.push(`- ${W} ${n(H[0])}`);for(let Y=1;Y<H.length;Y++)N.push(`  ${n(H[Y])}`)}N.push("")}if(K.archive.length>0){N.push("---","","## Archive","");for(let J of K.archive){let $=J.title.split(`
`);N.push(`- [${J.checked?"x":" "}] ${n($[0])}`);for(let W=1;W<$.length;W++)N.push(`  ${n($[W])}`)}N.push("")}if(Object.keys(K.settings).length>0)N.push("%% kanban:settings","```",JSON.stringify(K.settings),"```","%%");return N.join(`
`)}function fK({checked:K,onChange:N}){return q`
    <div class="kanban-plugin__item-prefix-button-wrapper">
      <button class="kanban-plugin__item-checkbox ${K?"is-checked":""}"
        onClick=${(J)=>{J.stopPropagation(),N()}}>
        ${K?x.check:""}
      </button>
    </div>`}function BK({onArchive:K,isEditing:N,onCancelEdit:J}){return q`
    <div class="kanban-plugin__item-postfix-button-wrapper">
      ${N?q`
        <button class="kanban-plugin__item-postfix-button is-enabled"
          onClick=${($)=>{$.stopPropagation(),J()}} title="Cancel">${x.x}</button>
      `:q`
        <button class="kanban-plugin__item-postfix-button"
          onClick=${($)=>{$.stopPropagation(),K()}} title="Archive">${x.archive}</button>
      `}
    </div>`}function TK({card:K,laneId:N,cardIndex:J,onUpdate:$,onDelete:W,onArchive:H,onMoveCard:Y}){let[Z,O]=B(!1),[F,y]=B(K.title),[V,T]=B(null),U=t(null);w(()=>{if(Z&&U.current)U.current.focus(),U.current.setSelectionRange(U.current.value.length,U.current.value.length),U.current.style.height="auto",U.current.style.height=U.current.scrollHeight+"px"},[Z]);let k=(G)=>{f={card:K,fromLaneId:N,fromIndex:J},G.dataTransfer.effectAllowed="move",G.dataTransfer.setData("text/plain",K.id);let Q=UK();if(Q&&G.dataTransfer?.setDragImage)G.dataTransfer.setDragImage(Q,0,0);zK(K,{clientX:G.clientX,clientY:G.clientY}),setTimeout(()=>{G.target.classList.add("is-dragging")},0)},I=(G)=>{if(!f)return;o(G.clientX,G.clientY)},C=(G)=>{f=null,T(null),i(),G.target.classList.remove("is-dragging")},S=(G)=>{let Q=G.currentTarget.getBoundingClientRect();T(G.clientY>=Q.top+Q.height/2?"after":"before")},u=(G)=>{if(!f||Z)return;G.preventDefault(),G.stopPropagation(),G.dataTransfer.dropEffect="move",o(G.clientX,G.clientY),S(G)},_=(G)=>{let Q=G.currentTarget.getBoundingClientRect();if(G.clientX<Q.left||G.clientX>Q.right||G.clientY<Q.top||G.clientY>Q.bottom)T(null)},p=(G)=>{if(!f||Z)return;G.preventDefault(),G.stopPropagation();let Q=G.currentTarget.getBoundingClientRect(),X=G.clientY>=Q.top+Q.height/2;Y(f.card,f.fromLaneId,N,J+(X?1:0)),T(null),i(),f=null},L=()=>{$({...K,checked:!K.checked,checkChar:K.checked?" ":"x"})},R=()=>{if(F.trim())$({...K,title:F.trim()});O(!1)},g=(G)=>{if(G.key==="Enter"&&!G.shiftKey)G.preventDefault(),R();else if(G.key==="Escape")y(K.title),O(!1)},P=(G)=>{y(G.target.value),G.target.style.height="auto",G.target.style.height=G.target.scrollHeight+"px"},E=()=>{y(K.title),O(!1)};return q`
    <div class="kanban-plugin__item-wrapper ${V?`is-drop-${V}`:""}"
      onDragOver=${u}
      onDragLeave=${_}
      onDrop=${p}>
      <div class="kanban-plugin__item ${K.checked?"is-complete":""} ${Z?"is-editing":""}"
        draggable=${!Z}
        onKeyDown=${(G)=>{if((G.ctrlKey||G.metaKey)&&G.key.toLowerCase()==="e")G.preventDefault(),O(!0);if((G.ctrlKey||G.metaKey)&&G.key.toLowerCase()==="d")G.preventDefault(),W(K);if((G.ctrlKey||G.metaKey)&&G.key.toLowerCase()==="a")G.preventDefault(),H(K)}}
        onDragStart=${k} onDrag=${I} onDragEnd=${C}
        onDblClick=${()=>!Z&&O(!0)} tabindex="0">
        <div class="kanban-plugin__item-content-wrapper">
          <div class="kanban-plugin__item-title-wrapper">
            <${fK} checked=${K.checked} onChange=${L} />
            ${Z?q`
              <textarea ref=${U} class="kanban-plugin__item-edit-textarea"
                value=${F} onInput=${P}
                onBlur=${()=>{if(Z)R()}}
                onKeyDown=${g} />
            `:q`<div class="kanban-plugin__item-title kanban-plugin__item-markdown" dangerouslySetInnerHTML=${{__html:HK(K.title)}}></div>`}
            <${BK} isEditing=${Z}
              onArchive=${()=>H(K)} onCancelEdit=${E} />
          </div>
        </div>
      </div>
    </div>`}function AK({onAdd:K,onCancel:N}){let[J,$]=B(""),W=t(null);w(()=>{W.current?.focus()},[]);let H=()=>{if(J.trim())K(J.trim()),$("")};return q`
    <div class="kanban-plugin__item-form">
      <div class="kanban-plugin__item-input-wrapper">
        <textarea ref=${W} placeholder="Card title..." value=${J}
          onInput=${(Z)=>$(Z.target.value)} onKeyDown=${(Z)=>{if(Z.key==="Enter"&&!Z.shiftKey)Z.preventDefault(),H();else if(Z.key==="Escape")N()}} rows="2" />
      </div>
      <div class="kanban-plugin__item-input-actions">
        <button class="kanban-plugin__item-action-add" onClick=${H}>Add card</button>
        <button class="kanban-plugin__item-action-cancel" onClick=${N}>Cancel</button>
      </div>
    </div>`}function MK({lane:K,laneIndex:N,onUpdate:J,onDelete:$,onAddCard:W,onUpdateCard:H,onDeleteCard:Y,onArchiveCard:Z,onMoveCard:O,onMoveLane:F}){let[y,V]=B(!1),[T,U]=B(K.title),[k,I]=B(!1),[C,S]=B(!1),[u,_]=B(!1),[p,L]=B(!1),R=t(null);w(()=>{if(y&&R.current)R.current.focus(),R.current.select()},[y]);let g=(j)=>{if(j.preventDefault(),f)j.dataTransfer.dropEffect="move",o(j.clientX,j.clientY),S(!0);if(D)j.dataTransfer.dropEffect="move",_(!0)},P=(j)=>{let A=j.currentTarget.getBoundingClientRect();if(j.clientX<A.left||j.clientX>A.right||j.clientY<A.top||j.clientY>A.bottom)S(!1),_(!1)},E=(j)=>{if(j.preventDefault(),S(!1),_(!1),f)O(f.card,f.fromLaneId,K.id);if(D&&D.laneId!==K.id)F(D.laneId,K.id);i(),f=null,D=null},G=(j)=>{D={laneId:K.id,fromIndex:N},j.dataTransfer.effectAllowed="move",j.dataTransfer.setData("text/plain",K.id),L(!0)},Q=()=>{D=null,_(!1),L(!1)},X=()=>{if(T.trim())J({...K,title:T.trim()});V(!1)},z=(j)=>{W(K.id,j),I(!1)};return q`
    <div class="kanban-plugin__lane-wrapper ${u?"is-lane-drop-target":""} ${p?"is-lane-dragging":""}"
      onDragOver=${g}
      onDragLeave=${P}
      onDrop=${E}>
      <div class="kanban-plugin__lane ${C?"is-dropping":""}">
        <div class="kanban-plugin__lane-header-wrapper">
          <div
            class="kanban-plugin__lane-grip"
            draggable=${!y&&!k}
            onDragStart=${G}
            onDragEnd=${Q}
            title="Drag lane"
          >${x.grip}</div>
          <div class="kanban-plugin__lane-title">
            ${y?q`
              <input ref=${R} class="kanban-plugin__lane-title-input" value=${T}
                onInput=${(j)=>U(j.target.value)}
                onBlur=${()=>{if(y)X()}}
                onKeyDown=${(j)=>{if(j.key==="Enter")X();if(j.key==="Escape")U(K.title),V(!1)}} />
            `:q`
              <div class="kanban-plugin__lane-title-text" onDblClick=${()=>V(!0)} title=${K.title}>${K.title}</div>
            `}
          </div>
          <div class="kanban-plugin__lane-settings-button-wrapper">
            <button class="kanban-plugin__lane-settings-button" onClick=${()=>I(!0)} title="Add card">${x.plusCircle}</button>
          </div>
        </div>
        <div class="kanban-plugin__lane-items">
          ${K.cards.map((j,A)=>q`
            <${TK} key=${j.id} card=${j} laneId=${K.id} cardIndex=${A}
              onUpdate=${(l)=>H(K.id,l)}
              onDelete=${(l)=>Y(K.id,l)}
              onArchive=${Z}
              onMoveCard=${O} />`)}
        </div>
        ${k?q`<${AK} onAdd=${z} onCancel=${()=>I(!1)} />`:null}
      </div>
    </div>`}function RK({onAdd:K,onCancel:N}){let[J,$]=B(""),W=t(null);w(()=>{W.current?.focus()},[]);let H=()=>{if(J.trim())K(J.trim())};return q`
    <div class="kanban-plugin__lane-form-wrapper">
      <input ref=${W} class="kanban-plugin__lane-input" placeholder="Enter lane title..." value=${J}
        onInput=${(Y)=>$(Y.target.value)}
        onKeyDown=${(Y)=>{if(Y.key==="Enter")Y.preventDefault(),H();else if(Y.key==="Escape")N()}} />
      <div class="kanban-plugin__lane-input-actions">
        <button class="kanban-plugin__lane-action-add" onClick=${H}>Add lane</button>
        <button class="kanban-plugin__lane-action-cancel" onClick=${N}>Cancel</button>
      </div>
    </div>`}function PK({cards:K,onRestore:N}){let[J,$]=B(!0);if(K.length===0)return null;return q`
    <div class="kanban-plugin__archive">
      <div class="kanban-plugin__archive-header">
        <h3>${x.archive} Archive (${K.length})</h3>
        <button class="kanban-plugin__archive-toggle" onClick=${()=>$(!J)}>${J?"Hide":"Show"}</button>
      </div>
      ${J&&q`
        <div class="kanban-plugin__archive-cards">
          ${K.map((W)=>q`
            <div class="kanban-plugin__archive-card" key=${W.id}>
              <span class="kanban-plugin__archive-card-title">${W.title.split(`
`)[0]}</span>
              <button onClick=${()=>N(W)} title="Restore">${x.restore}</button>
            </div>`)}
        </div>`}
    </div>`}function v(K){let N=String(K?.title||"").split(`
`)[0].trim();if(!N)return"card";return N.length>36?`${N.slice(0,35)}…`:N}function M(K){let N=String(K?.title||"").trim();if(!N)return"lane";return N.length>28?`${N.slice(0,27)}…`:N}function _K({initialContent:K}){let[N,J]=B(()=>$K(K??"")),[$,W]=B(!1),[H,Y]=B([]),[Z,O]=B([]),[F,y]=B(d);w(()=>{let G=setInterval(()=>{if(d!==F){if(y(d),m!==null)J($K(m)),m=null}},100);return()=>clearInterval(G)},[F]);let V=r((G,Q="Updated board")=>{J(G),Y((X)=>N?[...X,{board:N,label:Q}]:X),O([]),s?.(KK(G))},[N]),T=r(()=>{if(!N||H.length===0)return;let G=H[H.length-1];Y(H.slice(0,-1)),O((Q)=>[...Q,{board:N,label:G.label}]),J(G.board),s?.(KK(G.board))},[N,H]),U=r(()=>{if(!N||Z.length===0)return;let G=Z[Z.length-1];O(Z.slice(0,-1)),Y((Q)=>[...Q,{board:N,label:G.label}]),J(G.board),s?.(KK(G.board))},[N,Z]);w(()=>{let G=h;if(!G)return;let Q=(X)=>{if(!(X.ctrlKey||X.metaKey))return;if(X.key.toLowerCase()==="z")X.preventDefault(),X.shiftKey?U():T();else if(X.key.toLowerCase()==="y")X.preventDefault(),U()};return G.addEventListener("keydown",Q),()=>G.removeEventListener("keydown",Q)},[T,U]),w(()=>{if(typeof document>"u")return;let G=(X)=>{if(!f)return;o(X.clientX,X.clientY)},Q=()=>{i(),f=null};return document.addEventListener("dragover",G),document.addEventListener("drop",Q),document.addEventListener("dragend",Q),()=>{document.removeEventListener("dragover",G),document.removeEventListener("drop",Q),document.removeEventListener("dragend",Q),NK()}},[]);let k=(G)=>{if(!N)return;V({...N,lanes:[...N.lanes,{id:c("lane"),title:G,cards:[]}]},`Added lane “${M({id:"",title:G,cards:[]})}”`),W(!1)},I=(G)=>{if(!N)return;V({...N,lanes:N.lanes.map((Q)=>Q.id===G.id?G:Q)},`Updated lane “${M(G)}”`)},C=(G)=>{if(!N)return;V({...N,lanes:N.lanes.filter((Q)=>Q.id!==G.id)},`Deleted lane “${M(G)}”`)},S=(G,Q)=>{if(!N)return;let X=N.lanes.find((A)=>A.id===G)||null,z=N.lanes.find((A)=>A.id===Q)||null,j=JK(N,{fromLaneId:G,toLaneId:Q});if(j===N)return;V(j,`Moved lane “${M(X)}” before “${M(z)}”`)},u=(G,Q)=>{if(!N)return;let X=N.lanes.find((j)=>j.id===G)||null,z={id:c("card"),title:Q,checked:!1,checkChar:" "};V({...N,lanes:N.lanes.map((j)=>j.id===G?{...j,cards:[...j.cards,z]}:j)},`Added card to “${M(X)}”`)},_=(G,Q)=>{if(!N)return;let X=N.lanes.find((z)=>z.id===G)||null;V({...N,lanes:N.lanes.map((z)=>z.id===G?{...z,cards:z.cards.map((j)=>j.id===Q.id?Q:j)}:z)},`Updated “${v(Q)}” in “${M(X)}”`)},p=(G,Q)=>{if(!N)return;let X=N.lanes.find((z)=>z.id===G)||null;V({...N,lanes:N.lanes.map((z)=>z.id===G?{...z,cards:z.cards.filter((j)=>j.id!==Q.id)}:z)},`Deleted “${v(Q)}” from “${M(X)}”`)},L=(G)=>{if(!N)return;V({...N,lanes:N.lanes.map((Q)=>({...Q,cards:Q.cards.filter((X)=>X.id!==G.id)})),archive:[...N.archive,{...G,checked:!0}]},`Archived “${v(G)}”`)},R=(G,Q,X,z)=>{if(!N)return;let j=N.lanes.find((YK)=>YK.id===X)||null,A=GK(N,{cardId:G.id,fromLaneId:Q,toLaneId:X,toIndex:z});if(A===N)return;V(A,`${Q===X?"Reordered":"Moved"} “${v(G)}” in “${M(j)}”`)},g=(G)=>{if(!N)return;if(N.lanes.length===0){V({...N,lanes:[{id:c("lane"),title:"Restored",cards:[{...G,checked:!1}]}],archive:N.archive.filter((X)=>X.id!==G.id)},`Restored “${v(G)}”`);return}let Q=N.lanes[0];V({...N,lanes:N.lanes.map((X)=>X.id===Q.id?{...X,cards:[...X.cards,{...G,checked:!1}]}:X),archive:N.archive.filter((X)=>X.id!==G.id)},`Restored “${v(G)}” to “${M(Q)}”`)};if(!N)return q`<div class="loading">Loading...</div>`;let P=H.length>0?H[H.length-1]:null,E=Z.length>0?Z[Z.length-1]:null;return q`
    <div class="kanban-plugin" tabindex="-1">
      <div class="kanban-plugin__search-wrapper">
        <button onClick=${()=>W(!0)}>${x.plus} Add lane</button>
        <button class="secondary" onClick=${T} disabled=${H.length===0} title=${P?`Undo: ${P.label} (Ctrl+Z)`:"Undo (Ctrl+Z)"}>Undo</button>
        <button class="secondary" onClick=${U} disabled=${Z.length===0} title=${E?`Redo: ${E.label} (Ctrl+Y)`:"Redo (Ctrl+Y)"}>Redo</button>
        ${P&&q`<span class="kanban-plugin__history-note" title=${P.label}>Last change: ${P.label}</span>`}
      </div>
      <div class="kanban-plugin__board"><div>
        ${N.lanes.map((G,Q)=>q`
          <${MK} key=${G.id} lane=${G} laneIndex=${Q} onUpdate=${I} onDelete=${C}
            onAddCard=${u} onUpdateCard=${_} onDeleteCard=${p}
            onArchiveCard=${L} onMoveCard=${R} onMoveLane=${S} />`)}
        ${$&&q`<${RK} onAdd=${k} onCancel=${()=>W(!1)} />`}
      </div></div>
      <${PK} cards=${N.archive} onRestore=${g} />
    </div>`}window.__kanbanEditor={mount(K,N){if(h=K,s=N.onEdit,f=null,m=null,NK(),!N.isDark)K.classList.add("light");QK(q`<${_K} initialContent=${N.content} />`,K)},update(K){m=K,d++},setTheme(K){h?.classList.toggle("light",!K)},destroy(){if(h)QK(null,h);h=null,s=null,m=null,f=null,NK()}};})();
