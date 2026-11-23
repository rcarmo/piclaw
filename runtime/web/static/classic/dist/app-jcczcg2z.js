import{d,t,o,a,n,i,r,e}from"./app-1vedzwvv.js";import{Lr,Fr,Or,lt,jr,I,ie}from"./app-ja4wq1k9.js";import{ge,F,g,he,st,Ue,D,ne,ye,Ir,Er}from"./app-sh20tchy.js";import{u}from"./app-ctkstham.js";import{p,c,A,s}from"./app-3fbwg9z4.js";var _e="piclaw:session-picker-preferences-changed";function Ps(){return{pinnedChatJids:[]}}function ma(l){return typeof l==="string"?l.trim():""}function ga(l){if(!l||typeof l!=="object")return Ps();let h=l;return{pinnedChatJids:Array.from(new Set((Array.isArray(h.pinnedChatJids)?h.pinnedChatJids:[]).map(ma).filter(Boolean)))}}function ha(l){try{return l?.localStorage??null}catch{return null}}function V(l=typeof window<"u"?window:null){try{let h=ha(l)?.getItem("piclaw:session-picker-preferences:v1");return h?ga(JSON.parse(h)):Ps()}catch{return Ps()}}function It(l,h=typeof window<"u"?window:null){let f=ga(l);try{ha(h)?.setItem("piclaw:session-picker-preferences:v1",JSON.stringify(f))}catch(w){console.debug("[session-picker-preferences] Storage unavailable; keeping the in-memory preference result.",w)}try{h?.dispatchEvent?.(new CustomEvent("piclaw:session-picker-preferences-changed",{detail:f}))}catch(w){console.debug("[session-picker-preferences] Preference event delivery unavailable.",w)}return f}function Et(l,h=typeof window<"u"?window:null){let f=ma(l),w=V(h);if(!f)return w;let S=new Set(w.pinnedChatJids);if(S.has(f))S.delete(f);else S.add(f);let k=It({pinnedChatJids:Array.from(S)},h);return h?.dispatchEvent?.(new CustomEvent("piclaw:picker-pin-write",{detail:{kind:"session",key:f,pinned:S.has(f)}})),k}import{classHighlighter as yu,HighlightStyle as wu,tags as ao}from"#editor-vendor/codemirror";var vu=wu.define([{tag:[ao.function(ao.variableName),ao.function(ao.propertyName)],class:"tok-function"}]),Ls={style(l){let h=yu.style(l),f=vu.style(l);return[h,f].filter(Boolean).join(" ")||null}};import{highlightTree as Ga,StreamLanguage as z,cssLanguage as Su,cppLanguage as $u,goLanguage as ku,htmlLanguage as xu,javascriptLanguage as _u,jsxLanguage as Eu,tsxLanguage as Cu,typescriptLanguage as Au,jsonLanguage as Ru,markdownLanguage as Pu,pythonLanguage as Lu,rustLanguage as Tu,StandardSQL as Mu,xmlLanguage as Du,yamlLanguage as ju,dockerFile as Iu,powerShell as Nu,ruby as Fu,shell as Bu,swift as Ou,toml as Hu,clojure as zu,cmake as qu,coffeeScript as Gu,crystal as Ku,cypher as Wu,d as Uu,diff as Yu,eiffel as Vu,elm as Ju,erlang as Qu,factor as Xu,forth as Zu,fortran as ed,gas as td,gherkin as nd,groovy as rd,haskell as od,haxe as sd,http as id,jinja2 as ad,julia as cd,liveScript as ld,lua as ud,mathematica as dd,fSharp as pd,nginx as fd,octave as md,oz as gd,pascal as hd,perl as bd,properties as yd,protobuf as wd,pug as vd,puppet as Sd,r as $d,sas as kd,sass as xd,scheme as _d,smalltalk as Ed,solr as Cd,sparql as Ad,stex as Rd,stylus as Pd,tcl as Ld,textile as Td,turtle as Md,vb as Dd,verilog as jd,vhdl as Id,wast as Nd,webIDL as Fd,xQuery as Bd}from"#editor-vendor/codemirror";var Ka=98304;function qe(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}var Od={js:"JavaScript",javascript:"JavaScript",ts:"TypeScript",typescript:"TypeScript",jsx:"JSX",tsx:"TSX",py:"Python",python:"Python",sh:"Shell",shell:"Shell",bash:"Bash",zsh:"Zsh",ps1:"PowerShell",powershell:"PowerShell",md:"Markdown",markdown:"Markdown",yml:"YAML",yaml:"YAML",json:"JSON",html:"HTML",css:"CSS",sql:"SQL",go:"Go",c:"C",cc:"C++",cpp:"C++","c++":"C++",cxx:"C++",h:"C/C++",hh:"C++",hpp:"C++",hxx:"C++",rust:"Rust",rs:"Rust",ruby:"Ruby",swift:"Swift",toml:"TOML",dockerfile:"Dockerfile",asm:"Gas",clj:"Clojure",clojure:"Clojure",cmake:"CMake",coffee:"CoffeeScript",coffeescript:"CoffeeScript",conf:"nginx",cr:"Crystal",crystal:"Crystal",cypher:"Cypher",d:"D",diff:"Diff",eiffel:"Eiffel",elm:"Elm",erl:"Erlang",erlang:"Erlang",f90:"Fortran",f95:"Fortran",factor:"Factor",feature:"Gherkin",forth:"Forth",fortran:"Fortran",fsharp:"ML",gas:"Gas",gherkin:"Gherkin",groovy:"Groovy",haskell:"Haskell",haxe:"Haxe",hs:"Haskell",http:"HTTP",hx:"Haxe",ini:"Properties",jade:"Pug",jinja:"Jinja2",jinja2:"Jinja2",jl:"Julia",julia:"Julia",latex:"LaTeX",livescript:"LiveScript",ls:"LiveScript",lua:"Lua",mathematica:"Mathematica",matlab:"Octave",ml:"ML",nginx:"nginx",ocaml:"ML",octave:"Octave",oz:"Oz",pas:"Pascal",pascal:"Pascal",patch:"Diff",perl:"Perl",pl:"Perl",pm:"Perl",pp:"Puppet",properties:"Properties",proto:"Protobuf",protobuf:"Protobuf",pug:"Pug",puppet:"Puppet",r:"R",rq:"SPARQL",s:"Gas",sas:"SAS",sass:"Sass",scheme:"Scheme",scm:"Scheme",scss:"Sass",smalltalk:"Smalltalk",sml:"ML",sparql:"SPARQL",st:"Smalltalk",styl:"Stylus",stylus:"Stylus",sv:"Verilog",tcl:"Tcl",tex:"LaTeX",textile:"Textile",ttl:"Turtle",turtle:"Turtle",vb:"VB",verilog:"Verilog",vhdl:"VHDL",wasm:"WebAssembly",wast:"WebAssembly",webidl:"WebIDL",wl:"Mathematica",xq:"XQuery",xquery:"XQuery"},Hd=z.define(Bu).parser,zd=z.define(Nu).parser,qd=z.define(Iu).parser,Gd=z.define(Fu).parser,Kd=z.define(Ou).parser,Wd=z.define(Hu).parser,ba=z.define(zu).parser,Ud=z.define(qu).parser,ya=z.define(Gu).parser,wa=z.define(Ku).parser,Yd=z.define(Wu).parser,Vd=z.define(Uu).parser,va=z.define(Yu).parser,Jd=z.define(Vu).parser,Qd=z.define(Ju).parser,Sa=z.define(Qu).parser,Xd=z.define(Xu).parser,Zd=z.define(Zu).parser,Ts=z.define(ed).parser,Ms=z.define(td).parser,$a=z.define(nd).parser,ep=z.define(rd).parser,ka=z.define(od).parser,xa=z.define(sd).parser,tp=z.define(id).parser,_a=z.define(ad).parser,Ea=z.define(cd).parser,Ca=z.define(ld).parser,np=z.define(ud).parser,Aa=z.define(dd).parser,lr=z.define(pd).parser,rp=z.define(fd).parser,Ra=z.define(md).parser,op=z.define(gd).parser,Pa=z.define(hd).parser,Ds=z.define(bd).parser,La=z.define(yd).parser,Ta=z.define(wd).parser,Ma=z.define(vd).parser,Da=z.define(Sd).parser,sp=z.define($d).parser,ip=z.define(kd).parser,ja=z.define(xd).parser,Ia=z.define(_d).parser,Na=z.define(Ed).parser,ap=z.define(Cd).parser,Fa=z.define(Ad).parser,js=z.define(Rd).parser,Ba=z.define(Pd).parser,cp=z.define(Ld).parser,lp=z.define(Td).parser,Oa=z.define(Md).parser,up=z.define(Dd).parser,Ha=z.define(jd).parser,dp=z.define(Id).parser,za=z.define(Nd).parser,pp=z.define(Fd).parser,qa=z.define(Bd).parser;function Rt(l){let h=String(l||"").trim().toLowerCase();if(!h)return"text";return Od[h]||String(l||"").trim()}function _t(l){switch(String(l||"").trim().toLowerCase()){case"js":case"javascript":return _u.parser;case"ts":case"typescript":return Au.parser;case"jsx":return Eu.parser;case"tsx":return Cu.parser;case"py":case"python":return Lu.parser;case"json":return Ru.parser;case"css":return Su.parser;case"html":return xu.parser;case"xml":return Du.parser;case"yaml":case"yml":return ju.parser;case"md":case"markdown":return Pu.parser;case"sql":return Mu.language.parser;case"go":return ku.parser;case"c":case"cc":case"cpp":case"cxx":case"c++":case"h":case"hh":case"hpp":case"hxx":return $u.parser;case"sh":case"bash":case"shell":case"zsh":return Hd;case"ps1":case"powershell":return zd;case"dockerfile":return qd;case"rb":case"ruby":return Gd;case"rs":case"rust":return Tu.parser;case"swift":return Kd;case"toml":return Wd;case"asm":return Ms;case"clj":return ba;case"clojure":return ba;case"cmake":return Ud;case"coffee":return ya;case"coffeescript":return ya;case"cr":return wa;case"crystal":return wa;case"cypher":return Yd;case"d":return Vd;case"diff":return va;case"eiffel":return Jd;case"elm":return Qd;case"erl":return Sa;case"erlang":return Sa;case"f90":return Ts;case"f95":return Ts;case"factor":return Xd;case"feature":return $a;case"forth":return Zd;case"fortran":return Ts;case"fsharp":return lr;case"gas":return Ms;case"gherkin":return $a;case"groovy":return ep;case"haskell":return ka;case"haxe":return xa;case"hs":return ka;case"http":return tp;case"hx":return xa;case"ini":return La;case"jade":return Ma;case"jinja":return _a;case"jinja2":return _a;case"jl":return Ea;case"julia":return Ea;case"latex":return js;case"livescript":return Ca;case"ls":return Ca;case"lua":return np;case"mathematica":return Aa;case"matlab":return Ra;case"ml":return lr;case"mllike":return lr;case"nginx":return rp;case"ocaml":return lr;case"octave":return Ra;case"oz":return op;case"pas":return Pa;case"pascal":return Pa;case"patch":return va;case"perl":return Ds;case"pl":return Ds;case"pm":return Ds;case"pp":return Da;case"properties":return La;case"proto":return Ta;case"protobuf":return Ta;case"pug":return Ma;case"puppet":return Da;case"r":return sp;case"rq":return Fa;case"s":return Ms;case"sas":return ip;case"sass":return ja;case"scheme":return Ia;case"scm":return Ia;case"scss":return ja;case"smalltalk":return Na;case"sml":return lr;case"solr":return ap;case"sparql":return Fa;case"st":return Na;case"stex":return js;case"styl":return Ba;case"stylus":return Ba;case"sv":return Ha;case"tcl":return cp;case"tex":return js;case"textile":return lp;case"ttl":return Oa;case"turtle":return Oa;case"vb":return up;case"verilog":return Ha;case"vhdl":return dp;case"wasm":return za;case"wast":return za;case"webidl":return pp;case"wl":return Aa;case"xq":return qa;case"xquery":return qa;default:return null}}function Pe(l,h){if(String(l||"").length>Ka)return qe(l);let f=_t(h);if(!f)return qe(l);let w=[];try{let E=f.parse(l);Ga(E,Ls,(R,L,P)=>{if(!P||R>=L)return;w.push({from:R,to:L,cls:P})})}catch{return qe(l)}if(!w.length)return qe(l);w.sort((E,R)=>E.from-R.from||E.to-R.to);let S=0,k="";for(let E of w){if(E.from>S)k+=qe(l.slice(S,E.from));k+=`<span class="${qe(E.cls)}">${qe(l.slice(E.from,E.to))}</span>`,S=Math.max(S,E.to)}if(S<l.length)k+=qe(l.slice(S));return k}function fr(l,h){let f=String(l||"").split(`
`);if(!l)return f;if(String(l||"").length>Ka)return f.map((P)=>qe(P)||"&nbsp;");let w=_t(h);if(!w)return f.map((P)=>qe(P));let S=[];try{let P=w.parse(l);Ga(P,Ls,(j,N,B)=>{if(!B||j>=N)return;S.push({from:j,to:N,cls:B})})}catch{return f.map((P)=>qe(P))}if(!S.length)return f.map((P)=>qe(P));S.sort((P,j)=>P.from-j.from||P.to-j.to);let k=[],E=0;for(let P of f)k.push(E),E+=P.length+1;let R=[],L=0;for(let P=0;P<f.length;P+=1){let j=k[P],N=j+f[P].length,B="",U=j;while(L<S.length&&S[L].to<=j)L+=1;for(let q=L;q<S.length;q+=1){let Q=S[q];if(Q.from>=N)break;let Y=Math.max(j,Q.from),W=Math.min(N,Q.to);if(Y>U)B+=qe(l.slice(U,Y));if(W>Y)B+=`<span class="${qe(Q.cls)}">${qe(l.slice(Y,W))}</span>`;U=Math.max(U,W)}if(U<N)B+=qe(l.slice(U,N));R.push(B||"&nbsp;")}return R}function tt(l){let h=(l.match(/\.([^.]+)$/)||[])[1]?.toLowerCase()||"",f={ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",cjs:"javascript",py:"python",rb:"ruby",rs:"rust",go:"go",java:"java",c:"c",h:"c",cc:"cpp",cpp:"cpp",cxx:"cpp",hpp:"cpp",hxx:"cpp",cs:"csharp",swift:"swift",kt:"kotlin",sh:"shell",bash:"bash",zsh:"zsh",fish:"shell",ps1:"powershell",psm1:"powershell",json:"json",yaml:"yaml",yml:"yaml",toml:"toml",xml:"xml",html:"html",htm:"html",css:"css",scss:"sass",sass:"sass",sql:"sql",graphql:"graphql",gql:"graphql",dockerfile:"dockerfile",makefile:"makefile",lua:"lua",perl:"perl",pl:"perl",pm:"perl",r:"r",jl:"julia",hs:"haskell",erl:"erlang",clj:"clojure",scm:"scheme",elm:"elm",ex:"elixir",exs:"elixir",proto:"protobuf",tf:"hcl",diff:"diff",patch:"diff",ini:"properties",conf:"nginx",cfg:"properties",v:"verilog",sv:"verilog",vhd:"vhdl",vhdl:"vhdl",pas:"pascal",f90:"fortran",f95:"fortran",cmake:"cmake",groovy:"groovy",gradle:"groovy",tex:"stex",latex:"stex",bib:"stex",d:"d",nim:"nim",zig:"zig",pug:"pug",jade:"pug",styl:"stylus",coffee:"coffeescript",tcl:"tcl",ml:"mllike",sml:"mllike",fs:"mllike",wasm:"wast",wat:"wast",pp:"puppet",feature:"gherkin",ttl:"turtle",rq:"sparql",xq:"xquery"},w=l.split("/").pop()?.toLowerCase()||"";if(w==="dockerfile"||w.startsWith("dockerfile."))return"dockerfile";if(w==="makefile"||w==="gnumakefile")return"cmake";if(w===".env"||w.endsWith(".env"))return"properties";if(w==="cmakelists.txt")return"cmake";if(w==="vagrantfile"||w==="rakefile"||w==="gemfile")return"ruby";return f[h]||""}var ur=null,Is=new WeakSet;function fp(){if(window.piclawDiagrams)return Promise.resolve();if(ur)return ur;let l=document.createElement("script");return l.src="/static/common/js/vendor/pele.js",ur=new Promise((h,f)=>{l.onload=()=>window.piclawDiagrams?h():f(Error("Mermaid library failed to load")),l.onerror=()=>f(Error("Mermaid library failed to load")),document.head.append(l)}).catch((h)=>{throw l.remove(),ur=null,h}),ur}function Wa(l){if(/(?:https?:\/\/|data:|blob:|\/\/)/i.test(l))return!1;return Array.from(l.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(f)=>f[2]?.trim()||"").every((f)=>/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(f))}function mp(l){let h=Uint8Array.from(atob(l),(w)=>w.charCodeAt(0)),f=new TextDecoder().decode(h);for(let w=0;w<2;w++){let S=f.replace(/</g,"&lt;").replace(/>/g,"&gt;"),k=new DOMParser().parseFromString(S,"text/html").documentElement.textContent||"";if(f===k)break;f=k}return f}async function Ua(l,h={}){let w=Array.from(l.querySelectorAll(".mermaid-container[data-mermaid]")).filter((k)=>!Is.has(k));for(let k of w)Is.add(k);if(!w.length)return;try{await fp();for(let k of w){let E=k.dataset.mermaid;if(!l.contains(k)||E===void 0)continue;try{let R=mp(E);if(h.scoped&&!Wa(R))throw Error("External Mermaid resources are unavailable in this view.");let L=window.piclawDiagrams.render(R),P=window.piclawDiagrams.sanitize;if(typeof P!=="function")throw Error("Diagram sanitizer is unavailable");k.innerHTML=P(L),k.removeAttribute("data-mermaid")}catch(R){S(k,R)}}}catch(k){for(let E of w)if(l.contains(E)&&E.hasAttribute("data-mermaid"))S(E,k)}finally{for(let k of w)Is.delete(k)}function S(k,E){h.reportError?.(E);let R=document.createElement("pre");R.className="mermaid-error",R.textContent="Diagram error: "+(E instanceof Error?E.message:String(E)),k.replaceChildren(R),k.removeAttribute("data-mermaid")}}var Ns={background:"#ffffff",foreground:"#18212b",muted:"#536171",accent:"#0969da",border:"#b6bec8",surface:"#f3f5f7",success:"#1a7f37",warning:"#9a6700",danger:"#cf222e"},Ya={background:"#171b22",foreground:"#e6edf3",muted:"#a2afbf",accent:"#79c0ff",border:"#586577",surface:"#242b36",success:"#7ee787",warning:"#e3b341",danger:"#ff7b72"};function Va(l="theme"){if(l==="light")return{...Ns};if(l==="dark")return{...Ya};if(typeof document>"u")return{...Ns};let h=document.documentElement,w=(h.dataset.theme||(h.classList.contains("dark")?"dark":h.classList.contains("light")?"light":typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))==="dark"?Ya:Ns;if(!document.body)return{...w};let S=document.createElement("span");S.style.display="none",document.body.append(S);try{return Object.fromEntries(Object.entries({background:"--bg-primary",foreground:"--text-primary",muted:"--text-secondary",accent:"--accent-color",border:"--border-color",surface:"--bg-secondary",success:"--success-color",warning:"--warning-color",danger:"--danger-color"}).map(([E,R])=>(S.style.color=`var(${R}, ${w[E]})`,[E,getComputedStyle(S).color])))}finally{S.remove()}}var Vf=Object.freeze({bg:"var(--bg-primary, #ffffff)",fg:"var(--text-primary, #18212b)",line:"var(--text-secondary, #536171)",accent:"var(--accent-color, #0969da)",muted:"var(--text-secondary, #536171)",surface:"var(--bg-secondary, #f3f5f7)",border:"var(--border-color, #b6bec8)"});var En=Object.freeze({bytes:262144,nodes:2048,depth:32,dimension:2048}),co="http://www.w3.org/2000/svg",Ja=new Set(["svg","g","defs","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","title","desc","linearGradient","radialGradient","stop","clipPath"]),gp=new Set(["x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","width","height","dx","dy","stroke-width","stroke-dashoffset","font-size"]),hp=new Set(["opacity","fill-opacity","stroke-opacity","stop-opacity","stroke-miterlimit","offset"]),Qa={"fill-rule":["nonzero","evenodd"],"clip-rule":["nonzero","evenodd"],"stroke-linecap":["butt","round","square"],"stroke-linejoin":["miter","round","bevel"],"text-anchor":["start","middle","end"],"dominant-baseline":["auto","middle","central","hanging","text-before-edge","text-after-edge","alphabetic"],"font-family":["sans-serif","serif","monospace"],"font-weight":["normal","bold","100","200","300","400","500","600","700","800","900"],"font-style":["normal","italic","oblique"],gradientUnits:["objectBoundingBox","userSpaceOnUse"],clipPathUnits:["userSpaceOnUse","objectBoundingBox"],spreadMethod:["pad","reflect","repeat"]},bp=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,Bs=/^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)$/;function Os(l){let h="";for(let f of new TextEncoder().encode(l))h+=String.fromCharCode(f);return btoa(h)}function Rn(l){return new TextDecoder().decode(Uint8Array.from(atob(l),(h)=>h.charCodeAt(0)))}function Hs(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function uo(l){return bp.test(l)&&Number.isFinite(Number(l))&&Math.abs(Number(l))<=1e6}function lo(l){let h=l.trim().split(/[\s,]+/);return h.length&&h.every(uo)?h.map(Number):null}function yp(l,h){if(l==="id")return/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(h);if(gp.has(l))return uo(h.replace(/(?:px|%)$/,""));if(hp.has(l))return uo(h.replace(/%$/,""));if(Object.hasOwn(Qa,l))return Qa[l].includes(h);if(["fill","stroke","color","stop-color"].includes(l))return/^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+,\s/-]+\))$/i.test(h)||Bs.test(h);if(l==="clip-path")return h==="none"||Bs.test(h);if(l==="viewBox"){let f=lo(h);return!!f&&f.length===4&&f[2]>0&&f[3]>0}if(l==="points"||l==="stroke-dasharray")return h==="none"||lo(h)!==null;if(l==="d")return/^[MmZzLlHhVvCcSsQqTtAa\dEe+.,\s-]*$/.test(h);if(l==="transform"||l==="gradientTransform")return h.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/g,(w,S)=>lo(S)?"":w).trim()==="";return!1}var sn=new Map,wp=8,Xa=2097152,Fs=0;function Za(l,h="theme"){if(l.length>En.bytes)return null;let f=Va(h),w=JSON.stringify(f)+l,S=sn.get(w);if(S)return sn.delete(w),sn.set(w,S),S.image;let k=vp(l,f),E=2*(w.length+(k?.src.length||0)+(k?.label.length||0));if(E<=Xa){while(sn.size>=wp||Fs+E>Xa){let R=sn.keys().next().value;Fs-=sn.get(R).size,sn.delete(R)}sn.set(w,{image:k,size:E}),Fs+=E}return k}function vp(l,h){if(l.length>En.bytes||new TextEncoder().encode(l).byteLength>En.bytes)return null;if(/<!\s*(?:DOCTYPE|ENTITY)|<\?/i.test(l))return null;let f=new DOMParser().parseFromString(l,"image/svg+xml"),w=f.documentElement;if(!w||w.localName!=="svg"||f.querySelector("parsererror")||f.doctype)return null;let S=[{node:w,depth:1}],k=0;while(S.length){let{node:W,depth:X}=S.pop();if(++k>En.nodes||X>En.depth)return null;for(let H=W.lastChild;H;H=H.previousSibling){if(k+S.length>=En.nodes)return null;S.push({node:H,depth:X+(H.nodeType===1?1:0)})}}let E=document.implementation.createDocument(co,"svg",null),R=new Map,L=[];function P(W,X,H){if(W.hasAttribute("xmlns")&&W.getAttribute("xmlns")!==co)return!1;if(W.namespaceURI!==w.namespaceURI||W.namespaceURI&&W.namespaceURI!==co||W.prefix||!Ja.has(W.localName))return!1;if(W!==w&&W.localName==="svg")return!1;let ce=H||["defs","clipPath","linearGradient","radialGradient"].includes(W.localName);for(let xe of Array.from(W.attributes)){if(xe.namespaceURI||xe.prefix)continue;let de=xe.name,Ne=xe.value.trim();if(["fill","stroke","color","stop-color"].includes(de)){let cn=Ne.match(/^var\(--svg-(background|foreground|muted|accent|border|surface|success|warning|danger)\)$/);if(cn)Ne=h[cn[1]]}if(!yp(de,Ne))continue;let Kt=Ne.match(Bs);if(Kt){if(ce||!["fill","stroke","clip-path"].includes(de))continue;L.push({element:X,name:de,id:Kt[1]})}if(de==="id"){if(R.has(Ne))return!1;R.set(Ne,X)}X.setAttribute(de,Ne)}for(let xe of Array.from(W.childNodes))if(xe.nodeType===1){let de=xe;if(!Ja.has(de.localName))return!1;let Ne=E.createElementNS(co,de.localName);if(!P(de,Ne,ce))return!1;X.appendChild(Ne)}else if(xe.nodeType===3||xe.nodeType===4)X.appendChild(E.createTextNode(xe.nodeValue||""));else if(xe.nodeType!==8)return!1;return!0}if(!P(w,E.documentElement,!1))return null;for(let W of L){let X=R.get(W.id)?.localName;if(!(W.name==="clip-path"?X==="clipPath":X==="linearGradient"||X==="radialGradient"))W.element.removeAttribute(W.name)}let j=E.documentElement;if(!j.hasAttribute("color"))j.setAttribute("color",h.foreground);if(!j.hasAttribute("fill"))j.setAttribute("fill","currentColor");let N=lo(j.getAttribute("viewBox")||""),B=(W,X)=>{let H=j.getAttribute(W)?.replace(/px$/,"")||"";return uo(H)&&Number(H)>0?Number(H):X},U=B("width",N?.[2]||300),q=B("height",N?.[3]||150),Q=Math.min(1,En.dimension/Math.max(U,q));if(j.setAttribute("width",String(U*Q)),j.setAttribute("height",String(q*Q)),!N)j.setAttribute("viewBox",`0 0 ${U} ${q}`);j.setAttribute("preserveAspectRatio","xMidYMid meet");let Y=(j.querySelector("title")?.textContent?.trim()||j.querySelector("desc")?.textContent?.trim()||"Model-generated SVG").replace(/\s+/g," ").slice(0,256);return Object.freeze({src:`data:image/svg+xml;base64,${Os(new XMLSerializer().serializeToString(j))}`,label:Y})}function ec(l,h,f,w={}){if(!/^ {0,3}(?:`{3,}|~{3,})svg\s*$/im.test(l))return h(l);let S=l.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean)||[],k=null,E=/^(?:\uFEFF)?---(?:\r?\n|\r)/.test(l),R=0,L=[],P=[],j=`PICLAWSVG${Array.from(crypto.getRandomValues(new Uint32Array(4)),(B)=>B.toString(16)).join("")}BLOCK`;for(let B=0;B<S.length;B++){let U=S[B].replace(/[\r\n]+$/,"");if(E){if(B>0&&/^(---|\.\.\.)\s*$/.test(U))E=!1;continue}if(k){if(new RegExp(`^ {0,3}${k.char}{${k.length},}\\s*$`).test(U))k=null;continue}let q=U.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(!q)continue;if(k={char:q[1][0],length:q[1].length},!/^svg\s*$/i.test(q[2]))continue;let Q=new RegExp(`^ {0,3}${k.char}{${k.length},}\\s*$`),Y=B+1;while(Y<S.length&&!Q.test(S[Y].replace(/[\r\n]+$/,"")))Y++;if(B>R)L.push(S.slice(R,B).join(""));let W=S.slice(B+1,Y).join(""),X=w.sanitize===!1?null:Y<S.length?Za(W):null,H=f(W);L.push(`

${j}${P.length}END

`),P.push(w.sanitize===!1&&Y<S.length?W:X?`<div class="model-svg-block" data-svg-surface="theme"><div class="model-svg-controls"><label>SVG background <select class="model-svg-surface" aria-label="SVG background"><option value="theme">Theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><img class="model-svg-image" src="${X.src}" alt="${Hs(X.label)}"><details class="model-svg-source"><summary>SVG source</summary>${H}</details></div>`:H),B=Y,R=Y+1,k=null}if(!P.length)return h(l);if(R<S.length)L.push(S.slice(R).join(""));return h(L.join("")).replace(new RegExp(`(?:<p>)?${j}(\\d+)END(?:<\\/p>)?`,"g"),(B,U)=>P[Number(U)])}function mr(l){let h=Array.from(l.querySelectorAll(".model-svg-block"));if(!h.length)return()=>{};let f=(k)=>{let E=k.dataset.svgSurface,R=k.querySelector(".model-svg-image"),L=k.querySelector("[data-svg-source], .code-block__copy[data-code]");if(!R||!L)return;let P=Za(Rn(L.dataset.svgSource||L.dataset.code||""),E);if(P&&R.getAttribute("src")!==P.src)R.src=P.src},w=()=>h.forEach((k)=>{if(k.dataset.svgSurface==="theme")f(k)}),S=(k)=>{let E=k.target;if(!E?.matches(".model-svg-surface"))return;let R=E.closest(".model-svg-block");if(!R||!["theme","light","dark"].includes(E.value))return;R.dataset.svgSurface=E.value,f(R)};return l.addEventListener("change",S),window.addEventListener("piclaw-theme-change",w),w(),()=>{l.removeEventListener("change",S),window.removeEventListener("piclaw-theme-change",w)}}function tc(l){if(typeof l!=="string"||!l.trim()||l.length>2048)throw Error("Provide a GitHub/Gitea repository web URL.");let h=l.trim();if(!/^https?:\/\//i.test(h)||/[\\\s]/.test(h))throw Error("Repository URL must use HTTP or HTTPS.");let f=new URL(h);if(!["http:","https:"].includes(f.protocol)||f.username||f.password||f.search||f.hash)throw Error("Repository URL cannot contain credentials, a query or a fragment.");let w=f.pathname.replace(/\/+$/,"").split("/").slice(1);if(w.length<2||w.some((R)=>!/^[a-zA-Z0-9_.-]+$/.test(R)||R==="."||R===".."))throw Error("Use a repository URL ending in owner/repository (an installation subpath is allowed).");if(h.slice(h.indexOf("://")+3).split("/").slice(1).some((R)=>R==="."||R===".."))throw Error("Repository URL cannot contain traversal segments.");if(w.at(-1).endsWith(".git"))w[w.length-1]=w.at(-1).slice(0,-4);if(!w.at(-1))throw Error("Repository name is required.");if(f.hostname.toLowerCase()==="github.com"&&w.length!==2)throw Error("GitHub repository URLs must end at github.com/owner/repository.");if(f.hostname.toLowerCase()!=="github.com"&&w.length!==2&&w.length!==3)throw Error("Gitea repository URLs must be owner/repository or installation-base/owner/repository.");let k=new Set(["issues","issue","pulls","pull","explore","src","commits","commit","actions","releases","projects","settings","wiki","compare","branches","tags","milestones"]),E=w.at(-1).toLowerCase();if(w.some((R)=>k.has(R.toLowerCase()))||/^\d+$/.test(E))throw Error("Repository URL must identify a repository root, not an issue, pull request or explorer page.");return`${f.origin}/${w.join("/")}`}function nc(l,h=null,f=!0){if(typeof DOMParser>"u")return l;let w=null;if(h)try{w=tc(h)}catch{w=null}let S=new DOMParser().parseFromString(l,"text/html"),k=S.createTreeWalker(S.body,NodeFilter.SHOW_TEXT),E=[];while(k.nextNode())E.push(k.currentNode);for(let R of E){if(R.parentElement?.closest("a, code, pre, script, style, svg, math, .katex"))continue;let L=R.nodeValue||"",P=[...L.matchAll(/#(\w+)/g)];if(!P.length)continue;let j=S.createDocumentFragment(),N=0;for(let B of P){let U=B.index,q=U+B[0].length,Q=B[1];if(j.append(S.createTextNode(L.slice(N,U))),N=q,/^\d+$/.test(Q)){let Y=L[U-1]||"",W=L[q]||"",X=!Y||/[\s([{>,;:!?]/.test(Y);if(!w||!/^[1-9]\d*$/.test(Q)||!X||/[\p{L}\p{N}_/\-]/u.test(W)){j.append(S.createTextNode(B[0]));continue}let H=S.createElement("a");H.href=`${w}/issues/${Q}`,H.className="project-reference",H.target="_blank",H.rel="noopener noreferrer",H.title=`${w} #${Q}`,H.textContent=B[0],j.append(H)}else{if(!f){j.append(S.createTextNode(B[0]));continue}let Y=S.createElement("a");Y.href="#",Y.className="hashtag",Y.setAttribute("data-hashtag",Q),Y.textContent=B[0],j.append(Y)}}j.append(S.createTextNode(L.slice(N))),R.replaceWith(j)}return S.body.innerHTML}var Sp=new Set(["code","pre","strong","em","b","i","u","s","del","ins","sub","sup","mark","small","br","p","ul","ol","li","blockquote","ruby","rt","rp","span","input"]),$p=new Set(["a","abbr","blockquote","br","code","del","div","em","hr","h1","h2","h3","h4","h5","h6","i","img","input","ins","kbd","li","mark","ol","p","pre","ruby","rt","rp","s","small","span","strong","sub","sup","table","tbody","td","th","thead","tr","u","ul","math","semantics","mrow","mi","mn","mo","mtext","mspace","msup","msub","msubsup","mfrac","msqrt","mroot","mtable","mtr","mtd","annotation","svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]),kp=new Set(["class","title","role","aria-hidden","aria-label","aria-expanded","aria-live","data-mermaid","data-hashtag"]),xp={a:new Set(["href","target","rel"]),img:new Set(["src","alt","title"]),input:new Set(["type","checked","disabled"])},_p=new Set(["http:","https:","mailto:",""]),zs=new Set(["svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]);function Ep(l,h){let f=String(l||"").toLowerCase(),w=String(h||"").toLowerCase();if(!w||w.startsWith("on"))return!1;if(w.startsWith("data-")||w.startsWith("aria-"))return!0;if(zs.has(f))return!0;return(xp[f]||new Set).has(w)||kp.has(w)}function qn(l){return String(l||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;")}function Me(l,h={}){if(!l)return null;let f=String(l).trim();if(!f)return null;if(f.startsWith("#")||f.startsWith("/"))return f;if(f.startsWith("data:")){if(h.allowDataImage&&/^data:image\//i.test(f))return f;return null}if(f.startsWith("blob:"))return f;try{let w=new URL(f,typeof window<"u"?window.location.origin:"http://localhost");if(!_p.has(w.protocol))return null;return w.href}catch{return null}}function rc(l,h={}){if(!l)return"";if(h?.sanitize===!1)return l;let f=new DOMParser().parseFromString(l,"text/html"),w=[],S=f.createTreeWalker(f.body,NodeFilter.SHOW_ELEMENT),k;while(k=S.nextNode())w.push(k);for(let E of w){let R=E.tagName.toLowerCase();if(!$p.has(R)){let L=E.parentNode;if(!L)continue;while(E.firstChild)L.insertBefore(E.firstChild,E);L.removeChild(E);continue}for(let L of Array.from(E.attributes)){let P=L.name.toLowerCase(),j=L.value;if(P.startsWith("on")){E.removeAttribute(L.name);continue}if(Ep(R,P)){if(zs.has(R)&&typeof h.rewriteImageSrc==="function"){let N=Array.from(j.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(U)=>U[2]?.trim()||"");if(/(?:https?:|data:|blob:|\/\/)/i.test(j)||N.some((U)=>!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(U))){E.removeAttribute(L.name);continue}}if(P==="href"||P==="xlink:href"){let N=typeof h.rewriteImageSrc==="function"&&zs.has(R)?/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(j.trim())?j.trim():h.rewriteImageSrc(j):j,B=Me(N);if(!B)E.removeAttribute(L.name);else if(E.setAttribute(L.name,B),R==="a"){if(!E.getAttribute("rel"))E.setAttribute("rel","noopener noreferrer");if(/^https?:\/\//i.test(B))E.setAttribute("target","_blank")}}else if(P==="src"){let N=typeof h.rewriteImageSrc==="function"&&(R==="img"||R==="image")?h.rewriteImageSrc(j):j,B=Me(N,{allowDataImage:R==="img"&&typeof h.rewriteImageSrc!=="function"});if(!B)E.removeAttribute(L.name);else E.setAttribute(L.name,B)}continue}E.removeAttribute(L.name)}}return f.body.innerHTML}function qs(l){if(!l)return l;let h=l.replace(/</g,"&lt;").replace(/>/g,"&gt;");return new DOMParser().parseFromString(h,"text/html").documentElement.textContent}function Cp(l,h=2){if(!l)return l;let f=l;for(let w=0;w<h;w+=1){let S=qs(f);if(S===f)break;f=S}return f}function Ap(l){if(!l)return{text:"",frontmatter:null};let h=l.replace(/^\uFEFF/,"").replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!h.startsWith(`---
`))return{text:h,frontmatter:null};let f=h.split(`
`),w=-1;for(let E=1;E<f.length;E+=1)if(/^(---|\.\.\.)\s*$/.test(f[E])){w=E;break}if(w<=0)return{text:h,frontmatter:null};let S=f.slice(1,w).join(`
`);return{text:f.slice(w+1).join(`
`).replace(/^\n+/,""),frontmatter:S}}function Rp(l){let{text:h,frontmatter:f}=Ap(l);if(f===null)return h;return["<!--frontmatter-block-start-->","```yaml",f,"```","<!--frontmatter-block-end-->",h].filter(Boolean).join(`

`)}function Pp(l){if(!l)return l;return Cp(l,5)}function Lp(l){let h=new TextEncoder().encode(String(l||"")),f="";for(let w of h)f+=String.fromCharCode(w);return btoa(f)}function Tp(l){if(!l)return l;return l.replace(/<pre><code(?:\s+class="language-([A-Za-z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/g,(f,w,S)=>{let k=String(w||"").trim().toLowerCase(),E=qs(S),R=k||"plaintext",L=Pe(E,k);return`<pre><code class="hljs language-${qn(R)}">${L}</code></pre>`}).replace(/<!--frontmatter-block-start-->\s*<pre>/g,'<pre class="frontmatter-block">').replace(/<\/pre>\s*<!--frontmatter-block-end-->/g,"</pre>")}var Mp={span:new Set(["title","class","lang","dir"]),input:new Set(["type","checked","disabled"])};function Dp(l,h){let f=Mp[l];if(!f||!h)return"";let w=[],S=/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g,k;while(k=S.exec(h)){let E=(k[1]||"").toLowerCase();if(!E||E.startsWith("on")||!f.has(E))continue;let R=k[2]??k[3]??k[4]??"";w.push(` ${E}="${qn(R)}"`)}return w.join("")}function jp(l){if(!l)return l;return l.replace(/&lt;((?:[^"'<>]|"[^"]*"|'[^']*')*?)(?:&gt;|>)/g,(h,f)=>{let w=f.trim(),S=w.startsWith("/"),k=S?w.slice(1).trim():w,R=k.endsWith("/")?k.slice(0,-1).trim():k,[L=""]=R.split(/\s+/,1),P=L.toLowerCase();if(!P||!Sp.has(P))return h;if(P==="br")return S?"":"<br>";if(S)return`</${P}>`;let j=R.slice(L.length).trim(),N=Dp(P,j);return`<${P}${N}>`})}function oc(l,h=!0){if(typeof l.text!=="string")return;if(l.type==="code"&&h){let f=l.lang?.trim().toLowerCase();if(f==="mermaid"){l.type="html",l.text=`<div class="mermaid-container" data-mermaid="${Lp(Pp(l.text))}"><div class="mermaid-loading">Loading diagram...</div></div>`;return}if(f&&["math","katex","latex"].includes(f)){l.type="html",l.text=`<p>$$
${qn(l.text)}
$$</p>
`;return}}if(l.type!=="html")return;if(/^<!--frontmatter-block-(?:start|end)-->\s*$/.test(l.text))return;l.text=jp(l.text.replace(/</g,"&lt;"))}function Ip(l){if(!window.katex)return l;let h=(E)=>qs(E).replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&").replace(/<br\s*\/?\s*>/gi,`
`),f=(E)=>{let R=[],L=E.replace(/<pre\b[^>]*>\s*<code\b[^>]*>[\s\S]*?<\/code>\s*<\/pre>/gi,(P)=>{let j=R.length;return R.push(P),`@@CODE_BLOCK_${j}@@`});return L=L.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi,(P)=>{let j=R.length;return R.push(P),`@@CODE_INLINE_${j}@@`}),{html:L,blocks:R}},w=(E,R)=>{if(!R.length)return E;return E.replace(/@@CODE_(?:BLOCK|INLINE)_(\d+)@@/g,(L,P)=>{let j=Number(P);return R[j]??""})},S=f(l),k=S.html;return k=k.replace(/(^|\n|<br\s*\/?\s*>|<p>|<\/p>)\s*\$\$([\s\S]+?)\$\$\s*(?=\n|<br\s*\/?\s*>|<\/p>|$)/gi,(E,R,L)=>{try{let P=katex.renderToString(h(L.trim()),{displayMode:!0,throwOnError:!1});return`${R}${P}`}catch(P){let j=P instanceof Error?P.message:String(P);return`<span class="math-error" title="${qn(j)}">${E}</span>`}}),w(k,S.blocks)}function Np(l,h=null){return nc(l,h)}function Fp(l){return{safeHtml:Rp(l||"")}}var Bp=new Set(["NOTE","TIP","IMPORTANT","WARNING","CAUTION"]),Op={NOTE:"Note",TIP:"Tip",IMPORTANT:"Important",WARNING:"Warning",CAUTION:"Caution"};function Hp(l){return l.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>\s*)?(\n)?/gi,(h,f,w)=>{let S=f.toUpperCase();if(!Bp.has(S))return h;let k=Op[S]||S;return`<div class="admonition admonition-${S.toLowerCase()}"><p class="admonition-title">${k}</p><p>`}).replace(/(<div class="admonition admonition-[a-z]+">(?:(?!<\/div>)[\s\S])*?)<\/blockquote>/g,(h,f)=>`${f}</div>`)}function y(l,h,f={}){if(!l)return"";return ec(l,(w)=>zp(w,f),(w)=>`<pre><code class="language-svg" data-svg-source="${Os(w)}">${Hs(w)}</code></pre>`,{sanitize:typeof window>"u"||window.__PICLAW_SANITIZE_SVG_FENCES__!==!1})}function zp(l,h){let{safeHtml:f}=Fp(l),w=window.marked?marked.parse(f,{headerIds:!1,mangle:!1,walkTokens:oc}):qn(f).replace(/\n/g,"<br>");return w=Tp(w),w=Ip(w),w=Np(w,h.projectRepository),w=Hp(w),w=rc(w,h),w}function K(l){if(!l)return"";let h=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`),f=window.marked?marked.parse(h,{walkTokens:(w)=>oc(w,!1)}):qn(h).replace(/\n/g,"<br>");return f=rc(f),f}async function G(l,h={}){await Ua(l,{scoped:typeof h.rewriteImageSrc==="function",reportError:(f)=>console.error("Mermaid render error:",f)})}function De(l){if(!l||typeof l!=="object")return null;let h=l.started_at??l.startedAt;if(typeof h!=="string"||!h)return null;let f=Date.parse(h);return Number.isFinite(f)?f:null}function qp(l){if(!l||typeof l!=="object")return null;let h=l.retry_at??l.retryAt;if(typeof h!=="string"||!h)return null;let f=Date.parse(h);return Number.isFinite(f)?f:null}function pe(l){if(!l||typeof l!=="object")return null;let h=l.last_event_at??l.lastEventAt??l.started_at??l.startedAt;if(typeof h!=="string"||!h)return null;let f=Date.parse(h);return Number.isFinite(f)?f:null}function J(l){if(!l||typeof l!=="object")return!1;let h=l.intent_key??l.intentKey;return l.type==="intent"&&h==="compaction"}function Pt(l){if(!l||typeof l!=="object")return"";let h=l.title;if(typeof h==="string"&&h.trim())return h.trim();let f=l.tool_name??l.toolName;if(typeof f==="string"&&f.trim())return f.trim();let w=l.status;if(typeof w==="string"&&w.trim())return w.trim();return J(l)?"Compacting context":"Thinking..."}function sc(l){let h=Math.max(0,Math.floor(l/1000)),f=h%60,w=Math.floor(h/60)%60,S=Math.floor(h/3600);if(S>0)return`${S}:${String(w).padStart(2,"0")}:${String(f).padStart(2,"0")}`;return`${w}:${String(f).padStart(2,"0")}`}function Le(l,h=Date.now()){let f=De(l);if(f===null)return null;return sc(Math.max(0,h-f))}function gr(l,h=Date.now()){let f=qp(l);if(f===null)return null;let w=f-h;if(w<=0)return"retrying now";return`retry in ${sc(w)}`}function b(l={}){let h=l.window??(typeof window<"u"?window:null),f=l.navigator??(typeof navigator<"u"?navigator:null);if(f&&f.standalone===!0)return!0;if(!h||typeof h.matchMedia!=="function")return!1;return["(display-mode: standalone)","(display-mode: minimal-ui)","(display-mode: fullscreen)"].some((S)=>{try{return Boolean(h.matchMedia(S)?.matches)}catch{return!1}})}function Fe(l={}){let h=l.window??(typeof window<"u"?window:null),f=l.navigator??(typeof navigator<"u"?navigator:null);if(!h&&!f)return!1;let w=String(f?.userAgent||""),S=Number(f?.maxTouchPoints||0),k=/Android|webOS|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(w),E=(()=>{if(!h||typeof h.matchMedia!=="function")return!1;try{return Boolean(h.matchMedia("(pointer: coarse)")?.matches||h.matchMedia("(any-pointer: coarse)")?.matches)}catch{return!1}})();return Boolean(k||S>1||E)}function hr(l,h={}){if(b(h))return null;if(Fe(h))return{target:"_blank",features:void 0,mode:"tab"};return{target:Gp(l),features:"popup=yes,width=900,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function _n(l,h={}){let f=h.window??(typeof window<"u"?window:null);if(!f||!l)return null;try{return l.features?f.open("about:blank",l.target,l.features):f.open("about:blank",l.target)}catch{return null}}function Pn(l,h={}){if(!l||!l.document)return;try{let f=String(h.title||"Opening branch…"),w=String(h.message||"Preparing a new branch window…");l.document.title=f;let S=l.document.body;if(!S)return;if(typeof l.document.createElement!=="function"){S.textContent=`${f}
${w}`;return}let k=l.document.createElement("div");k.setAttribute("style","font-family: system-ui, sans-serif; padding: 24px; color: #222;");let E=l.document.createElement("h1");E.setAttribute("style","font-size: 18px; margin: 0 0 12px;"),E.textContent=f;let R=l.document.createElement("p");if(R.setAttribute("style","margin: 0; line-height: 1.5;"),R.textContent=w,k.appendChild(E),k.appendChild(R),typeof S.replaceChildren==="function")S.replaceChildren(k);else S.innerHTML="",S.appendChild(k)}catch{return}}function Mn(l,h){if(!l||!h)return;try{if(l.location&&typeof l.location.replace==="function"){l.location.replace(String(h));return}l.location=String(h)}catch{return}}function Dn(l){if(!l||typeof l.close!=="function")return;try{l.close()}catch{return}}function v(l,h,f={}){let w=new URL(String(l||"http://localhost/")),S=String(h||"").trim()||"web:default";if(w.searchParams.set("chat_jid",S),w.searchParams.delete("branch_loader"),w.searchParams.delete("branch_source_chat_jid"),w.searchParams.delete("pane_popout"),w.searchParams.delete("pane_path"),w.searchParams.delete("pane_label"),f.chatOnly===!0)w.searchParams.set("chat_only","1");return w.toString()}function Ln(l,h,f={}){let w=new URL(String(l||"http://localhost/")),S=String(h||"").trim()||"web:default";if(w.searchParams.set("branch_loader","1"),w.searchParams.set("branch_source_chat_jid",S),w.searchParams.delete("chat_jid"),w.searchParams.delete("pane_popout"),w.searchParams.delete("pane_path"),w.searchParams.delete("pane_label"),f.chatOnly===!0)w.searchParams.set("chat_only","1");return w.toString()}function yr(l,h,f={}){let w=new URL(String(l||"http://localhost/")),S=String(h||"").trim();if(!S)return w.toString();if(w.searchParams.set("pane_popout","1"),w.searchParams.set("pane_path",S),f?.label)w.searchParams.set("pane_label",String(f.label));else w.searchParams.delete("pane_label");if(f?.chatJid)w.searchParams.set("chat_jid",String(f.chatJid));let k=f?.params&&typeof f.params==="object"?f.params:null;if(k)for(let[E,R]of Object.entries(k)){let L=String(E||"").trim();if(!L)continue;if(R===null||R===void 0||R==="")w.searchParams.delete(L);else w.searchParams.set(L,String(R))}return w.searchParams.delete("chat_only"),w.searchParams.delete("branch_loader"),w.searchParams.delete("branch_source_chat_jid"),w.toString()}function Gp(l){return`piclaw-chat-${String(l||"web:default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function Kp(l){return`piclaw-pane-${String(l||"pane").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function br(l,h={}){if(b(h))return null;if(Fe(h))return{target:"_blank",features:void 0,mode:"tab"};return{target:Kp(l),features:"popup=yes,width=1200,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function fe(l){let h=l instanceof Error?l.message:String(l||"").trim(),f=String(h||"").trim();if(!f)return"PiClaw could not open a new branch window.";let w=f.toLowerCase();if(w.includes("no stable turn boundary"))return"This chat is still in flight and does not yet have a stable turn boundary to fork from.";if(w.includes("cannot fork a branch while the source chat is still active"))return"This chat is still active. Please wait for the current turn to settle, then try again.";if(w.includes("cancelled"))return"Branch creation was cancelled before a new chat window could be opened.";if(w.includes("did not return a chat id"))return"PiClaw created no usable branch id for the new window. Please try again.";if(w.includes("failed to fork branch")||w.includes("failed to fork chat branch"))return"PiClaw could not create the new branch. Please try again.";return f}var po=new Map,Gs=new Set,an,Ks=()=>{for(let l of Gs)l()};function vr(l,h){if(!l||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(h.id)||!h.label||typeof h.start!=="function"||typeof h.availability!=="function")throw Error("Invalid dictation provider registration.");if(po.has(h.id))throw Error("Duplicate dictation provider.");let f=Object.freeze({owner:l,provider:Object.freeze({...h})});po.set(h.id,f);let w=!1;return()=>{if(w)return;if(w=!0,an===f)an=void 0;po.delete(h.id),Ks()}}function wr(l,h){if(h===null){if(an?.owner===l)an=void 0,Ks();return}let f=po.get(h);if(!f||f.owner!==l)throw Error("Dictation provider belongs to another add-on or is unregistered.");if(an&&an!==f)throw Error("Another enabled dictation provider owns the composer.");an=f,Ks()}function Cn(){return an}function fo(l){return Gs.add(l),()=>{Gs.delete(l)}}var Wp=[[`Continue working toward the active thread goal.
`,"Continue goal","objective"],[`The active thread goal objective was edited by the user.
`,"Goal updated","untrusted_objective"],[`The active thread goal has reached its token budget.
`,"Goal budget reached","objective"],[`The current Plan Sidebar checklist has no pending or in-progress items.
`,"Finalize goal","objective"]];function Mt(l){let h=/^🎯 (?:Continue goal|Goal updated|Goal budget reached|Finalize goal): /.test(l),f=Wp.find(([S])=>l.startsWith(S));if(!h&&!f)return l;let w=/\n\n<piclaw_goal_input>([^\n]*)<\/piclaw_goal_input>$/.exec(l);if(!w)return l;try{let S=JSON.parse(w[1]);if(!S||Object.keys(S).sort().join(",")!=="generation,goalId"||typeof S.goalId!=="string"||!S.goalId.trim()||S.goalId!==S.goalId.trim()||S.goalId.length>256||!Number.isSafeInteger(S.generation)||S.generation<1)return l;let k=l.slice(0,w.index);if(h)return k;let[,E,R]=f,L=new RegExp(`<${R}>
([\\s\\S]*?)
</${R}>`).exec(k)?.[1];if(L===void 0)return l;let P={lt:"<",gt:">",amp:"&",quot:'"',"#39":"'",apos:"'"};return`\uD83C\uDFAF ${E}: ${L.replace(/&(lt|gt|amp|quot|#39|apos);/g,(j,N)=>P[N])}`}catch{return l}}class Ws{host;timeoutMs;current;pendingSubmit;constructor(l,h=15000){this.host=l;this.timeoutMs=h;if(!Number.isSafeInteger(h)||h<=0)throw Error("Invalid dictation deadline.")}get active(){return!!this.current}async start(l){if(this.current)throw Error("A dictation session already owns this composer.");if(!l.availability().available){this.host.state("error","Selected dictation provider is unavailable.");return}let h=this.host.readDraft(),f=new AbortController,w,S,k=new Promise((L,P)=>{w=L,S=P}),E={controller:f,provider:l,chatJid:h.chatJid,revision:h.revision,start:Math.min(h.selectionStart,h.selectionEnd),end:Math.max(h.selectionStart,h.selectionEnd),text:h.text,segments:[],starting:k};this.current=E,this.host.state("loading"),Promise.resolve().then(()=>l.start({signal:f.signal,chatJid:h.chatJid,setState:(L)=>{if(this.current!==E||f.signal.aborted)return;if(L==="error")E.error="Dictation provider failed. Draft preserved.",this.cancel(),this.host.state("error",E.error);else if(!E.finishing||L!=="loading"&&L!=="recording")this.host.state(L)},updateSegment:(L)=>this.updateSegment(E,L)})).then(w,S);try{if(await this.bounded(k,f.signal),this.current===E&&!f.signal.aborted&&!E.finishing)this.host.state("recording")}catch{let L=f.signal.aborted;if(f.abort(),!L)E.error="Dictation could not start. Draft preserved.";if(this.cancel(),E.error&&this.current===E)this.host.state("error",E.error)}}updateSegment(l,h){if(this.current!==l||l.controller.signal.aborted||!h.segmentId||h.segmentId.length>128||typeof h.text!=="string"||h.text.length>65536||typeof h.final!=="boolean")return{applied:!1};let f=this.host.readDraft();if(f.chatJid!==l.chatJid||f.revision!==l.revision||f.text!==l.text)return{applied:!1};let w=l.segments.find((j)=>j.id===h.segmentId);if(w?.final)return{applied:w.text===h.text&&h.final};let S=l.segments.map((j)=>({...j})),k=S.findIndex((j)=>j.id===h.segmentId),E={id:h.segmentId,text:h.text,final:h.final};if(k<0){if(S.length>=256)return{applied:!1};S.push(E)}else S[k]=E;let R=S.map((j)=>j.text).join("");if(R.length>131072)return{applied:!1};let L=f.text.slice(0,l.start)+R+f.text.slice(l.end);if(!this.host.writeDraft(L,f.revision))return{applied:!1};let P=this.host.readDraft();if(P.chatJid!==l.chatJid||P.text!==L)return{applied:!1};return l.segments=S,l.end=l.start+R.length,l.text=L,l.revision=P.revision,{applied:!0}}draftChanged(l,h){let f=this.current;if(!f||f.controller.signal.aborted)return;if(l.chatJid!==f.chatJid||h.chatJid!==f.chatJid||l.revision!==f.revision||l.text!==f.text){this.cancel();return}let w=0;while(w<l.text.length&&w<h.text.length&&l.text[w]===h.text[w])w++;let S=0;while(S<l.text.length-w&&S<h.text.length-w&&l.text.at(-1-S)===h.text.at(-1-S))S++;let k=l.text.length-S,E=h.text.length-l.text.length;if(k<=f.start&&w<f.start)f.start+=E,f.end+=E;else if(w<f.end||f.start===f.end&&w===f.start){this.cancel();return}f.text=h.text,f.revision=h.revision}finish(){let l=this.current;if(!l)return Promise.resolve({status:"cancelled"});if(!l.finishing)this.host.state("finishing"),l.finishing=(async()=>{try{let h=await this.bounded(l.starting,l.controller.signal),f=await this.bounded(Promise.resolve().then(()=>h.finish()),l.controller.signal);if(l.error)throw Error("Dictation provider failed.");if(this.current!==l||l.controller.signal.aborted)return{status:"cancelled"};if(f.status!=="finished")return this.cancel(),{status:"cancelled"};return l.controller.abort(),this.current=void 0,this.host.state("idle"),f}catch{if(l.controller.signal.aborted&&!l.error)return{status:"cancelled"};if(this.current===l)l.error="Dictation could not finish. Draft preserved; send again explicitly.",this.cancel(),this.host.state("error",l.error);throw Error("Dictation finish failed.")}})();return l.finishing}cancel(){let l=this.current;if(!l)return Promise.resolve();if(l.controller.abort(),!l.cancelling)l.cancelling=(async()=>{try{await(await l.starting).cancel()}catch{l.error??="Dictation cleanup failed."}finally{if(this.current===l)if(this.current=void 0,l.error)this.host.state("error",l.error);else this.host.state("idle")}})();return l.cancelling}submit(l){if(this.pendingSubmit)return this.pendingSubmit;let h=this.current;return this.pendingSubmit=(async()=>{if(h){if((await this.finish()).status!=="finished")return!1}return await l(),!0})().finally(()=>{this.pendingSubmit=void 0}),this.pendingSubmit}bounded(l,h){return new Promise((f,w)=>{let S,k=()=>{clearTimeout(S),w(Error("Dictation cancelled."))};if(h.aborted){w(Error("Dictation cancelled."));return}h.addEventListener("abort",k,{once:!0}),S=setTimeout(()=>{h.removeEventListener("abort",k),w(Error("Dictation deadline exceeded."))},this.timeoutMs),l.then((E)=>{clearTimeout(S),h.removeEventListener("abort",k),f(E)},(E)=>{clearTimeout(S),h.removeEventListener("abort",k),w(E)})})}}function ic(l){let h=0,f=l.read(),w=!1,S=0,E=new Ws({readDraft:()=>(R(),{...l.read(),revision:h}),writeDraft:(j,N)=>{if(R(),w||h!==N)return!1;return l.write(j),h++,f={...l.read(),text:j},!0},state:l.state});function R(){let j=l.read();if(j.text!==f.text||j.chatJid!==f.chatJid){S++;let N={...f,revision:h};h++,f=j,E.draftChanged(N,{...j,revision:h})}}let L=Cn()?.provider,P=fo(()=>{let j=Cn()?.provider;if(j!==L){if(S++,E.active)E.cancel();if(j)l.providerSelected?.()}L=j});return{get selected(){return Cn()?.provider},get active(){return E.active},draftChanged:R,async toggle(){R();let j=Cn()?.provider;if(!j)return!1;if(E.active)await E.finish();else await E.start(j);return!0},submit(j){R();let N=S,B=l.read().chatJid,U=Cn()?.provider;return E.submit(async()=>{if(R(),w||S!==N||l.read().chatJid!==B||Cn()?.provider!==U)return;await j()})},async dispose(){w=!0,P(),await E.cancel()},cancel:()=>(S++,E.cancel())}}var Us="piclaw:statusbar-compose-slot";function Ys(){if(typeof document>"u")return null;return document.querySelector(".workbench-statusbar-compose")}function Fn(){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent("piclaw:statusbar-compose-slot"))}function mo(l){return String(l||"").toLowerCase().replace(/^@/,"").replace(/\s+/g," ").trim()}function Up(l,h){let f=mo(l),w=mo(h);if(!w)return!1;return f.startsWith(w)||f.includes(w)}function Dt(l){if(!l)return!1;if(l.defaultPrevented||l.repeat)return!1;if(l.isComposing)return!1;if(l.ctrlKey||l.metaKey||l.altKey)return!1;return typeof l.key==="string"&&l.key.length===1&&/\S/.test(l.key)}function ac(l,h,f=Date.now(),w=700){let S=l&&typeof l==="object"?l:{value:"",updatedAt:0},k=String(h||"").trim().toLowerCase();if(!k)return{value:"",updatedAt:f};return{value:!S.value||!Number.isFinite(S.updatedAt)||f-S.updatedAt>w?k:`${S.value}${k}`,updatedAt:f}}function Yp(l,h){let f=Math.max(0,Number(l)||0);if(f<=0)return[];let S=((Number.isInteger(h)?h:0)%f+f)%f,k=[];for(let E=0;E<f;E+=1)k.push((S+E)%f);return k}function Vp(l,h,f=0,w=(S)=>S){let S=mo(h);if(!S)return-1;let k=Array.isArray(l)?l:[],E=Yp(k.length,f),R=k.map((L)=>mo(w(L)));for(let L of E)if(R[L].startsWith(S))return L;for(let L of E)if(R[L].includes(S))return L;return-1}function cc(l,h,f=-1,w=(S)=>S){let S=Array.isArray(l)?l:[];if(f>=0&&f<S.length){let k=w(S[f]);if(Up(k,h))return f}return Vp(S,h,0,w)}class Vs{publish;generation=0;constructor(l){this.publish=l}begin(l){let h=++this.generation;return this.publish("sending"),h}acknowledged(l){this.finished(l)}finished(l){if(l===this.generation)this.publish(null)}failed(l){this.finished(l)}reset(){this.generation++,this.publish(null)}}function go(l){return String(l||"").trim().toLowerCase()}function Js(l){let h=String(l||"").match(/^@([a-zA-Z0-9_-]*)$/);if(!h)return null;return go(h[1]||"")}function Jp(l){let h=new Set,f=[];for(let w of Array.isArray(l)?l:[]){let S=go(w?.agent_name);if(!S||h.has(S))continue;h.add(S),f.push(w)}return f}function lc(l,h,f={}){let w=Js(h);if(w==null)return[];let S=typeof f?.currentChatJid==="string"?f.currentChatJid:null;return Jp(l).filter((k)=>{if(S&&k?.chat_jid===S)return!1;return go(k?.agent_name).startsWith(w)})}function Qs(l){let h=go(l);return h?`@${h} `:""}var Qp={streaming:"Streaming",working:"Working",compacting:"Compacting",retrying:"Retrying",bash_running:"Running shell"};function xr(l){if(!l?.is_active)return"";let h=String(l.activity_status||"").trim();return Qp[h]||"Working"}function ee(l,h=220){let f=String(l??"").replace(/\r\n?/g,`
`).replace(/!\[[^\]]*\]\([^)]*\)/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/```+/g,"").replace(/`([^`]+)`/g,"$1").replace(/^#{1,6}\s+/gm,"").replace(/^>\s?/gm,"").replace(/^\s*[-*+]\s+/gm,"").replace(/[*_~]{1,3}/g,"").replace(/\s+/g," ").trim();if(f.length<=h)return f;return`${f.slice(0,Math.max(0,h-1)).trimEnd()}…`}function dc(l){if(!l)return null;if(typeof l==="string")try{return dc(JSON.parse(l))}catch{return null}if(typeof l!=="object"||Array.isArray(l))return null;let h=l,f=h.arguments??h.input??h.params??h.parameters??h.args??h.payload;return f&&typeof f==="object"&&!Array.isArray(f)?f:h}function Xp(l){let h=ee(l?.title,220);if(h)return h;let f=ee(l?.tool_name??l?.toolName,220);if(!f)return"";let w=dc(l?.tool_args??l?.toolArgs);if(!w)return f;let k=[w.command,Array.isArray(w.commands)?w.commands.filter((E)=>typeof E==="string").join(" && "):"",w.path??w.filePath??w.target,Array.isArray(w.paths)?w.paths.filter((E)=>typeof E==="string").join(", "):"",w.fileName??w.filename??w.file,w.url,w.query].map((E)=>typeof E==="string"?ee(E,120):"").filter(Boolean).sort((E,R)=>R.length-E.length)[0];return k?`${f}: ${k}`:f}function Zp(l){let h=typeof l?.type==="string"?l.type.trim():"";if(h!=="tool_call"&&h!=="tool_status")return null;let f=ee(l.status??l.tool_status??l.toolStatus,220);if(h==="tool_status"&&/^(done|failed|cancelled|canceled|aborted)$/i.test(f))return null;let w=f&&!/^working(?:\.{3}|…)?$/i.test(f)?f:"",S=[Xp(l),w].filter(Boolean).join(" — ");return S?{kind:"tool",label:"Tool",text:ee(S)}:null}function uc(l,h){let f=ee(typeof h==="string"?h:h?.text);return f?{kind:l,label:l==="thinking"?"Thinking":"Draft",text:f}:null}function Sr(l,h=null){if(!l||l.status!=="active")return{preview:null,retained:null};let f=l.data?.turn_id??l.data?.turnId,w=typeof f==="string"?f.trim():"",S=w&&h?.turnId===w?h:null,k=uc("draft",l.draft)||uc("thinking",l.thought),E=k&&w?{...k,turnId:w}:S;return{preview:k||Zp(l.data)||E,retained:E}}function ho(l){let h=typeof l==="string"?Date.parse(l):NaN;return Number.isFinite(h)?h:-1/0}function nt(l,h){let f=ho(l.last_activity_at),w=ho(h.last_activity_at);if(f!==w)return w-f;let S=ho(l.archived_at),k=ho(h.archived_at);return S===k?0:k-S}function kr(l,h=Date.now()){let f=Date.parse(String(l??""));if(!Number.isFinite(f))return"";let w=Math.max(0,Math.round((h-f)/1000));if(w<60)return"now";let S=Math.round(w/60);if(S<60)return`${S}m`;let k=Math.round(S/60);if(k<24)return`${k}h`;let E=Math.round(k/24);if(E<7)return`${E}d`;return new Date(f).toLocaleDateString(void 0,{month:"short",day:"numeric"})}function Lt(l){let h=Number(l?.context_percent??l?.contextPercent??l?.context_usage?.percent);if(Number.isFinite(h)&&h>=0)return Math.min(100,h);let f=Number(l?.context_tokens),w=Number(l?.context_window);if(Number.isFinite(f)&&Number.isFinite(w)&&w>0&&f>=0)return Math.min(100,f/w*100);return null}function Ar(l){return Boolean(l?.ctrlKey||l?.metaKey||l?.button===1)}var ef={current:"Current",pinned:"Pinned",active:"Active",tree:"This session tree",other:"Other sessions",archived:"Archived"};function ue(l){return typeof l==="string"?l.trim():""}function Xs(l){if(l==null)return null;let h=Number(l);return Number.isFinite(h)&&h>=0?h:null}function pc(l){if(l>=1e6){let h=l/1e6;return`${Number.isInteger(h)?h.toFixed(0):h.toFixed(1)}M`}if(l>=1000)return`${Math.round(l/1000)}K`;return String(Math.round(l))}function fc(l){let h=ue(l?.model)||ue(l?.model_label),f=Xs(l?.context_tokens??l?.contextTokens??l?.context_usage?.tokens),w=Xs(l?.context_window??l?.contextWindow??l?.context_usage?.contextWindow),S=Xs(l?.context_percent??l?.contextPercent??l?.context_usage?.percent),k=S==null?null:Math.min(100,S),E=f!=null&&w!=null&&w>0?`${pc(f)} / ${pc(w)}${k==null?"":` (${Math.round(k)}% context)`}`:k==null?"":`${Math.round(k)}% context`;return[h,E].filter(Boolean).join(" · ")}function tf(l){let h=Boolean(l?.archived_at),f=Boolean(l?.is_active)&&!h;return[ue(l?.agent_name)?`@${ue(l.agent_name)}`:"",ue(l?.agent_name),ue(l?.chat_jid),ue(l?.root_chat_jid),ue(l?.model),ue(l?.model_label),ue(l?.provider),h?"archived":f?"active":"idle",ue(l?.parent_branch_id),ue(l?.branch_id)].filter(Boolean).join(" ").toLocaleLowerCase()}function mc(l,h){let f=ue(h).toLocaleLowerCase().split(/\s+/).filter(Boolean);if(f.length===0)return!0;let w=tf(l);return f.every((S)=>w.includes(S))}function nf(l,h){if(!mc(l,h))return 4;let f=ue(l?.agent_name).toLocaleLowerCase(),w=ue(h).toLocaleLowerCase().split(/\s+/).map((S)=>S.replace(/^@/,"")).filter(Boolean);if(!f||w.length===0)return 3;if(w.some((S)=>f===S))return 0;if(w.some((S)=>f.startsWith(S)))return 1;if(w.some((S)=>f.includes(S)))return 2;return 3}function gc(l,h){let f=0,w=Number.POSITIVE_INFINITY;for(let S=0;S<l.length;S+=1){let k=nf(l[S],h);if(k>=w)continue;if(f=S,w=k,k===0)break}return f}function hc(l,h){let f=ue(h);if(!f)return-1;return l.findIndex((w)=>ue(w?.chat_jid)===f)}function Oe(l,h){let f=ue(h).toLocaleLowerCase();if(!f)return l;let w=new Set(l.filter((k)=>mc(k,f)).map((k)=>ue(k.chat_jid))),S=new Map(l.map((k)=>[ue(k.branch_id),k]).filter(([k])=>Boolean(k)));for(let k of l){if(!w.has(ue(k.chat_jid)))continue;let E=ue(k.parent_branch_id);while(E){let R=S.get(E);if(!R)break;w.add(ue(R.chat_jid)),E=ue(R.parent_branch_id)}}return l.filter((k)=>w.has(ue(k.chat_jid)))}function Be(l,h,f=[]){let w=ue(h),S=l.find((L)=>ue(L.chat_jid)===w),k=ue(S?.root_chat_jid)||w,E=new Set(Array.from(f,ue).filter(Boolean)),R=new Map([["current",[]],["pinned",[]],["active",[]],["tree",[]],["other",[]],["archived",[]]]);for(let L of l){let P=ue(L.chat_jid),N=Boolean(L.archived_at)?"archived":P===w?"current":Boolean(L.is_active)?"active":E.has(P)?"pinned":(ue(L.root_chat_jid)||P)===k?"tree":"other";R.get(N).push(L)}return["current","active","pinned","tree","other","archived"].map((L)=>({key:L,label:ef[L],items:R.get(L).sort(nt)})).filter((L)=>L.items.length>0)}function bc(l,h,f,w=8){if(h<=0)return 0;let S=Math.max(0,Math.min(l,h-1));if(f==="Home")return 0;if(f==="End")return h-1;if(f==="ArrowDown")return(S+1)%h;if(f==="ArrowUp")return(S-1+h)%h;if(f==="PageDown")return Math.min(h-1,S+w);if(f==="PageUp")return Math.max(0,S-w);return S}function yc(l={}){if(l.searchMode)return!1;return Boolean(l.showSessionSwitcherButton)}function wc(l,h,f={}){if(!l||l.isComposing)return!1;if(!yc(f))return!1;if(l.ctrlKey||l.metaKey||l.altKey)return!1;if(l.key!=="@")return!1;return String(h||"")===""}function Zs(l,h={}){if(!yc(h))return!1;return String(l||"")==="@"}function te(l){let h=ei(l);return h?`@${h}`:""}function ei(l){return String(l||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-")}function Ft(l,h=""){let f=String(l||""),w=ei(f),S=ei(h);if(!f.trim())return{normalized:w,handle:"",canSubmit:!1,kind:"error",message:"Enter a branch handle."};if(!w)return{normalized:w,handle:"",canSubmit:!1,kind:"error",message:"Handle must contain at least one letter or number."};let k=`@${w}`;if(w===S)return{normalized:w,handle:k,canSubmit:!1,kind:"info",message:`Already using ${k}.`};if(w!==f.trim())return{normalized:w,handle:k,canSubmit:!0,kind:"info",message:`Will save as ${k}. Letters, numbers, - and _ are allowed; leading @ is optional.`};return{normalized:w,handle:k,canSubmit:!0,kind:"success",message:`Saving as ${k}.`}}function rt(l,h={}){let f=[],w=typeof h.currentChatJid==="string"?h.currentChatJid.trim():"",S=typeof l?.chat_jid==="string"?l.chat_jid.trim():"";if(w&&S===w)f.push("current");if(l?.archived_at)f.push("archived");else{if(l?.is_compacting||l?.activity_status==="compacting")f.push("compacting");if(l?.is_active)f.push("active")}return f}function vc(l){let h=te(l?.agent_name)||String(l?.chat_jid||"").trim(),f=typeof l?.chat_jid==="string"&&l.chat_jid.trim()?l.chat_jid.trim():"unknown-chat";return`${h} — ${f}`}function Ot(l,h={}){let f=rt(l,h);return f.length>0?`${vc(l)} • ${f.join(" • ")}`:vc(l)}function Cr(l,h,f){let w=te(l),S=te(h),k=String(f||"").trim();if(w&&S&&w!==S)return`Restored archived ${w} as ${S} because ${w} is already in use.`;if(S)return`Restored ${S}.`;if(w)return`Restored ${w}.`;return`Restored ${k||"branch"}.`}function Bt({steerQueued:l=!1,pulsing:h=!1}={}){let f=["turn-dot"];if(l)f.push("turn-dot-queued");if(h)f.push("turn-dot-pulsing");return f.join(" ")}function ti({pulsing:l=!1}={}){let h=["compose-inline-status-dot"];if(l)h.push("compose-inline-status-dot-pulsing");return h.join(" ")}function ot(l,{isLastActivity:h=!1,pendingRequest:f=!1}={}){if(f)return"dot";if(h)return"none";if(l?.type==="error")return"none";let w=typeof l?.type==="string"?l.type:"";if(Boolean(typeof l?.tool_name==="string"&&l.tool_name.trim()||l?.tool_args))return"spinner";if(l?.type==="intent")return"dot";if(w==="tool_call"||w==="tool_status"||w==="thinking"||w==="waiting")return"spinner";return"dot"}function Tr(l,h={}){return ot(l,h)==="dot"}var Sc=350;function rf(l){return String(l||"Connecting").replace(/[-_]+/g," ").replace(/^./,(h)=>h.toUpperCase())}function of(l,h={}){let f=typeof l==="string"&&l.trim()?l.trim():"connecting";if(f==="connected")return{show:!1,statusClass:"connected",label:"Connected",title:"Connection: Connected"};if(f!=="disconnected"){let R=rf(f);return{show:!0,statusClass:f,label:R,title:`Connection: ${R}`}}let w=Number.isFinite(Number(h?.delayMs))?Math.max(0,Number(h.delayMs)):Sc,S=Number.isFinite(Number(h?.nowMs))?Number(h.nowMs):Date.now(),k=Number.isFinite(Number(h?.disconnectedAtMs))?Number(h.disconnectedAtMs):S;return S-k>=w?{show:!0,statusClass:"disconnected",label:"Reconnecting",title:"Reconnecting"}:{show:!1,statusClass:"connecting",label:"Connecting",title:"Connecting"}}function $c(l,h={}){let f=Number.isFinite(Number(h?.delayMs))?Math.max(0,Number(h.delayMs)):Sc,[w,S]=t(null),[k,E]=t(()=>Date.now());return o(()=>{if(l==="disconnected"){let R=Date.now();S((L)=>L??R),E(R);return}S(null),E(Date.now())},[l]),o(()=>{if(l!=="disconnected"||w===null)return;let R=f-(Date.now()-w);if(R<=0)return;let L=0,P=0,j=setTimeout(()=>{if(typeof requestAnimationFrame!=="function"){E(Date.now());return}L=requestAnimationFrame(()=>{P=requestAnimationFrame(()=>{E(Date.now())})})},R);return()=>{if(clearTimeout(j),L)cancelAnimationFrame(L);if(P)cancelAnimationFrame(P)}},[l,w,f]),i(()=>of(l,{delayMs:f,disconnectedAtMs:w,nowMs:k}),[l,f,w,k])}function x({prefix:l="file",label:h,title:f,onRemove:w,onClick:S,removeTitle:k="Remove",icon:E="file"}){let R=`${l}-file-pill`,L=`${l}-file-name`,P=`${l}-file-remove`,j=E==="message"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>`:E==="folder"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>`:e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>`;return e`
    <span class=${R} title=${f||h} onClick=${S}>
      ${j}
      <span class=${L}>${h}</span>
      ${w&&e`
        <button
          class=${P}
          onClick=${(N)=>{N.preventDefault(),N.stopPropagation(),w()}}
          title=${k}
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `}
    </span>
  `}async function ni(l,h,f,w){if(typeof l!=="function")return!1;try{let S=await l(h);if(!S)return!1;return f(S),w?.(S),!0}catch(S){return!1}}var sf=0;function kc(l,h){return`compose-model-option-${l}-${encodeURIComponent(h)}`}function af(l){let h=[],f=ne(l.contextWindow);if(f)h.push(f);if(l.reasoning)h.push("reasoning");return h.push(...l.variants.filter((w)=>w!=="stable").slice(0,2)),h}function xc({anchor:l=null,entries:h,loading:f=!1,switching:w=!1,onSelect:S,onTogglePin:k,onClose:E,onCompact:R,onOpenSettings:L,thinkingLevel:P=null,thinkingLevels:j=[],onSelectThinking:N,rootRef:B}){let[U,q]=t(""),[Q,Y]=t(null),W=n(null),X=n(new Map),H=n(null);if(H.current==null)H.current=++sf;let ce=`compose-model-search-${H.current}`,xe=`compose-model-results-${H.current}`,de=i(()=>Ir(h,{query:U}),[h,U]),Ne=i(()=>de.renderedEntries,[de]);o(()=>{W.current?.focus()},[]),o(()=>{if(Ne.some((Te)=>Te.key===Q))return;let O=Ne.find((Te)=>Te.current);Y(O?.key??Ne[0]?.key??null)},[Q,Ne]),o(()=>{X.current.get(Q)?.scrollIntoView?.({block:"nearest"})},[Q]);let Kt=r((O)=>{if(!O||w)return;S(O)},[S,w]),cn=r((O)=>{if(O.isComposing)return;let Te={ArrowDown:"next",ArrowUp:"previous",Home:"first",End:"last",PageDown:"page-next",PageUp:"page-previous"};if(O.key==="Escape"){O.preventDefault(),E();return}if(O.target!==W.current)return;if(O.key==="Enter"){let Ct=de.renderedEntries.find((ze)=>ze.key===Q);if(Ct)if(O.preventDefault(),O.altKey)k?.(Ct);else Kt(Ct);return}let Wt=Te[O.key];if(!Wt||(O.key==="Home"||O.key==="End")&&!O.ctrlKey&&!O.metaKey)return;O.preventDefault(),Y(Er(de.renderedEntries,Q,Wt))},[Q,Kt,E,k,de.renderedEntries]),dr=(O)=>{let Te=O.current,Wt=O.key===Q,Ct=af(O);return e`
            <button
                id=${kc(H.current,O.key)}
                key=${O.key}
                type="button"
                role="option"
                aria-label=${`${O.displayName}, ${O.pinned?"pinned":"not pinned"}. Alt+Enter to ${O.pinned?"unpin":"pin"}.`}
                aria-keyshortcuts="Alt+Enter"
                aria-selected=${Te?"true":"false"}
                tabIndex=${-1}
                class=${`compose-model-catalogue-option${Te?" selected":""}${Wt?" focused":""}`}
                ref=${(ze)=>ze?X.current.set(O.key,ze):X.current.delete(O.key)}
                onMouseDown=${(ze)=>ze.preventDefault()}
                onMouseEnter=${()=>Y(O.key)}
                onClick=${()=>Kt(O)}
            >
                <span
                    class=${`compose-model-catalogue-pin${O.pinned?" pinned":""}`}
                    aria-hidden="true"
                    title=${O.pinned?"Unpin model":"Pin model"}
                    onClick=${(ze)=>{ze.preventDefault(),ze.stopPropagation(),Y(O.key),k?.(O)}}
                >${O.pinned?"★":"☆"}</span>
                <span class="compose-model-catalogue-option-content">
                    <span class="compose-model-catalogue-option-primary">
                        <span class="compose-model-catalogue-option-name">${O.displayName}</span>
                        ${ye(O.pricing)&&e`<span class="compose-model-catalogue-option-price">${ye(O.pricing)}</span>`}
                    </span>
                    ${O.displayName!==O.key&&e`<span class="compose-model-catalogue-option-key">${O.key}</span>`}
                    ${Ct.length>0&&e`
                        <span class="compose-model-catalogue-option-badges">
                            ${Ct.map((ze)=>e`<span class="compose-model-catalogue-badge" key=${ze}>${ze}</span>`)}
                        </span>
                    `}

                </span>
            </button>
        `};return e`
        <div
            class=${`compose-model-popup compose-model-catalogue${l?" is-statusbar-anchored":""}`}
            style=${l?`--model-popup-left: ${l.left}px; --model-popup-bottom: ${l.bottom}px`:void 0}
            data-compose-model-catalogue="true"
            ref=${B}
            onKeyDown=${cn}
        >
            <div class="compose-model-catalogue-header">
                <label class="compose-model-catalogue-search-label" for=${ce}>Search models</label>
                <div class="compose-model-catalogue-search-row">
                    <input
                        id=${ce}
                        ref=${W}
                        class="compose-model-catalogue-search"
                        type="search"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls=${xe}
                        aria-activedescendant=${Q?kc(H.current,Q):void 0}
                        placeholder="Search models…"
                        value=${U}
                        onInput=${(O)=>q(O.currentTarget.value)}
                    />
                    ${U&&e`<button type="button" class="compose-model-catalogue-clear" onClick=${()=>q("")} aria-label="Clear model search">×</button>`}
                </div>
                <div class="compose-model-catalogue-summary" aria-live="polite">
                    <span>${de.totalMatches} ${de.totalMatches===1?"model":"models"}</span>
                    ${f&&e`<span>Refreshing…</span>`}
                </div>
            </div>
            <div id=${xe} class="compose-model-popup-menu compose-model-catalogue-results" role="listbox" aria-label="Models">
                ${de.sections.map((O)=>e`
                    <section class=${`compose-model-catalogue-section ${`compose-model-catalogue-section--${O.key}`}`} key=${O.key} role="presentation">
                        <div class="compose-model-catalogue-section-heading" role="presentation">
                            <span>${O.label}</span><span>${O.totalCount}</span>
                        </div>
                        ${O.entries.map(dr)}
                        ${O.groups.map((Te)=>e`
                            <div class="compose-model-catalogue-group" key=${Te.key} role="group" aria-label=${Te.label}>
                                <div class="compose-model-catalogue-group-heading" role="presentation">
                                    <span>${Te.label}</span><span>${Te.totalCount}</span>
                                </div>
                                ${Te.entries.map(dr)}
                            </div>
                        `)}
                    </section>
                `)}
                ${de.totalMatches===0&&e`
                    <div class="compose-model-popup-empty">
                        ${f?"Loading models…":U?`No models match “${U}”.`:"No models available."}
                    </div>
                `}
                ${de.hiddenCount>0&&e`<div class="compose-model-catalogue-limit-note">Showing ${de.renderedEntries.length} of ${de.totalMatches}; refine your search to see more.</div>`}
            </div>
            <div class="compose-model-catalogue-footer">
                <div class="compose-model-catalogue-footer-start">
                    ${j.length>0&&e`
                        <label class="compose-model-catalogue-thinking">
                            <span>Thinking</span>
                            <select
                                aria-label="Thinking level"
                                value=${P||j[0]?.id||""}
                                disabled=${w||typeof N!=="function"}
                                onChange=${(O)=>N?.(O.currentTarget.value)}
                            >
                                ${j.map((O)=>e`<option key=${O.id} value=${O.id}>${O.label}</option>`)}
                            </select>
                        </label>
                    `}
                    ${R&&e`<button type="button" class="compose-model-popup-btn" onClick=${R}>Compact context</button>`}
                </div>
                ${L&&e`<button type="button" class="compose-model-popup-btn primary" onClick=${L}>Open Models settings</button>`}
            </div>
        </div>
    `}function cf(l={}){let h=l.navigator??(typeof navigator<"u"?navigator:null);if(!h)return!1;let f=String(h.userAgent||"");if(/iPad|iPhone/.test(f))return!0;return h.platform==="MacIntel"&&Number(h.maxTouchPoints||0)>1}function lf(l={}){let h=l.window??(typeof window<"u"?window:null);if(!h)return null;return h.SpeechRecognition||h.webkitSpeechRecognition||null}function ri(l={}){let h=l.window??(typeof window<"u"?window:null),f=typeof l.secureContext==="boolean"?l.secureContext:Boolean(h?.isSecureContext),w=b(l),S=cf(l),k=lf(l);if(!f)return{mode:"unavailable",showButton:!1,canStart:!1,reason:"secure-context-required",title:"Voice input requires HTTPS",detail:"Native browser speech input needs a secure context (HTTPS or localhost).",recognitionCtor:null,ios:S,standalone:w,secureContext:f};if(S&&w)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-standalone-fallback",title:"Use keyboard dictation",detail:"Speech input is intentionally downgraded in iPhone/iPad standalone web apps because browser-native recognition is not reliable there. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:k,ios:S,standalone:w,secureContext:f};if(!k){if(S)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-keyboard-dictation",title:"Use keyboard dictation",detail:"This browser does not expose native in-page speech recognition here. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:null,ios:S,standalone:w,secureContext:f};return{mode:"unavailable",showButton:!1,canStart:!1,reason:"unsupported",title:"Voice input unavailable",detail:"This browser does not expose native speech recognition in this context.",recognitionCtor:null,ios:S,standalone:w,secureContext:f}}return{mode:"native",showButton:!0,canStart:!0,reason:"supported",title:"Start voice input",detail:S?"Browser-native speech input is available here, but Safari/WebKit reliability may still vary.":"Browser-native speech input is available.",recognitionCtor:k,ios:S,standalone:w,secureContext:f}}function _c(l,h="",f=""){let w=String(l||""),S=String(h||"").trim(),k=String(f||"").trim(),E=[S,k].filter(Boolean).join(" ").trim();if(!E)return w;if(!w)return E;let R=/[\s\n]$/.test(w)?"":" ";return`${w}${R}${E}`}function Ec(l,h=0){let f="",w="",S=l&&typeof l.length==="number"?l:[];for(let k=Math.max(0,h);k<S.length;k+=1){let E=S[k];if(!E||!E[0])continue;let R=String(E[0].transcript||"").trim();if(!R)continue;if(E.isFinal)f=`${f} ${R}`.trim();else w=`${w} ${R}`.trim()}return{finalText:f,interimText:w}}function oi(l,h=null){let f=String(l||"").trim().toLowerCase();switch(f){case"not-allowed":case"service-not-allowed":return h?.ios?"Microphone or speech-recognition permission was denied. On iPhone/iPad, using keyboard dictation may be more reliable.":"Microphone or speech-recognition permission was denied by the browser.";case"no-speech":return"No speech was detected. Try again and speak after the listening indicator appears.";case"audio-capture":return"The browser could not access a microphone for speech recognition.";case"network":return"The browser speech-recognition service reported a network or service failure.";case"aborted":return"Voice input was stopped.";default:return f?`Voice input failed (${f}).`:"Voice input failed."}}var uf=[{name:"/model",description:"Select model or list available models"},{name:"/cycle-model",description:"Cycle to the next available model"},{name:"/thinking",description:"Show or set thinking/effort level"},{name:"/effort",description:"Show or set thinking/effort level (alias for /thinking)"},{name:"/cycle-thinking",description:"Cycle thinking level"},{name:"/theme",description:"Set UI theme (no name to show available themes)"},{name:"/tint",description:"Tint default light/dark UI (usage: /tint #hex or /tint off)"},{name:"/btw",description:"Open a side conversation panel without interrupting the main chat"},{name:"/state",description:"Show current session state"},{name:"/stats",description:"Show session token and cost stats"},{name:"/context",description:"Show context window usage"},{name:"/quota",description:"Show cached provider quota / rate-limit usage"},{name:"/last",description:"Show last assistant response"},{name:"/compact",description:"Manually compact the session"},{name:"/auto-compact",description:"Toggle auto-compaction"},{name:"/auto-retry",description:"Toggle auto-retry"},{name:"/abort",description:"Abort the current response"},{name:"/abort-retry",description:"Abort retry backoff"},{name:"/abort-bash",description:"Abort running bash command"},{name:"/shell",description:"Run a shell command and return output"},{name:"/bash",description:"Run a shell command and add output to context"},{name:"/queue",description:"Queue a follow-up message (one-at-a-time)"},{name:"/queue-all",description:"Queue a follow-up message (batch all)"},{name:"/steer",description:"Steer the current response"},{name:"/steering-mode",description:"Set steering mode (all|one)"},{name:"/followup-mode",description:"Set follow-up mode (all|one)"},{name:"/session-name",description:"Set or show the session name"},{name:"/new-session",description:"Start a new session"},{name:"/switch-session",description:"Switch to a session file"},{name:"/session-rotate",description:"Rotate the current persisted session into an archived file"},{name:"/rollup",description:"Merge the current branch chat back into its parent chat"},{name:"/clone",description:"Duplicate the current active branch into a new session"},{name:"/fork",description:"Fork from a previous message"},{name:"/forks",description:"List forkable messages"},{name:"/tree",description:"List the session tree"},{name:"/label",description:"Set or clear a label on a tree entry"},{name:"/labels",description:"List labeled entries"},{name:"/agent-name",description:"Set or show the agent display name"},{name:"/agent-avatar",description:"Set or show the agent avatar URL"},{name:"/user-name",description:"Set or show your display name"},{name:"/user-avatar",description:"Set or show your avatar URL"},{name:"/user-github",description:"Set name/avatar from GitHub profile"},{name:"/export-html",description:"Export session to HTML"},{name:"/passkey",description:"Manage passkeys (enrol/list/delete)"},{name:"/totp",description:"Show a TOTP enrolment QR code"},{name:"/qr",description:"Generate a QR code for text or URL"},{name:"/search",description:"Search notes and skills in the workspace"},{name:"/dream",description:"Run Dream memory maintenance over recent days (default 7)"},{name:"/tasks",description:"List scheduled tasks"},{name:"/scheduled",description:"List scheduled tasks"},{name:"/pair",description:"Manage remote peer connections (/pair request <url> | /pair list)"},{name:"/ask",description:"Send a prompt to a paired remote instance (/ask <instance_id|fingerprint> <prompt>)"},{name:"/restart",description:"Restart the agent and stop subprocesses"},{name:"/exit",description:"Exit the current piclaw process immediately (Supervisor will restart it)"},{name:"/login",description:"Login to an AI model provider (OAuth or API key)"},{name:"/logout",description:"Logout from an AI model provider"},{name:"/settings",description:"Open the settings pane"},{name:"/help",description:"Open keyboard shortcuts help"},{name:"/commands",description:"List available commands"},{name:"/skill:",description:"Run a workspace skill (e.g. /skill:visual-artifact-generator, /skill:web-search)"}],Cc="piclaw_compose_history",si="piclaw_compose_height",df=50,Ac=70,Rc=300,Pc=520;function Dc(){if(typeof window>"u")return Ac;return window.innerWidth>=1024?Ac:df}function pf(){if(typeof window>"u")return Rc;return Math.min(Math.floor(window.innerHeight*0.4),Rc)}function ff(){if(typeof window>"u")return Pc;return Math.min(Math.floor(window.innerHeight*0.5),Pc)}function ii(l){let h=Dc(),f=Math.max(h,ff());return Math.min(Math.max(Math.round(Number(l)||h),h),f)}function mf(l=null,h=si){let f=l?.getItem?.(h)??p(h);if(!f)return null;let w=parseInt(f,10);return Number.isFinite(w)?ii(w):null}function gf(l,h,f=!1){if(f)return{shouldApply:!1,nextToken:h,text:""};if(!l||typeof l!=="object")return{shouldApply:!1,nextToken:h,text:""};let w=typeof l.token==="string"?l.token:"",S=typeof l.text==="string"?l.text:"";if(!w||w===h||!S.trim())return{shouldApply:!1,nextToken:h,text:""};return{shouldApply:!0,nextToken:w,text:S}}function hf(l="web:default"){let h=typeof l==="string"&&l.trim()?l.trim():"web:default";if(h==="web:default")return Cc;return`${Cc}:${encodeURIComponent(h)}`}function me(l,h=null,f=null){let w=new Set,S=f instanceof Set?f:new Set(Array.isArray(f)?f:[]),k=[];for(let E of Array.isArray(l)?l:[]){let R=typeof E?.chat_jid==="string"?E.chat_jid.trim():"";if(!R||w.has(R)||S.has(R))continue;if(!(typeof E?.agent_name==="string"?E.agent_name.trim():""))continue;w.add(R),k.push(E)}return k.sort((E,R)=>{let L=Boolean(E?.archived_at),P=Boolean(R?.archived_at);if(L!==P)return L?1:-1;let j=String(E?.agent_name||"").trim(),N=String(R?.agent_name||"").trim(),B=j.localeCompare(N,void 0,{sensitivity:"base"});if(B!==0)return B;let U=String(E?.chat_jid||"").trim(),q=String(R?.chat_jid||"").trim();return U.localeCompare(q,void 0,{sensitivity:"base"})}),k}function bf(l){return Boolean(l?.is_active&&!l?.archived_at)}function yf(l,h=null){let f=Array.isArray(l)?l:[],w=typeof h==="string"?h.trim():"";if(w){let k=f.findIndex((E)=>{if(E?.disabled)return!1;if(E?.type!=="session")return!1;return(typeof E?.chat?.chat_jid==="string"?E.chat.chat_jid.trim():"")===w});if(k>=0)return k}let S=f.findIndex((k)=>!k?.disabled);return S>=0?S:0}function Lc(l,h){let f=typeof h?.command?.message==="string"?h.command.message.trim():"";if(!h?.ui_only||!f)return null;let w=typeof l==="string"?l.trim():"";if(!w.startsWith("/"))return null;let S=w.split(/\s+/).filter(Boolean),k=S[0]?.toLowerCase()||"";if(!(S.length>1)&&(k==="/thinking"||k==="/effort"))return f;return null}function wf(l,h,f=!1){if(l)return{mode:"queue",className:"icon-btn send-btn queue-mode",title:"Queue follow-up (Enter)",ariaLabel:"Queue follow-up message",disabled:!h};return{mode:"send",className:"icon-btn send-btn",title:"Send (Enter)",ariaLabel:"Send message",disabled:!h}}function Tc(l,h,f={}){if(!l||f.searchMode)return!1;if(!(l.key===" "||l.key==="Spacebar"||l.code==="Space"))return!1;if(l.ctrlKey||l.metaKey||l.altKey||l.repeat)return!1;if(!f.speechButtonVisible||f.speechButtonActive)return!1;if(!f.canStartSpeech)return!1;return String(h||"").trim().length===0}function vf(l,h){if(!h||!l)return!1;return l.key===" "||l.key==="Spacebar"||l.code==="Space"}function Sf(l,h=!1){if(!l)return null;if(h)return{mode:"compacting",className:"icon-btn send-btn abort-mode compacting-mode",title:"Compacting context — Stop response",ariaLabel:"Compacting context — Stop response",disabled:!1};return{mode:"abort",className:"icon-btn send-btn abort-mode",title:"Stop response",ariaLabel:"Stop response",disabled:!1}}function $f(l){return l==="abort"||l==="compacting"}function kf(l,h=0){if(l?.visible===!1)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};let f=typeof l?.message==="string"&&l.message.trim()?l.message.trim():null,w=l?.indicator&&typeof l.indicator==="object"?l.indicator:null;if(!f&&!w)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};if(w?.mode==="hidden")return{visible:Boolean(f),title:f||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!1};if(w?.mode==="custom"&&Array.isArray(w.frames)&&w.frames.length>0){let S=w.frames,k=Number.isFinite(h)&&h>=0?Math.floor(h)%S.length:0;return{visible:!0,title:f||"Thinking…",indicatorText:S[k],animateDot:!1,animateSpinner:!1}}return{visible:!0,title:f||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!0}}function xf({usage:l,onCompact:h,compactionLabel:f="",compactionTitle:w=""}){let S=Number.isFinite(l.percent)?Math.min(100,Math.max(0,l.percent)):null,k=Number.isFinite(l.tokens)&&l.tokens>=0?l.tokens:null,E=Number.isFinite(l.contextWindow)&&l.contextWindow>0?l.contextWindow:null,R=typeof h==="function",L=R?"Compact context":"Context usage",P=S==null?"unavailable":`${S.toFixed(0)}%`,j=`Context: ${vo(k)} / ${vo(E)} tokens (${P})`,N=typeof f==="string"?f.trim():"",B=typeof w==="string"?w.trim():"",U=N?`${j}
${B||"Smart compaction"} · ${N}`:`${j}
${L}`,q=9,Q=2*Math.PI*9,Y=(S??0)/100*Q,W=S==null?"var(--text-secondary)":S>90?"var(--context-red, #ef4444)":S>75?"var(--context-amber, #f59e0b)":"var(--context-green, #22c55e)";return e`
        <button
            class=${`compose-context-pie icon-btn${N?" is-compacting":""}`}
            type="button"
            title=${U}
            aria-label=${U}
            disabled=${!R}
            onClick=${(X)=>{if(X.preventDefault(),X.stopPropagation(),R)h()}}
        >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r=${9}
                    fill="none"
                    stroke="var(--context-track, rgba(128,128,128,0.2))"
                    stroke-width="2.5" />
                <circle cx="12" cy="12" r=${9}
                    fill="none"
                    stroke=${W}
                    stroke-width="2.5"
                    stroke-dasharray=${`${Y} ${Q}`}
                    stroke-linecap="round"
                    transform="rotate(-90 12 12)" />
            </svg>
            ${N&&e`<span class="compose-context-pie-timer">${N}</span>`}
        </button>
    `}function vo(l){if(l==null)return"?";if(l>=1e6)return(l/1e6).toFixed(1)+"M";if(l>=1000)return(l/1000).toFixed(0)+"K";return String(l)}function xt(l){if(l==null)return null;let h=Number(l);return Number.isFinite(h)?h:null}function _f(l){if(!l||typeof l!=="object")return null;let h=xt(l.cacheHitRate);if(h!=null)return h;let f=xt(l.inputTokens)??0,w=xt(l.cacheReadTokens)??0,S=xt(l.cacheWriteTokens)??0,k=f+w+S;if(l.cacheReadReported===!1||k<=0)return null;if(w<=0&&l.cacheReadReported!==!0)return null;return w/k*100}function Ef(l){let h=xt(l);if(h==null)return null;return`${Math.max(0,Math.min(100,h)).toFixed(1)}%`}function Gn(l,h){let f=xt(h);return f!=null?`${l} ${vo(f)}`:null}function yo(l,h="USD"){let f=xt(l);if(f==null||f<0)return null;let w=f.toFixed(f>=0.01?2:4);return h==="USD"?`$${w}`:h?`${h} ${w}`:`${w} (currency unknown)`}function Cf(l){if(l?.provider!=="openrouter"||l?.availability!=="available")return null;return[`Key spend: ${yo(l.key_usage_usd)||"unavailable"}`,`Key limit: ${l.key_limit_configured===!0?yo(l.key_limit_usd)||"unavailable":l.key_limit_unlimited?"not configured (unlimited)":"unavailable"}`,`Key remaining: ${yo(l.key_limit_remaining_usd)||"unavailable"}`].join(" • ")}function Af(l,h=null){let f=l&&typeof l==="object"?l.cacheUsage:null;if(!f||typeof f!=="object")return null;let w=f.latest&&typeof f.latest==="object"?f.latest:null;if(!w)return null;let S=typeof w.provider==="string"&&w.provider.trim()?w.provider.trim():null,k=typeof w.model==="string"&&w.model.trim()?w.model.trim():null,E=k?!S||k.startsWith(`${S}/`)?k:`${S}/${k}`:S,R=typeof w.responseModel==="string"&&w.responseModel.trim()?w.responseModel.trim():null,L=ai(h,E),P=Boolean(h&&E&&!L),j=_f(w),N=Ef(j),B=N?`CH${N}`:"CH—",U=xt(w.totalTokens),q=yo(w.costTotal,w.costProvenance==="provider_reported"?w.providerCostCurrency??null:"USD"),Q=typeof w.costProvenance==="string"?w.costProvenance:null,Y=Q==="provider_reported"?q:Q==="catalogue_estimate"&&q?`~${q}`:null,W=P?"Prev":"Last",X=[Gn("in",w.inputTokens),Gn("out",w.outputTokens),Gn("reason",w.reasoningTokens),Gn("cache-r",w.cacheReadTokens),Gn("cache-w",w.cacheWriteTokens),Gn("total",w.totalTokens)].filter(Boolean).join(", "),H=Q==="provider_reported"&&q?`Provider-reported cost: ${q}`:Q==="catalogue_estimate"&&q?`Catalogue cost estimate: ~${q}`:"Cost unavailable",ce=N?`Prompt cache hit: ${N}`:w.cacheReadReported===!1?"Prompt cache telemetry unavailable":"Prompt cache hit unavailable",xe=[`${P?"Previous":"Latest"} run${E?`: ${E}`:""}`,R&&R!==w.model?`Response model: ${R}`:null,X||null,ce,H].filter(Boolean);return{label:[P?W:null,U==null?null:vo(U),B,Y].filter(Boolean).join(" • "),title:xe.join(" • "),cacheHitRate:j,costTotal:xt(w.costTotal),costProvenance:Q,requestedModel:E,responseModel:R,isPreviousModel:P}}function Rf(l){if(!l||typeof l!=="object")return"Price unknown";let h=[["in",l.input_per_million??l.inputPerMillion],["out",l.output_per_million??l.outputPerMillion],["cache-r",l.cache_read_per_million??l.cacheReadPerMillion],["cache-w",l.cache_write_per_million??l.cacheWritePerMillion]].map(([f,w])=>{let S=xt(w);if(S==null||S<0)return null;return`${f} $${S.toFixed(S>=1?2:4).replace(/0+$/,"").replace(/\.$/,"")}`}).filter(Boolean);return h.length>0?`${h.join(" / ")} per 1M`:"Price unknown"}function bo(l,h){let f=g(h);return D(l,{...he(f)})}function Pf(l){let h=Array.isArray(l?.model_options)&&l.model_options.length>0;return D(l).map((f)=>({label:f.key,provider:f.provider,id:f.id,name:f.displayName===f.key?null:f.displayName,contextWindow:f.contextWindow,pricing:f.pricing,reasoning:h?f.reasoning:null,...f.current?{current:!0}:{}}))}function Lf(l,h){let f=typeof l==="string"?l.trim():"";if(f)return{showPicker:!0,label:f,hasAvailableModels:!0};let w=Pf(h).length>0||Number(h?.available_model_count)>0;return{showPicker:w,label:w?"Select model":"",hasAvailableModels:w}}function wo(l){return(typeof l==="string"?l.trim():"")||null}function So(l){return wo(l)?.toLowerCase()??null}function jc(l,h){let f=So(l),w=So(h);if(!f||!w)return!1;return f===w||f.endsWith(`/${w}`)||w.endsWith(`/${f}`)}function ai(l,h){let f=So(l),w=So(h);if(!f||!w)return!1;return f.includes("/")&&w.includes("/")?f===w:jc(f,w)}function Tf(l,h){let f=h&&typeof h==="object"?h:{},w=wo(f.latest_response_model??f.response_model??f.responseModel??f.routed_model??f.routedModel);if(!w)return null;let S=wo(f.latest_requested_model??f.requested_model??f.requestedModel??f.current??f.model??l);if(S&&jc(w,S))return null;let k=wo(l??f.current??f.model);if(k&&S&&!ai(k,S))return null;return{label:`Routed: ${w}`,title:S?`Requested model: ${S} • Routed model: ${w}`:`Routed model: ${w}`,requestedModel:S,responseModel:w}}function Mf(l){if(!l)return l;let h=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!h.includes(" @ ")||!h.includes(`:
`))return l;let f=h.split(`
`),w=[],S=0,k=!1;while(S<f.length){let R=f[S].trim();if(!R){S+=1;continue}if(R==="Messages:"||R.startsWith("Channel:")||R.startsWith("Chat:")){k=!0,S+=1;continue}if(/^[^\n]+\s@\s[^\n]+:$/.test(R)){k=!0,S+=1;let L=[];while(S<f.length){let P=f[S],j=P.trim();if(/^[^\n]+\s@\s[^\n]+:$/.test(j))break;if(j.startsWith("Channel:")||j.startsWith("Chat:")||j==="Messages:")break;L.push(P.startsWith("  ")?P.slice(2):P),S+=1}if(L.length>0)w.push(L.join(`
`).trim());continue}return l}return k&&w.length>0?w.filter(Boolean).join(`

`):l}function Ic(l){let h=String(l||"").trim(),f=h.match(/^`([^`]+)`$/);return(f?f[1]:h).trim()}function Df(l){if(!l)return{content:l,fileRefs:[]};let f=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let P=0;P<f.length;P+=1)if(f[P].trim()==="Files:"&&f[P+1]&&/^\s*-\s+/.test(f[P+1])){w=P;break}if(w===-1)return{content:l,fileRefs:[]};let S=[],k=w+1;for(;k<f.length;k+=1){let P=f[k];if(/^\s*-\s+/.test(P)){let j=Ic(P.replace(/^\s*-\s+/,"").trim());if(j)S.push(j)}else if(!P.trim())break;else break}if(S.length===0)return{content:l,fileRefs:[]};let E=f.slice(0,w),R=f.slice(k);return{content:[...E,...R].join(`
`).replace(/\n{3,}/g,`

`).trim(),fileRefs:S}}function jf(l){if(!l)return{content:l,folderRefs:[]};let f=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let P=0;P<f.length;P+=1)if(f[P].trim()==="Folders:"&&f[P+1]&&/^\s*-\s+/.test(f[P+1])){w=P;break}if(w===-1)return{content:l,folderRefs:[]};let S=[],k=w+1;for(;k<f.length;k+=1){let P=f[k];if(/^\s*-\s+/.test(P)){let j=Ic(P.replace(/^\s*-\s+/,"").trim());if(j)S.push(j)}else if(!P.trim())break;else break}if(S.length===0)return{content:l,folderRefs:[]};let E=f.slice(0,w),R=f.slice(k);return{content:[...E,...R].join(`
`).replace(/\n{3,}/g,`

`).trim(),folderRefs:S}}function If(l){if(!l)return{content:l,messageRefs:[]};let f=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let P=0;P<f.length;P+=1)if(f[P].trim()==="Referenced messages:"&&f[P+1]&&/^\s*-\s+/.test(f[P+1])){w=P;break}if(w===-1)return{content:l,messageRefs:[]};let S=[],k=w+1;for(;k<f.length;k+=1){let P=f[k];if(/^\s*-\s+/.test(P)){let j=P.replace(/^\s*-\s+/,"").trim().match(/^message:(\S+)$/i);if(j)S.push(j[1])}else if(!P.trim())break;else break}if(S.length===0)return{content:l,messageRefs:[]};let E=f.slice(0,w),R=f.slice(k);return{content:[...E,...R].join(`
`).replace(/\n{3,}/g,`

`).trim(),messageRefs:S}}function Nf(l){if(!l)return{content:l,attachmentRefs:[]};let f=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let P=0;P<f.length;P+=1)if(f[P].trim()==="Attachments:"&&f[P+1]&&/^\s*-\s+/.test(f[P+1])){w=P;break}if(w===-1)return{content:l,attachmentRefs:[]};let S=[],k=w+1;for(;k<f.length;k+=1){let P=f[k];if(/^\s*-\s+/.test(P)){let j=P.replace(/^\s*-\s+/,"").trim(),N=j.match(/^attachment:(\d+)(?:\s*\((.+)\))?$/i);if(N)S.push({id:N[1],label:(N[2]||"").trim()||`attachment:${N[1]}`,raw:j})}else if(!P.trim())break;else break}if(S.length===0)return{content:l,attachmentRefs:[]};let E=f.slice(0,w),R=f.slice(k);return{content:[...E,...R].join(`
`).replace(/\n{3,}/g,`

`).trim(),attachmentRefs:S}}function Nc(l){let h=Mf(l||""),f=Df(h||""),w=jf(f.content||""),S=If(w.content||""),k=Nf(S.content||"");return{text:k.content||"",fileRefs:f.fileRefs,folderRefs:w.folderRefs,messageRefs:S.messageRefs,attachmentRefs:k.attachmentRefs}}function Ff(l){let h=Nc(l),f=h.attachmentRefs.length>0?`Attachments:
${h.attachmentRefs.map((S)=>`- ${S.raw}`).join(`
`)}`:"";return{content:[String(h.text||"").trim(),f].filter(Boolean).join(`

`).trim(),fileRefs:[...h.fileRefs],folderRefs:[...h.folderRefs],messageRefs:[...h.messageRefs],attachmentRefs:[...h.attachmentRefs]}}async function Bf(l){let{queuedItem:h,buildDraft:f=Ff,onRemoveQueuedFollowup:w,setSubmitError:S,setSubmitNotice:k,setMediaFiles:E,onSetFileRefs:R,onSetFolderRefs:L,onSetMessageRefs:P,setContent:j,textareaRef:N,resizeTextarea:B=()=>{},scheduleRaf:U=(H)=>requestAnimationFrame(H),isCurrent:q=()=>!0,canRestoreDraft:Q=()=>!0,logger:Y=console}=l||{};if(!h||!q()||typeof w!=="function")return!1;let W=f(h?.content||"");try{if(await w(h)!==!0)return!1}catch(H){return Y?.warn?.("[compose-box] Failed to remove returned queued follow-up.",H),!1}if(!q())return!1;if(!Q())return k?.("Queued message removed; existing draft preserved."),!1;let X=W.content;return Y?.info?.("[compose-box] Returning queued item to editor",{text:X?.slice(0,80),fileRefs:W.fileRefs?.length,folderRefs:W.folderRefs?.length,messageRefs:W.messageRefs?.length}),S?.(null),k?.(null),E?.([]),R?.(W.fileRefs),L?.(W.folderRefs),P?.(W.messageRefs),j?.(X),U(()=>{let H=N?.current;if(!q()||!H)return;if(H.value=X,typeof H.dispatchEvent==="function")H.dispatchEvent(new Event("input",{bubbles:!0}));B();let ce=X.length;H.selectionStart=ce,H.selectionEnd=ce,H.focus()}),!0}function Of({items:l=[],onInjectQueuedFollowup:h,onRemoveQueuedFollowup:f,onMoveQueuedFollowup:w,onReturnQueuedFollowup:S,onOpenFilePill:k}){let{t:E}=s(),R=n(new Set),[L,P]=t(()=>new Set),j=async(N)=>{let B=N.row_id;if(R.current.has(B)||!h)return;R.current.add(B),P(new Set(R.current));try{await h(N)}finally{R.current.delete(B),P(new Set(R.current))}};if(!Array.isArray(l)||l.length===0)return null;return e`
        <div class="compose-queue-stack">
            ${l.map((N,B)=>{let U=typeof N?.content==="string"?Mt(N.content):"",q=Nc(U);if(!q.text.trim()&&q.fileRefs.length===0&&q.folderRefs.length===0&&q.messageRefs.length===0&&q.attachmentRefs.length===0)return null;let Q=N?.mode==="steer",Y=L.has(N.row_id),W=!Y&&B>0&&l[B-1]?.mode==="steer"===Q,X=!Y&&B<l.length-1&&l[B+1]?.mode==="steer"===Q,H=!0;return e`
                    <div class=${`compose-queue-stack-item${Q?" is-steering":""}`} data-testid="queue-item" data-queue-mode=${Q?"steer":"followUp"} role="listitem">
                        <div class="compose-queue-stack-content" title=${U}>
                            ${Q&&e`<div class="compose-queue-stack-mode">${E("compose.queueSteering")}</div>`}
                            ${q.text.trim()&&e`<div class="compose-queue-stack-text">${q.text}</div>`}
                            ${(q.messageRefs.length>0||q.fileRefs.length>0||q.folderRefs.length>0||q.attachmentRefs.length>0)&&e`
                                <div class="compose-queue-stack-refs">
                                    ${q.messageRefs.map((ce)=>e`
                                        <${x}
                                            key=${"queue-msg-"+ce}
                                            prefix="compose"
                                            label=${"msg:"+ce}
                                            title=${"Message reference: "+ce}
                                            icon="message"
                                        />
                                    `)}
                                    ${q.fileRefs.map((ce)=>{let xe=ce.split("/").pop()||ce;return e`
                                            <${x}
                                                key=${"queue-file-"+ce}
                                                prefix="compose"
                                                label=${xe}
                                                title=${ce}
                                                onClick=${()=>k?.(ce)}
                                            />
                                        `})}
                                    ${q.folderRefs.map((ce)=>{let xe=ce.split("/").pop()||ce;return e`
                                            <${x}
                                                key=${"queue-folder-"+ce}
                                                prefix="compose"
                                                label=${xe}
                                                title=${ce}
                                                icon="folder"
                                                onClick=${()=>k?.(ce)}
                                            />
                                        `})}
                                    ${q.attachmentRefs.map((ce)=>e`
                                        <${x}
                                            key=${"queue-attachment-"+ce.id}
                                            prefix="compose"
                                            label=${ce.label}
                                            title=${ce.raw}
                                        />
                                    `)}
                                </div>
                            `}
                        </div>
                        <div class="compose-queue-stack-actions" role="group" aria-label=${E("compose.queueControls")}>
                            ${l.length>1&&e`
                                <button
                                    class="compose-queue-stack-move-btn"
                                    data-action="move-up"
                                    type="button"
                                    title=${E("compose.moveUp")}
                                    aria-label=${E("compose.moveUpQueue")}
                                    disabled=${!W}
                                    onClick=${()=>W&&w?.(B,B-1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="18 15 12 9 6 15"></polyline>
                                    </svg>
                                </button>
                                <button
                                    class="compose-queue-stack-move-btn"
                                    data-action="move-down"
                                    type="button"
                                    title=${E("compose.moveDown")}
                                    aria-label=${E("compose.moveDownQueue")}
                                    disabled=${!X}
                                    onClick=${()=>X&&w?.(B,B+1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </button>
                            `}
                            ${H&&e`
                                <button
                                    class="compose-queue-stack-move-btn queue-edit"
                                    data-action="edit"
                                    type="button"
                                    title=${E("compose.editInCompose")}
                                    aria-label=${E("compose.returnToEditor")}
                                    disabled=${Y}
                                    onClick=${(ce)=>{ce.stopPropagation(),S?.(N)}}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                </button>
                            `}
                            ${!Q&&e`<button
                                class="compose-queue-stack-steer-btn"
                                type="button"
                                title=${E("compose.injectSteer")}
                                aria-label=${E("compose.injectSteer")}
                                aria-busy=${Y?"true":void 0}
                                disabled=${Y}
                                onClick=${()=>void j(N)}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h12a2 2 0 0 0 2-2V8" />
                                    <polyline points="14 12 18 8 22 12" />
                                </svg>
                                <span>${E(Y?"compose.requestingSteer":"compose.steer")}</span>
                            </button>`}
                            <button
                                class="compose-queue-stack-close-btn queue-remove"
                                data-action="remove"
                                type="button"
                                title=${E("compose.cancelQueued")}
                                aria-label=${E("compose.cancelQueued")}
                                disabled=${Y}
                                onClick=${()=>f?.(N)}
                            >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    </div>
                `})}
        </div>
    `}var Mc=Object.freeze([]);function it({onPost:l,onFocus:h,searchMode:f,searchScope:w="current",onSearch:S,onSearchScopeChange:k,onEnterSearch:E,onExitSearch:R,fileRefs:L=[],onRemoveFileRef:P,onClearFileRefs:j,folderRefs:N=[],onRemoveFolderRef:B,onClearFolderRefs:U,messageRefs:q=[],onRemoveMessageRef:Q,onClearMessageRefs:Y,activeModel:W=null,agentModelsPayload:X=null,modelUsage:H=null,thinkingLevel:ce=null,supportsThinking:xe=!1,contextUsage:de=null,onContextCompact:Ne,notificationsEnabled:Kt=!1,notificationPermission:cn="default",onToggleNotifications:dr,onModelChange:O,onModelStateChange:Te,activeEditorPath:Wt=null,onAttachEditorFile:Ct,onOpenFilePill:ze,followupQueueItems:Fc=[],onInjectQueuedFollowup:Bc,onRemoveQueuedFollowup:$o,onMoveQueuedFollowup:Oc,onSubmitIntercept:Hc,onMessageResponse:ci,isAgentActive:Kn=!1,activeChatAgents:pt=Mc,currentChatJid:oe="web:default",connectionStatus:zc="connected",stateAccessFailed:qc=!1,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,onSubmitError:Eo,onSwitchChat:Co,onRenameSession:Ao,isRenameSessionInProgress:li=!1,onCreateSession:Ro,onCreateRootSession:Po,onDeleteSession:ln,onPurgeArchivedSession:Lo,onRestoreSession:To,showQueueStack:Gc=!0,statusNotice:At=null,extensionWorkingState:pr=null,prefillRequest:ui=null,draftValue:An=void 0,services:Mo=null,capabilities:Do=null,storageNamespace:$r="",preferenceRuntime:di=void 0,onContentChange:Kc,onSubmissionStateChange:pi,disabled:jo=!1,onJumpToLatest:Io,timelineAway:Wc=!1,timelineHasNew:fi=!1,inputId:Uc,sendButtonId:Yc}){let[we,ft]=t(()=>typeof An==="string"?An:""),{t:le}=s(),un=Mo&&typeof Mo==="object"?Mo:{},et=Do&&typeof Do==="object"?Do:{},No=un.sendAgentMessage??I,Fo=un.getAgentModels??ie,Vc=un.uploadMedia??jr,Jc=un.fetchCommands??((m)=>fetch(`/agent/commands?chat_jid=${encodeURIComponent(m)}`).then((_)=>_.ok?_.json():null)),Wn=un.browserStorage&&typeof un.browserStorage==="object"?un.browserStorage:{getItem:p,setItem:c},Tn=et.persistBrowserState!==!1,Ge=di===void 0?typeof window<"u"?window:null:di,Ut=Ge,Bo=et.commands!==!1,Oo=et.mentions!==!1,dn=et.media!==!1,Qc=et.search!==!1,Xc=et.location!==!1,_r=et.speech!==!1,Zc=et.notifications!==!1,el=et.modelPicker!==!1,Ho=et.modelSettings!==!1,mi=et.modelCompaction!==!1,tl=et.sessionRollup!==!1,[pn,gi]=t(""),[zo,nl]=t(!1),[qo,rl]=t(!1),[Rr,Go]=t("or"),[fn,mn]=t([]),[Tt,Ko]=t(null),[hi,bi]=t(!1),[ol,sl]=t(null),Yt=n(null);if(!Yt.current)Yt.current=new Vs(sl);o(()=>{let m=Yt.current;return m.reset(),()=>m.reset()},[oe]);let[il,Pr]=t(!1),[jt,Ve]=t([]),[Mr,Dr]=t(0),[Un,Je]=t(!1),Wo=n(null),[Vt,at]=t([]),[Uo,Nr]=t(0),[Yn,ct]=t(!1),[Jt,Yo]=t(!1),[Ke,gn]=t(!1),[$e,Ce]=t(!1),[mt,Br]=t(""),[Vn,yi]=t(()=>V(Ut).pinnedChatJids),[al,Vo]=t(null),[cl,Jo]=t(null),[wi,vi]=t(()=>new Set),Qo=n(new Set),gt=n(oe),Xo=n(X),vt=n(0),Jn=n(0);gt.current=oe,Xo.current=X;let[ll,jn]=t([]);o(()=>{let m=()=>{let _=g(Ge),C=new Set(_.pinnedKeys);jn((T)=>T.map((M)=>({...M,pinned:C.has(M.key),lastUsedAt:_.recentByKey[M.key]??null})))};if(Ge?.addEventListener?.(ge,m),typeof window<"u"&&Ge===window)window.addEventListener("storage",m);return()=>{if(Ge?.removeEventListener?.(ge,m),typeof window<"u"&&Ge===window)window.removeEventListener("storage",m)}},[X,Ge]),o(()=>{let m=()=>{yi(V(Ut).pinnedChatJids)};if(Ut?.addEventListener?.(_e,m),typeof window<"u"&&Ut===window)window.addEventListener("storage",m);return()=>{if(Ut?.removeEventListener?.(_e,m),typeof window<"u"&&Ut===window)window.removeEventListener("storage",m)}},[Ut]),o(()=>{let m=(_)=>{let C=_?.detail;if(C?.source==="compose")return;if(C?.chatJid&&C.chatJid!==oe)return;let T=C?.payload;if(!T||typeof T!=="object")return;let M=T.model??T.current;if(jn(bo(T,Ge)),Te?.({...T,model:M??null}),M)O?.(M)};return window.addEventListener("piclaw:model-state-changed",m),()=>window.removeEventListener("piclaw:model-state-changed",m)},[oe,Ge,O,Te]),o(()=>{vt.current+=1,Jn.current+=1,Yo(!1)},[oe]);let[ul,dl]=t(null),Si=n(null),In=n([]),Qt=r((m)=>{let _=m?.key??null;Si.current=_,dl(_)},[]),[pl,$i]=t(!1),[ki,xi]=t(!1),[,fl]=t(0),_i=n(oe);_i.current=oe;let[Ei,He]=t(null),[Ci,Xt]=t(null),[je,ml]=t(()=>_r?ri():{showButton:!1,canStart:!1}),[ht,St]=t({kind:"idle",title:"",detail:""}),[gl,Ai]=t(()=>Date.now()),[hl,Ri]=t(0),ae=n(null),Zo=$r?`${$r}:${si}`:si,Qn=n(Tn?mf(Wn,Zo):null),es=n(null),ts=n(null),Pi=n(null),Xn=n(null),Hr=n(null),Li=n([]),zr=n(null),ns=n(null),Zt=n({value:"",updatedAt:0}),[,bl]=t(0);o(()=>fo(()=>bl((m)=>m+1)),[]);let qr=n(null);qr.current={read:()=>({text:ae.current?.value??we,chatJid:oe,selectionStart:ae.current?.selectionStart??we.length,selectionEnd:ae.current?.selectionEnd??we.length}),write:(m)=>{if(ae.current)ae.current.value=m;ft(m)},state:(m)=>St({kind:m==="recording"||m==="finishing"?"listening":m==="loading"?"requesting_permission":m==="error"?"error":"idle",title:m==="error"?"Dictation failed; draft preserved":m==="finishing"?"Finishing dictation":"",detail:""})};let Ie=n(null);if(!Ie.current)Ie.current=ic({read:()=>qr.current.read(),write:(m)=>qr.current.write(m),state:(m,_)=>qr.current.state(m,_),providerSelected:()=>{let m=Ee.current;if(m)Ee.current=null,m.abort?.(),yt()}});o(()=>{Ie.current?.draftChanged()},[we,oe]),o(()=>()=>{Ie.current?.dispose()},[]);let Ee=n(null),Ti=n(""),en=n(""),tn=n(""),Gr=n(""),Kr=n(!1),Nn=n(!1),rs=n(!1),os=n(!1),ss=n(fn);ss.current=fn;let Wr=n(L),Ur=n(N),Yr=n(q);Wr.current=L,Ur.current=N,Yr.current=q;let Zn=n(0),Vr=n(!1),Mi=200,er=Tn?`${$r?`${$r}:`:""}${hf(oe)}`:"",Di=(m)=>{let _=new Set,C=[];for(let T of m||[]){if(typeof T!=="string")continue;let M=T.trim();if(!M||_.has(M))continue;_.add(M),C.push(M)}return C},ji=(m=er)=>{if(!Tn||!m)return[];let _=Wn.getItem?.(m)??null;if(!_)return[];try{let C=JSON.parse(_);if(!Array.isArray(C))return[];return Di(C)}catch{return[]}},yl=(m,_=er)=>{if(!Tn||!_)return;Wn.setItem?.(_,JSON.stringify(m))},Jr=n(ji(er)),Bn=n(-1),tr=n(""),Ii=n("");o(()=>{Jr.current=ji(er),Bn.current=-1,tr.current=""},[er]),o(()=>{if(typeof An!=="string"||An===we)return;ft(An),requestAnimationFrame(()=>bt())},[An]),o(()=>{Kc?.(we)},[we]),o(()=>{if(!f)return;fetch("/agent/settings-data").then((m)=>m.json()).then((m)=>{if(m?.searchMatchMode)Go(m.searchMatchMode)}).catch(()=>{Go((m)=>m||"or")})},[f]),o(()=>{let m=!1;if(!Bo)return Wo.current=[],()=>{m=!0};return Promise.resolve(Jc(oe||"web:default")).then((C)=>{if(m||!C?.commands)return;Wo.current=C.commands.map((T)=>({name:T.name,description:T.description||""}))}).catch((C)=>{console.debug("[compose] failed to fetch dynamic commands",C)}),()=>{m=!0}},[oe,Bo]),o(()=>{let m=gf(ui,Ii.current,f);if(!m.shouldApply)return;Ii.current=m.nextToken,He(null),ft(m.text),ys(m.text),ws(m.text),requestAnimationFrame(()=>{bt();let _=ae.current;if(!_)return;try{_.focus({preventScroll:!0})}catch{_.focus()}let C=m.text.length;_.setSelectionRange?.(C,C)})},[ui,f]),o(()=>{ml(_r?ri():{showButton:!1,canStart:!1})},[_r]);let wl=!jo&&(Ie.current?.active||we.trim()||fn.length>0||L.length>0||N.length>0||q.length>0),vl=ht.kind!=="idle",Sl=ht.kind==="requesting_permission"||ht.kind==="listening",Qr=Ie.current?.selected,is=_r&&!f&&Boolean(Qr||je?.showButton),Xr=ht.kind==="requesting_permission"||ht.kind==="listening",Ni=Xr?"Stop voice input":Qr?"Voice input":je?.title||"Voice input",$l=Xc&&typeof window<"u"&&typeof navigator<"u"&&Boolean(navigator.geolocation)&&Boolean(window.isSecureContext),kl=typeof window<"u"&&typeof Notification<"u",xl=typeof window<"u"?Boolean(window.isSecureContext):!1,_l=Zc&&kl&&xl&&cn!=="denied",Fi=cn==="granted"&&Kt,nn=J(At),Bi=Pt(At),as=typeof At?.detail==="string"&&At.detail.trim()?At.detail.trim():"",cs=nn?Le(At,gl):null,On=kf(pr,hl),Nt=pr?.indicator&&typeof pr.indicator==="object"?pr.indicator:null,El=Fi?"Disable notifications":"Enable notifications",Cl=fn.length>0||L.length>0||N.length>0||q.length>0,Zr=$c(qc?zc:"connected"),{label:Al,title:Rl}=Zr,Oi=wf(Kn,wl,nn),eo=hi?{...Oi,disabled:!0,title:Tt?"Uploading attachments…":"Sending…",ariaLabel:Tt?"Uploading attachments":"Sending message"}:Oi,hn=Sf(Kn,nn),Hi=i(()=>(Array.isArray(pt)?pt:Mc).filter((m)=>!m?.archived_at),[pt]),Re=(()=>{for(let m of Array.isArray(pt)?pt:[]){let _=typeof m?.chat_jid==="string"?m.chat_jid.trim():"";if(_&&_===oe)return m}return null})(),Pl=Boolean(Re&&Re.chat_jid===(Re.root_chat_jid||Re.chat_jid)),Ll=Boolean(Pl&&(Re?.chat_jid||oe)==="web:default"),Ht=(()=>{let m=typeof Re?.parent_branch_id==="string"?Re.parent_branch_id.trim():"",_=typeof Re?.branch_id==="string"?Re.branch_id.trim():"";if(!Re||!m||!_||Re.archived_at)return null;if((Array.isArray(pt)?pt:[]).filter((M)=>{let Z=typeof M?.parent_branch_id==="string"?M.parent_branch_id.trim():"";return Z&&Z===_}).length>0)return null;return(Array.isArray(pt)?pt:[]).find((M)=>{let Z=typeof M?.branch_id==="string"?M.branch_id.trim():"";return Z&&Z===m&&!M?.archived_at})||null})(),nr=i(()=>me(pt,oe,wi),[pt,oe,wi]),Tl=i(()=>new Set(Vn),[Vn]),ls=i(()=>Oe(nr,mt),[nr,mt]),us=i(()=>Be(ls,oe,Vn),[ls,oe,Vn]),ds=i(()=>us.flatMap((m)=>m.items),[us]);Li.current=nr;let to=nr.length>0,bn=to&&typeof Co==="function",yn=to&&typeof To==="function",no=Boolean(li||Vr.current),wn=!f&&typeof Ao==="function"&&Re?.capabilities?.rename!==!1&&!no,vn=!f&&typeof Ro==="function"&&Re?.capabilities?.fork!==!1,rr=!f&&typeof Po==="function",or=tl&&!f&&!Kn&&!ki&&Boolean(Ht?.chat_jid),Sn=!f&&typeof ln==="function"&&Re?.capabilities?.archive!==!1&&!Ll,zi=!f&&typeof Lo==="function",$n=!f&&(bn||yn||wn||vn||rr||or||Sn||zi),qi=el?Lf(W,X):{showPicker:!1,label:"",hasAvailableModels:!1},{showPicker:ro,label:Hn}=qi,ps=xe&&ce?` (${ce})`:"",Gi=ps.trim()?`${ce}`:"",fs=Tf(W,X),sr=Af(de,W),ms=typeof H?.hint_short==="string"?H.hint_short.trim():"",Ki=D(X).find((m)=>ai(m.key,W)),Wi=Rf(Ki?.pricing),Ml=Cf(H),Ui=[Gi?{key:"thinking",text:Gi}:null,fs?.label?{key:"routed",text:fs.label}:null,ms?{key:"quota",text:ms}:null,sr?.label?{key:"run",text:sr.label}:null].filter(Boolean),Dl=Ui.map((m)=>m.text).join(" • "),gs=Hn.indexOf("/"),hs=gs>0?Hn.slice(0,gs+1):"",jl=hs?Hn.slice(gs+1):Hn,Il=[W?`Current model: ${Hn}${ps}`:null,fs?.title||null,H?.plan?`Plan: ${H.plan}`:null,ms||null,H?.availability&&H.availability!=="available"?`Usage telemetry: ${H.availability.replaceAll("_"," ")}`:null,H?.stale?`Usage telemetry stale after ${String(H.refresh_failure||"refresh failure").replaceAll("_"," ")}`:null,Ml,Wi?`Catalogue pricing: ${Wi}`:null,sr?.title||null,H?.primary?.reset_description||null,H?.secondary?.reset_description||null].filter(Boolean),Yi=Jt?"Switching model…":Il.join(" • ")||(ro?"Select a model (tap to open model picker)":`Current model: ${Hn}${ps} (tap to open model picker)`),Vi=!f&&(ro||sr||de),[zt,Nl]=t(()=>Ys());o(()=>{if(typeof window>"u")return;let m=()=>Nl(Ys());return window.addEventListener(Us,m),m(),()=>window.removeEventListener(Us,m)},[]);let bs=(m)=>{if(!m||typeof m!=="object")return;let _=m.model??m.current;if(typeof Te==="function")Te({...m,model:_??null,thinking_level:m.thinking_level??null,thinking_level_label:m.thinking_level_label??null,supports_thinking:m.supports_thinking,provider_usage:m.provider_usage??null});if(_&&typeof O==="function")O(_);window.dispatchEvent?.(new CustomEvent("piclaw:model-state-changed",{detail:{chatJid:oe,payload:m,source:"compose"}}))},Ji=(m,_)=>{let C=ii(_);return m.style.minHeight=`${C}px`,m.style.height=`${C}px`,m.style.overflowY=m.scrollHeight>C?"auto":"hidden",C},bt=(m)=>{let _=m||ae.current;if(!_)return;let C=Qn.current;if(C!=null){Ji(_,C);return}_.style.minHeight="",_.style.height="auto";let T=Math.max(Dc(),Math.min(_.scrollHeight,pf()));_.style.height=`${T}px`,_.style.overflowY=_.scrollHeight>T?"auto":"hidden"},ys=(m)=>{if(!m.startsWith("/")||m.includes(`
`)){Je(!1),Ve([]);return}let _=m.toLowerCase().split(" ")[0];if(_.length<1){Je(!1),Ve([]);return}let T=(Wo.current||uf).filter((M)=>M.name.startsWith(_)||M.name.replace(/-/g,"").startsWith(_.replace(/-/g,"")));if(T.length>0&&!(T.length===1&&T[0].name===_))ct(!1),at([]),Ve(T),Dr(0),Je(!0);else Je(!1),Ve([])},Qi=(m)=>{let _=we,C=_.indexOf(" "),T=C>=0?_.slice(C):"",M=m.name+T;ft(M),Je(!1),Ve([]),requestAnimationFrame(()=>{let Z=ae.current;if(!Z)return;let re=M.length;Z.selectionStart=re,Z.selectionEnd=re,Z.focus()})},ws=(m)=>{if(Zs(m,{searchMode:f,showSessionSwitcherButton:$n})){ct(!1),at([]);return}if(Js(m)==null){ct(!1),at([]);return}let _=lc(Hi,m,{currentChatJid:oe});if(_.length>0&&!(_.length===1&&Qs(_[0].agent_name).trim().toLowerCase()===String(m||"").trim().toLowerCase()))Je(!1),Ve([]),at(_),Nr(0),ct(!0);else ct(!1),at([])},Xi=(m)=>{let _=Qs(m?.agent_name);if(!_)return;ft(_),ct(!1),at([]),requestAnimationFrame(()=>{let C=ae.current;if(!C)return;let T=_.length;C.selectionStart=T,C.selectionEnd=T,C.focus()})},vs=()=>{if(f||!bn&&!yn&&!wn&&!vn&&!Sn)return!1;return Zt.current={value:"",updatedAt:0},gn(!1),Je(!1),Ve([]),ct(!1),at([]),Br(""),Ce(!0),!0},Fl=(m)=>{if(m?.preventDefault?.(),m?.stopPropagation?.(),f||!bn&&!yn&&!wn&&!vn&&!Sn)return;if($e){Zt.current={value:"",updatedAt:0},Ce(!1);return}vs()},Zi=(m)=>{let _=typeof m==="string"?m.trim():"";if(Ce(!1),!_||_===oe){requestAnimationFrame(()=>ae.current?.focus());return}Co?.(_)},ea=async(m)=>{let _=typeof m==="string"?m.trim():"";if(Ce(!1),!_||typeof To!=="function"){requestAnimationFrame(()=>ae.current?.focus());return}try{await To(_)}catch(C){console.warn("Failed to restore session:",C),requestAnimationFrame(()=>ae.current?.focus())}},Ss=r((m)=>{let _=typeof m==="string"?m.trim():"";if(!_||Qo.current.has(_))return!1;return Qo.current.add(_),vi((C)=>{let T=new Set(C instanceof Set?C:[]);return T.add(_),T}),!0},[]),$s=r((m,_)=>{let C=typeof m==="string"?m.trim():"";if(!C)return;if(Qo.current.delete(C),_)return;vi((T)=>{let M=new Set(T instanceof Set?T:[]);return M.delete(C),M})},[]),oo=r(async(m,_={})=>{let C=typeof m?.chat_jid==="string"?m.chat_jid.trim():"";if(!C)return;if(_.canPurgeArchived){if(!Ss(C))return;Vo(null);let T=!1;try{T=await Lo?.(C,{confirmed:!0})!==!1}catch(M){console.warn("Failed to purge archived session:",M)}if($s(C,T),T)Ce(!1);return}if(_.canPrune){if(!Ss(C))return;Jo(null);let T=!1;try{T=await ln(C,{confirmed:!0})!==!1}catch(M){console.warn("Failed to delete session:",M)}if($s(C,T),T)Ce(!1)}},[$s,Ss,ln,Lo]);o(()=>{if(!$e)return;let m=(_)=>{let C=Hr.current;if(!C)return;let M=_.target?.closest?.("button.compose-model-popup-item-delete.confirming[data-chat-jid]");if(!M||!C.contains(M))return;_.preventDefault?.(),_.stopPropagation?.(),_.stopImmediatePropagation?.();let Z=typeof M.dataset?.chatJid==="string"?M.dataset.chatJid.trim():"";if(!Z)return;let re=Li.current.find((se)=>se?.chat_jid===Z)||{chat_jid:Z};oo(re,{canPurgeArchived:M.dataset?.deleteKind==="purge",canPrune:M.dataset?.deleteKind==="prune"})};return document.addEventListener("pointerdown",m,!0),document.addEventListener("mousedown",m,!0),document.addEventListener("touchstart",m,!0),()=>{document.removeEventListener("pointerdown",m,!0),document.removeEventListener("mousedown",m,!0),document.removeEventListener("touchstart",m,!0)}},[oo,$e]);let ut=i(()=>{let m=[];for(let _ of ds){let C=Boolean(_?.archived_at),T=typeof _?.agent_name==="string"?_.agent_name.trim():"",M=typeof _?.chat_jid==="string"?_.chat_jid.trim():"";if(!T||!M)continue;m.push({type:"session",key:`session:${M}`,label:`@${T} — ${M}${_?.is_active?" active":""}${C?" archived":""}`,chat:_,disabled:C?!yn||_?.capabilities?.restore===!1:!bn||_?.capabilities?.open===!1})}if(!mt&&vn)m.push({type:"action",key:"action:new",label:"New branch",action:"new",disabled:!1});if(!mt&&rr)m.push({type:"action",key:"action:new-root",label:"New root session…",action:"new-root",disabled:!1});if(!mt&&Ht?.chat_jid)m.push({type:"action",key:"action:rollup",label:"Merge current w/ parent",action:"rollup",disabled:!or});if(!mt&&wn)m.push({type:"action",key:"action:rename",label:"Rename current session",action:"rename",disabled:no});if(!mt&&Sn)m.push({type:"action",key:"action:delete",label:"Delete current session",action:"delete",disabled:!1});return m},[ds,mt,yn,bn,vn,rr,Ht,or,wn,Sn,no]);In.current=ut;let $t=Math.max(0,ut.findIndex((m)=>m.key===ul)),ks=r((m)=>{let _=Et(m,Ut);yi(_.pinnedChatJids);let C=In.current,T=C.filter((ve)=>ve?.type==="session").map((ve)=>ve.chat),M=Be(T,oe,_.pinnedChatJids).flatMap((ve)=>ve.items),Z=C.filter((ve)=>ve?.type==="session"),re=C.filter((ve)=>ve?.type!=="session"),se=new Map(Z.map((ve)=>[ve.chat.chat_jid,ve])),be=M.map((ve)=>se.get(ve.chat_jid)).filter(Boolean);In.current=[...be,...re];let Qe=hc(M,m);if(Qe>=0)Qt(be[Qe])},[oe,Qt]),ta=async(m)=>{if(m?.preventDefault)m.preventDefault();if(m?.stopPropagation)m.stopPropagation();if(typeof Ao!=="function"||li||Vr.current)return;Vr.current=!0,Ce(!1);try{await Ao()}catch(_){console.warn("Failed to rename session:",_)}finally{Vr.current=!1}requestAnimationFrame(()=>ae.current?.focus())},na=async()=>{if(typeof Ro!=="function")return;Ce(!1);try{await Ro()}catch(m){console.warn("Failed to create session:",m)}requestAnimationFrame(()=>ae.current?.focus())},ra=async()=>{if(typeof Po!=="function")return;Ce(!1);let m=typeof window<"u"?window.prompt("New root session handle (for example: ops)"):"",_=String(m||"").trim();if(!_){requestAnimationFrame(()=>ae.current?.focus());return}try{await Po(_)}catch(C){console.warn("Failed to create root session:",C)}requestAnimationFrame(()=>ae.current?.focus())},oa=async()=>{let m=typeof Ht?.chat_jid==="string"?Ht.chat_jid.trim():"";if(!m||ki||Kn)return;Ce(!1),He(null),Xt(null),xi(!0);try{let _=await No("default","/rollup",null,[],null,oe);ci?.(_),l?.(_);let C=_?.command;if(C?.status==="error"){let M=C?.message||"Failed to merge current session with parent.";He(M),Eo?.(M);return}let T=typeof C?.rolled_up_to==="string"&&C.rolled_up_to.trim()?C.rolled_up_to.trim():m;Co?.(T)}catch(_){let C=_?.message||"Failed to merge current session with parent.";He(C),Eo?.(C),console.warn("Failed to merge session with parent:",_)}finally{xi(!1)}requestAnimationFrame(()=>ae.current?.focus())},sa=async()=>{if(typeof ln!=="function")return;Ce(!1);try{await ln(oe)}catch(m){console.warn("Failed to delete session:",m)}requestAnimationFrame(()=>ae.current?.focus())},ia=(m,_,C)=>{let T=ae.current;if(!T||!C)return;let M=m,Z=!1,re=oe;C.classList.add("dragging"),document.body.style.cursor="row-resize",document.body.style.userSelect="none";let se=(Ye)=>{if(Math.abs(Ye-_)>4)Z=!0;M=Ji(T,m+(_-Ye)),Qn.current=M},be=(Ye)=>{se(Ye.clientY)},Qe=(Ye)=>{let qt=Ye.touches[0];if(!qt)return;Ye.preventDefault(),se(qt.clientY)},ve=(Ye)=>{if(C.classList.remove("dragging"),document.body.style.cursor="",document.body.style.userSelect="",Tn)Wn.setItem?.(Zo,String(Math.round(M)));if(document.removeEventListener("mousemove",be),document.removeEventListener("mouseup",ve),document.removeEventListener("touchmove",Qe),document.removeEventListener("touchend",ve),document.removeEventListener("touchcancel",ve),!Z&&Ye?.type!=="touchcancel"&&T.isConnected&&_i.current===re)Io?.()};document.addEventListener("mousemove",be),document.addEventListener("mouseup",ve),document.addEventListener("touchmove",Qe,{passive:!1}),document.addEventListener("touchend",ve),document.addEventListener("touchcancel",ve)},Bl=(m)=>{let _=ae.current;if(!_)return;m.preventDefault(),ia(_.getBoundingClientRect().height,m.clientY,m.currentTarget)},Ol=(m)=>{let _=ae.current,C=m.touches?.[0];if(!_||!C)return;m.preventDefault(),ia(_.getBoundingClientRect().height,C.clientY,m.currentTarget)},rn=(m)=>{if(f)gi(m);else{if(ft(m),Bo)ys(m);else Je(!1),Ve([]);if(Oo)ws(m);else ct(!1),at([])}requestAnimationFrame(()=>bt())},Hl=(m)=>{let _=f?pn:we,C=_&&!_.endsWith(`
`)?`
`:"",T=`${_}${C}${m}`.trimStart();rn(T)},xs=r(()=>{requestAnimationFrame(()=>{let m=ae.current;if(!m)return;try{m.focus({preventScroll:!0})}catch{m.focus()}})},[]),yt=r(()=>{St({kind:"idle",title:"",detail:""})},[]),_s=r((m=en.current,_=tn.current)=>{if(f)return;rn(_c(Ti.current,m,_))},[f]),kt=r(()=>{Kr.current=!0;let m=Ee.current;if(!m){yt();return}try{m.stop()}catch{Ee.current=null,yt()}},[yt]),Es=r(()=>{if(Ie.current?.selected){Ie.current.toggle().catch(()=>He("Dictation could not finish. Draft preserved."));return}if(He(null),Xt(null),Ee.current){kt();return}if(!je?.showButton)return;if(je.mode==="fallback"){xs(),St({kind:"guidance",title:je.title||"Use keyboard dictation",detail:je.detail||"Use your keyboard dictation mic for voice input here."});return}if(!je?.canStart||!je?.recognitionCtor){St({kind:"error",title:je?.title||"Voice input unavailable",detail:je?.detail||"This browser does not expose native speech recognition in this context."});return}try{let m=new je.recognitionCtor;if(Ee.current=m,Ti.current=String(we||""),en.current="",tn.current="",Gr.current="",Kr.current=!1,m.lang=typeof navigator<"u"&&navigator.language?navigator.language:"en-US",m.interimResults=!0,m.continuous=!1,"maxAlternatives"in m)m.maxAlternatives=1;m.onstart=()=>{if(Ee.current!==m||Ie.current?.selected)return;St({kind:"listening",title:"Listening…",detail:"Speak now. Tap the mic again to stop."})},m.onresult=(_)=>{if(Ee.current!==m||Ie.current?.selected)return;let{finalText:C,interimText:T}=Ec(_?.results,_?.resultIndex||0);if(C)en.current=`${en.current} ${C}`.trim();tn.current=T,_s(),St({kind:"listening",title:"Listening…",detail:T?`Heard: ${T}`:"Speak now. Tap the mic again to stop."})},m.onerror=(_)=>{if(Ee.current!==m||Ie.current?.selected)return;let C=String(_?.error||"").trim();if(Gr.current=C,Ee.current=null,tn.current="",C==="aborted"){yt();return}St({kind:"error",title:"Voice input failed",detail:oi(C,je)})},m.onend=()=>{if(Ee.current!==m||Ie.current?.selected)return;let _=Gr.current,C=Kr.current,T=Boolean(en.current.trim()||tn.current.trim());if(Ee.current=null,Kr.current=!1,Gr.current="",tn.current.trim())en.current=`${en.current} ${tn.current}`.trim(),tn.current="";if(T)_s(en.current,"");if(_&&_!=="aborted")return;if(!T&&!C){St({kind:"error",title:"No speech detected",detail:oi("no-speech",je)});return}yt()},St({kind:"requesting_permission",title:"Starting voice input…",detail:"Allow microphone access if the browser asks."}),xs(),m.start()}catch(m){Ee.current=null,St({kind:"error",title:"Voice input failed",detail:m?.message||"Could not start native browser speech recognition."})}},[_s,yt,we,xs,je,kt]),aa=async(m,_=null)=>{if(f||Jt)return;let C=oe,T=++vt.current;He(null),Xt(null),Yo(!0);try{let M=await No("default",m,null,[],null,C);if(T!==vt.current||C!==gt.current)return!1;if(M?.error||M?.command===!1||M?.command?.status==="error")throw Error(M?.error||M?.command?.message||"Model switch failed.");let Z=null,re=await ni(Fo,C,(se)=>{if(T===vt.current&&C===gt.current)bs(se)},(se)=>{if(T!==vt.current||C!==gt.current)return;Z=D(se).find((be)=>be.current)?.key??F(se?.current??se?.model)??null,jn(bo(se,Ge))});if(T!==vt.current||C!==gt.current)return!1;if(!re||_&&Z!==_)throw Error("The server did not confirm the model switch.");if(_)Ue(_,new Date().toISOString(),Ge);return Xt(Lc(m,M)),l?.(M),!0}catch(M){return console.error("Failed to switch model:",M),alert("Failed to switch model: "+M.message),!1}finally{if(T===vt.current)Yo(!1)}},zl=(m)=>{if(m.pointerType==="mouse")return;let _=ae.current?.value??(f?pn:we);if(!Tc({key:" ",code:"Space",ctrlKey:m.ctrlKey,metaKey:m.metaKey,altKey:m.altKey},_,{searchMode:f,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||je?.canStart&&je?.recognitionCtor)}))return;m.preventDefault(),Nn.current=!0,rs.current=!0,Es()},Cs=(m)=>{if(!Nn.current)return;if(m?.preventDefault?.(),Nn.current=!1,Ie.current?.selected)Ie.current.toggle().catch(()=>He("Dictation could not finish. Draft preserved."));else if(Ee.current)kt()},ql=(m)=>{if(rs.current){rs.current=!1,m.preventDefault();return}Es()},Gl=async(m)=>{let _=typeof m==="string"?m.trim():"";if(!_||Jt)return;await aa(`/thinking ${_}`)},Kl=async(m)=>{let _=typeof m==="string"?m:typeof m?.key==="string"?m.key:typeof m?.label==="string"?m.label:"";if(!_||Jt)return;if(await aa(`/model ${_}`,_))gn(!1),requestAnimationFrame(()=>Xn.current?.focus?.())},Wl=(m)=>{if(!m||m.disabled)return;if(m.type==="session"){let _=m.chat;if(_?.archived_at)ea(_.chat_jid);else Zi(_.chat_jid);return}if(m.type==="action"){if(m.action==="new"){na();return}if(m.action==="new-root"){ra();return}if(m.action==="rollup"){oa();return}if(m.action==="rename"){ta();return}if(m.action==="delete")sa()}},so=r(()=>{gn(!1),requestAnimationFrame(()=>Xn.current?.focus?.())},[]),Ul=(m)=>{m.preventDefault(),m.stopPropagation(),Zt.current={value:"",updatedAt:0},Ce(!1),gn((_)=>{if(!_)jn(bo(X,Ge));return!_})},ca=async()=>{if(f)return;Ne?.(),await kn("/compact",null,{includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,clearAfterSubmit:!1,recordHistory:!1})},Yl=(m)=>{if(m==="queue"||m==="steer"||m==="auto")return m;return Kn?"queue":void 0},kn=async(m,_,C={})=>{if(!C.dictationFinished&&Ie.current?.active&&!/^\/abort\s*$/i.test(String(m||""))){let Ze=m==null||m===(ae.current?.value??we);try{await Ie.current.submit(async()=>{await kn(Ze?ae.current?.value??we:m,_,{...C,dictationFinished:!0})})}catch{He("Dictation could not finish. Draft preserved; send again explicitly.")}return}let T=typeof m==="string"?m:we;if(Ho&&/^\/settings\s*$/i.test(T.trim())){ft(""),requestAnimationFrame(()=>bt()),A();return}if(Ho&&/^\/help\s*$/i.test(T.trim())){ft(""),requestAnimationFrame(()=>bt()),A({section:"keyboard"});return}let M=/^\/abort\s*$/i.test(T.trim());if(os.current&&!M)return;let{includeMedia:Z=!0,includeFileRefs:re=!0,includeFolderRefs:se=!0,includeMessageRefs:be=!0,clearAfterSubmit:Qe=!0,recordHistory:ve=!0}=C||{},Ye=typeof m==="string"?m:m&&typeof m?.target?.value==="string"?m.target.value:we,qt=typeof Ye==="string"?Ye:"";if(!qt.trim()&&(Z?fn.length===0:!0)&&(re?L.length===0:!0)&&(se?N.length===0:!0)&&(be?q.length===0:!0))return;let ar=!M;if(ar)os.current=!0,bi(!0),pi?.(!0);if(Ee.current)kt();yt(),Je(!1),Ve([]),ct(!1),at([]),Ce(!1),He(null),Xt(null);let dt=ar?Yt.current.begin(oe):null,cr=Z?[...fn]:[],zn=re?[...L]:[],xn=se?[...N]:[],Se=be?[...q]:[],We=qt.trim(),Xe=oe,da=vt.current;if(ve&&We){let Ze=Jr.current,ke=Di(Ze.filter((Gt)=>Gt!==We));if(ke.push(We),ke.length>Mi)ke.splice(0,ke.length-Mi);Jr.current=ke,yl(ke),Bn.current=-1,tr.current=""}let uu=()=>{let Ze=(ke,Gt)=>[...new Set([...ke||[],...Gt||[]])];if(Z)mn((ke)=>[...cr.filter((Gt)=>!ke.includes(Gt)),...ke]);if(re)ko?.(Ze(zn,Wr.current));if(se)xo?.(Ze(xn,Ur.current));if(be)_o?.(Ze(Se,Yr.current));ft((ke)=>{if(!We)return ke;if(!ke.trim())return We;if(ke.trim()===We)return ke;return`${We}

${ke}`}),requestAnimationFrame(()=>bt())};if(Qe)ft(""),mn([]),j?.(),U?.(),Y?.();(async()=>{try{let Ze=await Hc?.({content:We,submitMode:_,fileRefs:zn,folderRefs:xn,messageRefs:Se,mediaFiles:cr});if(Ze){l?.(Ze);return}let ke=await lt(dn?cr:[],(Ae,wt)=>Vc(Ae,{onProgress:wt}),{onProgress:Ko}),Gt=ke.filter(({result:Ae})=>Ae.id).map(({name:Ae,result:wt})=>({name:Ae,id:wt.id})),du=ke.filter(({result:Ae})=>Ae.storage==="workspace").map(({result:Ae})=>Ae.path),pu=Gt.map(({id:Ae})=>Ae),pa=[...zn,...du],fu=pa.length?`Files:
${pa.map((Ae)=>`- ${Ae}`).join(`
`)}`:"",mu=xn.length?`Folders:
${xn.map((Ae)=>`- ${Ae}`).join(`
`)}`:"",gu=Se.length?`Referenced messages:
${Se.map((Ae)=>`- message:${Ae}`).join(`
`)}`:"",hu=Gt.length?`Attachments:
${Gt.map(({id:Ae,name:wt},io)=>{let Rs=wt||`attachment-${io+1}`;return`- attachment:${Ae} (${Rs})`}).join(`
`)}`:"",bu=[We,fu,mu,gu,hu].filter(Boolean).join(`

`);Ko(null);let on=await No("default",bu,null,pu,Yl(_),Xe);Or(on);let fa=Fr(on);if(fa&&gt.current===Xe)He(fa);if(ci?.(on),dt!==null)if(on?.command?.status==="error")Yt.current.failed(dt);else Yt.current.acknowledged(dt);if(on?.command&&on.command.status!=="error"){let Ae=/^\/(?:model\s+\S+|cycle-model)\s*$/i.test(We.trim());await ni(Fo,Xe,(wt)=>{if(da===vt.current&&Xe===gt.current)bs(wt)},(wt)=>{if(da!==vt.current||Xe!==gt.current)return;let io=D(wt).find((Rs)=>Rs.current)?.key??F(wt?.current??wt?.model)??null;if(Ae&&io)Ue(io,new Date().toISOString(),Ge)})}Xt(Lc(We,on)),l?.(on)}catch(Ze){if(Qe)uu();let ke=Ze?.message||"Failed to send message.";if(dt!==null)Yt.current.failed(dt);He(ke),Eo?.(ke),console.error("Failed to post:",Ze)}finally{if(ar){if(dt!==null)Yt.current.finished(dt);Ko(null),bi(!1),os.current=!1,pi?.(!1)}}})()},Vl=(m)=>Bc?.(m),Jl=r((m)=>{let _=oe,C=ae.current,T=C?.value??we,M=Wr.current,Z=Ur.current,re=Yr.current,se=ss.current;return Bf({queuedItem:m,onRemoveQueuedFollowup:$o,isCurrent:()=>gt.current===_&&ae.current===C,canRestoreDraft:()=>(ae.current?.value??we)===T&&Wr.current===M&&Ur.current===Z&&Yr.current===re&&ss.current===se,setSubmitError:He,setSubmitNotice:Xt,setMediaFiles:mn,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,setContent:ft,textareaRef:ae,resizeTextarea:bt})},[oe,we,$o,ko,xo,_o,bt]),ir=r((m)=>{if(f||!Ke&&!$e||m?.isComposing)return!1;let _=()=>{m.preventDefault?.(),m.stopPropagation?.()},C=()=>{Zt.current={value:"",updatedAt:0}};if(Ke&&m.target?.closest?.("[data-compose-model-catalogue]"))return!1;if(m.key==="Escape"){if(_(),C(),Ke)so();if($e)Ce(!1),Br(""),requestAnimationFrame(()=>zr.current?.querySelector?.("button")?.focus?.());return!0}if(Ke)return!1;if($e){let T=In.current,M=Math.max(0,T.findIndex((re)=>re.key===Si.current)),Z=Boolean(m.target?.classList?.contains?.("compose-session-search"));if(["ArrowDown","ArrowUp","Home","End","PageDown","PageUp"].includes(m.key)){if(_(),C(),T.length>0){let re=bc(M,T.length,m.key);Qt(T[re])}return!0}if(m.key==="Enter"&&m.altKey&&T.length>0){_(),C();let re=T[M];if(re?.type==="session"&&!re.chat?.archived_at)ks(re.chat.chat_jid);return!0}if((m.key==="Enter"||m.key==="Tab")&&T.length>0)return _(),C(),Wl(T[M]),!0;if(!Z&&Dt(m)&&T.length>0){_();let re=ac(Zt.current,m.key);Zt.current=re;let se=cc(T,re.value,M,(be)=>be.label);if(se>=0)Qt(T[se]);return!0}}return!1},[f,Ke,$e,Qt,so,ks]),Ql=(m)=>{if(m.isComposing||m.defaultPrevented)return;if(m.key==="Enter"&&(m.ctrlKey||m.metaKey)&&!m.shiftKey&&!m.altKey&&!f){let C=Lr(m);if(m.preventDefault(),C)kn(ae.current?.value??we,"steer");return}if(f&&m.key==="Escape"){m.preventDefault(),gi(""),R?.();return}if(ir(m))return;let _=ae.current?.value??(f?pn:we);if(Tc(m,_,{searchMode:f,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||je?.canStart&&je?.recognitionCtor)})){m.preventDefault(),Nn.current=!0,Es();return}if(wc(m,_,{searchMode:f,showSessionSwitcherButton:$n})){m.preventDefault(),vs();return}if(Yn&&Vt.length>0){let C=ae.current?.value??(f?pn:we);if(!String(C||"").match(/^@([a-zA-Z0-9_-]*)$/))ct(!1),at([]);else{if(m.key==="ArrowDown"){m.preventDefault(),Nr((T)=>(T+1)%Vt.length);return}if(m.key==="ArrowUp"){m.preventDefault(),Nr((T)=>(T-1+Vt.length)%Vt.length);return}if(m.key==="Tab"||m.key==="Enter"){m.preventDefault(),Xi(Vt[Uo]);return}if(m.key==="Escape"){m.preventDefault(),ct(!1),at([]);return}}}if(Un&&jt.length>0){let C=ae.current?.value??(f?pn:we);if(!String(C||"").startsWith("/"))Je(!1),Ve([]);else{if(m.key==="ArrowDown"){m.preventDefault(),Dr((T)=>(T+1)%jt.length);return}if(m.key==="ArrowUp"){m.preventDefault(),Dr((T)=>(T-1+jt.length)%jt.length);return}if(m.key==="Tab"){m.preventDefault(),Qi(jt[Mr]);return}if(m.key==="Enter"&&!m.shiftKey){if(!_.includes(" ")){m.preventDefault();let M=jt[Mr];Je(!1),Ve([]),kn(M.name);return}}if(m.key==="Escape"){m.preventDefault(),Je(!1),Ve([]);return}}}if(!f&&(m.key==="ArrowUp"||m.key==="ArrowDown")&&!m.metaKey&&!m.ctrlKey&&!m.altKey&&!m.shiftKey){let C=ae.current;if(!C)return;let T=C.value||"",M=C.selectionStart===0&&C.selectionEnd===0,Z=C.selectionStart===T.length&&C.selectionEnd===T.length;if(m.key==="ArrowUp"&&M||m.key==="ArrowDown"&&Z){let re=Jr.current;if(!re.length)return;m.preventDefault();let se=Bn.current;if(m.key==="ArrowUp"){if(se===-1)tr.current=T,se=re.length-1;else if(se>0)se-=1;Bn.current=se,rn(re[se]||"")}else{if(se===-1)return;if(se<re.length-1)se+=1,Bn.current=se,rn(re[se]||"");else Bn.current=-1,rn(tr.current||""),tr.current=""}requestAnimationFrame(()=>{let be=ae.current;if(!be)return;let Qe=be.value.length;be.selectionStart=Qe,be.selectionEnd=Qe});return}}if(m.key==="Enter"&&!m.shiftKey&&(m.ctrlKey||m.metaKey)){if(m.preventDefault(),f){if(_.trim())S?.(_.trim(),w,{images:zo,attachments:qo})}return}if(m.key==="Enter"&&!m.shiftKey&&!m.ctrlKey&&!m.metaKey&&!m.altKey&&!m.repeat){if(m.preventDefault(),f){if(_.trim())S?.(_.trim(),w,{images:zo,attachments:qo})}else kn(_);return}if(m.key==="Escape"){if(Ke||$e||Un||Yn)return;m.preventDefault(),ae.current?.blur()}},Xl=(m)=>{if(vf(m,Nn.current)){if(m.preventDefault(),Nn.current=!1,Ie.current?.selected)Ie.current.toggle().catch(()=>He("Dictation could not finish. Draft preserved."));else if(Ee.current)kt()}},As=(m)=>{if(!dn)return;let _=Array.from(m||[]).filter((C)=>C instanceof File&&!String(C.name||"").startsWith(".DS_Store"));if(!_.length)return;mn((C)=>[...C,..._]),He(null)};o(()=>{let m=async(_)=>{let C=_?.detail?.mediaId;if(!C)return;try{let{getMediaBlob:T}=await (u("9f4r5tar"),import("./api-9f4r5tar.js")),M=await T(C),Z=new File([M],`annotated-${C}.png`,{type:M.type||"image/png"});mn((re)=>[...re,Z]),ae.current?.focus()}catch(T){console.warn("[compose-box] Failed to attach annotated image:",T)}};return window.addEventListener("piclaw:compose-media-attach",m),()=>window.removeEventListener("piclaw:compose-media-attach",m)},[]);let Zl=(m)=>{As(m.target.files),m.target.value=""},eu=(m)=>{if(f||!dn)return;m.preventDefault(),m.stopPropagation(),Zn.current+=1,Pr(!0)},tu=(m)=>{if(f)return;if(m.preventDefault(),m.stopPropagation(),Zn.current=Math.max(0,Zn.current-1),Zn.current===0)Pr(!1)},nu=(m)=>{if(f||!dn)return;if(m.preventDefault(),m.stopPropagation(),m.dataTransfer)m.dataTransfer.dropEffect="copy";Pr(!0)},ru=(m)=>{if(f||!dn)return;m.preventDefault(),m.stopPropagation(),Zn.current=0,Pr(!1),As(m.dataTransfer?.files||[])},ou=(m)=>{if(f||!dn)return;let _=m.clipboardData?.items;if(!_||!_.length)return;let C=[];for(let T of _){if(T.kind!=="file")continue;let M=T.getAsFile?.();if(M)C.push(M)}if(C.length>0)m.preventDefault(),As(C)},su=(m)=>{mn((_)=>_.filter((C,T)=>T!==m))},iu=()=>{He(null),mn([]),j?.(),U?.(),Y?.()},au=()=>{if(!navigator.geolocation){alert("Geolocation is not available in this browser.");return}navigator.geolocation.getCurrentPosition((m)=>{let{latitude:_,longitude:C,accuracy:T}=m.coords,M=`${_.toFixed(5)}, ${C.toFixed(5)}`,Z=Number.isFinite(T)?` ±${Math.round(T)}m`:"",re=`https://maps.google.com/?q=${_},${C}`,se=`Location: ${M}${Z} ${re}`;Hl(se)},(m)=>{let _=m?.message||"Unable to retrieve location.";alert(`Location error: ${_}`)},{enableHighAccuracy:!0,timeout:1e4,maximumAge:0})};o(()=>{if(!Ke)return;let m=oe,_=++Jn.current,C=Xo.current;Zt.current={value:"",updatedAt:0},$i(!0),Promise.resolve(Fo(m)).then((T)=>{if(_!==Jn.current||m!==gt.current)return;if(Xo.current!==C)return;jn(bo(T,Ge)),bs(T)}).catch((T)=>{if(_!==Jn.current||m!==gt.current)return;console.warn("Failed to load model list:",T),jn([])}).finally(()=>{if(_===Jn.current)$i(!1)})},[Ke,oe]),o(()=>{if(f)gn(!1),Ce(!1),Je(!1),Ve([]),ct(!1),at([])},[f]),o(()=>{if($e&&!$n)Ce(!1)},[$e,$n]),o(()=>{if(!$e)Vo(null),Jo(null),Br("")},[$e]),o(()=>{if(!$e)return;let m=yf(ut,oe);Qt(ut[m]),Zt.current={value:"",updatedAt:0}},[$e,oe,Qt]),o(()=>{if(!Ke)return;let m=(_)=>{let C=Pi.current,T=Xn.current,M=_.target;if(C&&C.contains(M))return;if(T&&T.contains(M))return;gn(!1)};return document.addEventListener("pointerdown",m),()=>document.removeEventListener("pointerdown",m)},[Ke]),o(()=>{if(!$e)return;let m=(_)=>{let C=Hr.current,T=zr.current,M=_.target;if(C&&C.contains(M))return;if(T&&T.contains(M))return;Ce(!1)};return document.addEventListener("pointerdown",m),()=>document.removeEventListener("pointerdown",m)},[$e]),o(()=>{if(f||!Ke&&!$e)return;let m=(_)=>{ir(_)};return document.addEventListener("keydown",m,!0),()=>document.removeEventListener("keydown",m,!0)},[f,Ke,$e,ir]),o(()=>{if(!$e)return;let m=Hr.current,_=m?.querySelector?.(".compose-session-search");if(document.activeElement!==_)_?.focus?.();m?.querySelector?.(".compose-model-popup-item.active")?.scrollIntoView?.({block:"nearest"})},[$e,$t,ut.length]),o(()=>{if(!Yn||!ts.current)return;ts.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Yn,Uo,Vt.length]),o(()=>{if(!Un||!es.current)return;es.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Un,Mr,jt.length]),o(()=>{let m=(C)=>{if(!C||typeof C!=="object")return!1;if(C.isContentEditable)return!0;if(typeof C.closest!=="function")return!1;return Boolean(C.closest('input, textarea, select, [contenteditable="true"], .compose-box, .compose-model-popup, .compose-session-popup, .settings-dialog, .workspace-sidebar, .editor-pane-container, .dock-panel, .timeline-menu-dropdown, .rename-branch-overlay, .agent-request-modal, .attachment-preview-modal, .vnc-pane-shell, .kanban-plugin, .timeline-quick-actions'))},_=(C)=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;let T=ae.current;if(!T)return;let M=document.activeElement===T;if(C.key==="Escape"&&!M&&!m(C.target)){C.preventDefault(),T.focus();return}if(C.key==="/"&&!M&&!m(C.target))C.preventDefault(),rn("/"),requestAnimationFrame(()=>{T.focus(),T.selectionStart=1,T.selectionEnd=1,ys("/")})};return window.addEventListener("keydown",_),()=>window.removeEventListener("keydown",_)},[]),o(()=>{let m=()=>{let Z=ns.current?.clientWidth||0;fl((re)=>re===Z?re:Z)};m();let _=ns.current,C=0,T=()=>{if(C)cancelAnimationFrame(C);C=requestAnimationFrame(()=>{C=0,m()})},M=null;if(_&&typeof ResizeObserver<"u")M=new ResizeObserver(()=>T()),M.observe(_);if(typeof window<"u")window.addEventListener("resize",T);return()=>{if(C)cancelAnimationFrame(C);if(M?.disconnect?.(),typeof window<"u")window.removeEventListener("resize",T)}},[f,W,Re?.agent_name,$n,de?.percent]);let cu=(m)=>{let _=m.target.value;if(Ee.current&&m?.isTrusted)kt();if(He(null),Xt(null),ht.kind==="guidance"||ht.kind==="error")yt();if($e)Ce(!1);if(bt(m.target),Zs(_,{searchMode:f,showSessionSwitcherButton:$n})){rn(""),requestAnimationFrame(()=>{let C=ae.current;if(!C)return;C.value="",C.selectionStart=0,C.selectionEnd=0,C.focus()}),vs();return}rn(_)};o(()=>{requestAnimationFrame(()=>bt())},[we,pn,f]),o(()=>{if(typeof window>"u")return;let m=()=>{if(Qn.current!=null){let _=ii(Qn.current);if(Qn.current=_,Tn)Wn.setItem?.(Zo,String(_))}requestAnimationFrame(()=>bt())};return window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[]),o(()=>{if(!f)return;if(Ie.current?.cancel(),Ee.current)kt();return},[f,kt]),o(()=>{if(Ee.current)kt();yt()},[oe,yt,kt]),o(()=>()=>{if(!Ee.current)return;try{Ee.current.stop()}catch(m){console.debug("[compose] failed to stop speech recognition during cleanup",m)}Ee.current=null},[]),o(()=>{if(!nn)return;Ai(Date.now());let m=setInterval(()=>Ai(Date.now()),1000);return()=>clearInterval(m)},[nn,At?.started_at,At?.startedAt]),o(()=>{if(Ri(0),Nt?.mode!=="custom"||!Array.isArray(Nt.frames)||Nt.frames.length<=1)return;let m=typeof Nt.intervalMs==="number"&&Number.isFinite(Nt.intervalMs)&&Nt.intervalMs>0?Nt.intervalMs:120,_=setInterval(()=>{Ri((C)=>(C+1)%Nt.frames.length)},m);return()=>clearInterval(_)},[Nt]),o(()=>{if(f||!Oo)return;ws(we)},[Oo,Hi,oe,we,f]);let la=Vi?e`
                    <div class="compose-meta-row">
                        ${(ro||sr)&&e`
                            <div class="compose-model-meta">
                                ${ro&&e`
                                    <button
                                        ref=${Xn}
                                        type="button"
                                        class="compose-model-hint compose-model-hint-btn"
                                        title=${Yi}
                                        aria-label=${le("compose.openModelPicker")}
                                        onClick=${Ul}
                                        disabled=${Jt}
                                    >
                                        ${Jt?"Switching…":e`${hs&&e`<span class="compose-model-hint-provider">${hs}</span>`}<span class="compose-model-hint-name">${jl}</span>`}
                                    </button>
                                `}
                                <div class="compose-model-meta-subline">
                                    ${!Jt&&Dl&&e`
                                        <span class="compose-model-usage-hint" title=${Yi}>${Ui.map((m)=>e`<span key=${m.key} class=${`compose-model-usage-part is-${m.key}`}>${m.text}</span>`)}</span>
                                    `}
                                </div>
                            </div>
                        `}
                        ${!f&&de&&e`
                            <${xf}
                                usage=${de}
                                onCompact=${mi?ca:void 0}
                                compactionLabel=${nn?cs||"0:00":""}
                                compactionTitle=${nn?Bi||"Smart compaction":""}
                            />
                        `}
                    </div>
    `:null;a(()=>{if(!zt)return;d(la,zt)});let[lu,ua]=t(null);return a(()=>{if(!Ke||!zt){ua(null);return}let m=()=>{let _=Xn.current?.getBoundingClientRect?.(),C=zt.closest?.(".workbench-statusbar")?.getBoundingClientRect?.();if(!_||!C)return;ua({left:Math.round(_.left),bottom:Math.round(window.innerHeight-C.top+6)})};return m(),window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[Ke,zt]),o(()=>()=>{if(zt)d(null,zt)},[zt]),e`
        <div class="compose-box" data-testid="compose-box" aria-disabled=${jo?"true":"false"}>
            <div
                class=${`compose-resize-handle ${Wc?"away-from-latest":""} ${fi?"has-new-messages":""}`}
                role="separator"
                aria-orientation="horizontal"
                aria-label=${le("compose.resizeInput")}
                title=${le("compose.resizeInputHint")}
                onMouseDown=${Bl}
                onTouchStart=${Ol}
            >${Io&&e`<button type="button" class="compose-latest-handle" aria-label=${fi?"New messages — jump to latest":"Jump to latest message"} title="Jump to latest message" onClick=${(m)=>{if(m.detail===0)Io()}}><span class="compose-latest-chevron compose-latest-chevron-left" aria-hidden="true"></span><span class="compose-latest-chevron compose-latest-chevron-right" aria-hidden="true"></span></button>`}</div>
            ${ol&&e`<div class="agent-status" role="status" aria-live="polite" data-submission-state="sending"><div class="agent-status-spinner" aria-hidden="true"></div><span class="status-text">Sending…</span></div>`}
            ${vl&&e`
                <div class=${`compose-inline-status compose-speech-status compose-speech-status-${ht.kind}`} role="status" aria-live="polite">
                    <div class="compose-inline-status-row">
                        <span class=${ti({pulsing:Sl})} aria-hidden="true"></span>
                        <span class="compose-inline-status-title">${ht.title}</span>
                    </div>
                    ${ht.detail&&e`<div class="compose-inline-status-detail">${ht.detail}</div>`}
                </div>
            `}
            ${Tt&&e`
                <div class="compose-inline-status compose-upload-status" role="status" aria-live="polite" data-testid="compose-upload-status">
                    <div class="compose-inline-status-row">
                        <div class="compose-inline-status-spinner" aria-hidden="true"></div>
                        <span class="compose-inline-status-title">
                            ${`Uploading ${Tt.current}/${Tt.total}: ${Tt.name}`}
                        </span>
                        <span class="compose-inline-status-elapsed">${Tt.percent}%</span>
                    </div>
                    <div
                        class="upload-progress-bar"
                        role="progressbar"
                        aria-label="Attachment upload progress"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow=${Tt.percent}
                    >
                        <div class="upload-progress-fill" style=${`width:${Tt.percent}%`}></div>
                    </div>
                </div>
            `}
            ${Ei&&e`
                <div class="compose-inline-status compose-submit-error" role="alert" aria-live="assertive">
                    <div class="compose-inline-status-detail">${Ei}</div>
                </div>
            `}
            ${Gc&&!f&&e`
                <${Of}
                    items=${Fc}
                    onInjectQueuedFollowup=${Vl}
                    onRemoveQueuedFollowup=${$o}
                    onMoveQueuedFollowup=${Oc}
                    onReturnQueuedFollowup=${Jl}
                    onOpenFilePill=${ze}
                />
            `}
            ${On.visible&&e`
                <div class="compose-inline-status extension-working" role="status" aria-live="polite">
                    <div class="compose-inline-status-row">
                        ${On.indicatorText?e`<span class="compose-inline-status-glyph" aria-hidden="true">${On.indicatorText}</span>`:On.animateSpinner?e`<div class="compose-inline-status-spinner" aria-hidden="true"></div>`:On.animateDot?e`<span class=${ti({pulsing:!0})} aria-hidden="true"></span>`:null}
                        <span class="compose-inline-status-title">${On.title}</span>
                    </div>
                </div>
            `}
            ${At&&!nn&&e`
                <div
                    class="compose-inline-status"
                    role="status"
                    aria-live="polite"
                    title=${as||""}
                >
                    <div class="compose-inline-status-row">
                        <div class="compose-inline-status-spinner" aria-hidden="true"></div>
                        <span class="compose-inline-status-title">${Bi}</span>
                        ${cs&&e`<span class="compose-inline-status-elapsed">${cs}</span>`}
                    </div>
                    ${as&&e`<div class="compose-inline-status-detail">${as}</div>`}
                </div>
            `}
            ${Ci&&e`
                <div class="compose-inline-status compose-command-notice" role="status" aria-live="polite">
                    <div class="compose-inline-status-detail compose-command-notice-text" dangerouslySetInnerHTML=${{__html:y(Ci)}}></div>
                </div>
            `}
            <div
                class=${`compose-input-wrapper${il?" drag-active":""}`}
                onDragEnter=${eu}
                onDragOver=${nu}
                onDragLeave=${tu}
                onDrop=${ru}
            >
                ${$n&&e`
                    <div
                        ref=${zr}
                        class="compose-session-trigger-group compose-session-trigger-top"
                    >
                        <button
                            type="button"
                            class=${`compose-session-trigger compose-session-trigger-pill${$e?" active":""}`}
                            data-testid="session-switcher"
                            onClick=${Fl}
                            title=${Re?.chat_jid||oe}
                            aria-label=${Re?.agent_name?`Manage sessions for @${Re.agent_name}`:"Manage Sessions/Agents"}
                            aria-expanded=${$e?"true":"false"}
                        >
                            <span class="compose-current-agent-label active">${Re?.agent_name?`@${Re.agent_name}`:"Sessions"}</span>
                        </button>
                    </div>
                `}
                <div class="compose-input-main">
                    ${Cl&&e`
                        <div class="compose-file-refs">
                            ${q.map((m)=>e`
                                    <${x}
                                        key=${"msg-"+m}
                                        prefix="compose"
                                        label=${"msg:"+m}
                                        title=${"Message reference: "+m}
                                        removeTitle="Remove reference"
                                        icon="message"
                                        onRemove=${()=>Q?.(m)}
                                    />
                                `)}
                            ${L.map((m)=>{let _=m.split("/").pop()||m;return e`
                                    <${x}
                                        prefix="compose"
                                        label=${_}
                                        title=${m}
                                        onClick=${()=>ze?.(m)}
                                        removeTitle="Remove file"
                                        onRemove=${()=>P?.(m)}
                                    />
                                `})}
                            ${N.map((m)=>{let _=m.split("/").pop()||m;return e`
                                    <${x}
                                        prefix="compose"
                                        label=${_}
                                        title=${m}
                                        icon="folder"
                                        onClick=${()=>ze?.(m)}
                                        removeTitle="Remove folder hint"
                                        onRemove=${()=>B?.(m)}
                                    />
                                `})}
                            ${fn.map((m,_)=>{let C=m?.name||`attachment-${_+1}`;return e`
                                    <${x}
                                        key=${C+_}
                                        prefix="compose"
                                        label=${C}
                                        title=${C}
                                        removeTitle="Remove attachment"
                                        onRemove=${()=>su(_)}
                                    />
                                `})}
                            <button
                                type="button"
                                class="compose-clear-attachments-btn"
                                onClick=${iu}
                                title=${le("compose.clearAllTitle")}
                                aria-label=${le("compose.clearAllTitle")}
                            >
                                ${le("compose.clearAll")}
                            </button>
                        </div>
                    `}
                    <textarea
                        id=${Uc}
                        ref=${ae}
                        data-testid="compose-input"
                        placeholder=${f?le("compose.searchPlaceholder"):le("compose.placeholder")}
                        value=${f?pn:we}
                        onInput=${cu}
                        onKeyDown=${Ql}
                        onKeyUp=${Xl}
                        onPaste=${ou}
                        onFocus=${h}
                        onClick=${h}
                        rows="1"
                        disabled=${jo}
                    />
                    ${Yn&&Vt.length>0&&e`
                        <div class="slash-autocomplete" ref=${ts}>
                            ${Vt.map((m,_)=>e`
                                <div
                                    key=${m.chat_jid||m.agent_name}
                                    class=${`slash-item${_===Uo?" active":""}`}
                                    onMouseDown=${(C)=>{C.preventDefault(),Xi(m)}}
                                    onMouseEnter=${()=>Nr(_)}
                                >
                                    <span class="slash-name">@${m.agent_name}</span>
                                    <span class="slash-desc">${m.chat_jid||"Active agent"}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${Un&&jt.length>0&&e`
                        <div class="slash-autocomplete" ref=${es}>
                            ${jt.map((m,_)=>e`
                                <div
                                    key=${m.name}
                                    class=${`slash-item${_===Mr?" active":""}`}
                                    onMouseDown=${(C)=>{C.preventDefault(),Qi(m)}}
                                    onMouseEnter=${()=>Dr(_)}
                                >
                                    <span class="slash-name">${m.name}</span>
                                    <span class="slash-desc">${m.description}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${Ke&&!f&&e`
                        <${xc}
                            anchor=${lu}
                            entries=${ll}
                            loading=${pl}
                            switching=${Jt}
                            onSelect=${(m)=>{Kl(m)}}
                            onTogglePin=${(m)=>st(m.key,Ge)}
                            onClose=${so}
                            onCompact=${mi?()=>{so(),ca()}:void 0}
                            onOpenSettings=${Ho?()=>{gn(!1),A({section:"models"})}:void 0}
                            thinkingLevel=${ce}
                            thinkingLevels=${Ki?.thinkingLevels??[]}
                            onSelectThinking=${(m)=>{Gl(m)}}
                            rootRef=${Pi}
                        />
                    `}
                    ${$e&&!f&&e`
                        <div class="compose-model-popup compose-session-popup" data-testid="session-popup" ref=${Hr} tabIndex="-1" onKeyDown=${ir}>
                            <div class="compose-session-popup-header">
                                <label class="compose-model-popup-title compose-session-search-heading" for="compose-session-search">Search sessions</label>
                                <button type="button" class="compose-session-popup-close" aria-label="Close session picker" onClick=${()=>{Ce(!1),requestAnimationFrame(()=>zr.current?.querySelector?.("button")?.focus?.())}}>×</button>
                            </div>
                            <input
                                id="compose-session-search"
                                class="compose-session-search"
                                type="search"
                                value=${mt}
                                placeholder="Handle, JID, state, or model"
                                autocomplete="off"
                                onInput=${(m)=>{let _=m.currentTarget.value,C=Be(Oe(nr,_),oe,Vn).flatMap((M)=>M.items);In.current=C.map((M)=>({type:"session",key:`session:${M.chat_jid}`,label:`@${M.agent_name} — ${M.chat_jid}${M.is_active?" active":""}${M.archived_at?" archived":""}`,chat:M,disabled:M.archived_at?!yn||M?.capabilities?.restore===!1:!bn||M?.capabilities?.open===!1}));let T=gc(C,_);Qt(In.current[T]),Br(_)}}
                                onKeyDown=${ir}
                            />
                            <div
                                class="compose-model-popup-menu compose-session-popup-results"
                                role="listbox"
                                aria-label=${le("compose.sessionsAndAgents")}
                                aria-activedescendant=${ut[$t]?.type==="session"?`compose-session-option-${encodeURIComponent(ut[$t].chat.chat_jid)}`:void 0}
                            >
                                ${!to&&e`
                                    <div class="compose-model-popup-empty">${le("compose.noSessions")}</div>
                                `}
                                ${to&&ls.length===0&&e`
                                    <div class="compose-model-popup-empty">No sessions match “${mt}”.</div>
                                `}
                                ${ds.map((m,_)=>{let C=us.find((Se)=>Se.items.includes(m)),T=C?.items[0]===m,M=Boolean(m.archived_at),Z=!M&&Tl.has(m.chat_jid),re=m.chat_jid===(m.root_chat_jid||m.chat_jid),se=!re&&!m.is_active&&!M&&typeof ln==="function"&&m?.capabilities?.archive!==!1,be=M&&zi,Qe=be&&al===m.chat_jid,ve=se&&cl===m.chat_jid,Ye=Qe||ve,qt=Ot(m,{currentChatJid:oe}),ar=te(m.agent_name),dt=rt(m,{currentChatJid:oe}),cr=m.root_chat_jid||m.chat_jid,zn=m.model||m.model_label||"",xn=fc(m);return e`
                                        ${T&&e`<div class="compose-session-section-heading" role="presentation">${C.label}</div>`}
                                        <div key=${m.chat_jid} class=${`compose-model-popup-item-row${M?" archived":""}`}>
                                            ${M?e`<span class="compose-session-row-pin-spacer" aria-hidden="true"></span>`:e`<button
                                                    type="button"
                                                    class=${`compose-session-row-pin${Z?" pinned":""}`}
                                                    title=${Z?`Unpin @${m.agent_name}`:`Pin @${m.agent_name}`}
                                                    aria-label=${Z?`Unpin @${m.agent_name}`:`Pin @${m.agent_name}`}
                                                    aria-pressed=${Z?"true":"false"}
                                                    aria-keyshortcuts="Alt+Enter"
                                                    onClick=${(Se)=>{Se.preventDefault(),Se.stopPropagation(),ks(m.chat_jid)}}
                                                >${Z?"★":"☆"}</button>`}
                                            <button
                                                id=${`compose-session-option-${encodeURIComponent(m.chat_jid)}`}
                                                type="button"
                                                role="option"
                                                aria-selected=${$t===_?"true":"false"}
                                                aria-label=${`${qt}; chat ${m.chat_jid}; root ${cr}; ${zn?`model ${zn}; `:""}${dt.join(", ")||"idle"}`}
                                                class=${`compose-model-popup-item session-item${M?" archived":""}${$t===_?" active":""}`}
                                                data-testid="session-item"
                                                onClick=${()=>{if(M){ea(m.chat_jid);return}Zi(m.chat_jid)}}
                                                disabled=${M?!yn||m?.capabilities?.restore===!1:!bn||m?.capabilities?.open===!1}
                                                title=${M?`Restore archived ${qt}`:`Switch to ${qt}`}
                                            >
                                                <span class="compose-session-row-content" style=${bf(m)?"font-weight:700":""}>
                                                    <span class="compose-session-row-main">
                                                        <span class="compose-session-row-label">${ar}</span>
                                                        <span class="compose-session-row-meta">
                                                            <span class="compose-session-row-jid">${m.chat_jid}</span>
                                                            ${xn&&e`<span class="compose-session-row-metrics"> · ${xn}</span>`}
                                                        </span>
                                                    </span>
                                                    ${dt.length>0&&e`
                                                        <span class="compose-session-row-pills" aria-label=${`Session status: ${dt.join(", ")}`}>
                                                            ${dt.map((Se)=>e`
                                                                <span key=${Se} class=${`compose-session-status-pill ${Se}`}>${Se}</span>
                                                            `)}
                                                        </span>
                                                    `}
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                class="compose-model-popup-item-popout"
                                                title=${`Open @${m.agent_name} in new window`}
                                                aria-label=${`Open @${m.agent_name} in new window`}
                                                onClick=${(Se)=>{Se.stopPropagation(),Ce(!1);let We=new URL(window.location.href);We.searchParams.set("chat_jid",m.chat_jid),We.searchParams.set("chat_only","1");let Xe=document.createElement("a");Xe.href=We.toString(),Xe.target="_blank",Xe.rel="noopener",Xe.style.display="none",document.body.appendChild(Xe),Xe.click(),Xe.remove()}}
                                            >
                                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M6 2h8v8"/>
                                                    <path d="M14 2 7 9"/>
                                                    <path d="M12 9v5H2V4h5"/>
                                                </svg>
                                            </button>
                                            ${(se||be)&&e`
                                                ${Ye?e`<button
                                                        key=${`${m.chat_jid}:delete-confirm`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete confirming"
                                                        data-chat-jid=${m.chat_jid}
                                                        data-delete-kind=${be?"purge":"prune"}
                                                        title=${be?"Confirm permanent deletion":"Confirm branch deletion"}
                                                        aria-label=${be?re?`Confirm permanent deletion of archived session @${m.agent_name}`:`Confirm permanent deletion of archived branch @${m.agent_name}`:`Confirm delete @${m.agent_name}`}
                                                        onPointerDown=${(Se)=>{Se.preventDefault(),Se.stopPropagation(),oo(m,{canPurgeArchived:be,canPrune:se})}}
                                                        onKeyDown=${(Se)=>{if(Se.key!=="Enter"&&Se.key!==" ")return;Se.preventDefault(),Se.stopPropagation(),oo(m,{canPurgeArchived:be,canPrune:se})}}
                                                    >
                                                        <span class="compose-model-popup-item-delete-confirm">OK</span>
                                                    </button>`:e`<button
                                                        key=${`${m.chat_jid}:delete-request`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete"
                                                        title=${be?re?"Permanently delete this archived session":"Permanently delete this archived branch":"Delete this branch"}
                                                        aria-label=${be?re?`Permanently delete archived session @${m.agent_name}`:`Permanently delete archived branch @${m.agent_name}`:`Delete @${m.agent_name}`}
                                                        onClick=${(Se)=>{if(Se.stopPropagation(),be){Vo(m.chat_jid);return}if(se){Jo(m.chat_jid);return}Ce(!1),ln(m.chat_jid)}}
                                                    >
                                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                                            <line x1="18" y1="6" x2="6" y2="18" />
                                                            <line x1="6" y1="6" x2="18" y2="18" />
                                                        </svg>
                                                    </button>`}
                                            `}
                                        </div>
                                    `})}
                            </div>
                            ${!mt&&(vn||rr||wn||Sn)&&e`
                                <div class="compose-model-popup-actions">
                                    ${vn&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn primary${ut.findIndex((m)=>m.key==="action:new")===$t?" active":""}`}
                                            onClick=${()=>{na()}}
                                            title=${le("compose.newBranchTitle")}
                                        >
                                            ${le("compose.newBranch")}
                                        </button>
                                    `}
                                    ${rr&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:new-root")===$t?" active":""}`}
                                            onClick=${()=>{ra()}}
                                            title=${le("compose.newRootTitle")}
                                        >
                                            ${le("compose.newRoot")}
                                        </button>
                                    `}
                                    ${Ht?.chat_jid&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:rollup")===$t?" active":""}`}
                                            onClick=${()=>{oa()}}
                                            title=${or?le("compose.mergeInto",{target:Ht.agent_name?`@${Ht.agent_name}`:Ht.chat_jid}):le("compose.mergeBlocked")}
                                            disabled=${!or}
                                        >
                                            ${le("compose.mergeCurrent")}
                                        </button>
                                    `}
                                    ${wn&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:rename")===$t?" active":""}`}
                                            onClick=${(m)=>{ta(m)}}
                                            title=${le("compose.renameSessionTitle")}
                                            disabled=${no}
                                        >
                                            ${le("compose.renameCurrent")}
                                        </button>
                                    `}
                                    ${Sn&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn danger${ut.findIndex((m)=>m.key==="action:delete")===$t?" active":""}`}
                                            onClick=${()=>{sa()}}
                                            title=${le("compose.pruneSessionTitle")}
                                        >
                                            ${le("compose.deleteCurrent")}
                                        </button>
                                    `}
                                </div>
                            `}
                        </div>
                    `}
                </div>
                <div class="compose-footer" ref=${ns}>
                    ${Zr.show&&e`
                        <span class="compose-connection-status connection-status ${Zr.statusClass}" title=${Rl}>
                            ${Al}
                        </span>
                    `}
                    ${Vi&&!zt&&la}
                    <div class="compose-actions ${f?"search-mode":""}">
                    ${f&&e`
                        <label class="compose-search-scope-wrap" title=${le("compose.searchScope")}>
                            <span class="compose-search-scope-label">${le("compose.scope")}</span>
                            <select
                                class="compose-search-scope-select"
                                value=${w}
                                onChange=${(m)=>k?.(m.currentTarget.value)}
                            >
                                <option value="current">${le("compose.scopeCurrent")}</option>
                                <option value="root">${le("compose.scopeBranchFamily")}</option>
                                <option value="all">${le("compose.scopeAll")}</option>
                            </select>
                        </label>
                        <label class="compose-search-filter-wrap" title=${le("compose.filterImagesTitle")}>
                            <input type="checkbox" checked=${zo} onChange=${()=>nl((m)=>!m)} />
                            <span class="compose-search-filter-label">${le("compose.filterImages")}</span>
                        </label>
                        <label class="compose-search-filter-wrap" title=${le("compose.filterAttachmentsTitle")}>
                            <input type="checkbox" checked=${qo} onChange=${()=>rl((m)=>!m)} />
                            <span class="compose-search-filter-label">${le("compose.filterAttachments")}</span>
                        </label>
                        <button
                            class=${`compose-search-match-toggle ${Rr==="and"?"active":""}`}
                            onClick=${()=>{let m=Rr==="or"?"and":"or";Go(m),fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchMatchMode:m})}).catch((_)=>{})}}
                            title=${Rr==="or"?"Any keyword (OR) — click for all keywords (AND)":"All keywords (AND) — click for any keyword (OR)"}
                            type="button"
                        >
                            ${Rr==="or"?"OR":"AND"}
                        </button>
                    `}
                    ${Qc&&e`
                    <button
                        class="icon-btn search-toggle"
                        onClick=${f?R:E}
                        title=${f?le("compose.closeSearch"):le("compose.search")}
                        disabled=${f?typeof R!=="function":typeof E!=="function"}
                    >
                        ${f?e`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`:e`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`}
                    </button>
                    `}
                    ${$l&&!f&&e`
                        <button
                            class="icon-btn location-btn"
                            onClick=${au}
                            title=${le("compose.shareLocation")}
                            type="button"
                            disabled=${!1}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M12 2a14 14 0 0 1 0 20a14 14 0 0 1 0-20" />
                                <path d="M2 12h20" />
                            </svg>
                        </button>
                    `}
                    ${is&&e`
                        <button
                            class=${`icon-btn voice-input-btn${Xr?" active":""}${je.mode==="fallback"?" fallback":""}`}
                            onClick=${ql}
                            onPointerDown=${zl}
                            onPointerUp=${Cs}
                            onPointerCancel=${Cs}
                            onPointerLeave=${Cs}
                            title=${Ni}
                            aria-label=${Ni}
                            type="button"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <path d="M12 19v3" />
                            </svg>
                        </button>
                    `}
                    ${_l&&!f&&e`
                        <button
                            class=${`icon-btn notification-btn${Fi?" active":""}`}
                            onClick=${dr}
                            title=${El}
                            type="button"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                        </button>
                    `}
                    ${!f&&e`
                        ${Wt&&Ct&&e`
                            <button
                                class="icon-btn attach-editor-btn"
                                onClick=${Ct}
                                title=${`Attach open file: ${Wt}`}
                                type="button"
                                disabled=${L.includes(Wt)}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                            </button>
                        `}
                        ${dn&&e`<label class="icon-btn" title=${le("compose.attachFile")}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <input type="file" multiple hidden onChange=${Zl} disabled=${hi} />
                        </label>`}
                    `}
                    ${!f&&e`
                        <div class="compose-send-stack">
                                <button
                                    class=${eo.className}
                                    id=${Yc}
                                    data-testid="send-button"
                                    type="button"
                                    onClick=${()=>{kn()}}
                                    disabled=${eo.disabled}
                                    title=${eo.title}
                                    aria-label=${eo.ariaLabel}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                                </button>
                                ${hn&&e`
                                    <button
                                        class=${hn.className}
                                        data-testid="stop-button"
                                        type="button"
                                        onClick=${()=>{if($f(hn.mode))kn("/abort","steer",{clearAfterSubmit:!1,includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,recordHistory:!1})}}
                                        disabled=${hn.disabled}
                                        title=${hn.title}
                                        aria-label=${hn.ariaLabel}
                                    >
                                        ${hn.mode==="compacting"?e`
                                                <span class="compose-submit-spinner" aria-hidden="true">
                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                                        <circle class="compose-submit-spinner-ring" cx="12" cy="12" r="10.5" stroke-width="2.25" stroke-linecap="round"></circle>
                                                        <rect class="compose-submit-spinner-stop" x="6" y="6" width="12" height="12" rx="0" fill="currentColor"></rect>
                                                    </svg>
                                                </span>
                                            `:e`<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2.5"/></svg>`}
                                    </button>
                                `}
                        </div>
                    `}
                </div>
            </div>
        </div>
        </div>
    `}
export{_e,V,It,Et,Rt,_t,Pe,fr,tt,Rn,mr,Me,y,K,G,De,pe,J,Pt,Le,gr,b,Fe,hr,_n,Pn,Mn,Dn,v,Ln,yr,br,fe,vr,wr,Mt,Fn,Dt,xr,ee,Sr,nt,kr,Lt,Ar,Oe,Be,te,Ft,rt,Ot,Cr,Bt,ot,Tr,x,me,it};

//# debugId=866CB3C45958A1A564756E2164756E21
//# sourceMappingURL=app-jcczcg2z.js.map
