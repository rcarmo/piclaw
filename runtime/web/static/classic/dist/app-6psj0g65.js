import{d,t,o,a,r,i,n,e}from"./app-017vdhd7.js";import{mr,gr,hr,Xe,wr,E,Y}from"./app-0zpdk33j.js";import{ae,M,y,ce,Qe,Pe,P,J,le,lr,ur}from"./app-9ah8dw8m.js";import{u}from"./app-de3w0xbd.js";import{f,c,A,s}from"./app-mbxfp7m6.js";var ke="piclaw:session-picker-preferences-changed";function Ps(){return{pinnedChatJids:[]}}function ma(l){return typeof l==="string"?l.trim():""}function ga(l){if(!l||typeof l!=="object")return Ps();let g=l;return{pinnedChatJids:Array.from(new Set((Array.isArray(g.pinnedChatJids)?g.pinnedChatJids:[]).map(ma).filter(Boolean)))}}function ha(l){try{return l?.localStorage??null}catch{return null}}function B(l=typeof window<"u"?window:null){try{let g=ha(l)?.getItem("piclaw:session-picker-preferences:v1");return g?ga(JSON.parse(g)):Ps()}catch{return Ps()}}function mt(l,g=typeof window<"u"?window:null){let p=ga(l);try{ha(g)?.setItem("piclaw:session-picker-preferences:v1",JSON.stringify(p))}catch(h){console.debug("[session-picker-preferences] Storage unavailable; keeping the in-memory preference result.",h)}try{g?.dispatchEvent?.(new CustomEvent("piclaw:session-picker-preferences-changed",{detail:p}))}catch(h){console.debug("[session-picker-preferences] Preference event delivery unavailable.",h)}return p}function gt(l,g=typeof window<"u"?window:null){let p=ma(l),h=B(g);if(!p)return h;let b=new Set(h.pinnedChatJids);if(b.has(p))b.delete(p);else b.add(p);let S=mt({pinnedChatJids:Array.from(b)},g);return g?.dispatchEvent?.(new CustomEvent("piclaw:picker-pin-write",{detail:{kind:"session",key:p,pinned:b.has(p)}})),S}import{classHighlighter as yu,HighlightStyle as wu,tags as ao}from"#editor-vendor/codemirror";var vu=wu.define([{tag:[ao.function(ao.variableName),ao.function(ao.propertyName)],class:"tok-function"}]),Ls={style(l){let g=yu.style(l),p=vu.style(l);return[g,p].filter(Boolean).join(" ")||null}};import{highlightTree as Ga,StreamLanguage as V,cssLanguage as Su,cppLanguage as $u,goLanguage as ku,htmlLanguage as xu,javascriptLanguage as _u,jsxLanguage as Eu,tsxLanguage as Cu,typescriptLanguage as Au,jsonLanguage as Ru,markdownLanguage as Pu,pythonLanguage as Lu,rustLanguage as Tu,StandardSQL as Mu,xmlLanguage as Du,yamlLanguage as ju,dockerFile as Iu,powerShell as Nu,ruby as Fu,shell as Bu,swift as Ou,toml as Hu,clojure as zu,cmake as qu,coffeeScript as Gu,crystal as Ku,cypher as Wu,d as Uu,diff as Yu,eiffel as Vu,elm as Ju,erlang as Qu,factor as Xu,forth as Zu,fortran as ed,gas as td,gherkin as nd,groovy as rd,haskell as od,haxe as sd,http as id,jinja2 as ad,julia as cd,liveScript as ld,lua as ud,mathematica as dd,fSharp as pd,nginx as fd,octave as md,oz as gd,pascal as hd,perl as bd,properties as yd,protobuf as wd,pug as vd,puppet as Sd,r as $d,sas as kd,sass as xd,scheme as _d,smalltalk as Ed,solr as Cd,sparql as Ad,stex as Rd,stylus as Pd,tcl as Ld,textile as Td,turtle as Md,vb as Dd,verilog as jd,vhdl as Id,wast as Nd,webIDL as Fd,xQuery as Bd}from"#editor-vendor/codemirror";var Ka=98304;function Ue(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}var Od={js:"JavaScript",javascript:"JavaScript",ts:"TypeScript",typescript:"TypeScript",jsx:"JSX",tsx:"TSX",py:"Python",python:"Python",sh:"Shell",shell:"Shell",bash:"Bash",zsh:"Zsh",ps1:"PowerShell",powershell:"PowerShell",md:"Markdown",markdown:"Markdown",yml:"YAML",yaml:"YAML",json:"JSON",html:"HTML",css:"CSS",sql:"SQL",go:"Go",c:"C",cc:"C++",cpp:"C++","c++":"C++",cxx:"C++",h:"C/C++",hh:"C++",hpp:"C++",hxx:"C++",rust:"Rust",rs:"Rust",ruby:"Ruby",swift:"Swift",toml:"TOML",dockerfile:"Dockerfile",asm:"Gas",clj:"Clojure",clojure:"Clojure",cmake:"CMake",coffee:"CoffeeScript",coffeescript:"CoffeeScript",conf:"nginx",cr:"Crystal",crystal:"Crystal",cypher:"Cypher",d:"D",diff:"Diff",eiffel:"Eiffel",elm:"Elm",erl:"Erlang",erlang:"Erlang",f90:"Fortran",f95:"Fortran",factor:"Factor",feature:"Gherkin",forth:"Forth",fortran:"Fortran",fsharp:"ML",gas:"Gas",gherkin:"Gherkin",groovy:"Groovy",haskell:"Haskell",haxe:"Haxe",hs:"Haskell",http:"HTTP",hx:"Haxe",ini:"Properties",jade:"Pug",jinja:"Jinja2",jinja2:"Jinja2",jl:"Julia",julia:"Julia",latex:"LaTeX",livescript:"LiveScript",ls:"LiveScript",lua:"Lua",mathematica:"Mathematica",matlab:"Octave",ml:"ML",nginx:"nginx",ocaml:"ML",octave:"Octave",oz:"Oz",pas:"Pascal",pascal:"Pascal",patch:"Diff",perl:"Perl",pl:"Perl",pm:"Perl",pp:"Puppet",properties:"Properties",proto:"Protobuf",protobuf:"Protobuf",pug:"Pug",puppet:"Puppet",r:"R",rq:"SPARQL",s:"Gas",sas:"SAS",sass:"Sass",scheme:"Scheme",scm:"Scheme",scss:"Sass",smalltalk:"Smalltalk",sml:"ML",sparql:"SPARQL",st:"Smalltalk",styl:"Stylus",stylus:"Stylus",sv:"Verilog",tcl:"Tcl",tex:"LaTeX",textile:"Textile",ttl:"Turtle",turtle:"Turtle",vb:"VB",verilog:"Verilog",vhdl:"VHDL",wasm:"WebAssembly",wast:"WebAssembly",webidl:"WebIDL",wl:"Mathematica",xq:"XQuery",xquery:"XQuery"},Hd=V.define(Bu).parser,zd=V.define(Nu).parser,qd=V.define(Iu).parser,Gd=V.define(Fu).parser,Kd=V.define(Ou).parser,Wd=V.define(Hu).parser,ba=V.define(zu).parser,Ud=V.define(qu).parser,ya=V.define(Gu).parser,wa=V.define(Ku).parser,Yd=V.define(Wu).parser,Vd=V.define(Uu).parser,va=V.define(Yu).parser,Jd=V.define(Vu).parser,Qd=V.define(Ju).parser,Sa=V.define(Qu).parser,Xd=V.define(Xu).parser,Zd=V.define(Zu).parser,Ts=V.define(ed).parser,Ms=V.define(td).parser,$a=V.define(nd).parser,ep=V.define(rd).parser,ka=V.define(od).parser,xa=V.define(sd).parser,tp=V.define(id).parser,_a=V.define(ad).parser,Ea=V.define(cd).parser,Ca=V.define(ld).parser,np=V.define(ud).parser,Aa=V.define(dd).parser,Rr=V.define(pd).parser,rp=V.define(fd).parser,Ra=V.define(md).parser,op=V.define(gd).parser,Pa=V.define(hd).parser,Ds=V.define(bd).parser,La=V.define(yd).parser,Ta=V.define(wd).parser,Ma=V.define(vd).parser,Da=V.define(Sd).parser,sp=V.define($d).parser,ip=V.define(kd).parser,ja=V.define(xd).parser,Ia=V.define(_d).parser,Na=V.define(Ed).parser,ap=V.define(Cd).parser,Fa=V.define(Ad).parser,js=V.define(Rd).parser,Ba=V.define(Pd).parser,cp=V.define(Ld).parser,lp=V.define(Td).parser,Oa=V.define(Md).parser,up=V.define(Dd).parser,Ha=V.define(jd).parser,dp=V.define(Id).parser,za=V.define(Nd).parser,pp=V.define(Fd).parser,qa=V.define(Bd).parser;function ht(l){let g=String(l||"").trim().toLowerCase();if(!g)return"text";return Od[g]||String(l||"").trim()}function yt(l){switch(String(l||"").trim().toLowerCase()){case"js":case"javascript":return _u.parser;case"ts":case"typescript":return Au.parser;case"jsx":return Eu.parser;case"tsx":return Cu.parser;case"py":case"python":return Lu.parser;case"json":return Ru.parser;case"css":return Su.parser;case"html":return xu.parser;case"xml":return Du.parser;case"yaml":case"yml":return ju.parser;case"md":case"markdown":return Pu.parser;case"sql":return Mu.language.parser;case"go":return ku.parser;case"c":case"cc":case"cpp":case"cxx":case"c++":case"h":case"hh":case"hpp":case"hxx":return $u.parser;case"sh":case"bash":case"shell":case"zsh":return Hd;case"ps1":case"powershell":return zd;case"dockerfile":return qd;case"rb":case"ruby":return Gd;case"rs":case"rust":return Tu.parser;case"swift":return Kd;case"toml":return Wd;case"asm":return Ms;case"clj":return ba;case"clojure":return ba;case"cmake":return Ud;case"coffee":return ya;case"coffeescript":return ya;case"cr":return wa;case"crystal":return wa;case"cypher":return Yd;case"d":return Vd;case"diff":return va;case"eiffel":return Jd;case"elm":return Qd;case"erl":return Sa;case"erlang":return Sa;case"f90":return Ts;case"f95":return Ts;case"factor":return Xd;case"feature":return $a;case"forth":return Zd;case"fortran":return Ts;case"fsharp":return Rr;case"gas":return Ms;case"gherkin":return $a;case"groovy":return ep;case"haskell":return ka;case"haxe":return xa;case"hs":return ka;case"http":return tp;case"hx":return xa;case"ini":return La;case"jade":return Ma;case"jinja":return _a;case"jinja2":return _a;case"jl":return Ea;case"julia":return Ea;case"latex":return js;case"livescript":return Ca;case"ls":return Ca;case"lua":return np;case"mathematica":return Aa;case"matlab":return Ra;case"ml":return Rr;case"mllike":return Rr;case"nginx":return rp;case"ocaml":return Rr;case"octave":return Ra;case"oz":return op;case"pas":return Pa;case"pascal":return Pa;case"patch":return va;case"perl":return Ds;case"pl":return Ds;case"pm":return Ds;case"pp":return Da;case"properties":return La;case"proto":return Ta;case"protobuf":return Ta;case"pug":return Ma;case"puppet":return Da;case"r":return sp;case"rq":return Fa;case"s":return Ms;case"sas":return ip;case"sass":return ja;case"scheme":return Ia;case"scm":return Ia;case"scss":return ja;case"smalltalk":return Na;case"sml":return Rr;case"solr":return ap;case"sparql":return Fa;case"st":return Na;case"stex":return js;case"styl":return Ba;case"stylus":return Ba;case"sv":return Ha;case"tcl":return cp;case"tex":return js;case"textile":return lp;case"ttl":return Oa;case"turtle":return Oa;case"vb":return up;case"verilog":return Ha;case"vhdl":return dp;case"wasm":return za;case"wast":return za;case"webidl":return pp;case"wl":return Aa;case"xq":return qa;case"xquery":return qa;default:return null}}function Ae(l,g){if(String(l||"").length>Ka)return Ue(l);let p=yt(g);if(!p)return Ue(l);let h=[];try{let C=p.parse(l);Ga(C,Ls,(L,D,T)=>{if(!T||L>=D)return;h.push({from:L,to:D,cls:T})})}catch{return Ue(l)}if(!h.length)return Ue(l);h.sort((C,L)=>C.from-L.from||C.to-L.to);let b=0,S="";for(let C of h){if(C.from>b)S+=Ue(l.slice(b,C.from));S+=`<span class="${Ue(C.cls)}">${Ue(l.slice(C.from,C.to))}</span>`,b=Math.max(b,C.to)}if(b<l.length)S+=Ue(l.slice(b));return S}function Gn(l,g){let p=String(l||"").split(`
`);if(!l)return p;if(String(l||"").length>Ka)return p.map((T)=>Ue(T)||"&nbsp;");let h=yt(g);if(!h)return p.map((T)=>Ue(T));let b=[];try{let T=h.parse(l);Ga(T,Ls,(F,O,z)=>{if(!z||F>=O)return;b.push({from:F,to:O,cls:z})})}catch{return p.map((T)=>Ue(T))}if(!b.length)return p.map((T)=>Ue(T));b.sort((T,F)=>T.from-F.from||T.to-F.to);let S=[],C=0;for(let T of p)S.push(C),C+=T.length+1;let L=[],D=0;for(let T=0;T<p.length;T+=1){let F=S[T],O=F+p[T].length,z="",Z=F;while(D<b.length&&b[D].to<=F)D+=1;for(let Q=D;Q<b.length;Q+=1){let te=b[Q];if(te.from>=O)break;let ee=Math.max(F,te.from),X=Math.min(O,te.to);if(ee>Z)z+=Ue(l.slice(Z,ee));if(X>ee)z+=`<span class="${Ue(te.cls)}">${Ue(l.slice(ee,X))}</span>`;Z=Math.max(Z,X)}if(Z<O)z+=Ue(l.slice(Z,O));L.push(z||"&nbsp;")}return L}function ze(l){let g=(l.match(/\.([^.]+)$/)||[])[1]?.toLowerCase()||"",p={ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",cjs:"javascript",py:"python",rb:"ruby",rs:"rust",go:"go",java:"java",c:"c",h:"c",cc:"cpp",cpp:"cpp",cxx:"cpp",hpp:"cpp",hxx:"cpp",cs:"csharp",swift:"swift",kt:"kotlin",sh:"shell",bash:"bash",zsh:"zsh",fish:"shell",ps1:"powershell",psm1:"powershell",json:"json",yaml:"yaml",yml:"yaml",toml:"toml",xml:"xml",html:"html",htm:"html",css:"css",scss:"sass",sass:"sass",sql:"sql",graphql:"graphql",gql:"graphql",dockerfile:"dockerfile",makefile:"makefile",lua:"lua",perl:"perl",pl:"perl",pm:"perl",r:"r",jl:"julia",hs:"haskell",erl:"erlang",clj:"clojure",scm:"scheme",elm:"elm",ex:"elixir",exs:"elixir",proto:"protobuf",tf:"hcl",diff:"diff",patch:"diff",ini:"properties",conf:"nginx",cfg:"properties",v:"verilog",sv:"verilog",vhd:"vhdl",vhdl:"vhdl",pas:"pascal",f90:"fortran",f95:"fortran",cmake:"cmake",groovy:"groovy",gradle:"groovy",tex:"stex",latex:"stex",bib:"stex",d:"d",nim:"nim",zig:"zig",pug:"pug",jade:"pug",styl:"stylus",coffee:"coffeescript",tcl:"tcl",ml:"mllike",sml:"mllike",fs:"mllike",wasm:"wast",wat:"wast",pp:"puppet",feature:"gherkin",ttl:"turtle",rq:"sparql",xq:"xquery"},h=l.split("/").pop()?.toLowerCase()||"";if(h==="dockerfile"||h.startsWith("dockerfile."))return"dockerfile";if(h==="makefile"||h==="gnumakefile")return"cmake";if(h===".env"||h.endsWith(".env"))return"properties";if(h==="cmakelists.txt")return"cmake";if(h==="vagrantfile"||h==="rakefile"||h==="gemfile")return"ruby";return p[g]||""}var Pr=null,Is=new WeakSet;function fp(){if(window.piclawDiagrams)return Promise.resolve();if(Pr)return Pr;let l=document.createElement("script");return l.src="/static/common/js/vendor/pele.js",Pr=new Promise((g,p)=>{l.onload=()=>window.piclawDiagrams?g():p(Error("Mermaid library failed to load")),l.onerror=()=>p(Error("Mermaid library failed to load")),document.head.append(l)}).catch((g)=>{throw l.remove(),Pr=null,g}),Pr}function Wa(l){if(/(?:https?:\/\/|data:|blob:|\/\/)/i.test(l))return!1;return Array.from(l.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(p)=>p[2]?.trim()||"").every((p)=>/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(p))}function mp(l){let g=Uint8Array.from(atob(l),(h)=>h.charCodeAt(0)),p=new TextDecoder().decode(g);for(let h=0;h<2;h++){let b=p.replace(/</g,"&lt;").replace(/>/g,"&gt;"),S=new DOMParser().parseFromString(b,"text/html").documentElement.textContent||"";if(p===S)break;p=S}return p}async function Ua(l,g={}){let h=Array.from(l.querySelectorAll(".mermaid-container[data-mermaid]")).filter((S)=>!Is.has(S));for(let S of h)Is.add(S);if(!h.length)return;try{await fp();for(let S of h){let C=S.dataset.mermaid;if(!l.contains(S)||C===void 0)continue;try{let L=mp(C);if(g.scoped&&!Wa(L))throw Error("External Mermaid resources are unavailable in this view.");let D=window.piclawDiagrams.render(L),T=window.piclawDiagrams.sanitize;if(typeof T!=="function")throw Error("Diagram sanitizer is unavailable");S.innerHTML=T(D),S.removeAttribute("data-mermaid")}catch(L){b(S,L)}}}catch(S){for(let C of h)if(l.contains(C)&&C.hasAttribute("data-mermaid"))b(C,S)}finally{for(let S of h)Is.delete(S)}function b(S,C){g.reportError?.(C);let L=document.createElement("pre");L.className="mermaid-error",L.textContent="Diagram error: "+(C instanceof Error?C.message:String(C)),S.replaceChildren(L),S.removeAttribute("data-mermaid")}}var Ns={background:"#ffffff",foreground:"#18212b",muted:"#536171",accent:"#0969da",border:"#b6bec8",surface:"#f3f5f7",success:"#1a7f37",warning:"#9a6700",danger:"#cf222e"},Ya={background:"#171b22",foreground:"#e6edf3",muted:"#a2afbf",accent:"#79c0ff",border:"#586577",surface:"#242b36",success:"#7ee787",warning:"#e3b341",danger:"#ff7b72"};function Va(l="theme"){if(l==="light")return{...Ns};if(l==="dark")return{...Ya};if(typeof document>"u")return{...Ns};let g=document.documentElement,h=(g.dataset.theme||(g.classList.contains("dark")?"dark":g.classList.contains("light")?"light":typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))==="dark"?Ya:Ns;if(!document.body)return{...h};let b=document.createElement("span");b.style.display="none",document.body.append(b);try{return Object.fromEntries(Object.entries({background:"--bg-primary",foreground:"--text-primary",muted:"--text-secondary",accent:"--accent-color",border:"--border-color",surface:"--bg-secondary",success:"--success-color",warning:"--warning-color",danger:"--danger-color"}).map(([C,L])=>(b.style.color=`var(${L}, ${h[C]})`,[C,getComputedStyle(b).color])))}finally{b.remove()}}var Vf=Object.freeze({bg:"var(--bg-primary, #ffffff)",fg:"var(--text-primary, #18212b)",line:"var(--text-secondary, #536171)",accent:"var(--accent-color, #0969da)",muted:"var(--text-secondary, #536171)",surface:"var(--bg-secondary, #f3f5f7)",border:"var(--border-color, #b6bec8)"});var Tn=Object.freeze({bytes:262144,nodes:2048,depth:32,dimension:2048}),co="http://www.w3.org/2000/svg",Ja=new Set(["svg","g","defs","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","title","desc","linearGradient","radialGradient","stop","clipPath"]),gp=new Set(["x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","width","height","dx","dy","stroke-width","stroke-dashoffset","font-size"]),hp=new Set(["opacity","fill-opacity","stroke-opacity","stop-opacity","stroke-miterlimit","offset"]),Qa={"fill-rule":["nonzero","evenodd"],"clip-rule":["nonzero","evenodd"],"stroke-linecap":["butt","round","square"],"stroke-linejoin":["miter","round","bevel"],"text-anchor":["start","middle","end"],"dominant-baseline":["auto","middle","central","hanging","text-before-edge","text-after-edge","alphabetic"],"font-family":["sans-serif","serif","monospace"],"font-weight":["normal","bold","100","200","300","400","500","600","700","800","900"],"font-style":["normal","italic","oblique"],gradientUnits:["objectBoundingBox","userSpaceOnUse"],clipPathUnits:["userSpaceOnUse","objectBoundingBox"],spreadMethod:["pad","reflect","repeat"]},bp=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,Bs=/^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)$/;function Os(l){let g="";for(let p of new TextEncoder().encode(l))g+=String.fromCharCode(p);return btoa(g)}function gn(l){return new TextDecoder().decode(Uint8Array.from(atob(l),(g)=>g.charCodeAt(0)))}function Hs(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function uo(l){return bp.test(l)&&Number.isFinite(Number(l))&&Math.abs(Number(l))<=1e6}function lo(l){let g=l.trim().split(/[\s,]+/);return g.length&&g.every(uo)?g.map(Number):null}function yp(l,g){if(l==="id")return/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(g);if(gp.has(l))return uo(g.replace(/(?:px|%)$/,""));if(hp.has(l))return uo(g.replace(/%$/,""));if(Object.hasOwn(Qa,l))return Qa[l].includes(g);if(["fill","stroke","color","stop-color"].includes(l))return/^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+,\s/-]+\))$/i.test(g)||Bs.test(g);if(l==="clip-path")return g==="none"||Bs.test(g);if(l==="viewBox"){let p=lo(g);return!!p&&p.length===4&&p[2]>0&&p[3]>0}if(l==="points"||l==="stroke-dasharray")return g==="none"||lo(g)!==null;if(l==="d")return/^[MmZzLlHhVvCcSsQqTtAa\dEe+.,\s-]*$/.test(g);if(l==="transform"||l==="gradientTransform")return g.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/g,(h,b)=>lo(b)?"":h).trim()==="";return!1}var sn=new Map,wp=8,Xa=2097152,Fs=0;function Za(l,g="theme"){if(l.length>Tn.bytes)return null;let p=Va(g),h=JSON.stringify(p)+l,b=sn.get(h);if(b)return sn.delete(h),sn.set(h,b),b.image;let S=vp(l,p),C=2*(h.length+(S?.src.length||0)+(S?.label.length||0));if(C<=Xa){while(sn.size>=wp||Fs+C>Xa){let L=sn.keys().next().value;Fs-=sn.get(L).size,sn.delete(L)}sn.set(h,{image:S,size:C}),Fs+=C}return S}function vp(l,g){if(l.length>Tn.bytes||new TextEncoder().encode(l).byteLength>Tn.bytes)return null;if(/<!\s*(?:DOCTYPE|ENTITY)|<\?/i.test(l))return null;let p=new DOMParser().parseFromString(l,"image/svg+xml"),h=p.documentElement;if(!h||h.localName!=="svg"||p.querySelector("parsererror")||p.doctype)return null;let b=[{node:h,depth:1}],S=0;while(b.length){let{node:X,depth:ne}=b.pop();if(++S>Tn.nodes||ne>Tn.depth)return null;for(let W=X.lastChild;W;W=W.previousSibling){if(S+b.length>=Tn.nodes)return null;b.push({node:W,depth:ne+(W.nodeType===1?1:0)})}}let C=document.implementation.createDocument(co,"svg",null),L=new Map,D=[];function T(X,ne,W){if(X.hasAttribute("xmlns")&&X.getAttribute("xmlns")!==co)return!1;if(X.namespaceURI!==h.namespaceURI||X.namespaceURI&&X.namespaceURI!==co||X.prefix||!Ja.has(X.localName))return!1;if(X!==h&&X.localName==="svg")return!1;let me=W||["defs","clipPath","linearGradient","radialGradient"].includes(X.localName);for(let Le of Array.from(X.attributes)){if(Le.namespaceURI||Le.prefix)continue;let be=Le.name,He=Le.value.trim();if(["fill","stroke","color","stop-color"].includes(be)){let cn=He.match(/^var\(--svg-(background|foreground|muted|accent|border|surface|success|warning|danger)\)$/);if(cn)He=g[cn[1]]}if(!yp(be,He))continue;let Kt=He.match(Bs);if(Kt){if(me||!["fill","stroke","clip-path"].includes(be))continue;D.push({element:ne,name:be,id:Kt[1]})}if(be==="id"){if(L.has(He))return!1;L.set(He,ne)}ne.setAttribute(be,He)}for(let Le of Array.from(X.childNodes))if(Le.nodeType===1){let be=Le;if(!Ja.has(be.localName))return!1;let He=C.createElementNS(co,be.localName);if(!T(be,He,me))return!1;ne.appendChild(He)}else if(Le.nodeType===3||Le.nodeType===4)ne.appendChild(C.createTextNode(Le.nodeValue||""));else if(Le.nodeType!==8)return!1;return!0}if(!T(h,C.documentElement,!1))return null;for(let X of D){let ne=L.get(X.id)?.localName;if(!(X.name==="clip-path"?ne==="clipPath":ne==="linearGradient"||ne==="radialGradient"))X.element.removeAttribute(X.name)}let F=C.documentElement;if(!F.hasAttribute("color"))F.setAttribute("color",g.foreground);if(!F.hasAttribute("fill"))F.setAttribute("fill","currentColor");let O=lo(F.getAttribute("viewBox")||""),z=(X,ne)=>{let W=F.getAttribute(X)?.replace(/px$/,"")||"";return uo(W)&&Number(W)>0?Number(W):ne},Z=z("width",O?.[2]||300),Q=z("height",O?.[3]||150),te=Math.min(1,Tn.dimension/Math.max(Z,Q));if(F.setAttribute("width",String(Z*te)),F.setAttribute("height",String(Q*te)),!O)F.setAttribute("viewBox",`0 0 ${Z} ${Q}`);F.setAttribute("preserveAspectRatio","xMidYMid meet");let ee=(F.querySelector("title")?.textContent?.trim()||F.querySelector("desc")?.textContent?.trim()||"Model-generated SVG").replace(/\s+/g," ").slice(0,256);return Object.freeze({src:`data:image/svg+xml;base64,${Os(new XMLSerializer().serializeToString(F))}`,label:ee})}function ec(l,g,p,h={}){if(!/^ {0,3}(?:`{3,}|~{3,})svg\s*$/im.test(l))return g(l);let b=l.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean)||[],S=null,C=/^(?:\uFEFF)?---(?:\r?\n|\r)/.test(l),L=0,D=[],T=[],F=`PICLAWSVG${Array.from(crypto.getRandomValues(new Uint32Array(4)),(z)=>z.toString(16)).join("")}BLOCK`;for(let z=0;z<b.length;z++){let Z=b[z].replace(/[\r\n]+$/,"");if(C){if(z>0&&/^(---|\.\.\.)\s*$/.test(Z))C=!1;continue}if(S){if(new RegExp(`^ {0,3}${S.char}{${S.length},}\\s*$`).test(Z))S=null;continue}let Q=Z.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(!Q)continue;if(S={char:Q[1][0],length:Q[1].length},!/^svg\s*$/i.test(Q[2]))continue;let te=new RegExp(`^ {0,3}${S.char}{${S.length},}\\s*$`),ee=z+1;while(ee<b.length&&!te.test(b[ee].replace(/[\r\n]+$/,"")))ee++;if(z>L)D.push(b.slice(L,z).join(""));let X=b.slice(z+1,ee).join(""),ne=h.sanitize===!1?null:ee<b.length?Za(X):null,W=p(X);D.push(`

${F}${T.length}END

`),T.push(h.sanitize===!1&&ee<b.length?X:ne?`<div class="model-svg-block" data-svg-surface="theme"><div class="model-svg-controls"><label>SVG background <select class="model-svg-surface" aria-label="SVG background"><option value="theme">Theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><img class="model-svg-image" src="${ne.src}" alt="${Hs(ne.label)}"><details class="model-svg-source"><summary>SVG source</summary>${W}</details></div>`:W),z=ee,L=ee+1,S=null}if(!T.length)return g(l);if(L<b.length)D.push(b.slice(L).join(""));return g(D.join("")).replace(new RegExp(`(?:<p>)?${F}(\\d+)END(?:<\\/p>)?`,"g"),(z,Z)=>T[Number(Z)])}function Jn(l){let g=Array.from(l.querySelectorAll(".model-svg-block"));if(!g.length)return()=>{};let p=(S)=>{let C=S.dataset.svgSurface,L=S.querySelector(".model-svg-image"),D=S.querySelector("[data-svg-source], .code-block__copy[data-code]");if(!L||!D)return;let T=Za(gn(D.dataset.svgSource||D.dataset.code||""),C);if(T&&L.getAttribute("src")!==T.src)L.src=T.src},h=()=>g.forEach((S)=>{if(S.dataset.svgSurface==="theme")p(S)}),b=(S)=>{let C=S.target;if(!C?.matches(".model-svg-surface"))return;let L=C.closest(".model-svg-block");if(!L||!["theme","light","dark"].includes(C.value))return;L.dataset.svgSurface=C.value,p(L)};return l.addEventListener("change",b),window.addEventListener("piclaw-theme-change",h),h(),()=>{l.removeEventListener("change",b),window.removeEventListener("piclaw-theme-change",h)}}function tc(l){if(typeof l!=="string"||!l.trim()||l.length>2048)throw Error("Provide a GitHub/Gitea repository web URL.");let g=l.trim();if(!/^https?:\/\//i.test(g)||/[\\\s]/.test(g))throw Error("Repository URL must use HTTP or HTTPS.");let p=new URL(g);if(!["http:","https:"].includes(p.protocol)||p.username||p.password||p.search||p.hash)throw Error("Repository URL cannot contain credentials, a query or a fragment.");let h=p.pathname.replace(/\/+$/,"").split("/").slice(1);if(h.length<2||h.some((L)=>!/^[a-zA-Z0-9_.-]+$/.test(L)||L==="."||L===".."))throw Error("Use a repository URL ending in owner/repository (an installation subpath is allowed).");if(g.slice(g.indexOf("://")+3).split("/").slice(1).some((L)=>L==="."||L===".."))throw Error("Repository URL cannot contain traversal segments.");if(h.at(-1).endsWith(".git"))h[h.length-1]=h.at(-1).slice(0,-4);if(!h.at(-1))throw Error("Repository name is required.");if(p.hostname.toLowerCase()==="github.com"&&h.length!==2)throw Error("GitHub repository URLs must end at github.com/owner/repository.");if(p.hostname.toLowerCase()!=="github.com"&&h.length!==2&&h.length!==3)throw Error("Gitea repository URLs must be owner/repository or installation-base/owner/repository.");let S=new Set(["issues","issue","pulls","pull","explore","src","commits","commit","actions","releases","projects","settings","wiki","compare","branches","tags","milestones"]),C=h.at(-1).toLowerCase();if(h.some((L)=>S.has(L.toLowerCase()))||/^\d+$/.test(C))throw Error("Repository URL must identify a repository root, not an issue, pull request or explorer page.");return`${p.origin}/${h.join("/")}`}function nc(l,g=null,p=!0){if(typeof DOMParser>"u")return l;let h=null;if(g)try{h=tc(g)}catch{h=null}let b=new DOMParser().parseFromString(l,"text/html"),S=b.createTreeWalker(b.body,NodeFilter.SHOW_TEXT),C=[];while(S.nextNode())C.push(S.currentNode);for(let L of C){if(L.parentElement?.closest("a, code, pre, script, style, svg, math, .katex"))continue;let D=L.nodeValue||"",T=[...D.matchAll(/#(\w+)/g)];if(!T.length)continue;let F=b.createDocumentFragment(),O=0;for(let z of T){let Z=z.index,Q=Z+z[0].length,te=z[1];if(F.append(b.createTextNode(D.slice(O,Z))),O=Q,/^\d+$/.test(te)){let ee=D[Z-1]||"",X=D[Q]||"",ne=!ee||/[\s([{>,;:!?]/.test(ee);if(!h||!/^[1-9]\d*$/.test(te)||!ne||/[\p{L}\p{N}_/\-]/u.test(X)){F.append(b.createTextNode(z[0]));continue}let W=b.createElement("a");W.href=`${h}/issues/${te}`,W.className="project-reference",W.target="_blank",W.rel="noopener noreferrer",W.title=`${h} #${te}`,W.textContent=z[0],F.append(W)}else{if(!p){F.append(b.createTextNode(z[0]));continue}let ee=b.createElement("a");ee.href="#",ee.className="hashtag",ee.setAttribute("data-hashtag",te),ee.textContent=z[0],F.append(ee)}}F.append(b.createTextNode(D.slice(O))),L.replaceWith(F)}return b.body.innerHTML}var Sp=new Set(["code","pre","strong","em","b","i","u","s","del","ins","sub","sup","mark","small","br","p","ul","ol","li","blockquote","ruby","rt","rp","span","input"]),$p=new Set(["a","abbr","blockquote","br","code","del","div","em","hr","h1","h2","h3","h4","h5","h6","i","img","input","ins","kbd","li","mark","ol","p","pre","ruby","rt","rp","s","small","span","strong","sub","sup","table","tbody","td","th","thead","tr","u","ul","math","semantics","mrow","mi","mn","mo","mtext","mspace","msup","msub","msubsup","mfrac","msqrt","mroot","mtable","mtr","mtd","annotation","svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]),kp=new Set(["class","title","role","aria-hidden","aria-label","aria-expanded","aria-live","data-mermaid","data-hashtag"]),xp={a:new Set(["href","target","rel"]),img:new Set(["src","alt","title"]),input:new Set(["type","checked","disabled"])},_p=new Set(["http:","https:","mailto:",""]),zs=new Set(["svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]);function Ep(l,g){let p=String(l||"").toLowerCase(),h=String(g||"").toLowerCase();if(!h||h.startsWith("on"))return!1;if(h.startsWith("data-")||h.startsWith("aria-"))return!0;if(zs.has(p))return!0;return(xp[p]||new Set).has(h)||kp.has(h)}function qn(l){return String(l||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;")}function Ce(l,g={}){if(!l)return null;let p=String(l).trim();if(!p)return null;if(p.startsWith("#")||p.startsWith("/"))return p;if(p.startsWith("data:")){if(g.allowDataImage&&/^data:image\//i.test(p))return p;return null}if(p.startsWith("blob:"))return p;try{let h=new URL(p,typeof window<"u"?window.location.origin:"http://localhost");if(!_p.has(h.protocol))return null;return h.href}catch{return null}}function rc(l,g={}){if(!l)return"";if(g?.sanitize===!1)return l;let p=new DOMParser().parseFromString(l,"text/html"),h=[],b=p.createTreeWalker(p.body,NodeFilter.SHOW_ELEMENT),S;while(S=b.nextNode())h.push(S);for(let C of h){let L=C.tagName.toLowerCase();if(!$p.has(L)){let D=C.parentNode;if(!D)continue;while(C.firstChild)D.insertBefore(C.firstChild,C);D.removeChild(C);continue}for(let D of Array.from(C.attributes)){let T=D.name.toLowerCase(),F=D.value;if(T.startsWith("on")){C.removeAttribute(D.name);continue}if(Ep(L,T)){if(zs.has(L)&&typeof g.rewriteImageSrc==="function"){let O=Array.from(F.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(Z)=>Z[2]?.trim()||"");if(/(?:https?:|data:|blob:|\/\/)/i.test(F)||O.some((Z)=>!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(Z))){C.removeAttribute(D.name);continue}}if(T==="href"||T==="xlink:href"){let O=typeof g.rewriteImageSrc==="function"&&zs.has(L)?/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(F.trim())?F.trim():g.rewriteImageSrc(F):F,z=Ce(O);if(!z)C.removeAttribute(D.name);else if(C.setAttribute(D.name,z),L==="a"){if(!C.getAttribute("rel"))C.setAttribute("rel","noopener noreferrer");if(/^https?:\/\//i.test(z))C.setAttribute("target","_blank")}}else if(T==="src"){let O=typeof g.rewriteImageSrc==="function"&&(L==="img"||L==="image")?g.rewriteImageSrc(F):F,z=Ce(O,{allowDataImage:L==="img"&&typeof g.rewriteImageSrc!=="function"});if(!z)C.removeAttribute(D.name);else C.setAttribute(D.name,z)}continue}C.removeAttribute(D.name)}}return p.body.innerHTML}function qs(l){if(!l)return l;let g=l.replace(/</g,"&lt;").replace(/>/g,"&gt;");return new DOMParser().parseFromString(g,"text/html").documentElement.textContent}function Cp(l,g=2){if(!l)return l;let p=l;for(let h=0;h<g;h+=1){let b=qs(p);if(b===p)break;p=b}return p}function Ap(l){if(!l)return{text:"",frontmatter:null};let g=l.replace(/^\uFEFF/,"").replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!g.startsWith(`---
`))return{text:g,frontmatter:null};let p=g.split(`
`),h=-1;for(let C=1;C<p.length;C+=1)if(/^(---|\.\.\.)\s*$/.test(p[C])){h=C;break}if(h<=0)return{text:g,frontmatter:null};let b=p.slice(1,h).join(`
`);return{text:p.slice(h+1).join(`
`).replace(/^\n+/,""),frontmatter:b}}function Rp(l){let{text:g,frontmatter:p}=Ap(l);if(p===null)return g;return["<!--frontmatter-block-start-->","```yaml",p,"```","<!--frontmatter-block-end-->",g].filter(Boolean).join(`

`)}function Pp(l){if(!l)return l;return Cp(l,5)}function Lp(l){let g=new TextEncoder().encode(String(l||"")),p="";for(let h of g)p+=String.fromCharCode(h);return btoa(p)}function Tp(l){if(!l)return l;return l.replace(/<pre><code(?:\s+class="language-([A-Za-z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/g,(p,h,b)=>{let S=String(h||"").trim().toLowerCase(),C=qs(b),L=S||"plaintext",D=Ae(C,S);return`<pre><code class="hljs language-${qn(L)}">${D}</code></pre>`}).replace(/<!--frontmatter-block-start-->\s*<pre>/g,'<pre class="frontmatter-block">').replace(/<\/pre>\s*<!--frontmatter-block-end-->/g,"</pre>")}var Mp={span:new Set(["title","class","lang","dir"]),input:new Set(["type","checked","disabled"])};function Dp(l,g){let p=Mp[l];if(!p||!g)return"";let h=[],b=/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g,S;while(S=b.exec(g)){let C=(S[1]||"").toLowerCase();if(!C||C.startsWith("on")||!p.has(C))continue;let L=S[2]??S[3]??S[4]??"";h.push(` ${C}="${qn(L)}"`)}return h.join("")}function jp(l){if(!l)return l;return l.replace(/&lt;((?:[^"'<>]|"[^"]*"|'[^']*')*?)(?:&gt;|>)/g,(g,p)=>{let h=p.trim(),b=h.startsWith("/"),S=b?h.slice(1).trim():h,L=S.endsWith("/")?S.slice(0,-1).trim():S,[D=""]=L.split(/\s+/,1),T=D.toLowerCase();if(!T||!Sp.has(T))return g;if(T==="br")return b?"":"<br>";if(b)return`</${T}>`;let F=L.slice(D.length).trim(),O=Dp(T,F);return`<${T}${O}>`})}function oc(l,g=!0){if(typeof l.text!=="string")return;if(l.type==="code"&&g){let p=l.lang?.trim().toLowerCase();if(p==="mermaid"){l.type="html",l.text=`<div class="mermaid-container" data-mermaid="${Lp(Pp(l.text))}"><div class="mermaid-loading">Loading diagram...</div></div>`;return}if(p&&["math","katex","latex"].includes(p)){l.type="html",l.text=`<p>$$
${qn(l.text)}
$$</p>
`;return}}if(l.type!=="html")return;if(/^<!--frontmatter-block-(?:start|end)-->\s*$/.test(l.text))return;l.text=jp(l.text.replace(/</g,"&lt;"))}function Ip(l){if(!window.katex)return l;let g=(C)=>qs(C).replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&").replace(/<br\s*\/?\s*>/gi,`
`),p=(C)=>{let L=[],D=C.replace(/<pre\b[^>]*>\s*<code\b[^>]*>[\s\S]*?<\/code>\s*<\/pre>/gi,(T)=>{let F=L.length;return L.push(T),`@@CODE_BLOCK_${F}@@`});return D=D.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi,(T)=>{let F=L.length;return L.push(T),`@@CODE_INLINE_${F}@@`}),{html:D,blocks:L}},h=(C,L)=>{if(!L.length)return C;return C.replace(/@@CODE_(?:BLOCK|INLINE)_(\d+)@@/g,(D,T)=>{let F=Number(T);return L[F]??""})},b=p(l),S=b.html;return S=S.replace(/(^|\n|<br\s*\/?\s*>|<p>|<\/p>)\s*\$\$([\s\S]+?)\$\$\s*(?=\n|<br\s*\/?\s*>|<\/p>|$)/gi,(C,L,D)=>{try{let T=katex.renderToString(g(D.trim()),{displayMode:!0,throwOnError:!1});return`${L}${T}`}catch(T){let F=T instanceof Error?T.message:String(T);return`<span class="math-error" title="${qn(F)}">${C}</span>`}}),h(S,b.blocks)}function Np(l,g=null){return nc(l,g)}function Fp(l){return{safeHtml:Rp(l||"")}}var Bp=new Set(["NOTE","TIP","IMPORTANT","WARNING","CAUTION"]),Op={NOTE:"Note",TIP:"Tip",IMPORTANT:"Important",WARNING:"Warning",CAUTION:"Caution"};function Hp(l){return l.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>\s*)?(\n)?/gi,(g,p,h)=>{let b=p.toUpperCase();if(!Bp.has(b))return g;let S=Op[b]||b;return`<div class="admonition admonition-${b.toLowerCase()}"><p class="admonition-title">${S}</p><p>`}).replace(/(<div class="admonition admonition-[a-z]+">(?:(?!<\/div>)[\s\S])*?)<\/blockquote>/g,(g,p)=>`${p}</div>`)}function v(l,g,p={}){if(!l)return"";return ec(l,(h)=>zp(h,p),(h)=>`<pre><code class="language-svg" data-svg-source="${Os(h)}">${Hs(h)}</code></pre>`,{sanitize:typeof window>"u"||window.__PICLAW_SANITIZE_SVG_FENCES__!==!1})}function zp(l,g){let{safeHtml:p}=Fp(l),h=window.marked?marked.parse(p,{headerIds:!1,mangle:!1,walkTokens:oc}):qn(p).replace(/\n/g,"<br>");return h=Tp(h),h=Ip(h),h=Np(h,g.projectRepository),h=Hp(h),h=rc(h,g),h}function j(l){if(!l)return"";let g=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`),p=window.marked?marked.parse(g,{walkTokens:(h)=>oc(h,!1)}):qn(g).replace(/\n/g,"<br>");return p=rc(p),p}async function U(l,g={}){await Ua(l,{scoped:typeof g.rewriteImageSrc==="function",reportError:(p)=>console.error("Mermaid render error:",p)})}function _e(l){if(!l||typeof l!=="object")return null;let g=l.started_at??l.startedAt;if(typeof g!=="string"||!g)return null;let p=Date.parse(g);return Number.isFinite(p)?p:null}function qp(l){if(!l||typeof l!=="object")return null;let g=l.retry_at??l.retryAt;if(typeof g!=="string"||!g)return null;let p=Date.parse(g);return Number.isFinite(p)?p:null}function oe(l){if(!l||typeof l!=="object")return null;let g=l.last_event_at??l.lastEventAt??l.started_at??l.startedAt;if(typeof g!=="string"||!g)return null;let p=Date.parse(g);return Number.isFinite(p)?p:null}function H(l){if(!l||typeof l!=="object")return!1;let g=l.intent_key??l.intentKey;return l.type==="intent"&&g==="compaction"}function bt(l){if(!l||typeof l!=="object")return"";let g=l.title;if(typeof g==="string"&&g.trim())return g.trim();let p=l.tool_name??l.toolName;if(typeof p==="string"&&p.trim())return p.trim();let h=l.status;if(typeof h==="string"&&h.trim())return h.trim();return H(l)?"Compacting context":"Thinking..."}function sc(l){let g=Math.max(0,Math.floor(l/1000)),p=g%60,h=Math.floor(g/60)%60,b=Math.floor(g/3600);if(b>0)return`${b}:${String(h).padStart(2,"0")}:${String(p).padStart(2,"0")}`;return`${h}:${String(p).padStart(2,"0")}`}function $e(l,g=Date.now()){let p=_e(l);if(p===null)return null;return sc(Math.max(0,g-p))}function Qn(l,g=Date.now()){let p=qp(l);if(p===null)return null;let h=p-g;if(h<=0)return"retrying now";return`retry in ${sc(h)}`}function w(l={}){let g=l.window??(typeof window<"u"?window:null),p=l.navigator??(typeof navigator<"u"?navigator:null);if(p&&p.standalone===!0)return!0;if(!g||typeof g.matchMedia!=="function")return!1;return["(display-mode: standalone)","(display-mode: minimal-ui)","(display-mode: fullscreen)"].some((b)=>{try{return Boolean(g.matchMedia(b)?.matches)}catch{return!1}})}function Te(l={}){let g=l.window??(typeof window<"u"?window:null),p=l.navigator??(typeof navigator<"u"?navigator:null);if(!g&&!p)return!1;let h=String(p?.userAgent||""),b=Number(p?.maxTouchPoints||0),S=/Android|webOS|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(h),C=(()=>{if(!g||typeof g.matchMedia!=="function")return!1;try{return Boolean(g.matchMedia("(pointer: coarse)")?.matches||g.matchMedia("(any-pointer: coarse)")?.matches)}catch{return!1}})();return Boolean(S||b>1||C)}function Yn(l,g={}){if(w(g))return null;if(Te(g))return{target:"_blank",features:void 0,mode:"tab"};return{target:Gp(l),features:"popup=yes,width=900,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function hn(l,g={}){let p=g.window??(typeof window<"u"?window:null);if(!p||!l)return null;try{return l.features?p.open("about:blank",l.target,l.features):p.open("about:blank",l.target)}catch{return null}}function yn(l,g={}){if(!l||!l.document)return;try{let p=String(g.title||"Opening branch…"),h=String(g.message||"Preparing a new branch window…");l.document.title=p;let b=l.document.body;if(!b)return;if(typeof l.document.createElement!=="function"){b.textContent=`${p}
${h}`;return}let S=l.document.createElement("div");S.setAttribute("style","font-family: system-ui, sans-serif; padding: 24px; color: #222;");let C=l.document.createElement("h1");C.setAttribute("style","font-size: 18px; margin: 0 0 12px;"),C.textContent=p;let L=l.document.createElement("p");if(L.setAttribute("style","margin: 0; line-height: 1.5;"),L.textContent=h,S.appendChild(C),S.appendChild(L),typeof b.replaceChildren==="function")b.replaceChildren(S);else b.innerHTML="",b.appendChild(S)}catch{return}}function bn(l,g){if(!l||!g)return;try{if(l.location&&typeof l.location.replace==="function"){l.location.replace(String(g));return}l.location=String(g)}catch{return}}function vn(l){if(!l||typeof l.close!=="function")return;try{l.close()}catch{return}}function x(l,g,p={}){let h=new URL(String(l||"http://localhost/")),b=String(g||"").trim()||"web:default";if(h.searchParams.set("chat_jid",b),h.searchParams.delete("branch_loader"),h.searchParams.delete("branch_source_chat_jid"),h.searchParams.delete("pane_popout"),h.searchParams.delete("pane_path"),h.searchParams.delete("pane_label"),p.chatOnly===!0)h.searchParams.set("chat_only","1");return h.toString()}function wn(l,g,p={}){let h=new URL(String(l||"http://localhost/")),b=String(g||"").trim()||"web:default";if(h.searchParams.set("branch_loader","1"),h.searchParams.set("branch_source_chat_jid",b),h.searchParams.delete("chat_jid"),h.searchParams.delete("pane_popout"),h.searchParams.delete("pane_path"),h.searchParams.delete("pane_label"),p.chatOnly===!0)h.searchParams.set("chat_only","1");return h.toString()}function Zn(l,g,p={}){let h=new URL(String(l||"http://localhost/")),b=String(g||"").trim();if(!b)return h.toString();if(h.searchParams.set("pane_popout","1"),h.searchParams.set("pane_path",b),p?.label)h.searchParams.set("pane_label",String(p.label));else h.searchParams.delete("pane_label");if(p?.chatJid)h.searchParams.set("chat_jid",String(p.chatJid));let S=p?.params&&typeof p.params==="object"?p.params:null;if(S)for(let[C,L]of Object.entries(S)){let D=String(C||"").trim();if(!D)continue;if(L===null||L===void 0||L==="")h.searchParams.delete(D);else h.searchParams.set(D,String(L))}return h.searchParams.delete("chat_only"),h.searchParams.delete("branch_loader"),h.searchParams.delete("branch_source_chat_jid"),h.toString()}function Gp(l){return`piclaw-chat-${String(l||"web:default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function Kp(l){return`piclaw-pane-${String(l||"pane").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function Xn(l,g={}){if(w(g))return null;if(Te(g))return{target:"_blank",features:void 0,mode:"tab"};return{target:Kp(l),features:"popup=yes,width=1200,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function ie(l){let g=l instanceof Error?l.message:String(l||"").trim(),p=String(g||"").trim();if(!p)return"PiClaw could not open a new branch window.";let h=p.toLowerCase();if(h.includes("no stable turn boundary"))return"This chat is still in flight and does not yet have a stable turn boundary to fork from.";if(h.includes("cannot fork a branch while the source chat is still active"))return"This chat is still active. Please wait for the current turn to settle, then try again.";if(h.includes("cancelled"))return"Branch creation was cancelled before a new chat window could be opened.";if(h.includes("did not return a chat id"))return"PiClaw created no usable branch id for the new window. Please try again.";if(h.includes("failed to fork branch")||h.includes("failed to fork chat branch"))return"PiClaw could not create the new branch. Please try again.";return p}var po=new Map,Gs=new Set,an,Ks=()=>{for(let l of Gs)l()};function er(l,g){if(!l||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(g.id)||!g.label||typeof g.start!=="function"||typeof g.availability!=="function")throw Error("Invalid dictation provider registration.");if(po.has(g.id))throw Error("Duplicate dictation provider.");let p=Object.freeze({owner:l,provider:Object.freeze({...g})});po.set(g.id,p);let h=!1;return()=>{if(h)return;if(h=!0,an===p)an=void 0;po.delete(g.id),Ks()}}function tr(l,g){if(g===null){if(an?.owner===l)an=void 0,Ks();return}let p=po.get(g);if(!p||p.owner!==l)throw Error("Dictation provider belongs to another add-on or is unregistered.");if(an&&an!==p)throw Error("Another enabled dictation provider owns the composer.");an=p,Ks()}function Mn(){return an}function fo(l){return Gs.add(l),()=>{Gs.delete(l)}}var Wp=[[`Continue working toward the active thread goal.
`,"Continue goal","objective"],[`The active thread goal objective was edited by the user.
`,"Goal updated","untrusted_objective"],[`The active thread goal has reached its token budget.
`,"Goal budget reached","objective"],[`The current Plan Sidebar checklist has no pending or in-progress items.
`,"Finalize goal","objective"]];function vt(l){let g=/^🎯 (?:Continue goal|Goal updated|Goal budget reached|Finalize goal): /.test(l),p=Wp.find(([b])=>l.startsWith(b));if(!g&&!p)return l;let h=/\n\n<piclaw_goal_input>([^\n]*)<\/piclaw_goal_input>$/.exec(l);if(!h)return l;try{let b=JSON.parse(h[1]);if(!b||Object.keys(b).sort().join(",")!=="generation,goalId"||typeof b.goalId!=="string"||!b.goalId.trim()||b.goalId!==b.goalId.trim()||b.goalId.length>256||!Number.isSafeInteger(b.generation)||b.generation<1)return l;let S=l.slice(0,h.index);if(g)return S;let[,C,L]=p,D=new RegExp(`<${L}>
([\\s\\S]*?)
</${L}>`).exec(S)?.[1];if(D===void 0)return l;let T={lt:"<",gt:">",amp:"&",quot:'"',"#39":"'",apos:"'"};return`\uD83C\uDFAF ${C}: ${D.replace(/&(lt|gt|amp|quot|#39|apos);/g,(F,O)=>T[O])}`}catch{return l}}class Ws{host;timeoutMs;current;pendingSubmit;constructor(l,g=15000){this.host=l;this.timeoutMs=g;if(!Number.isSafeInteger(g)||g<=0)throw Error("Invalid dictation deadline.")}get active(){return!!this.current}async start(l){if(this.current)throw Error("A dictation session already owns this composer.");if(!l.availability().available){this.host.state("error","Selected dictation provider is unavailable.");return}let g=this.host.readDraft(),p=new AbortController,h,b,S=new Promise((D,T)=>{h=D,b=T}),C={controller:p,provider:l,chatJid:g.chatJid,revision:g.revision,start:Math.min(g.selectionStart,g.selectionEnd),end:Math.max(g.selectionStart,g.selectionEnd),text:g.text,segments:[],starting:S};this.current=C,this.host.state("loading"),Promise.resolve().then(()=>l.start({signal:p.signal,chatJid:g.chatJid,setState:(D)=>{if(this.current!==C||p.signal.aborted)return;if(D==="error")C.error="Dictation provider failed. Draft preserved.",this.cancel(),this.host.state("error",C.error);else if(!C.finishing||D!=="loading"&&D!=="recording")this.host.state(D)},updateSegment:(D)=>this.updateSegment(C,D)})).then(h,b);try{if(await this.bounded(S,p.signal),this.current===C&&!p.signal.aborted&&!C.finishing)this.host.state("recording")}catch{let D=p.signal.aborted;if(p.abort(),!D)C.error="Dictation could not start. Draft preserved.";if(this.cancel(),C.error&&this.current===C)this.host.state("error",C.error)}}updateSegment(l,g){if(this.current!==l||l.controller.signal.aborted||!g.segmentId||g.segmentId.length>128||typeof g.text!=="string"||g.text.length>65536||typeof g.final!=="boolean")return{applied:!1};let p=this.host.readDraft();if(p.chatJid!==l.chatJid||p.revision!==l.revision||p.text!==l.text)return{applied:!1};let h=l.segments.find((F)=>F.id===g.segmentId);if(h?.final)return{applied:h.text===g.text&&g.final};let b=l.segments.map((F)=>({...F})),S=b.findIndex((F)=>F.id===g.segmentId),C={id:g.segmentId,text:g.text,final:g.final};if(S<0){if(b.length>=256)return{applied:!1};b.push(C)}else b[S]=C;let L=b.map((F)=>F.text).join("");if(L.length>131072)return{applied:!1};let D=p.text.slice(0,l.start)+L+p.text.slice(l.end);if(!this.host.writeDraft(D,p.revision))return{applied:!1};let T=this.host.readDraft();if(T.chatJid!==l.chatJid||T.text!==D)return{applied:!1};return l.segments=b,l.end=l.start+L.length,l.text=D,l.revision=T.revision,{applied:!0}}draftChanged(l,g){let p=this.current;if(!p||p.controller.signal.aborted)return;if(l.chatJid!==p.chatJid||g.chatJid!==p.chatJid||l.revision!==p.revision||l.text!==p.text){this.cancel();return}let h=0;while(h<l.text.length&&h<g.text.length&&l.text[h]===g.text[h])h++;let b=0;while(b<l.text.length-h&&b<g.text.length-h&&l.text.at(-1-b)===g.text.at(-1-b))b++;let S=l.text.length-b,C=g.text.length-l.text.length;if(S<=p.start&&h<p.start)p.start+=C,p.end+=C;else if(h<p.end||p.start===p.end&&h===p.start){this.cancel();return}p.text=g.text,p.revision=g.revision}finish(){let l=this.current;if(!l)return Promise.resolve({status:"cancelled"});if(!l.finishing)this.host.state("finishing"),l.finishing=(async()=>{try{let g=await this.bounded(l.starting,l.controller.signal),p=await this.bounded(Promise.resolve().then(()=>g.finish()),l.controller.signal);if(l.error)throw Error("Dictation provider failed.");if(this.current!==l||l.controller.signal.aborted)return{status:"cancelled"};if(p.status!=="finished")return this.cancel(),{status:"cancelled"};return l.controller.abort(),this.current=void 0,this.host.state("idle"),p}catch{if(l.controller.signal.aborted&&!l.error)return{status:"cancelled"};if(this.current===l)l.error="Dictation could not finish. Draft preserved; send again explicitly.",this.cancel(),this.host.state("error",l.error);throw Error("Dictation finish failed.")}})();return l.finishing}cancel(){let l=this.current;if(!l)return Promise.resolve();if(l.controller.abort(),!l.cancelling)l.cancelling=(async()=>{try{await(await l.starting).cancel()}catch{l.error??="Dictation cleanup failed."}finally{if(this.current===l)if(this.current=void 0,l.error)this.host.state("error",l.error);else this.host.state("idle")}})();return l.cancelling}submit(l){if(this.pendingSubmit)return this.pendingSubmit;let g=this.current;return this.pendingSubmit=(async()=>{if(g){if((await this.finish()).status!=="finished")return!1}return await l(),!0})().finally(()=>{this.pendingSubmit=void 0}),this.pendingSubmit}bounded(l,g){return new Promise((p,h)=>{let b,S=()=>{clearTimeout(b),h(Error("Dictation cancelled."))};if(g.aborted){h(Error("Dictation cancelled."));return}g.addEventListener("abort",S,{once:!0}),b=setTimeout(()=>{g.removeEventListener("abort",S),h(Error("Dictation deadline exceeded."))},this.timeoutMs),l.then((C)=>{clearTimeout(b),g.removeEventListener("abort",S),p(C)},(C)=>{clearTimeout(b),g.removeEventListener("abort",S),h(C)})})}}function ic(l){let g=0,p=l.read(),h=!1,b=0,C=new Ws({readDraft:()=>(L(),{...l.read(),revision:g}),writeDraft:(F,O)=>{if(L(),h||g!==O)return!1;return l.write(F),g++,p={...l.read(),text:F},!0},state:l.state});function L(){let F=l.read();if(F.text!==p.text||F.chatJid!==p.chatJid){b++;let O={...p,revision:g};g++,p=F,C.draftChanged(O,{...F,revision:g})}}let D=Mn()?.provider,T=fo(()=>{let F=Mn()?.provider;if(F!==D){if(b++,C.active)C.cancel();if(F)l.providerSelected?.()}D=F});return{get selected(){return Mn()?.provider},get active(){return C.active},draftChanged:L,async toggle(){L();let F=Mn()?.provider;if(!F)return!1;if(C.active)await C.finish();else await C.start(F);return!0},submit(F){L();let O=b,z=l.read().chatJid,Z=Mn()?.provider;return C.submit(async()=>{if(L(),h||b!==O||l.read().chatJid!==z||Mn()?.provider!==Z)return;await F()})},async dispose(){h=!0,T(),await C.cancel()},cancel:()=>(b++,C.cancel())}}var Us="piclaw:statusbar-compose-slot";function Ys(){if(typeof document>"u")return null;return document.querySelector(".workbench-statusbar-compose")}function xn(){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent("piclaw:statusbar-compose-slot"))}function mo(l){return String(l||"").toLowerCase().replace(/^@/,"").replace(/\s+/g," ").trim()}function Up(l,g){let p=mo(l),h=mo(g);if(!h)return!1;return p.startsWith(h)||p.includes(h)}function wt(l){if(!l)return!1;if(l.defaultPrevented||l.repeat)return!1;if(l.isComposing)return!1;if(l.ctrlKey||l.metaKey||l.altKey)return!1;return typeof l.key==="string"&&l.key.length===1&&/\S/.test(l.key)}function ac(l,g,p=Date.now(),h=700){let b=l&&typeof l==="object"?l:{value:"",updatedAt:0},S=String(g||"").trim().toLowerCase();if(!S)return{value:"",updatedAt:p};return{value:!b.value||!Number.isFinite(b.updatedAt)||p-b.updatedAt>h?S:`${b.value}${S}`,updatedAt:p}}function Yp(l,g){let p=Math.max(0,Number(l)||0);if(p<=0)return[];let b=((Number.isInteger(g)?g:0)%p+p)%p,S=[];for(let C=0;C<p;C+=1)S.push((b+C)%p);return S}function Vp(l,g,p=0,h=(b)=>b){let b=mo(g);if(!b)return-1;let S=Array.isArray(l)?l:[],C=Yp(S.length,p),L=S.map((D)=>mo(h(D)));for(let D of C)if(L[D].startsWith(b))return D;for(let D of C)if(L[D].includes(b))return D;return-1}function cc(l,g,p=-1,h=(b)=>b){let b=Array.isArray(l)?l:[];if(p>=0&&p<b.length){let S=h(b[p]);if(Up(S,g))return p}return Vp(b,g,0,h)}class Vs{publish;generation=0;constructor(l){this.publish=l}begin(l){let g=++this.generation;return this.publish("sending"),g}acknowledged(l){this.finished(l)}finished(l){if(l===this.generation)this.publish(null)}failed(l){this.finished(l)}reset(){this.generation++,this.publish(null)}}function go(l){return String(l||"").trim().toLowerCase()}function Js(l){let g=String(l||"").match(/^@([a-zA-Z0-9_-]*)$/);if(!g)return null;return go(g[1]||"")}function Jp(l){let g=new Set,p=[];for(let h of Array.isArray(l)?l:[]){let b=go(h?.agent_name);if(!b||g.has(b))continue;g.add(b),p.push(h)}return p}function lc(l,g,p={}){let h=Js(g);if(h==null)return[];let b=typeof p?.currentChatJid==="string"?p.currentChatJid:null;return Jp(l).filter((S)=>{if(b&&S?.chat_jid===b)return!1;return go(S?.agent_name).startsWith(h)})}function Qs(l){let g=go(l);return g?`@${g} `:""}var Qp={streaming:"Streaming",working:"Working",compacting:"Compacting",retrying:"Retrying",bash_running:"Running shell"};function nr(l){if(!l?.is_active)return"";let g=String(l.activity_status||"").trim();return Qp[g]||"Working"}function K(l,g=220){let p=String(l??"").replace(/\r\n?/g,`
`).replace(/!\[[^\]]*\]\([^)]*\)/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/```+/g,"").replace(/`([^`]+)`/g,"$1").replace(/^#{1,6}\s+/gm,"").replace(/^>\s?/gm,"").replace(/^\s*[-*+]\s+/gm,"").replace(/[*_~]{1,3}/g,"").replace(/\s+/g," ").trim();if(p.length<=g)return p;return`${p.slice(0,Math.max(0,g-1)).trimEnd()}…`}function dc(l){if(!l)return null;if(typeof l==="string")try{return dc(JSON.parse(l))}catch{return null}if(typeof l!=="object"||Array.isArray(l))return null;let g=l,p=g.arguments??g.input??g.params??g.parameters??g.args??g.payload;return p&&typeof p==="object"&&!Array.isArray(p)?p:g}function Xp(l){let g=K(l?.title,220);if(g)return g;let p=K(l?.tool_name??l?.toolName,220);if(!p)return"";let h=dc(l?.tool_args??l?.toolArgs);if(!h)return p;let S=[h.command,Array.isArray(h.commands)?h.commands.filter((C)=>typeof C==="string").join(" && "):"",h.path??h.filePath??h.target,Array.isArray(h.paths)?h.paths.filter((C)=>typeof C==="string").join(", "):"",h.fileName??h.filename??h.file,h.url,h.query].map((C)=>typeof C==="string"?K(C,120):"").filter(Boolean).sort((C,L)=>L.length-C.length)[0];return S?`${p}: ${S}`:p}function Zp(l){let g=typeof l?.type==="string"?l.type.trim():"";if(g!=="tool_call"&&g!=="tool_status")return null;let p=K(l.status??l.tool_status??l.toolStatus,220);if(g==="tool_status"&&/^(done|failed|cancelled|canceled|aborted)$/i.test(p))return null;let h=p&&!/^working(?:\.{3}|…)?$/i.test(p)?p:"",b=[Xp(l),h].filter(Boolean).join(" — ");return b?{kind:"tool",label:"Tool",text:K(b)}:null}function uc(l,g){let p=K(typeof g==="string"?g:g?.text);return p?{kind:l,label:l==="thinking"?"Thinking":"Draft",text:p}:null}function rr(l,g=null){if(!l||l.status!=="active")return{preview:null,retained:null};let p=l.data?.turn_id??l.data?.turnId,h=typeof p==="string"?p.trim():"",b=h&&g?.turnId===h?g:null,S=uc("draft",l.draft)||uc("thinking",l.thought),C=S&&h?{...S,turnId:h}:b;return{preview:S||Zp(l.data)||C,retained:C}}function ho(l){let g=typeof l==="string"?Date.parse(l):NaN;return Number.isFinite(g)?g:-1/0}function Ve(l,g){let p=ho(l.last_activity_at),h=ho(g.last_activity_at);if(p!==h)return h-p;let b=ho(l.archived_at),S=ho(g.archived_at);return b===S?0:S-b}function or(l,g=Date.now()){let p=Date.parse(String(l??""));if(!Number.isFinite(p))return"";let h=Math.max(0,Math.round((g-p)/1000));if(h<60)return"now";let b=Math.round(h/60);if(b<60)return`${b}m`;let S=Math.round(b/60);if(S<24)return`${S}h`;let C=Math.round(S/24);if(C<7)return`${C}d`;return new Date(p).toLocaleDateString(void 0,{month:"short",day:"numeric"})}function xt(l){let g=Number(l?.context_percent??l?.contextPercent??l?.context_usage?.percent);if(Number.isFinite(g)&&g>=0)return Math.min(100,g);let p=Number(l?.context_tokens),h=Number(l?.context_window);if(Number.isFinite(p)&&Number.isFinite(h)&&h>0&&p>=0)return Math.min(100,p/h*100);return null}function ir(l){return Boolean(l?.ctrlKey||l?.metaKey||l?.button===1)}var ef={current:"Current",pinned:"Pinned",active:"Active",tree:"This session tree",other:"Other sessions",archived:"Archived"};function he(l){return typeof l==="string"?l.trim():""}function Xs(l){if(l==null)return null;let g=Number(l);return Number.isFinite(g)&&g>=0?g:null}function pc(l){if(l>=1e6){let g=l/1e6;return`${Number.isInteger(g)?g.toFixed(0):g.toFixed(1)}M`}if(l>=1000)return`${Math.round(l/1000)}K`;return String(Math.round(l))}function fc(l){let g=he(l?.model)||he(l?.model_label),p=Xs(l?.context_tokens??l?.contextTokens??l?.context_usage?.tokens),h=Xs(l?.context_window??l?.contextWindow??l?.context_usage?.contextWindow),b=Xs(l?.context_percent??l?.contextPercent??l?.context_usage?.percent),S=b==null?null:Math.min(100,b),C=p!=null&&h!=null&&h>0?`${pc(p)} / ${pc(h)}${S==null?"":` (${Math.round(S)}% context)`}`:S==null?"":`${Math.round(S)}% context`;return[g,C].filter(Boolean).join(" · ")}function tf(l){let g=Boolean(l?.archived_at),p=Boolean(l?.is_active)&&!g;return[he(l?.agent_name)?`@${he(l.agent_name)}`:"",he(l?.agent_name),he(l?.chat_jid),he(l?.root_chat_jid),he(l?.model),he(l?.model_label),he(l?.provider),g?"archived":p?"active":"idle",he(l?.parent_branch_id),he(l?.branch_id)].filter(Boolean).join(" ").toLocaleLowerCase()}function mc(l,g){let p=he(g).toLocaleLowerCase().split(/\s+/).filter(Boolean);if(p.length===0)return!0;let h=tf(l);return p.every((b)=>h.includes(b))}function nf(l,g){if(!mc(l,g))return 4;let p=he(l?.agent_name).toLocaleLowerCase(),h=he(g).toLocaleLowerCase().split(/\s+/).map((b)=>b.replace(/^@/,"")).filter(Boolean);if(!p||h.length===0)return 3;if(h.some((b)=>p===b))return 0;if(h.some((b)=>p.startsWith(b)))return 1;if(h.some((b)=>p.includes(b)))return 2;return 3}function gc(l,g){let p=0,h=Number.POSITIVE_INFINITY;for(let b=0;b<l.length;b+=1){let S=nf(l[b],g);if(S>=h)continue;if(p=b,h=S,S===0)break}return p}function hc(l,g){let p=he(g);if(!p)return-1;return l.findIndex((h)=>he(h?.chat_jid)===p)}function Ee(l,g){let p=he(g).toLocaleLowerCase();if(!p)return l;let h=new Set(l.filter((S)=>mc(S,p)).map((S)=>he(S.chat_jid))),b=new Map(l.map((S)=>[he(S.branch_id),S]).filter(([S])=>Boolean(S)));for(let S of l){if(!h.has(he(S.chat_jid)))continue;let C=he(S.parent_branch_id);while(C){let L=b.get(C);if(!L)break;h.add(he(L.chat_jid)),C=he(L.parent_branch_id)}}return l.filter((S)=>h.has(he(S.chat_jid)))}function Ie(l,g,p=[]){let h=he(g),b=l.find((D)=>he(D.chat_jid)===h),S=he(b?.root_chat_jid)||h,C=new Set(Array.from(p,he).filter(Boolean)),L=new Map([["current",[]],["pinned",[]],["active",[]],["tree",[]],["other",[]],["archived",[]]]);for(let D of l){let T=he(D.chat_jid),O=Boolean(D.archived_at)?"archived":T===h?"current":Boolean(D.is_active)?"active":C.has(T)?"pinned":(he(D.root_chat_jid)||T)===S?"tree":"other";L.get(O).push(D)}return["current","active","pinned","tree","other","archived"].map((D)=>({key:D,label:ef[D],items:L.get(D).sort(Ve)})).filter((D)=>D.items.length>0)}function bc(l,g,p,h=8){if(g<=0)return 0;let b=Math.max(0,Math.min(l,g-1));if(p==="Home")return 0;if(p==="End")return g-1;if(p==="ArrowDown")return(b+1)%g;if(p==="ArrowUp")return(b-1+g)%g;if(p==="PageDown")return Math.min(g-1,b+h);if(p==="PageUp")return Math.max(0,b-h);return b}function yc(l={}){if(l.searchMode)return!1;return Boolean(l.showSessionSwitcherButton)}function wc(l,g,p={}){if(!l||l.isComposing)return!1;if(!yc(p))return!1;if(l.ctrlKey||l.metaKey||l.altKey)return!1;if(l.key!=="@")return!1;return String(g||"")===""}function Zs(l,g={}){if(!yc(g))return!1;return String(l||"")==="@"}function G(l){let g=ei(l);return g?`@${g}`:""}function ei(l){return String(l||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-")}function St(l,g=""){let p=String(l||""),h=ei(p),b=ei(g);if(!p.trim())return{normalized:h,handle:"",canSubmit:!1,kind:"error",message:"Enter a branch handle."};if(!h)return{normalized:h,handle:"",canSubmit:!1,kind:"error",message:"Handle must contain at least one letter or number."};let S=`@${h}`;if(h===b)return{normalized:h,handle:S,canSubmit:!1,kind:"info",message:`Already using ${S}.`};if(h!==p.trim())return{normalized:h,handle:S,canSubmit:!0,kind:"info",message:`Will save as ${S}. Letters, numbers, - and _ are allowed; leading @ is optional.`};return{normalized:h,handle:S,canSubmit:!0,kind:"success",message:`Saving as ${S}.`}}function Ke(l,g={}){let p=[],h=typeof g.currentChatJid==="string"?g.currentChatJid.trim():"",b=typeof l?.chat_jid==="string"?l.chat_jid.trim():"";if(h&&b===h)p.push("current");if(l?.archived_at)p.push("archived");else{if(l?.is_compacting||l?.activity_status==="compacting")p.push("compacting");if(l?.is_active)p.push("active")}return p}function vc(l){let g=G(l?.agent_name)||String(l?.chat_jid||"").trim(),p=typeof l?.chat_jid==="string"&&l.chat_jid.trim()?l.chat_jid.trim():"unknown-chat";return`${g} — ${p}`}function kt(l,g={}){let p=Ke(l,g);return p.length>0?`${vc(l)} • ${p.join(" • ")}`:vc(l)}function sr(l,g,p){let h=G(l),b=G(g),S=String(p||"").trim();if(h&&b&&h!==b)return`Restored archived ${h} as ${b} because ${h} is already in use.`;if(b)return`Restored ${b}.`;if(h)return`Restored ${h}.`;return`Restored ${S||"branch"}.`}function At({steerQueued:l=!1,pulsing:g=!1}={}){let p=["turn-dot"];if(l)p.push("turn-dot-queued");if(g)p.push("turn-dot-pulsing");return p.join(" ")}function ti({pulsing:l=!1}={}){let g=["compose-inline-status-dot"];if(l)g.push("compose-inline-status-dot-pulsing");return g.join(" ")}function Ge(l,{isLastActivity:g=!1,pendingRequest:p=!1}={}){if(p)return"dot";if(g)return"none";if(l?.type==="error")return"none";let h=typeof l?.type==="string"?l.type:"";if(Boolean(typeof l?.tool_name==="string"&&l.tool_name.trim()||l?.tool_args))return"spinner";if(l?.type==="intent")return"dot";if(h==="tool_call"||h==="tool_status"||h==="thinking"||h==="waiting")return"spinner";return"dot"}function ar(l,g={}){return Ge(l,g)==="dot"}var Sc=350;function rf(l){return String(l||"Connecting").replace(/[-_]+/g," ").replace(/^./,(g)=>g.toUpperCase())}function of(l,g={}){let p=typeof l==="string"&&l.trim()?l.trim():"connecting";if(p==="connected")return{show:!1,statusClass:"connected",label:"Connected",title:"Connection: Connected"};if(p!=="disconnected"){let L=rf(p);return{show:!0,statusClass:p,label:L,title:`Connection: ${L}`}}let h=Number.isFinite(Number(g?.delayMs))?Math.max(0,Number(g.delayMs)):Sc,b=Number.isFinite(Number(g?.nowMs))?Number(g.nowMs):Date.now(),S=Number.isFinite(Number(g?.disconnectedAtMs))?Number(g.disconnectedAtMs):b;return b-S>=h?{show:!0,statusClass:"disconnected",label:"Reconnecting",title:"Reconnecting"}:{show:!1,statusClass:"connecting",label:"Connecting",title:"Connecting"}}function $c(l,g={}){let p=Number.isFinite(Number(g?.delayMs))?Math.max(0,Number(g.delayMs)):Sc,[h,b]=t(null),[S,C]=t(()=>Date.now());return o(()=>{if(l==="disconnected"){let L=Date.now();b((D)=>D??L),C(L);return}b(null),C(Date.now())},[l]),o(()=>{if(l!=="disconnected"||h===null)return;let L=p-(Date.now()-h);if(L<=0)return;let D=0,T=0,F=setTimeout(()=>{if(typeof requestAnimationFrame!=="function"){C(Date.now());return}D=requestAnimationFrame(()=>{T=requestAnimationFrame(()=>{C(Date.now())})})},L);return()=>{if(clearTimeout(F),D)cancelAnimationFrame(D);if(T)cancelAnimationFrame(T)}},[l,h,p]),i(()=>of(l,{delayMs:p,disconnectedAtMs:h,nowMs:S}),[l,p,h,S])}function k({prefix:l="file",label:g,title:p,onRemove:h,onClick:b,removeTitle:S="Remove",icon:C="file"}){let L=`${l}-file-pill`,D=`${l}-file-name`,T=`${l}-file-remove`,F=C==="message"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>`:C==="folder"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>`:e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>`;return e`
    <span class=${L} title=${p||g} onClick=${b}>
      ${F}
      <span class=${D}>${g}</span>
      ${h&&e`
        <button
          class=${T}
          onClick=${(O)=>{O.preventDefault(),O.stopPropagation(),h()}}
          title=${S}
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `}
    </span>
  `}async function ni(l,g,p,h){if(typeof l!=="function")return!1;try{let b=await l(g);if(!b)return!1;return p(b),h?.(b),!0}catch(b){return!1}}var sf=0;function kc(l,g){return`compose-model-option-${l}-${encodeURIComponent(g)}`}function af(l){let g=[],p=J(l.contextWindow);if(p)g.push(p);if(l.reasoning)g.push("reasoning");return g.push(...l.variants.filter((h)=>h!=="stable").slice(0,2)),g}function xc({anchor:l=null,entries:g,loading:p=!1,switching:h=!1,onSelect:b,onTogglePin:S,onClose:C,onCompact:L,onOpenSettings:D,thinkingLevel:T=null,thinkingLevels:F=[],onSelectThinking:O,rootRef:z}){let[Z,Q]=t(""),[te,ee]=t(null),X=r(null),ne=r(new Map),W=r(null);if(W.current==null)W.current=++sf;let me=`compose-model-search-${W.current}`,Le=`compose-model-results-${W.current}`,be=i(()=>lr(g,{query:Z}),[g,Z]),He=i(()=>be.renderedEntries,[be]);o(()=>{X.current?.focus()},[]),o(()=>{if(He.some((Fe)=>Fe.key===te))return;let q=He.find((Fe)=>Fe.current);ee(q?.key??He[0]?.key??null)},[te,He]),o(()=>{ne.current.get(te)?.scrollIntoView?.({block:"nearest"})},[te]);let Kt=n((q)=>{if(!q||h)return;b(q)},[b,h]),cn=n((q)=>{if(q.isComposing)return;let Fe={ArrowDown:"next",ArrowUp:"previous",Home:"first",End:"last",PageDown:"page-next",PageUp:"page-previous"};if(q.key==="Escape"){q.preventDefault(),C();return}if(q.target!==X.current)return;if(q.key==="Enter"){let It=be.renderedEntries.find((We)=>We.key===te);if(It)if(q.preventDefault(),q.altKey)S?.(It);else Kt(It);return}let Wt=Fe[q.key];if(!Wt||(q.key==="Home"||q.key==="End")&&!q.ctrlKey&&!q.metaKey)return;q.preventDefault(),ee(ur(be.renderedEntries,te,Wt))},[te,Kt,C,S,be.renderedEntries]),Lr=(q)=>{let Fe=q.current,Wt=q.key===te,It=af(q);return e`
            <button
                id=${kc(W.current,q.key)}
                key=${q.key}
                type="button"
                role="option"
                aria-label=${`${q.displayName}, ${q.pinned?"pinned":"not pinned"}. Alt+Enter to ${q.pinned?"unpin":"pin"}.`}
                aria-keyshortcuts="Alt+Enter"
                aria-selected=${Fe?"true":"false"}
                tabIndex=${-1}
                class=${`compose-model-catalogue-option${Fe?" selected":""}${Wt?" focused":""}`}
                ref=${(We)=>We?ne.current.set(q.key,We):ne.current.delete(q.key)}
                onMouseDown=${(We)=>We.preventDefault()}
                onMouseEnter=${()=>ee(q.key)}
                onClick=${()=>Kt(q)}
            >
                <span
                    class=${`compose-model-catalogue-pin${q.pinned?" pinned":""}`}
                    aria-hidden="true"
                    title=${q.pinned?"Unpin model":"Pin model"}
                    onClick=${(We)=>{We.preventDefault(),We.stopPropagation(),ee(q.key),S?.(q)}}
                >${q.pinned?"★":"☆"}</span>
                <span class="compose-model-catalogue-option-content">
                    <span class="compose-model-catalogue-option-primary">
                        <span class="compose-model-catalogue-option-name">${q.displayName}</span>
                        ${le(q.pricing)&&e`<span class="compose-model-catalogue-option-price">${le(q.pricing)}</span>`}
                    </span>
                    ${q.displayName!==q.key&&e`<span class="compose-model-catalogue-option-key">${q.key}</span>`}
                    ${It.length>0&&e`
                        <span class="compose-model-catalogue-option-badges">
                            ${It.map((We)=>e`<span class="compose-model-catalogue-badge" key=${We}>${We}</span>`)}
                        </span>
                    `}

                </span>
            </button>
        `};return e`
        <div
            class=${`compose-model-popup compose-model-catalogue${l?" is-statusbar-anchored":""}`}
            style=${l?`--model-popup-left: ${l.left}px; --model-popup-bottom: ${l.bottom}px`:void 0}
            data-compose-model-catalogue="true"
            ref=${z}
            onKeyDown=${cn}
        >
            <div class="compose-model-catalogue-header">
                <label class="compose-model-catalogue-search-label" for=${me}>Search models</label>
                <div class="compose-model-catalogue-search-row">
                    <input
                        id=${me}
                        ref=${X}
                        class="compose-model-catalogue-search"
                        type="search"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls=${Le}
                        aria-activedescendant=${te?kc(W.current,te):void 0}
                        placeholder="Search models…"
                        value=${Z}
                        onInput=${(q)=>Q(q.currentTarget.value)}
                    />
                    ${Z&&e`<button type="button" class="compose-model-catalogue-clear" onClick=${()=>Q("")} aria-label="Clear model search">×</button>`}
                </div>
                <div class="compose-model-catalogue-summary" aria-live="polite">
                    <span>${be.totalMatches} ${be.totalMatches===1?"model":"models"}</span>
                    ${p&&e`<span>Refreshing…</span>`}
                </div>
            </div>
            <div id=${Le} class="compose-model-popup-menu compose-model-catalogue-results" role="listbox" aria-label="Models">
                ${be.sections.map((q)=>e`
                    <section class=${`compose-model-catalogue-section ${`compose-model-catalogue-section--${q.key}`}`} key=${q.key} role="presentation">
                        <div class="compose-model-catalogue-section-heading" role="presentation">
                            <span>${q.label}</span><span>${q.totalCount}</span>
                        </div>
                        ${q.entries.map(Lr)}
                        ${q.groups.map((Fe)=>e`
                            <div class="compose-model-catalogue-group" key=${Fe.key} role="group" aria-label=${Fe.label}>
                                <div class="compose-model-catalogue-group-heading" role="presentation">
                                    <span>${Fe.label}</span><span>${Fe.totalCount}</span>
                                </div>
                                ${Fe.entries.map(Lr)}
                            </div>
                        `)}
                    </section>
                `)}
                ${be.totalMatches===0&&e`
                    <div class="compose-model-popup-empty">
                        ${p?"Loading models…":Z?`No models match “${Z}”.`:"No models available."}
                    </div>
                `}
                ${be.hiddenCount>0&&e`<div class="compose-model-catalogue-limit-note">Showing ${be.renderedEntries.length} of ${be.totalMatches}; refine your search to see more.</div>`}
            </div>
            <div class="compose-model-catalogue-footer">
                <div class="compose-model-catalogue-footer-start">
                    ${F.length>0&&e`
                        <label class="compose-model-catalogue-thinking">
                            <span>Thinking</span>
                            <select
                                aria-label="Thinking level"
                                value=${T||F[0]?.id||""}
                                disabled=${h||typeof O!=="function"}
                                onChange=${(q)=>O?.(q.currentTarget.value)}
                            >
                                ${F.map((q)=>e`<option key=${q.id} value=${q.id}>${q.label}</option>`)}
                            </select>
                        </label>
                    `}
                    ${L&&e`<button type="button" class="compose-model-popup-btn" onClick=${L}>Compact context</button>`}
                </div>
                ${D&&e`<button type="button" class="compose-model-popup-btn primary" onClick=${D}>Open Models settings</button>`}
            </div>
        </div>
    `}function cf(l={}){let g=l.navigator??(typeof navigator<"u"?navigator:null);if(!g)return!1;let p=String(g.userAgent||"");if(/iPad|iPhone/.test(p))return!0;return g.platform==="MacIntel"&&Number(g.maxTouchPoints||0)>1}function lf(l={}){let g=l.window??(typeof window<"u"?window:null);if(!g)return null;return g.SpeechRecognition||g.webkitSpeechRecognition||null}function ri(l={}){let g=l.window??(typeof window<"u"?window:null),p=typeof l.secureContext==="boolean"?l.secureContext:Boolean(g?.isSecureContext),h=w(l),b=cf(l),S=lf(l);if(!p)return{mode:"unavailable",showButton:!1,canStart:!1,reason:"secure-context-required",title:"Voice input requires HTTPS",detail:"Native browser speech input needs a secure context (HTTPS or localhost).",recognitionCtor:null,ios:b,standalone:h,secureContext:p};if(b&&h)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-standalone-fallback",title:"Use keyboard dictation",detail:"Speech input is intentionally downgraded in iPhone/iPad standalone web apps because browser-native recognition is not reliable there. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:S,ios:b,standalone:h,secureContext:p};if(!S){if(b)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-keyboard-dictation",title:"Use keyboard dictation",detail:"This browser does not expose native in-page speech recognition here. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:null,ios:b,standalone:h,secureContext:p};return{mode:"unavailable",showButton:!1,canStart:!1,reason:"unsupported",title:"Voice input unavailable",detail:"This browser does not expose native speech recognition in this context.",recognitionCtor:null,ios:b,standalone:h,secureContext:p}}return{mode:"native",showButton:!0,canStart:!0,reason:"supported",title:"Start voice input",detail:b?"Browser-native speech input is available here, but Safari/WebKit reliability may still vary.":"Browser-native speech input is available.",recognitionCtor:S,ios:b,standalone:h,secureContext:p}}function _c(l,g="",p=""){let h=String(l||""),b=String(g||"").trim(),S=String(p||"").trim(),C=[b,S].filter(Boolean).join(" ").trim();if(!C)return h;if(!h)return C;let L=/[\s\n]$/.test(h)?"":" ";return`${h}${L}${C}`}function Ec(l,g=0){let p="",h="",b=l&&typeof l.length==="number"?l:[];for(let S=Math.max(0,g);S<b.length;S+=1){let C=b[S];if(!C||!C[0])continue;let L=String(C[0].transcript||"").trim();if(!L)continue;if(C.isFinal)p=`${p} ${L}`.trim();else h=`${h} ${L}`.trim()}return{finalText:p,interimText:h}}function oi(l,g=null){let p=String(l||"").trim().toLowerCase();switch(p){case"not-allowed":case"service-not-allowed":return g?.ios?"Microphone or speech-recognition permission was denied. On iPhone/iPad, using keyboard dictation may be more reliable.":"Microphone or speech-recognition permission was denied by the browser.";case"no-speech":return"No speech was detected. Try again and speak after the listening indicator appears.";case"audio-capture":return"The browser could not access a microphone for speech recognition.";case"network":return"The browser speech-recognition service reported a network or service failure.";case"aborted":return"Voice input was stopped.";default:return p?`Voice input failed (${p}).`:"Voice input failed."}}var uf=[{name:"/model",description:"Select model or list available models"},{name:"/cycle-model",description:"Cycle to the next available model"},{name:"/thinking",description:"Show or set thinking/effort level"},{name:"/effort",description:"Show or set thinking/effort level (alias for /thinking)"},{name:"/cycle-thinking",description:"Cycle thinking level"},{name:"/theme",description:"Set UI theme (no name to show available themes)"},{name:"/tint",description:"Tint default light/dark UI (usage: /tint #hex or /tint off)"},{name:"/btw",description:"Open a side conversation panel without interrupting the main chat"},{name:"/state",description:"Show current session state"},{name:"/stats",description:"Show session token and cost stats"},{name:"/context",description:"Show context window usage"},{name:"/quota",description:"Show cached provider quota / rate-limit usage"},{name:"/last",description:"Show last assistant response"},{name:"/compact",description:"Manually compact the session"},{name:"/auto-compact",description:"Toggle auto-compaction"},{name:"/auto-retry",description:"Toggle auto-retry"},{name:"/abort",description:"Abort the current response"},{name:"/abort-retry",description:"Abort retry backoff"},{name:"/abort-bash",description:"Abort running bash command"},{name:"/shell",description:"Run a shell command and return output"},{name:"/bash",description:"Run a shell command and add output to context"},{name:"/queue",description:"Queue a follow-up message (one-at-a-time)"},{name:"/queue-all",description:"Queue a follow-up message (batch all)"},{name:"/steer",description:"Steer the current response"},{name:"/steering-mode",description:"Set steering mode (all|one)"},{name:"/followup-mode",description:"Set follow-up mode (all|one)"},{name:"/session-name",description:"Set or show the session name"},{name:"/new-session",description:"Start a new session"},{name:"/switch-session",description:"Switch to a session file"},{name:"/session-rotate",description:"Rotate the current persisted session into an archived file"},{name:"/rollup",description:"Merge the current branch chat back into its parent chat"},{name:"/clone",description:"Duplicate the current active branch into a new session"},{name:"/fork",description:"Fork from a previous message"},{name:"/forks",description:"List forkable messages"},{name:"/tree",description:"List the session tree"},{name:"/label",description:"Set or clear a label on a tree entry"},{name:"/labels",description:"List labeled entries"},{name:"/agent-name",description:"Set or show the agent display name"},{name:"/agent-avatar",description:"Set or show the agent avatar URL"},{name:"/user-name",description:"Set or show your display name"},{name:"/user-avatar",description:"Set or show your avatar URL"},{name:"/user-github",description:"Set name/avatar from GitHub profile"},{name:"/export-html",description:"Export session to HTML"},{name:"/passkey",description:"Manage passkeys (enrol/list/delete)"},{name:"/totp",description:"Show a TOTP enrolment QR code"},{name:"/qr",description:"Generate a QR code for text or URL"},{name:"/search",description:"Search notes and skills in the workspace"},{name:"/dream",description:"Run Dream memory maintenance over recent days (default 7)"},{name:"/tasks",description:"List scheduled tasks"},{name:"/scheduled",description:"List scheduled tasks"},{name:"/pair",description:"Manage remote peer connections (/pair request <url> | /pair list)"},{name:"/ask",description:"Send a prompt to a paired remote instance (/ask <instance_id|fingerprint> <prompt>)"},{name:"/restart",description:"Restart the agent and stop subprocesses"},{name:"/exit",description:"Exit the current piclaw process immediately (Supervisor will restart it)"},{name:"/login",description:"Login to an AI model provider (OAuth or API key)"},{name:"/logout",description:"Logout from an AI model provider"},{name:"/settings",description:"Open the settings pane"},{name:"/help",description:"Open keyboard shortcuts help"},{name:"/commands",description:"List available commands"},{name:"/skill:",description:"Run a workspace skill (e.g. /skill:visual-artifact-generator, /skill:web-search)"}],Cc="piclaw_compose_history",si="piclaw_compose_height",df=50,Ac=70,Rc=300,Pc=520;function Dc(){if(typeof window>"u")return Ac;return window.innerWidth>=1024?Ac:df}function pf(){if(typeof window>"u")return Rc;return Math.min(Math.floor(window.innerHeight*0.4),Rc)}function ff(){if(typeof window>"u")return Pc;return Math.min(Math.floor(window.innerHeight*0.5),Pc)}function ii(l){let g=Dc(),p=Math.max(g,ff());return Math.min(Math.max(Math.round(Number(l)||g),g),p)}function mf(l=null,g=si){let p=l?.getItem?.(g)??f(g);if(!p)return null;let h=parseInt(p,10);return Number.isFinite(h)?ii(h):null}function gf(l,g,p=!1){if(p)return{shouldApply:!1,nextToken:g,text:""};if(!l||typeof l!=="object")return{shouldApply:!1,nextToken:g,text:""};let h=typeof l.token==="string"?l.token:"",b=typeof l.text==="string"?l.text:"";if(!h||h===g||!b.trim())return{shouldApply:!1,nextToken:g,text:""};return{shouldApply:!0,nextToken:h,text:b}}function hf(l="web:default"){let g=typeof l==="string"&&l.trim()?l.trim():"web:default";if(g==="web:default")return Cc;return`${Cc}:${encodeURIComponent(g)}`}function se(l,g=null,p=null){let h=new Set,b=p instanceof Set?p:new Set(Array.isArray(p)?p:[]),S=[];for(let C of Array.isArray(l)?l:[]){let L=typeof C?.chat_jid==="string"?C.chat_jid.trim():"";if(!L||h.has(L)||b.has(L))continue;if(!(typeof C?.agent_name==="string"?C.agent_name.trim():""))continue;h.add(L),S.push(C)}return S.sort((C,L)=>{let D=Boolean(C?.archived_at),T=Boolean(L?.archived_at);if(D!==T)return D?1:-1;let F=String(C?.agent_name||"").trim(),O=String(L?.agent_name||"").trim(),z=F.localeCompare(O,void 0,{sensitivity:"base"});if(z!==0)return z;let Z=String(C?.chat_jid||"").trim(),Q=String(L?.chat_jid||"").trim();return Z.localeCompare(Q,void 0,{sensitivity:"base"})}),S}function bf(l){return Boolean(l?.is_active&&!l?.archived_at)}function yf(l,g=null){let p=Array.isArray(l)?l:[],h=typeof g==="string"?g.trim():"";if(h){let S=p.findIndex((C)=>{if(C?.disabled)return!1;if(C?.type!=="session")return!1;return(typeof C?.chat?.chat_jid==="string"?C.chat.chat_jid.trim():"")===h});if(S>=0)return S}let b=p.findIndex((S)=>!S?.disabled);return b>=0?b:0}function Lc(l,g){let p=typeof g?.command?.message==="string"?g.command.message.trim():"";if(!g?.ui_only||!p)return null;let h=typeof l==="string"?l.trim():"";if(!h.startsWith("/"))return null;let b=h.split(/\s+/).filter(Boolean),S=b[0]?.toLowerCase()||"";if(!(b.length>1)&&(S==="/thinking"||S==="/effort"))return p;return null}function wf(l,g,p=!1){if(l)return{mode:"queue",className:"icon-btn send-btn queue-mode",title:"Queue follow-up (Enter)",ariaLabel:"Queue follow-up message",disabled:!g};return{mode:"send",className:"icon-btn send-btn",title:"Send (Enter)",ariaLabel:"Send message",disabled:!g}}function Tc(l,g,p={}){if(!l||p.searchMode)return!1;if(!(l.key===" "||l.key==="Spacebar"||l.code==="Space"))return!1;if(l.ctrlKey||l.metaKey||l.altKey||l.repeat)return!1;if(!p.speechButtonVisible||p.speechButtonActive)return!1;if(!p.canStartSpeech)return!1;return String(g||"").trim().length===0}function vf(l,g){if(!g||!l)return!1;return l.key===" "||l.key==="Spacebar"||l.code==="Space"}function Sf(l,g=!1){if(!l)return null;if(g)return{mode:"compacting",className:"icon-btn send-btn abort-mode compacting-mode",title:"Compacting context — Stop response",ariaLabel:"Compacting context — Stop response",disabled:!1};return{mode:"abort",className:"icon-btn send-btn abort-mode",title:"Stop response",ariaLabel:"Stop response",disabled:!1}}function $f(l){return l==="abort"||l==="compacting"}function kf(l,g=0){if(l?.visible===!1)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};let p=typeof l?.message==="string"&&l.message.trim()?l.message.trim():null,h=l?.indicator&&typeof l.indicator==="object"?l.indicator:null;if(!p&&!h)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};if(h?.mode==="hidden")return{visible:Boolean(p),title:p||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!1};if(h?.mode==="custom"&&Array.isArray(h.frames)&&h.frames.length>0){let b=h.frames,S=Number.isFinite(g)&&g>=0?Math.floor(g)%b.length:0;return{visible:!0,title:p||"Thinking…",indicatorText:b[S],animateDot:!1,animateSpinner:!1}}return{visible:!0,title:p||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!0}}function xf({usage:l,onCompact:g,compactionLabel:p="",compactionTitle:h=""}){let b=Number.isFinite(l.percent)?Math.min(100,Math.max(0,l.percent)):null,S=Number.isFinite(l.tokens)&&l.tokens>=0?l.tokens:null,C=Number.isFinite(l.contextWindow)&&l.contextWindow>0?l.contextWindow:null,L=typeof g==="function",D=L?"Compact context":"Context usage",T=b==null?"unavailable":`${b.toFixed(0)}%`,F=`Context: ${vo(S)} / ${vo(C)} tokens (${T})`,O=typeof p==="string"?p.trim():"",z=typeof h==="string"?h.trim():"",Z=O?`${F}
${z||"Smart compaction"} · ${O}`:`${F}
${D}`,Q=9,te=2*Math.PI*9,ee=(b??0)/100*te,X=b==null?"var(--text-secondary)":b>90?"var(--context-red, #ef4444)":b>75?"var(--context-amber, #f59e0b)":"var(--context-green, #22c55e)";return e`
        <button
            class=${`compose-context-pie icon-btn${O?" is-compacting":""}`}
            type="button"
            title=${Z}
            aria-label=${Z}
            disabled=${!L}
            onClick=${(ne)=>{if(ne.preventDefault(),ne.stopPropagation(),L)g()}}
        >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r=${9}
                    fill="none"
                    stroke="var(--context-track, rgba(128,128,128,0.2))"
                    stroke-width="2.5" />
                <circle cx="12" cy="12" r=${9}
                    fill="none"
                    stroke=${X}
                    stroke-width="2.5"
                    stroke-dasharray=${`${ee} ${te}`}
                    stroke-linecap="round"
                    transform="rotate(-90 12 12)" />
            </svg>
            ${O&&e`<span class="compose-context-pie-timer">${O}</span>`}
        </button>
    `}function vo(l){if(l==null)return"?";if(l>=1e6)return(l/1e6).toFixed(1)+"M";if(l>=1000)return(l/1000).toFixed(0)+"K";return String(l)}function jt(l){if(l==null)return null;let g=Number(l);return Number.isFinite(g)?g:null}function _f(l){if(!l||typeof l!=="object")return null;let g=jt(l.cacheHitRate);if(g!=null)return g;let p=jt(l.inputTokens)??0,h=jt(l.cacheReadTokens)??0,b=jt(l.cacheWriteTokens)??0,S=p+h+b;if(l.cacheReadReported===!1||S<=0)return null;if(h<=0&&l.cacheReadReported!==!0)return null;return h/S*100}function Ef(l){let g=jt(l);if(g==null)return null;return`${Math.max(0,Math.min(100,g)).toFixed(1)}%`}function Kn(l,g){let p=jt(g);return p!=null?`${l} ${vo(p)}`:null}function yo(l,g="USD"){let p=jt(l);if(p==null||p<0)return null;let h=p.toFixed(p>=0.01?2:4);return g==="USD"?`$${h}`:g?`${g} ${h}`:`${h} (currency unknown)`}function Cf(l){if(l?.provider!=="openrouter"||l?.availability!=="available")return null;return[`Key spend: ${yo(l.key_usage_usd)||"unavailable"}`,`Key limit: ${l.key_limit_configured===!0?yo(l.key_limit_usd)||"unavailable":l.key_limit_unlimited?"not configured (unlimited)":"unavailable"}`,`Key remaining: ${yo(l.key_limit_remaining_usd)||"unavailable"}`].join(" • ")}function Af(l,g=null){let p=l&&typeof l==="object"?l.cacheUsage:null;if(!p||typeof p!=="object")return null;let h=p.latest&&typeof p.latest==="object"?p.latest:null;if(!h)return null;let b=typeof h.provider==="string"&&h.provider.trim()?h.provider.trim():null,S=typeof h.model==="string"&&h.model.trim()?h.model.trim():null,C=S?!b||S.startsWith(`${b}/`)?S:`${b}/${S}`:b,L=typeof h.responseModel==="string"&&h.responseModel.trim()?h.responseModel.trim():null,D=ai(g,C),T=Boolean(g&&C&&!D),F=_f(h),O=Ef(F),z=O?`CH${O}`:"CH—",Z=jt(h.totalTokens),Q=yo(h.costTotal,h.costProvenance==="provider_reported"?h.providerCostCurrency??null:"USD"),te=typeof h.costProvenance==="string"?h.costProvenance:null,ee=te==="provider_reported"?Q:te==="catalogue_estimate"&&Q?`~${Q}`:null,X=T?"Prev":"Last",ne=[Kn("in",h.inputTokens),Kn("out",h.outputTokens),Kn("reason",h.reasoningTokens),Kn("cache-r",h.cacheReadTokens),Kn("cache-w",h.cacheWriteTokens),Kn("total",h.totalTokens)].filter(Boolean).join(", "),W=te==="provider_reported"&&Q?`Provider-reported cost: ${Q}`:te==="catalogue_estimate"&&Q?`Catalogue cost estimate: ~${Q}`:"Cost unavailable",me=O?`Prompt cache hit: ${O}`:h.cacheReadReported===!1?"Prompt cache telemetry unavailable":"Prompt cache hit unavailable",Le=[`${T?"Previous":"Latest"} run${C?`: ${C}`:""}`,L&&L!==h.model?`Response model: ${L}`:null,ne||null,me,W].filter(Boolean);return{label:[T?X:null,Z==null?null:vo(Z),z,ee].filter(Boolean).join(" • "),title:Le.join(" • "),cacheHitRate:F,costTotal:jt(h.costTotal),costProvenance:te,requestedModel:C,responseModel:L,isPreviousModel:T}}function Rf(l){if(!l||typeof l!=="object")return"Price unknown";let g=[["in",l.input_per_million??l.inputPerMillion],["out",l.output_per_million??l.outputPerMillion],["cache-r",l.cache_read_per_million??l.cacheReadPerMillion],["cache-w",l.cache_write_per_million??l.cacheWritePerMillion]].map(([p,h])=>{let b=jt(h);if(b==null||b<0)return null;return`${p} $${b.toFixed(b>=1?2:4).replace(/0+$/,"").replace(/\.$/,"")}`}).filter(Boolean);return g.length>0?`${g.join(" / ")} per 1M`:"Price unknown"}function bo(l,g){let p=y(g);return P(l,{...ce(p)})}function Pf(l){let g=Array.isArray(l?.model_options)&&l.model_options.length>0;return P(l).map((p)=>({label:p.key,provider:p.provider,id:p.id,name:p.displayName===p.key?null:p.displayName,contextWindow:p.contextWindow,pricing:p.pricing,reasoning:g?p.reasoning:null,...p.current?{current:!0}:{}}))}function Lf(l,g){let p=typeof l==="string"?l.trim():"";if(p)return{showPicker:!0,label:p,hasAvailableModels:!0};let h=Pf(g).length>0||Number(g?.available_model_count)>0;return{showPicker:h,label:h?"Select model":"",hasAvailableModels:h}}function wo(l){return(typeof l==="string"?l.trim():"")||null}function So(l){return wo(l)?.toLowerCase()??null}function jc(l,g){let p=So(l),h=So(g);if(!p||!h)return!1;return p===h||p.endsWith(`/${h}`)||h.endsWith(`/${p}`)}function ai(l,g){let p=So(l),h=So(g);if(!p||!h)return!1;return p.includes("/")&&h.includes("/")?p===h:jc(p,h)}function Tf(l,g){let p=g&&typeof g==="object"?g:{},h=wo(p.latest_response_model??p.response_model??p.responseModel??p.routed_model??p.routedModel);if(!h)return null;let b=wo(p.latest_requested_model??p.requested_model??p.requestedModel??p.current??p.model??l);if(b&&jc(h,b))return null;let S=wo(l??p.current??p.model);if(S&&b&&!ai(S,b))return null;return{label:`Routed: ${h}`,title:b?`Requested model: ${b} • Routed model: ${h}`:`Routed model: ${h}`,requestedModel:b,responseModel:h}}function Mf(l){if(!l)return l;let g=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!g.includes(" @ ")||!g.includes(`:
`))return l;let p=g.split(`
`),h=[],b=0,S=!1;while(b<p.length){let L=p[b].trim();if(!L){b+=1;continue}if(L==="Messages:"||L.startsWith("Channel:")||L.startsWith("Chat:")){S=!0,b+=1;continue}if(/^[^\n]+\s@\s[^\n]+:$/.test(L)){S=!0,b+=1;let D=[];while(b<p.length){let T=p[b],F=T.trim();if(/^[^\n]+\s@\s[^\n]+:$/.test(F))break;if(F.startsWith("Channel:")||F.startsWith("Chat:")||F==="Messages:")break;D.push(T.startsWith("  ")?T.slice(2):T),b+=1}if(D.length>0)h.push(D.join(`
`).trim());continue}return l}return S&&h.length>0?h.filter(Boolean).join(`

`):l}function Ic(l){let g=String(l||"").trim(),p=g.match(/^`([^`]+)`$/);return(p?p[1]:g).trim()}function Df(l){if(!l)return{content:l,fileRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),h=-1;for(let T=0;T<p.length;T+=1)if(p[T].trim()==="Files:"&&p[T+1]&&/^\s*-\s+/.test(p[T+1])){h=T;break}if(h===-1)return{content:l,fileRefs:[]};let b=[],S=h+1;for(;S<p.length;S+=1){let T=p[S];if(/^\s*-\s+/.test(T)){let F=Ic(T.replace(/^\s*-\s+/,"").trim());if(F)b.push(F)}else if(!T.trim())break;else break}if(b.length===0)return{content:l,fileRefs:[]};let C=p.slice(0,h),L=p.slice(S);return{content:[...C,...L].join(`
`).replace(/\n{3,}/g,`

`).trim(),fileRefs:b}}function jf(l){if(!l)return{content:l,folderRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),h=-1;for(let T=0;T<p.length;T+=1)if(p[T].trim()==="Folders:"&&p[T+1]&&/^\s*-\s+/.test(p[T+1])){h=T;break}if(h===-1)return{content:l,folderRefs:[]};let b=[],S=h+1;for(;S<p.length;S+=1){let T=p[S];if(/^\s*-\s+/.test(T)){let F=Ic(T.replace(/^\s*-\s+/,"").trim());if(F)b.push(F)}else if(!T.trim())break;else break}if(b.length===0)return{content:l,folderRefs:[]};let C=p.slice(0,h),L=p.slice(S);return{content:[...C,...L].join(`
`).replace(/\n{3,}/g,`

`).trim(),folderRefs:b}}function If(l){if(!l)return{content:l,messageRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),h=-1;for(let T=0;T<p.length;T+=1)if(p[T].trim()==="Referenced messages:"&&p[T+1]&&/^\s*-\s+/.test(p[T+1])){h=T;break}if(h===-1)return{content:l,messageRefs:[]};let b=[],S=h+1;for(;S<p.length;S+=1){let T=p[S];if(/^\s*-\s+/.test(T)){let F=T.replace(/^\s*-\s+/,"").trim().match(/^message:(\S+)$/i);if(F)b.push(F[1])}else if(!T.trim())break;else break}if(b.length===0)return{content:l,messageRefs:[]};let C=p.slice(0,h),L=p.slice(S);return{content:[...C,...L].join(`
`).replace(/\n{3,}/g,`

`).trim(),messageRefs:b}}function Nf(l){if(!l)return{content:l,attachmentRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),h=-1;for(let T=0;T<p.length;T+=1)if(p[T].trim()==="Attachments:"&&p[T+1]&&/^\s*-\s+/.test(p[T+1])){h=T;break}if(h===-1)return{content:l,attachmentRefs:[]};let b=[],S=h+1;for(;S<p.length;S+=1){let T=p[S];if(/^\s*-\s+/.test(T)){let F=T.replace(/^\s*-\s+/,"").trim(),O=F.match(/^attachment:(\d+)(?:\s*\((.+)\))?$/i);if(O)b.push({id:O[1],label:(O[2]||"").trim()||`attachment:${O[1]}`,raw:F})}else if(!T.trim())break;else break}if(b.length===0)return{content:l,attachmentRefs:[]};let C=p.slice(0,h),L=p.slice(S);return{content:[...C,...L].join(`
`).replace(/\n{3,}/g,`

`).trim(),attachmentRefs:b}}function Nc(l){let g=Mf(l||""),p=Df(g||""),h=jf(p.content||""),b=If(h.content||""),S=Nf(b.content||"");return{text:S.content||"",fileRefs:p.fileRefs,folderRefs:h.folderRefs,messageRefs:b.messageRefs,attachmentRefs:S.attachmentRefs}}function Ff(l){let g=Nc(l),p=g.attachmentRefs.length>0?`Attachments:
${g.attachmentRefs.map((b)=>`- ${b.raw}`).join(`
`)}`:"";return{content:[String(g.text||"").trim(),p].filter(Boolean).join(`

`).trim(),fileRefs:[...g.fileRefs],folderRefs:[...g.folderRefs],messageRefs:[...g.messageRefs],attachmentRefs:[...g.attachmentRefs]}}async function Bf(l){let{queuedItem:g,buildDraft:p=Ff,onRemoveQueuedFollowup:h,setSubmitError:b,setSubmitNotice:S,setMediaFiles:C,onSetFileRefs:L,onSetFolderRefs:D,onSetMessageRefs:T,setContent:F,textareaRef:O,resizeTextarea:z=()=>{},scheduleRaf:Z=(W)=>requestAnimationFrame(W),isCurrent:Q=()=>!0,canRestoreDraft:te=()=>!0,logger:ee=console}=l||{};if(!g||!Q()||typeof h!=="function")return!1;let X=p(g?.content||"");try{if(await h(g)!==!0)return!1}catch(W){return ee?.warn?.("[compose-box] Failed to remove returned queued follow-up.",W),!1}if(!Q())return!1;if(!te())return S?.("Queued message removed; existing draft preserved."),!1;let ne=X.content;return ee?.info?.("[compose-box] Returning queued item to editor",{text:ne?.slice(0,80),fileRefs:X.fileRefs?.length,folderRefs:X.folderRefs?.length,messageRefs:X.messageRefs?.length}),b?.(null),S?.(null),C?.([]),L?.(X.fileRefs),D?.(X.folderRefs),T?.(X.messageRefs),F?.(ne),Z(()=>{let W=O?.current;if(!Q()||!W)return;if(W.value=ne,typeof W.dispatchEvent==="function")W.dispatchEvent(new Event("input",{bubbles:!0}));z();let me=ne.length;W.selectionStart=me,W.selectionEnd=me,W.focus()}),!0}function Of({items:l=[],onInjectQueuedFollowup:g,onRemoveQueuedFollowup:p,onMoveQueuedFollowup:h,onReturnQueuedFollowup:b,onOpenFilePill:S}){let{t:C}=s(),L=r(new Set),[D,T]=t(()=>new Set),F=async(O)=>{let z=O.row_id;if(L.current.has(z)||!g)return;L.current.add(z),T(new Set(L.current));try{await g(O)}finally{L.current.delete(z),T(new Set(L.current))}};if(!Array.isArray(l)||l.length===0)return null;return e`
        <div class="compose-queue-stack">
            ${l.map((O,z)=>{let Z=typeof O?.content==="string"?vt(O.content):"",Q=Nc(Z);if(!Q.text.trim()&&Q.fileRefs.length===0&&Q.folderRefs.length===0&&Q.messageRefs.length===0&&Q.attachmentRefs.length===0)return null;let te=O?.mode==="steer",ee=D.has(O.row_id),X=!ee&&z>0&&l[z-1]?.mode==="steer"===te,ne=!ee&&z<l.length-1&&l[z+1]?.mode==="steer"===te,W=!0;return e`
                    <div class=${`compose-queue-stack-item${te?" is-steering":""}`} data-testid="queue-item" data-queue-mode=${te?"steer":"followUp"} role="listitem">
                        <div class="compose-queue-stack-content" title=${Z}>
                            ${te&&e`<div class="compose-queue-stack-mode">${C("compose.queueSteering")}</div>`}
                            ${Q.text.trim()&&e`<div class="compose-queue-stack-text">${Q.text}</div>`}
                            ${(Q.messageRefs.length>0||Q.fileRefs.length>0||Q.folderRefs.length>0||Q.attachmentRefs.length>0)&&e`
                                <div class="compose-queue-stack-refs">
                                    ${Q.messageRefs.map((me)=>e`
                                        <${k}
                                            key=${"queue-msg-"+me}
                                            prefix="compose"
                                            label=${"msg:"+me}
                                            title=${"Message reference: "+me}
                                            icon="message"
                                        />
                                    `)}
                                    ${Q.fileRefs.map((me)=>{let Le=me.split("/").pop()||me;return e`
                                            <${k}
                                                key=${"queue-file-"+me}
                                                prefix="compose"
                                                label=${Le}
                                                title=${me}
                                                onClick=${()=>S?.(me)}
                                            />
                                        `})}
                                    ${Q.folderRefs.map((me)=>{let Le=me.split("/").pop()||me;return e`
                                            <${k}
                                                key=${"queue-folder-"+me}
                                                prefix="compose"
                                                label=${Le}
                                                title=${me}
                                                icon="folder"
                                                onClick=${()=>S?.(me)}
                                            />
                                        `})}
                                    ${Q.attachmentRefs.map((me)=>e`
                                        <${k}
                                            key=${"queue-attachment-"+me.id}
                                            prefix="compose"
                                            label=${me.label}
                                            title=${me.raw}
                                        />
                                    `)}
                                </div>
                            `}
                        </div>
                        <div class="compose-queue-stack-actions" role="group" aria-label=${C("compose.queueControls")}>
                            ${l.length>1&&e`
                                <button
                                    class="compose-queue-stack-move-btn"
                                    data-action="move-up"
                                    type="button"
                                    title=${C("compose.moveUp")}
                                    aria-label=${C("compose.moveUpQueue")}
                                    disabled=${!X}
                                    onClick=${()=>X&&h?.(z,z-1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="18 15 12 9 6 15"></polyline>
                                    </svg>
                                </button>
                                <button
                                    class="compose-queue-stack-move-btn"
                                    data-action="move-down"
                                    type="button"
                                    title=${C("compose.moveDown")}
                                    aria-label=${C("compose.moveDownQueue")}
                                    disabled=${!ne}
                                    onClick=${()=>ne&&h?.(z,z+1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </button>
                            `}
                            ${W&&e`
                                <button
                                    class="compose-queue-stack-move-btn queue-edit"
                                    data-action="edit"
                                    type="button"
                                    title=${C("compose.editInCompose")}
                                    aria-label=${C("compose.returnToEditor")}
                                    disabled=${ee}
                                    onClick=${(me)=>{me.stopPropagation(),b?.(O)}}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                </button>
                            `}
                            ${!te&&e`<button
                                class="compose-queue-stack-steer-btn"
                                type="button"
                                title=${C("compose.injectSteer")}
                                aria-label=${C("compose.injectSteer")}
                                aria-busy=${ee?"true":void 0}
                                disabled=${ee}
                                onClick=${()=>void F(O)}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h12a2 2 0 0 0 2-2V8" />
                                    <polyline points="14 12 18 8 22 12" />
                                </svg>
                                <span>${C(ee?"compose.requestingSteer":"compose.steer")}</span>
                            </button>`}
                            <button
                                class="compose-queue-stack-close-btn queue-remove"
                                data-action="remove"
                                type="button"
                                title=${C("compose.cancelQueued")}
                                aria-label=${C("compose.cancelQueued")}
                                disabled=${ee}
                                onClick=${()=>p?.(O)}
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
    `}var Mc=Object.freeze([]);function Je({onPost:l,onFocus:g,searchMode:p,searchScope:h="current",onSearch:b,onSearchScopeChange:S,onEnterSearch:C,onExitSearch:L,fileRefs:D=[],onRemoveFileRef:T,onClearFileRefs:F,folderRefs:O=[],onRemoveFolderRef:z,onClearFolderRefs:Z,messageRefs:Q=[],onRemoveMessageRef:te,onClearMessageRefs:ee,activeModel:X=null,agentModelsPayload:ne=null,modelUsage:W=null,thinkingLevel:me=null,supportsThinking:Le=!1,contextUsage:be=null,onContextCompact:He,notificationsEnabled:Kt=!1,notificationPermission:cn="default",onToggleNotifications:Lr,onModelChange:q,onModelStateChange:Fe,activeEditorPath:Wt=null,onAttachEditorFile:It,onOpenFilePill:We,followupQueueItems:Fc=[],onInjectQueuedFollowup:Bc,onRemoveQueuedFollowup:$o,onMoveQueuedFollowup:Oc,onSubmitIntercept:Hc,onMessageResponse:ci,isAgentActive:Wn=!1,activeChatAgents:pt=Mc,currentChatJid:de="web:default",connectionStatus:zc="connected",stateAccessFailed:qc=!1,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,onSubmitError:Eo,onSwitchChat:Co,onRenameSession:Ao,isRenameSessionInProgress:li=!1,onCreateSession:Ro,onCreateRootSession:Po,onDeleteSession:ln,onPurgeArchivedSession:Lo,onRestoreSession:To,showQueueStack:Gc=!0,statusNotice:Nt=null,extensionWorkingState:Tr=null,prefillRequest:ui=null,draftValue:Dn=void 0,services:Mo=null,capabilities:Do=null,storageNamespace:Mr="",preferenceRuntime:di=void 0,onContentChange:Kc,onSubmissionStateChange:pi,disabled:jo=!1,onJumpToLatest:Io,timelineAway:Wc=!1,timelineHasNew:fi=!1,inputId:Uc,sendButtonId:Yc}){let[we,ft]=t(()=>typeof Dn==="string"?Dn:""),{t:ge}=s(),un=Mo&&typeof Mo==="object"?Mo:{},at=Do&&typeof Do==="object"?Do:{},No=un.sendAgentMessage??E,Fo=un.getAgentModels??Y,Vc=un.uploadMedia??wr,Jc=un.fetchCommands??((m)=>fetch(`/agent/commands?chat_jid=${encodeURIComponent(m)}`).then((_)=>_.ok?_.json():null)),Un=un.browserStorage&&typeof un.browserStorage==="object"?un.browserStorage:{getItem:f,setItem:c},jn=at.persistBrowserState!==!1,Ye=di===void 0?typeof window<"u"?window:null:di,Ut=Ye,Bo=at.commands!==!1,Oo=at.mentions!==!1,dn=at.media!==!1,Qc=at.search!==!1,Xc=at.location!==!1,Dr=at.speech!==!1,Zc=at.notifications!==!1,el=at.modelPicker!==!1,Ho=at.modelSettings!==!1,mi=at.modelCompaction!==!1,tl=at.sessionRollup!==!1,[pn,gi]=t(""),[zo,nl]=t(!1),[qo,rl]=t(!1),[jr,Go]=t("or"),[fn,mn]=t([]),[Ft,Ko]=t(null),[hi,bi]=t(!1),[ol,sl]=t(null),Yt=r(null);if(!Yt.current)Yt.current=new Vs(sl);o(()=>{let m=Yt.current;return m.reset(),()=>m.reset()},[de]);let[il,Ir]=t(!1),[Bt,nt]=t([]),[Nr,Fr]=t(0),[Vn,rt]=t(!1),Wo=r(null),[Vt,ct]=t([]),[Uo,Br]=t(0),[cr,lt]=t(!1),[Jt,Yo]=t(!1),[Ze,Sn]=t(!1),[xe,De]=t(!1),[$t,Or]=t(""),[dr,yi]=t(()=>B(Ut).pinnedChatJids),[al,Vo]=t(null),[cl,Jo]=t(null),[wi,vi]=t(()=>new Set),Qo=r(new Set),_t=r(de),Xo=r(ne),Lt=r(0),pr=r(0);_t.current=de,Xo.current=ne;let[ll,In]=t([]);o(()=>{let m=()=>{let _=y(Ye),R=new Set(_.pinnedKeys);In((I)=>I.map((N)=>({...N,pinned:R.has(N.key),lastUsedAt:_.recentByKey[N.key]??null})))};if(Ye?.addEventListener?.(ae,m),typeof window<"u"&&Ye===window)window.addEventListener("storage",m);return()=>{if(Ye?.removeEventListener?.(ae,m),typeof window<"u"&&Ye===window)window.removeEventListener("storage",m)}},[ne,Ye]),o(()=>{let m=()=>{yi(B(Ut).pinnedChatJids)};if(Ut?.addEventListener?.(ke,m),typeof window<"u"&&Ut===window)window.addEventListener("storage",m);return()=>{if(Ut?.removeEventListener?.(ke,m),typeof window<"u"&&Ut===window)window.removeEventListener("storage",m)}},[Ut]),o(()=>{let m=(_)=>{let R=_?.detail;if(R?.source==="compose")return;if(R?.chatJid&&R.chatJid!==de)return;let I=R?.payload;if(!I||typeof I!=="object")return;let N=I.model??I.current;if(In(bo(I,Ye)),Fe?.({...I,model:N??null}),N)q?.(N)};return window.addEventListener("piclaw:model-state-changed",m),()=>window.removeEventListener("piclaw:model-state-changed",m)},[de,Ye,q,Fe]),o(()=>{Lt.current+=1,pr.current+=1,Yo(!1)},[de]);let[ul,dl]=t(null),Si=r(null),Nn=r([]),Qt=n((m)=>{let _=m?.key??null;Si.current=_,dl(_)},[]),[pl,$i]=t(!1),[ki,xi]=t(!1),[,fl]=t(0),_i=r(de);_i.current=de;let[Ei,qe]=t(null),[Ci,Xt]=t(null),[Be,ml]=t(()=>Dr?ri():{showButton:!1,canStart:!1}),[Et,Tt]=t({kind:"idle",title:"",detail:""}),[gl,Ai]=t(()=>Date.now()),[hl,Ri]=t(0),fe=r(null),Zo=Mr?`${Mr}:${si}`:si,fr=r(jn?mf(Un,Zo):null),es=r(null),ts=r(null),Pi=r(null),br=r(null),Hr=r(null),Li=r([]),zr=r(null),ns=r(null),Zt=r({value:"",updatedAt:0}),[,bl]=t(0);o(()=>fo(()=>bl((m)=>m+1)),[]);let qr=r(null);qr.current={read:()=>({text:fe.current?.value??we,chatJid:de,selectionStart:fe.current?.selectionStart??we.length,selectionEnd:fe.current?.selectionEnd??we.length}),write:(m)=>{if(fe.current)fe.current.value=m;ft(m)},state:(m)=>Tt({kind:m==="recording"||m==="finishing"?"listening":m==="loading"?"requesting_permission":m==="error"?"error":"idle",title:m==="error"?"Dictation failed; draft preserved":m==="finishing"?"Finishing dictation":"",detail:""})};let Oe=r(null);if(!Oe.current)Oe.current=ic({read:()=>qr.current.read(),write:(m)=>qr.current.write(m),state:(m,_)=>qr.current.state(m,_),providerSelected:()=>{let m=Me.current;if(m)Me.current=null,m.abort?.(),Rt()}});o(()=>{Oe.current?.draftChanged()},[we,de]),o(()=>()=>{Oe.current?.dispose()},[]);let Me=r(null),Ti=r(""),en=r(""),tn=r(""),Gr=r(""),Kr=r(!1),Fn=r(!1),rs=r(!1),os=r(!1),ss=r(fn);ss.current=fn;let Wr=r(D),Ur=r(O),Yr=r(Q);Wr.current=D,Ur.current=O,Yr.current=Q;let yr=r(0),Vr=r(!1),Mi=200,vr=jn?`${Mr?`${Mr}:`:""}${hf(de)}`:"",Di=(m)=>{let _=new Set,R=[];for(let I of m||[]){if(typeof I!=="string")continue;let N=I.trim();if(!N||_.has(N))continue;_.add(N),R.push(N)}return R},ji=(m=vr)=>{if(!jn||!m)return[];let _=Un.getItem?.(m)??null;if(!_)return[];try{let R=JSON.parse(_);if(!Array.isArray(R))return[];return Di(R)}catch{return[]}},yl=(m,_=vr)=>{if(!jn||!_)return;Un.setItem?.(_,JSON.stringify(m))},Jr=r(ji(vr)),Bn=r(-1),Sr=r(""),Ii=r("");o(()=>{Jr.current=ji(vr),Bn.current=-1,Sr.current=""},[vr]),o(()=>{if(typeof Dn!=="string"||Dn===we)return;ft(Dn),requestAnimationFrame(()=>Ct())},[Dn]),o(()=>{Kc?.(we)},[we]),o(()=>{if(!p)return;fetch("/agent/settings-data").then((m)=>m.json()).then((m)=>{if(m?.searchMatchMode)Go(m.searchMatchMode)}).catch(()=>{Go((m)=>m||"or")})},[p]),o(()=>{let m=!1;if(!Bo)return Wo.current=[],()=>{m=!0};return Promise.resolve(Jc(de||"web:default")).then((R)=>{if(m||!R?.commands)return;Wo.current=R.commands.map((I)=>({name:I.name,description:I.description||""}))}).catch((R)=>{console.debug("[compose] failed to fetch dynamic commands",R)}),()=>{m=!0}},[de,Bo]),o(()=>{let m=gf(ui,Ii.current,p);if(!m.shouldApply)return;Ii.current=m.nextToken,qe(null),ft(m.text),ys(m.text),ws(m.text),requestAnimationFrame(()=>{Ct();let _=fe.current;if(!_)return;try{_.focus({preventScroll:!0})}catch{_.focus()}let R=m.text.length;_.setSelectionRange?.(R,R)})},[ui,p]),o(()=>{ml(Dr?ri():{showButton:!1,canStart:!1})},[Dr]);let wl=!jo&&(Oe.current?.active||we.trim()||fn.length>0||D.length>0||O.length>0||Q.length>0),vl=Et.kind!=="idle",Sl=Et.kind==="requesting_permission"||Et.kind==="listening",Qr=Oe.current?.selected,is=Dr&&!p&&Boolean(Qr||Be?.showButton),Xr=Et.kind==="requesting_permission"||Et.kind==="listening",Ni=Xr?"Stop voice input":Qr?"Voice input":Be?.title||"Voice input",$l=Xc&&typeof window<"u"&&typeof navigator<"u"&&Boolean(navigator.geolocation)&&Boolean(window.isSecureContext),kl=typeof window<"u"&&typeof Notification<"u",xl=typeof window<"u"?Boolean(window.isSecureContext):!1,_l=Zc&&kl&&xl&&cn!=="denied",Fi=cn==="granted"&&Kt,nn=H(Nt),Bi=bt(Nt),as=typeof Nt?.detail==="string"&&Nt.detail.trim()?Nt.detail.trim():"",cs=nn?$e(Nt,gl):null,On=kf(Tr,hl),Ot=Tr?.indicator&&typeof Tr.indicator==="object"?Tr.indicator:null,El=Fi?"Disable notifications":"Enable notifications",Cl=fn.length>0||D.length>0||O.length>0||Q.length>0,Zr=$c(qc?zc:"connected"),{label:Al,title:Rl}=Zr,Oi=wf(Wn,wl,nn),eo=hi?{...Oi,disabled:!0,title:Ft?"Uploading attachments…":"Sending…",ariaLabel:Ft?"Uploading attachments":"Sending message"}:Oi,$n=Sf(Wn,nn),Hi=i(()=>(Array.isArray(pt)?pt:Mc).filter((m)=>!m?.archived_at),[pt]),Ne=(()=>{for(let m of Array.isArray(pt)?pt:[]){let _=typeof m?.chat_jid==="string"?m.chat_jid.trim():"";if(_&&_===de)return m}return null})(),Pl=Boolean(Ne&&Ne.chat_jid===(Ne.root_chat_jid||Ne.chat_jid)),Ll=Boolean(Pl&&(Ne?.chat_jid||de)==="web:default"),Ht=(()=>{let m=typeof Ne?.parent_branch_id==="string"?Ne.parent_branch_id.trim():"",_=typeof Ne?.branch_id==="string"?Ne.branch_id.trim():"";if(!Ne||!m||!_||Ne.archived_at)return null;if((Array.isArray(pt)?pt:[]).filter((N)=>{let re=typeof N?.parent_branch_id==="string"?N.parent_branch_id.trim():"";return re&&re===_}).length>0)return null;return(Array.isArray(pt)?pt:[]).find((N)=>{let re=typeof N?.branch_id==="string"?N.branch_id.trim():"";return re&&re===m&&!N?.archived_at})||null})(),$r=i(()=>se(pt,de,wi),[pt,de,wi]),Tl=i(()=>new Set(dr),[dr]),ls=i(()=>Ee($r,$t),[$r,$t]),us=i(()=>Ie(ls,de,dr),[ls,de,dr]),ds=i(()=>us.flatMap((m)=>m.items),[us]);Li.current=$r;let to=$r.length>0,kn=to&&typeof Co==="function",_n=to&&typeof To==="function",no=Boolean(li||Vr.current),En=!p&&typeof Ao==="function"&&Ne?.capabilities?.rename!==!1&&!no,Cn=!p&&typeof Ro==="function"&&Ne?.capabilities?.fork!==!1,kr=!p&&typeof Po==="function",xr=tl&&!p&&!Wn&&!ki&&Boolean(Ht?.chat_jid),An=!p&&typeof ln==="function"&&Ne?.capabilities?.archive!==!1&&!Ll,zi=!p&&typeof Lo==="function",Rn=!p&&(kn||_n||En||Cn||kr||xr||An||zi),qi=el?Lf(X,ne):{showPicker:!1,label:"",hasAvailableModels:!1},{showPicker:ro,label:Hn}=qi,ps=Le&&me?` (${me})`:"",Gi=ps.trim()?`${me}`:"",fs=Tf(X,ne),_r=Af(be,X),ms=typeof W?.hint_short==="string"?W.hint_short.trim():"",Ki=P(ne).find((m)=>ai(m.key,X)),Wi=Rf(Ki?.pricing),Ml=Cf(W),Ui=[Gi?{key:"thinking",text:Gi}:null,fs?.label?{key:"routed",text:fs.label}:null,ms?{key:"quota",text:ms}:null,_r?.label?{key:"run",text:_r.label}:null].filter(Boolean),Dl=Ui.map((m)=>m.text).join(" • "),gs=Hn.indexOf("/"),hs=gs>0?Hn.slice(0,gs+1):"",jl=hs?Hn.slice(gs+1):Hn,Il=[X?`Current model: ${Hn}${ps}`:null,fs?.title||null,W?.plan?`Plan: ${W.plan}`:null,ms||null,W?.availability&&W.availability!=="available"?`Usage telemetry: ${W.availability.replaceAll("_"," ")}`:null,W?.stale?`Usage telemetry stale after ${String(W.refresh_failure||"refresh failure").replaceAll("_"," ")}`:null,Ml,Wi?`Catalogue pricing: ${Wi}`:null,_r?.title||null,W?.primary?.reset_description||null,W?.secondary?.reset_description||null].filter(Boolean),Yi=Jt?"Switching model…":Il.join(" • ")||(ro?"Select a model (tap to open model picker)":`Current model: ${Hn}${ps} (tap to open model picker)`),Vi=!p&&(ro||_r||be),[zt,Nl]=t(()=>Ys());o(()=>{if(typeof window>"u")return;let m=()=>Nl(Ys());return window.addEventListener(Us,m),m(),()=>window.removeEventListener(Us,m)},[]);let bs=(m)=>{if(!m||typeof m!=="object")return;let _=m.model??m.current;if(typeof Fe==="function")Fe({...m,model:_??null,thinking_level:m.thinking_level??null,thinking_level_label:m.thinking_level_label??null,supports_thinking:m.supports_thinking,provider_usage:m.provider_usage??null});if(_&&typeof q==="function")q(_);window.dispatchEvent?.(new CustomEvent("piclaw:model-state-changed",{detail:{chatJid:de,payload:m,source:"compose"}}))},Ji=(m,_)=>{let R=ii(_);return m.style.minHeight=`${R}px`,m.style.height=`${R}px`,m.style.overflowY=m.scrollHeight>R?"auto":"hidden",R},Ct=(m)=>{let _=m||fe.current;if(!_)return;let R=fr.current;if(R!=null){Ji(_,R);return}_.style.minHeight="",_.style.height="auto";let I=Math.max(Dc(),Math.min(_.scrollHeight,pf()));_.style.height=`${I}px`,_.style.overflowY=_.scrollHeight>I?"auto":"hidden"},ys=(m)=>{if(!m.startsWith("/")||m.includes(`
`)){rt(!1),nt([]);return}let _=m.toLowerCase().split(" ")[0];if(_.length<1){rt(!1),nt([]);return}let I=(Wo.current||uf).filter((N)=>N.name.startsWith(_)||N.name.replace(/-/g,"").startsWith(_.replace(/-/g,"")));if(I.length>0&&!(I.length===1&&I[0].name===_))lt(!1),ct([]),nt(I),Fr(0),rt(!0);else rt(!1),nt([])},Qi=(m)=>{let _=we,R=_.indexOf(" "),I=R>=0?_.slice(R):"",N=m.name+I;ft(N),rt(!1),nt([]),requestAnimationFrame(()=>{let re=fe.current;if(!re)return;let ue=N.length;re.selectionStart=ue,re.selectionEnd=ue,re.focus()})},ws=(m)=>{if(Zs(m,{searchMode:p,showSessionSwitcherButton:Rn})){lt(!1),ct([]);return}if(Js(m)==null){lt(!1),ct([]);return}let _=lc(Hi,m,{currentChatJid:de});if(_.length>0&&!(_.length===1&&Qs(_[0].agent_name).trim().toLowerCase()===String(m||"").trim().toLowerCase()))rt(!1),nt([]),ct(_),Br(0),lt(!0);else lt(!1),ct([])},Xi=(m)=>{let _=Qs(m?.agent_name);if(!_)return;ft(_),lt(!1),ct([]),requestAnimationFrame(()=>{let R=fe.current;if(!R)return;let I=_.length;R.selectionStart=I,R.selectionEnd=I,R.focus()})},vs=()=>{if(p||!kn&&!_n&&!En&&!Cn&&!An)return!1;return Zt.current={value:"",updatedAt:0},Sn(!1),rt(!1),nt([]),lt(!1),ct([]),Or(""),De(!0),!0},Fl=(m)=>{if(m?.preventDefault?.(),m?.stopPropagation?.(),p||!kn&&!_n&&!En&&!Cn&&!An)return;if(xe){Zt.current={value:"",updatedAt:0},De(!1);return}vs()},Zi=(m)=>{let _=typeof m==="string"?m.trim():"";if(De(!1),!_||_===de){requestAnimationFrame(()=>fe.current?.focus());return}Co?.(_)},ea=async(m)=>{let _=typeof m==="string"?m.trim():"";if(De(!1),!_||typeof To!=="function"){requestAnimationFrame(()=>fe.current?.focus());return}try{await To(_)}catch(R){console.warn("Failed to restore session:",R),requestAnimationFrame(()=>fe.current?.focus())}},Ss=n((m)=>{let _=typeof m==="string"?m.trim():"";if(!_||Qo.current.has(_))return!1;return Qo.current.add(_),vi((R)=>{let I=new Set(R instanceof Set?R:[]);return I.add(_),I}),!0},[]),$s=n((m,_)=>{let R=typeof m==="string"?m.trim():"";if(!R)return;if(Qo.current.delete(R),_)return;vi((I)=>{let N=new Set(I instanceof Set?I:[]);return N.delete(R),N})},[]),oo=n(async(m,_={})=>{let R=typeof m?.chat_jid==="string"?m.chat_jid.trim():"";if(!R)return;if(_.canPurgeArchived){if(!Ss(R))return;Vo(null);let I=!1;try{I=await Lo?.(R,{confirmed:!0})!==!1}catch(N){console.warn("Failed to purge archived session:",N)}if($s(R,I),I)De(!1);return}if(_.canPrune){if(!Ss(R))return;Jo(null);let I=!1;try{I=await ln(R,{confirmed:!0})!==!1}catch(N){console.warn("Failed to delete session:",N)}if($s(R,I),I)De(!1)}},[$s,Ss,ln,Lo]);o(()=>{if(!xe)return;let m=(_)=>{let R=Hr.current;if(!R)return;let N=_.target?.closest?.("button.compose-model-popup-item-delete.confirming[data-chat-jid]");if(!N||!R.contains(N))return;_.preventDefault?.(),_.stopPropagation?.(),_.stopImmediatePropagation?.();let re=typeof N.dataset?.chatJid==="string"?N.dataset.chatJid.trim():"";if(!re)return;let ue=Li.current.find((pe)=>pe?.chat_jid===re)||{chat_jid:re};oo(ue,{canPurgeArchived:N.dataset?.deleteKind==="purge",canPrune:N.dataset?.deleteKind==="prune"})};return document.addEventListener("pointerdown",m,!0),document.addEventListener("mousedown",m,!0),document.addEventListener("touchstart",m,!0),()=>{document.removeEventListener("pointerdown",m,!0),document.removeEventListener("mousedown",m,!0),document.removeEventListener("touchstart",m,!0)}},[oo,xe]);let ut=i(()=>{let m=[];for(let _ of ds){let R=Boolean(_?.archived_at),I=typeof _?.agent_name==="string"?_.agent_name.trim():"",N=typeof _?.chat_jid==="string"?_.chat_jid.trim():"";if(!I||!N)continue;m.push({type:"session",key:`session:${N}`,label:`@${I} — ${N}${_?.is_active?" active":""}${R?" archived":""}`,chat:_,disabled:R?!_n||_?.capabilities?.restore===!1:!kn||_?.capabilities?.open===!1})}if(!$t&&Cn)m.push({type:"action",key:"action:new",label:"New branch",action:"new",disabled:!1});if(!$t&&kr)m.push({type:"action",key:"action:new-root",label:"New root session…",action:"new-root",disabled:!1});if(!$t&&Ht?.chat_jid)m.push({type:"action",key:"action:rollup",label:"Merge current w/ parent",action:"rollup",disabled:!xr});if(!$t&&En)m.push({type:"action",key:"action:rename",label:"Rename current session",action:"rename",disabled:no});if(!$t&&An)m.push({type:"action",key:"action:delete",label:"Delete current session",action:"delete",disabled:!1});return m},[ds,$t,_n,kn,Cn,kr,Ht,xr,En,An,no]);Nn.current=ut;let Mt=Math.max(0,ut.findIndex((m)=>m.key===ul)),ks=n((m)=>{let _=gt(m,Ut);yi(_.pinnedChatJids);let R=Nn.current,I=R.filter((ve)=>ve?.type==="session").map((ve)=>ve.chat),N=Ie(I,de,_.pinnedChatJids).flatMap((ve)=>ve.items),re=R.filter((ve)=>ve?.type==="session"),ue=R.filter((ve)=>ve?.type!=="session"),pe=new Map(re.map((ve)=>[ve.chat.chat_jid,ve])),ye=N.map((ve)=>pe.get(ve.chat_jid)).filter(Boolean);Nn.current=[...ye,...ue];let ot=hc(N,m);if(ot>=0)Qt(ye[ot])},[de,Qt]),ta=async(m)=>{if(m?.preventDefault)m.preventDefault();if(m?.stopPropagation)m.stopPropagation();if(typeof Ao!=="function"||li||Vr.current)return;Vr.current=!0,De(!1);try{await Ao()}catch(_){console.warn("Failed to rename session:",_)}finally{Vr.current=!1}requestAnimationFrame(()=>fe.current?.focus())},na=async()=>{if(typeof Ro!=="function")return;De(!1);try{await Ro()}catch(m){console.warn("Failed to create session:",m)}requestAnimationFrame(()=>fe.current?.focus())},ra=async()=>{if(typeof Po!=="function")return;De(!1);let m=typeof window<"u"?window.prompt("New root session handle (for example: ops)"):"",_=String(m||"").trim();if(!_){requestAnimationFrame(()=>fe.current?.focus());return}try{await Po(_)}catch(R){console.warn("Failed to create root session:",R)}requestAnimationFrame(()=>fe.current?.focus())},oa=async()=>{let m=typeof Ht?.chat_jid==="string"?Ht.chat_jid.trim():"";if(!m||ki||Wn)return;De(!1),qe(null),Xt(null),xi(!0);try{let _=await No("default","/rollup",null,[],null,de);ci?.(_),l?.(_);let R=_?.command;if(R?.status==="error"){let N=R?.message||"Failed to merge current session with parent.";qe(N),Eo?.(N);return}let I=typeof R?.rolled_up_to==="string"&&R.rolled_up_to.trim()?R.rolled_up_to.trim():m;Co?.(I)}catch(_){let R=_?.message||"Failed to merge current session with parent.";qe(R),Eo?.(R),console.warn("Failed to merge session with parent:",_)}finally{xi(!1)}requestAnimationFrame(()=>fe.current?.focus())},sa=async()=>{if(typeof ln!=="function")return;De(!1);try{await ln(de)}catch(m){console.warn("Failed to delete session:",m)}requestAnimationFrame(()=>fe.current?.focus())},ia=(m,_,R)=>{let I=fe.current;if(!I||!R)return;let N=m,re=!1,ue=de;R.classList.add("dragging"),document.body.style.cursor="row-resize",document.body.style.userSelect="none";let pe=(tt)=>{if(Math.abs(tt-_)>4)re=!0;N=Ji(I,m+(_-tt)),fr.current=N},ye=(tt)=>{pe(tt.clientY)},ot=(tt)=>{let qt=tt.touches[0];if(!qt)return;tt.preventDefault(),pe(qt.clientY)},ve=(tt)=>{if(R.classList.remove("dragging"),document.body.style.cursor="",document.body.style.userSelect="",jn)Un.setItem?.(Zo,String(Math.round(N)));if(document.removeEventListener("mousemove",ye),document.removeEventListener("mouseup",ve),document.removeEventListener("touchmove",ot),document.removeEventListener("touchend",ve),document.removeEventListener("touchcancel",ve),!re&&tt?.type!=="touchcancel"&&I.isConnected&&_i.current===ue)Io?.()};document.addEventListener("mousemove",ye),document.addEventListener("mouseup",ve),document.addEventListener("touchmove",ot,{passive:!1}),document.addEventListener("touchend",ve),document.addEventListener("touchcancel",ve)},Bl=(m)=>{let _=fe.current;if(!_)return;m.preventDefault(),ia(_.getBoundingClientRect().height,m.clientY,m.currentTarget)},Ol=(m)=>{let _=fe.current,R=m.touches?.[0];if(!_||!R)return;m.preventDefault(),ia(_.getBoundingClientRect().height,R.clientY,m.currentTarget)},rn=(m)=>{if(p)gi(m);else{if(ft(m),Bo)ys(m);else rt(!1),nt([]);if(Oo)ws(m);else lt(!1),ct([])}requestAnimationFrame(()=>Ct())},Hl=(m)=>{let _=p?pn:we,R=_&&!_.endsWith(`
`)?`
`:"",I=`${_}${R}${m}`.trimStart();rn(I)},xs=n(()=>{requestAnimationFrame(()=>{let m=fe.current;if(!m)return;try{m.focus({preventScroll:!0})}catch{m.focus()}})},[]),Rt=n(()=>{Tt({kind:"idle",title:"",detail:""})},[]),_s=n((m=en.current,_=tn.current)=>{if(p)return;rn(_c(Ti.current,m,_))},[p]),Dt=n(()=>{Kr.current=!0;let m=Me.current;if(!m){Rt();return}try{m.stop()}catch{Me.current=null,Rt()}},[Rt]),Es=n(()=>{if(Oe.current?.selected){Oe.current.toggle().catch(()=>qe("Dictation could not finish. Draft preserved."));return}if(qe(null),Xt(null),Me.current){Dt();return}if(!Be?.showButton)return;if(Be.mode==="fallback"){xs(),Tt({kind:"guidance",title:Be.title||"Use keyboard dictation",detail:Be.detail||"Use your keyboard dictation mic for voice input here."});return}if(!Be?.canStart||!Be?.recognitionCtor){Tt({kind:"error",title:Be?.title||"Voice input unavailable",detail:Be?.detail||"This browser does not expose native speech recognition in this context."});return}try{let m=new Be.recognitionCtor;if(Me.current=m,Ti.current=String(we||""),en.current="",tn.current="",Gr.current="",Kr.current=!1,m.lang=typeof navigator<"u"&&navigator.language?navigator.language:"en-US",m.interimResults=!0,m.continuous=!1,"maxAlternatives"in m)m.maxAlternatives=1;m.onstart=()=>{if(Me.current!==m||Oe.current?.selected)return;Tt({kind:"listening",title:"Listening…",detail:"Speak now. Tap the mic again to stop."})},m.onresult=(_)=>{if(Me.current!==m||Oe.current?.selected)return;let{finalText:R,interimText:I}=Ec(_?.results,_?.resultIndex||0);if(R)en.current=`${en.current} ${R}`.trim();tn.current=I,_s(),Tt({kind:"listening",title:"Listening…",detail:I?`Heard: ${I}`:"Speak now. Tap the mic again to stop."})},m.onerror=(_)=>{if(Me.current!==m||Oe.current?.selected)return;let R=String(_?.error||"").trim();if(Gr.current=R,Me.current=null,tn.current="",R==="aborted"){Rt();return}Tt({kind:"error",title:"Voice input failed",detail:oi(R,Be)})},m.onend=()=>{if(Me.current!==m||Oe.current?.selected)return;let _=Gr.current,R=Kr.current,I=Boolean(en.current.trim()||tn.current.trim());if(Me.current=null,Kr.current=!1,Gr.current="",tn.current.trim())en.current=`${en.current} ${tn.current}`.trim(),tn.current="";if(I)_s(en.current,"");if(_&&_!=="aborted")return;if(!I&&!R){Tt({kind:"error",title:"No speech detected",detail:oi("no-speech",Be)});return}Rt()},Tt({kind:"requesting_permission",title:"Starting voice input…",detail:"Allow microphone access if the browser asks."}),xs(),m.start()}catch(m){Me.current=null,Tt({kind:"error",title:"Voice input failed",detail:m?.message||"Could not start native browser speech recognition."})}},[_s,Rt,we,xs,Be,Dt]),aa=async(m,_=null)=>{if(p||Jt)return;let R=de,I=++Lt.current;qe(null),Xt(null),Yo(!0);try{let N=await No("default",m,null,[],null,R);if(I!==Lt.current||R!==_t.current)return!1;if(N?.error||N?.command===!1||N?.command?.status==="error")throw Error(N?.error||N?.command?.message||"Model switch failed.");let re=null,ue=await ni(Fo,R,(pe)=>{if(I===Lt.current&&R===_t.current)bs(pe)},(pe)=>{if(I!==Lt.current||R!==_t.current)return;re=P(pe).find((ye)=>ye.current)?.key??M(pe?.current??pe?.model)??null,In(bo(pe,Ye))});if(I!==Lt.current||R!==_t.current)return!1;if(!ue||_&&re!==_)throw Error("The server did not confirm the model switch.");if(_)Pe(_,new Date().toISOString(),Ye);return Xt(Lc(m,N)),l?.(N),!0}catch(N){return console.error("Failed to switch model:",N),alert("Failed to switch model: "+N.message),!1}finally{if(I===Lt.current)Yo(!1)}},zl=(m)=>{if(m.pointerType==="mouse")return;let _=fe.current?.value??(p?pn:we);if(!Tc({key:" ",code:"Space",ctrlKey:m.ctrlKey,metaKey:m.metaKey,altKey:m.altKey},_,{searchMode:p,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||Be?.canStart&&Be?.recognitionCtor)}))return;m.preventDefault(),Fn.current=!0,rs.current=!0,Es()},Cs=(m)=>{if(!Fn.current)return;if(m?.preventDefault?.(),Fn.current=!1,Oe.current?.selected)Oe.current.toggle().catch(()=>qe("Dictation could not finish. Draft preserved."));else if(Me.current)Dt()},ql=(m)=>{if(rs.current){rs.current=!1,m.preventDefault();return}Es()},Gl=async(m)=>{let _=typeof m==="string"?m.trim():"";if(!_||Jt)return;await aa(`/thinking ${_}`)},Kl=async(m)=>{let _=typeof m==="string"?m:typeof m?.key==="string"?m.key:typeof m?.label==="string"?m.label:"";if(!_||Jt)return;if(await aa(`/model ${_}`,_))Sn(!1),requestAnimationFrame(()=>br.current?.focus?.())},Wl=(m)=>{if(!m||m.disabled)return;if(m.type==="session"){let _=m.chat;if(_?.archived_at)ea(_.chat_jid);else Zi(_.chat_jid);return}if(m.type==="action"){if(m.action==="new"){na();return}if(m.action==="new-root"){ra();return}if(m.action==="rollup"){oa();return}if(m.action==="rename"){ta();return}if(m.action==="delete")sa()}},so=n(()=>{Sn(!1),requestAnimationFrame(()=>br.current?.focus?.())},[]),Ul=(m)=>{m.preventDefault(),m.stopPropagation(),Zt.current={value:"",updatedAt:0},De(!1),Sn((_)=>{if(!_)In(bo(ne,Ye));return!_})},ca=async()=>{if(p)return;He?.(),await Pn("/compact",null,{includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,clearAfterSubmit:!1,recordHistory:!1})},Yl=(m)=>{if(m==="queue"||m==="steer"||m==="auto")return m;return Wn?"queue":void 0},Pn=async(m,_,R={})=>{if(!R.dictationFinished&&Oe.current?.active&&!/^\/abort\s*$/i.test(String(m||""))){let it=m==null||m===(fe.current?.value??we);try{await Oe.current.submit(async()=>{await Pn(it?fe.current?.value??we:m,_,{...R,dictationFinished:!0})})}catch{qe("Dictation could not finish. Draft preserved; send again explicitly.")}return}let I=typeof m==="string"?m:we;if(Ho&&/^\/settings\s*$/i.test(I.trim())){ft(""),requestAnimationFrame(()=>Ct()),A();return}if(Ho&&/^\/help\s*$/i.test(I.trim())){ft(""),requestAnimationFrame(()=>Ct()),A({section:"keyboard"});return}let N=/^\/abort\s*$/i.test(I.trim());if(os.current&&!N)return;let{includeMedia:re=!0,includeFileRefs:ue=!0,includeFolderRefs:pe=!0,includeMessageRefs:ye=!0,clearAfterSubmit:ot=!0,recordHistory:ve=!0}=R||{},tt=typeof m==="string"?m:m&&typeof m?.target?.value==="string"?m.target.value:we,qt=typeof tt==="string"?tt:"";if(!qt.trim()&&(re?fn.length===0:!0)&&(ue?D.length===0:!0)&&(pe?O.length===0:!0)&&(ye?Q.length===0:!0))return;let Cr=!N;if(Cr)os.current=!0,bi(!0),pi?.(!0);if(Me.current)Dt();Rt(),rt(!1),nt([]),lt(!1),ct([]),De(!1),qe(null),Xt(null);let dt=Cr?Yt.current.begin(de):null,Ar=re?[...fn]:[],zn=ue?[...D]:[],Ln=pe?[...O]:[],Se=ye?[...Q]:[],et=qt.trim(),st=de,da=Lt.current;if(ve&&et){let it=Jr.current,Re=Di(it.filter((Gt)=>Gt!==et));if(Re.push(et),Re.length>Mi)Re.splice(0,Re.length-Mi);Jr.current=Re,yl(Re),Bn.current=-1,Sr.current=""}let uu=()=>{let it=(Re,Gt)=>[...new Set([...Re||[],...Gt||[]])];if(re)mn((Re)=>[...Ar.filter((Gt)=>!Re.includes(Gt)),...Re]);if(ue)ko?.(it(zn,Wr.current));if(pe)xo?.(it(Ln,Ur.current));if(ye)_o?.(it(Se,Yr.current));ft((Re)=>{if(!et)return Re;if(!Re.trim())return et;if(Re.trim()===et)return Re;return`${et}

${Re}`}),requestAnimationFrame(()=>Ct())};if(ot)ft(""),mn([]),F?.(),Z?.(),ee?.();(async()=>{try{let it=await Hc?.({content:et,submitMode:_,fileRefs:zn,folderRefs:Ln,messageRefs:Se,mediaFiles:Ar});if(it){l?.(it);return}let Re=await Xe(dn?Ar:[],(je,Pt)=>Vc(je,{onProgress:Pt}),{onProgress:Ko}),Gt=Re.filter(({result:je})=>je.id).map(({name:je,result:Pt})=>({name:je,id:Pt.id})),du=Re.filter(({result:je})=>je.storage==="workspace").map(({result:je})=>je.path),pu=Gt.map(({id:je})=>je),pa=[...zn,...du],fu=pa.length?`Files:
${pa.map((je)=>`- ${je}`).join(`
`)}`:"",mu=Ln.length?`Folders:
${Ln.map((je)=>`- ${je}`).join(`
`)}`:"",gu=Se.length?`Referenced messages:
${Se.map((je)=>`- message:${je}`).join(`
`)}`:"",hu=Gt.length?`Attachments:
${Gt.map(({id:je,name:Pt},io)=>{let Rs=Pt||`attachment-${io+1}`;return`- attachment:${je} (${Rs})`}).join(`
`)}`:"",bu=[et,fu,mu,gu,hu].filter(Boolean).join(`

`);Ko(null);let on=await No("default",bu,null,pu,Yl(_),st);hr(on);let fa=gr(on);if(fa&&_t.current===st)qe(fa);if(ci?.(on),dt!==null)if(on?.command?.status==="error")Yt.current.failed(dt);else Yt.current.acknowledged(dt);if(on?.command&&on.command.status!=="error"){let je=/^\/(?:model\s+\S+|cycle-model)\s*$/i.test(et.trim());await ni(Fo,st,(Pt)=>{if(da===Lt.current&&st===_t.current)bs(Pt)},(Pt)=>{if(da!==Lt.current||st!==_t.current)return;let io=P(Pt).find((Rs)=>Rs.current)?.key??M(Pt?.current??Pt?.model)??null;if(je&&io)Pe(io,new Date().toISOString(),Ye)})}Xt(Lc(et,on)),l?.(on)}catch(it){if(ot)uu();let Re=it?.message||"Failed to send message.";if(dt!==null)Yt.current.failed(dt);qe(Re),Eo?.(Re),console.error("Failed to post:",it)}finally{if(Cr){if(dt!==null)Yt.current.finished(dt);Ko(null),bi(!1),os.current=!1,pi?.(!1)}}})()},Vl=(m)=>Bc?.(m),Jl=n((m)=>{let _=de,R=fe.current,I=R?.value??we,N=Wr.current,re=Ur.current,ue=Yr.current,pe=ss.current;return Bf({queuedItem:m,onRemoveQueuedFollowup:$o,isCurrent:()=>_t.current===_&&fe.current===R,canRestoreDraft:()=>(fe.current?.value??we)===I&&Wr.current===N&&Ur.current===re&&Yr.current===ue&&ss.current===pe,setSubmitError:qe,setSubmitNotice:Xt,setMediaFiles:mn,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,setContent:ft,textareaRef:fe,resizeTextarea:Ct})},[de,we,$o,ko,xo,_o,Ct]),Er=n((m)=>{if(p||!Ze&&!xe||m?.isComposing)return!1;let _=()=>{m.preventDefault?.(),m.stopPropagation?.()},R=()=>{Zt.current={value:"",updatedAt:0}};if(Ze&&m.target?.closest?.("[data-compose-model-catalogue]"))return!1;if(m.key==="Escape"){if(_(),R(),Ze)so();if(xe)De(!1),Or(""),requestAnimationFrame(()=>zr.current?.querySelector?.("button")?.focus?.());return!0}if(Ze)return!1;if(xe){let I=Nn.current,N=Math.max(0,I.findIndex((ue)=>ue.key===Si.current)),re=Boolean(m.target?.classList?.contains?.("compose-session-search"));if(["ArrowDown","ArrowUp","Home","End","PageDown","PageUp"].includes(m.key)){if(_(),R(),I.length>0){let ue=bc(N,I.length,m.key);Qt(I[ue])}return!0}if(m.key==="Enter"&&m.altKey&&I.length>0){_(),R();let ue=I[N];if(ue?.type==="session"&&!ue.chat?.archived_at)ks(ue.chat.chat_jid);return!0}if((m.key==="Enter"||m.key==="Tab")&&I.length>0)return _(),R(),Wl(I[N]),!0;if(!re&&wt(m)&&I.length>0){_();let ue=ac(Zt.current,m.key);Zt.current=ue;let pe=cc(I,ue.value,N,(ye)=>ye.label);if(pe>=0)Qt(I[pe]);return!0}}return!1},[p,Ze,xe,Qt,so,ks]),Ql=(m)=>{if(m.isComposing||m.defaultPrevented)return;if(m.key==="Enter"&&(m.ctrlKey||m.metaKey)&&!m.shiftKey&&!m.altKey&&!p){let R=mr(m);if(m.preventDefault(),R)Pn(fe.current?.value??we,"steer");return}if(p&&m.key==="Escape"){m.preventDefault(),gi(""),L?.();return}if(Er(m))return;let _=fe.current?.value??(p?pn:we);if(Tc(m,_,{searchMode:p,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||Be?.canStart&&Be?.recognitionCtor)})){m.preventDefault(),Fn.current=!0,Es();return}if(wc(m,_,{searchMode:p,showSessionSwitcherButton:Rn})){m.preventDefault(),vs();return}if(cr&&Vt.length>0){let R=fe.current?.value??(p?pn:we);if(!String(R||"").match(/^@([a-zA-Z0-9_-]*)$/))lt(!1),ct([]);else{if(m.key==="ArrowDown"){m.preventDefault(),Br((I)=>(I+1)%Vt.length);return}if(m.key==="ArrowUp"){m.preventDefault(),Br((I)=>(I-1+Vt.length)%Vt.length);return}if(m.key==="Tab"||m.key==="Enter"){m.preventDefault(),Xi(Vt[Uo]);return}if(m.key==="Escape"){m.preventDefault(),lt(!1),ct([]);return}}}if(Vn&&Bt.length>0){let R=fe.current?.value??(p?pn:we);if(!String(R||"").startsWith("/"))rt(!1),nt([]);else{if(m.key==="ArrowDown"){m.preventDefault(),Fr((I)=>(I+1)%Bt.length);return}if(m.key==="ArrowUp"){m.preventDefault(),Fr((I)=>(I-1+Bt.length)%Bt.length);return}if(m.key==="Tab"){m.preventDefault(),Qi(Bt[Nr]);return}if(m.key==="Enter"&&!m.shiftKey){if(!_.includes(" ")){m.preventDefault();let N=Bt[Nr];rt(!1),nt([]),Pn(N.name);return}}if(m.key==="Escape"){m.preventDefault(),rt(!1),nt([]);return}}}if(!p&&(m.key==="ArrowUp"||m.key==="ArrowDown")&&!m.metaKey&&!m.ctrlKey&&!m.altKey&&!m.shiftKey){let R=fe.current;if(!R)return;let I=R.value||"",N=R.selectionStart===0&&R.selectionEnd===0,re=R.selectionStart===I.length&&R.selectionEnd===I.length;if(m.key==="ArrowUp"&&N||m.key==="ArrowDown"&&re){let ue=Jr.current;if(!ue.length)return;m.preventDefault();let pe=Bn.current;if(m.key==="ArrowUp"){if(pe===-1)Sr.current=I,pe=ue.length-1;else if(pe>0)pe-=1;Bn.current=pe,rn(ue[pe]||"")}else{if(pe===-1)return;if(pe<ue.length-1)pe+=1,Bn.current=pe,rn(ue[pe]||"");else Bn.current=-1,rn(Sr.current||""),Sr.current=""}requestAnimationFrame(()=>{let ye=fe.current;if(!ye)return;let ot=ye.value.length;ye.selectionStart=ot,ye.selectionEnd=ot});return}}if(m.key==="Enter"&&!m.shiftKey&&(m.ctrlKey||m.metaKey)){if(m.preventDefault(),p){if(_.trim())b?.(_.trim(),h,{images:zo,attachments:qo})}return}if(m.key==="Enter"&&!m.shiftKey&&!m.ctrlKey&&!m.metaKey&&!m.altKey&&!m.repeat){if(m.preventDefault(),p){if(_.trim())b?.(_.trim(),h,{images:zo,attachments:qo})}else Pn(_);return}if(m.key==="Escape"){if(Ze||xe||Vn||cr)return;m.preventDefault(),fe.current?.blur()}},Xl=(m)=>{if(vf(m,Fn.current)){if(m.preventDefault(),Fn.current=!1,Oe.current?.selected)Oe.current.toggle().catch(()=>qe("Dictation could not finish. Draft preserved."));else if(Me.current)Dt()}},As=(m)=>{if(!dn)return;let _=Array.from(m||[]).filter((R)=>R instanceof File&&!String(R.name||"").startsWith(".DS_Store"));if(!_.length)return;mn((R)=>[...R,..._]),qe(null)};o(()=>{let m=async(_)=>{let R=_?.detail?.mediaId;if(!R)return;try{let{getMediaBlob:I}=await (u("0z1fe878"),import("./api-0z1fe878.js")),N=await I(R),re=new File([N],`annotated-${R}.png`,{type:N.type||"image/png"});mn((ue)=>[...ue,re]),fe.current?.focus()}catch(I){console.warn("[compose-box] Failed to attach annotated image:",I)}};return window.addEventListener("piclaw:compose-media-attach",m),()=>window.removeEventListener("piclaw:compose-media-attach",m)},[]);let Zl=(m)=>{As(m.target.files),m.target.value=""},eu=(m)=>{if(p||!dn)return;m.preventDefault(),m.stopPropagation(),yr.current+=1,Ir(!0)},tu=(m)=>{if(p)return;if(m.preventDefault(),m.stopPropagation(),yr.current=Math.max(0,yr.current-1),yr.current===0)Ir(!1)},nu=(m)=>{if(p||!dn)return;if(m.preventDefault(),m.stopPropagation(),m.dataTransfer)m.dataTransfer.dropEffect="copy";Ir(!0)},ru=(m)=>{if(p||!dn)return;m.preventDefault(),m.stopPropagation(),yr.current=0,Ir(!1),As(m.dataTransfer?.files||[])},ou=(m)=>{if(p||!dn)return;let _=m.clipboardData?.items;if(!_||!_.length)return;let R=[];for(let I of _){if(I.kind!=="file")continue;let N=I.getAsFile?.();if(N)R.push(N)}if(R.length>0)m.preventDefault(),As(R)},su=(m)=>{mn((_)=>_.filter((R,I)=>I!==m))},iu=()=>{qe(null),mn([]),F?.(),Z?.(),ee?.()},au=()=>{if(!navigator.geolocation){alert("Geolocation is not available in this browser.");return}navigator.geolocation.getCurrentPosition((m)=>{let{latitude:_,longitude:R,accuracy:I}=m.coords,N=`${_.toFixed(5)}, ${R.toFixed(5)}`,re=Number.isFinite(I)?` ±${Math.round(I)}m`:"",ue=`https://maps.google.com/?q=${_},${R}`,pe=`Location: ${N}${re} ${ue}`;Hl(pe)},(m)=>{let _=m?.message||"Unable to retrieve location.";alert(`Location error: ${_}`)},{enableHighAccuracy:!0,timeout:1e4,maximumAge:0})};o(()=>{if(!Ze)return;let m=de,_=++pr.current,R=Xo.current;Zt.current={value:"",updatedAt:0},$i(!0),Promise.resolve(Fo(m)).then((I)=>{if(_!==pr.current||m!==_t.current)return;if(Xo.current!==R)return;In(bo(I,Ye)),bs(I)}).catch((I)=>{if(_!==pr.current||m!==_t.current)return;console.warn("Failed to load model list:",I),In([])}).finally(()=>{if(_===pr.current)$i(!1)})},[Ze,de]),o(()=>{if(p)Sn(!1),De(!1),rt(!1),nt([]),lt(!1),ct([])},[p]),o(()=>{if(xe&&!Rn)De(!1)},[xe,Rn]),o(()=>{if(!xe)Vo(null),Jo(null),Or("")},[xe]),o(()=>{if(!xe)return;let m=yf(ut,de);Qt(ut[m]),Zt.current={value:"",updatedAt:0}},[xe,de,Qt]),o(()=>{if(!Ze)return;let m=(_)=>{let R=Pi.current,I=br.current,N=_.target;if(R&&R.contains(N))return;if(I&&I.contains(N))return;Sn(!1)};return document.addEventListener("pointerdown",m),()=>document.removeEventListener("pointerdown",m)},[Ze]),o(()=>{if(!xe)return;let m=(_)=>{let R=Hr.current,I=zr.current,N=_.target;if(R&&R.contains(N))return;if(I&&I.contains(N))return;De(!1)};return document.addEventListener("pointerdown",m),()=>document.removeEventListener("pointerdown",m)},[xe]),o(()=>{if(p||!Ze&&!xe)return;let m=(_)=>{Er(_)};return document.addEventListener("keydown",m,!0),()=>document.removeEventListener("keydown",m,!0)},[p,Ze,xe,Er]),o(()=>{if(!xe)return;let m=Hr.current,_=m?.querySelector?.(".compose-session-search");if(document.activeElement!==_)_?.focus?.();m?.querySelector?.(".compose-model-popup-item.active")?.scrollIntoView?.({block:"nearest"})},[xe,Mt,ut.length]),o(()=>{if(!cr||!ts.current)return;ts.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[cr,Uo,Vt.length]),o(()=>{if(!Vn||!es.current)return;es.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Vn,Nr,Bt.length]),o(()=>{let m=(R)=>{if(!R||typeof R!=="object")return!1;if(R.isContentEditable)return!0;if(typeof R.closest!=="function")return!1;return Boolean(R.closest('input, textarea, select, [contenteditable="true"], .compose-box, .compose-model-popup, .compose-session-popup, .settings-dialog, .workspace-sidebar, .editor-pane-container, .dock-panel, .timeline-menu-dropdown, .rename-branch-overlay, .agent-request-modal, .attachment-preview-modal, .vnc-pane-shell, .kanban-plugin, .timeline-quick-actions'))},_=(R)=>{if(R.defaultPrevented||R.ctrlKey||R.metaKey||R.altKey)return;let I=fe.current;if(!I)return;let N=document.activeElement===I;if(R.key==="Escape"&&!N&&!m(R.target)){R.preventDefault(),I.focus();return}if(R.key==="/"&&!N&&!m(R.target))R.preventDefault(),rn("/"),requestAnimationFrame(()=>{I.focus(),I.selectionStart=1,I.selectionEnd=1,ys("/")})};return window.addEventListener("keydown",_),()=>window.removeEventListener("keydown",_)},[]),o(()=>{let m=()=>{let re=ns.current?.clientWidth||0;fl((ue)=>ue===re?ue:re)};m();let _=ns.current,R=0,I=()=>{if(R)cancelAnimationFrame(R);R=requestAnimationFrame(()=>{R=0,m()})},N=null;if(_&&typeof ResizeObserver<"u")N=new ResizeObserver(()=>I()),N.observe(_);if(typeof window<"u")window.addEventListener("resize",I);return()=>{if(R)cancelAnimationFrame(R);if(N?.disconnect?.(),typeof window<"u")window.removeEventListener("resize",I)}},[p,X,Ne?.agent_name,Rn,be?.percent]);let cu=(m)=>{let _=m.target.value;if(Me.current&&m?.isTrusted)Dt();if(qe(null),Xt(null),Et.kind==="guidance"||Et.kind==="error")Rt();if(xe)De(!1);if(Ct(m.target),Zs(_,{searchMode:p,showSessionSwitcherButton:Rn})){rn(""),requestAnimationFrame(()=>{let R=fe.current;if(!R)return;R.value="",R.selectionStart=0,R.selectionEnd=0,R.focus()}),vs();return}rn(_)};o(()=>{requestAnimationFrame(()=>Ct())},[we,pn,p]),o(()=>{if(typeof window>"u")return;let m=()=>{if(fr.current!=null){let _=ii(fr.current);if(fr.current=_,jn)Un.setItem?.(Zo,String(_))}requestAnimationFrame(()=>Ct())};return window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[]),o(()=>{if(!p)return;if(Oe.current?.cancel(),Me.current)Dt();return},[p,Dt]),o(()=>{if(Me.current)Dt();Rt()},[de,Rt,Dt]),o(()=>()=>{if(!Me.current)return;try{Me.current.stop()}catch(m){console.debug("[compose] failed to stop speech recognition during cleanup",m)}Me.current=null},[]),o(()=>{if(!nn)return;Ai(Date.now());let m=setInterval(()=>Ai(Date.now()),1000);return()=>clearInterval(m)},[nn,Nt?.started_at,Nt?.startedAt]),o(()=>{if(Ri(0),Ot?.mode!=="custom"||!Array.isArray(Ot.frames)||Ot.frames.length<=1)return;let m=typeof Ot.intervalMs==="number"&&Number.isFinite(Ot.intervalMs)&&Ot.intervalMs>0?Ot.intervalMs:120,_=setInterval(()=>{Ri((R)=>(R+1)%Ot.frames.length)},m);return()=>clearInterval(_)},[Ot]),o(()=>{if(p||!Oo)return;ws(we)},[Oo,Hi,de,we,p]);let la=Vi?e`
                    <div class="compose-meta-row">
                        ${(ro||_r)&&e`
                            <div class="compose-model-meta">
                                ${ro&&e`
                                    <button
                                        ref=${br}
                                        type="button"
                                        class="compose-model-hint compose-model-hint-btn"
                                        title=${Yi}
                                        aria-label=${ge("compose.openModelPicker")}
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
                        ${!p&&be&&e`
                            <${xf}
                                usage=${be}
                                onCompact=${mi?ca:void 0}
                                compactionLabel=${nn?cs||"0:00":""}
                                compactionTitle=${nn?Bi||"Smart compaction":""}
                            />
                        `}
                    </div>
    `:null;a(()=>{if(!zt)return;d(la,zt)});let[lu,ua]=t(null);return a(()=>{if(!Ze||!zt){ua(null);return}let m=()=>{let _=br.current?.getBoundingClientRect?.(),R=zt.closest?.(".workbench-statusbar")?.getBoundingClientRect?.();if(!_||!R)return;ua({left:Math.round(_.left),bottom:Math.round(window.innerHeight-R.top+6)})};return m(),window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[Ze,zt]),o(()=>()=>{if(zt)d(null,zt)},[zt]),e`
        <div class="compose-box" data-testid="compose-box" aria-disabled=${jo?"true":"false"}>
            <div
                class=${`compose-resize-handle ${Wc?"away-from-latest":""} ${fi?"has-new-messages":""}`}
                role="separator"
                aria-orientation="horizontal"
                aria-label=${ge("compose.resizeInput")}
                title=${ge("compose.resizeInputHint")}
                onMouseDown=${Bl}
                onTouchStart=${Ol}
            >${Io&&e`<button type="button" class="compose-latest-handle" aria-label=${fi?"New messages — jump to latest":"Jump to latest message"} title="Jump to latest message" onClick=${(m)=>{if(m.detail===0)Io()}}><span class="compose-latest-chevron compose-latest-chevron-left" aria-hidden="true"></span><span class="compose-latest-chevron compose-latest-chevron-right" aria-hidden="true"></span></button>`}</div>
            ${ol&&e`<div class="agent-status" role="status" aria-live="polite" data-submission-state="sending"><div class="agent-status-spinner" aria-hidden="true"></div><span class="status-text">Sending…</span></div>`}
            ${vl&&e`
                <div class=${`compose-inline-status compose-speech-status compose-speech-status-${Et.kind}`} role="status" aria-live="polite">
                    <div class="compose-inline-status-row">
                        <span class=${ti({pulsing:Sl})} aria-hidden="true"></span>
                        <span class="compose-inline-status-title">${Et.title}</span>
                    </div>
                    ${Et.detail&&e`<div class="compose-inline-status-detail">${Et.detail}</div>`}
                </div>
            `}
            ${Ft&&e`
                <div class="compose-inline-status compose-upload-status" role="status" aria-live="polite" data-testid="compose-upload-status">
                    <div class="compose-inline-status-row">
                        <div class="compose-inline-status-spinner" aria-hidden="true"></div>
                        <span class="compose-inline-status-title">
                            ${`Uploading ${Ft.current}/${Ft.total}: ${Ft.name}`}
                        </span>
                        <span class="compose-inline-status-elapsed">${Ft.percent}%</span>
                    </div>
                    <div
                        class="upload-progress-bar"
                        role="progressbar"
                        aria-label="Attachment upload progress"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow=${Ft.percent}
                    >
                        <div class="upload-progress-fill" style=${`width:${Ft.percent}%`}></div>
                    </div>
                </div>
            `}
            ${Ei&&e`
                <div class="compose-inline-status compose-submit-error" role="alert" aria-live="assertive">
                    <div class="compose-inline-status-detail">${Ei}</div>
                </div>
            `}
            ${Gc&&!p&&e`
                <${Of}
                    items=${Fc}
                    onInjectQueuedFollowup=${Vl}
                    onRemoveQueuedFollowup=${$o}
                    onMoveQueuedFollowup=${Oc}
                    onReturnQueuedFollowup=${Jl}
                    onOpenFilePill=${We}
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
            ${Nt&&!nn&&e`
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
                    <div class="compose-inline-status-detail compose-command-notice-text" dangerouslySetInnerHTML=${{__html:v(Ci)}}></div>
                </div>
            `}
            <div
                class=${`compose-input-wrapper${il?" drag-active":""}`}
                onDragEnter=${eu}
                onDragOver=${nu}
                onDragLeave=${tu}
                onDrop=${ru}
            >
                ${Rn&&e`
                    <div
                        ref=${zr}
                        class="compose-session-trigger-group compose-session-trigger-top"
                    >
                        <button
                            type="button"
                            class=${`compose-session-trigger compose-session-trigger-pill${xe?" active":""}`}
                            data-testid="session-switcher"
                            onClick=${Fl}
                            title=${Ne?.chat_jid||de}
                            aria-label=${Ne?.agent_name?`Manage sessions for @${Ne.agent_name}`:"Manage Sessions/Agents"}
                            aria-expanded=${xe?"true":"false"}
                        >
                            <span class="compose-current-agent-label active">${Ne?.agent_name?`@${Ne.agent_name}`:"Sessions"}</span>
                        </button>
                    </div>
                `}
                <div class="compose-input-main">
                    ${Cl&&e`
                        <div class="compose-file-refs">
                            ${Q.map((m)=>e`
                                    <${k}
                                        key=${"msg-"+m}
                                        prefix="compose"
                                        label=${"msg:"+m}
                                        title=${"Message reference: "+m}
                                        removeTitle="Remove reference"
                                        icon="message"
                                        onRemove=${()=>te?.(m)}
                                    />
                                `)}
                            ${D.map((m)=>{let _=m.split("/").pop()||m;return e`
                                    <${k}
                                        prefix="compose"
                                        label=${_}
                                        title=${m}
                                        onClick=${()=>We?.(m)}
                                        removeTitle="Remove file"
                                        onRemove=${()=>T?.(m)}
                                    />
                                `})}
                            ${O.map((m)=>{let _=m.split("/").pop()||m;return e`
                                    <${k}
                                        prefix="compose"
                                        label=${_}
                                        title=${m}
                                        icon="folder"
                                        onClick=${()=>We?.(m)}
                                        removeTitle="Remove folder hint"
                                        onRemove=${()=>z?.(m)}
                                    />
                                `})}
                            ${fn.map((m,_)=>{let R=m?.name||`attachment-${_+1}`;return e`
                                    <${k}
                                        key=${R+_}
                                        prefix="compose"
                                        label=${R}
                                        title=${R}
                                        removeTitle="Remove attachment"
                                        onRemove=${()=>su(_)}
                                    />
                                `})}
                            <button
                                type="button"
                                class="compose-clear-attachments-btn"
                                onClick=${iu}
                                title=${ge("compose.clearAllTitle")}
                                aria-label=${ge("compose.clearAllTitle")}
                            >
                                ${ge("compose.clearAll")}
                            </button>
                        </div>
                    `}
                    <textarea
                        id=${Uc}
                        ref=${fe}
                        data-testid="compose-input"
                        placeholder=${p?ge("compose.searchPlaceholder"):ge("compose.placeholder")}
                        value=${p?pn:we}
                        onInput=${cu}
                        onKeyDown=${Ql}
                        onKeyUp=${Xl}
                        onPaste=${ou}
                        onFocus=${g}
                        onClick=${g}
                        rows="1"
                        disabled=${jo}
                    />
                    ${cr&&Vt.length>0&&e`
                        <div class="slash-autocomplete" ref=${ts}>
                            ${Vt.map((m,_)=>e`
                                <div
                                    key=${m.chat_jid||m.agent_name}
                                    class=${`slash-item${_===Uo?" active":""}`}
                                    onMouseDown=${(R)=>{R.preventDefault(),Xi(m)}}
                                    onMouseEnter=${()=>Br(_)}
                                >
                                    <span class="slash-name">@${m.agent_name}</span>
                                    <span class="slash-desc">${m.chat_jid||"Active agent"}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${Vn&&Bt.length>0&&e`
                        <div class="slash-autocomplete" ref=${es}>
                            ${Bt.map((m,_)=>e`
                                <div
                                    key=${m.name}
                                    class=${`slash-item${_===Nr?" active":""}`}
                                    onMouseDown=${(R)=>{R.preventDefault(),Qi(m)}}
                                    onMouseEnter=${()=>Fr(_)}
                                >
                                    <span class="slash-name">${m.name}</span>
                                    <span class="slash-desc">${m.description}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${Ze&&!p&&e`
                        <${xc}
                            anchor=${lu}
                            entries=${ll}
                            loading=${pl}
                            switching=${Jt}
                            onSelect=${(m)=>{Kl(m)}}
                            onTogglePin=${(m)=>Qe(m.key,Ye)}
                            onClose=${so}
                            onCompact=${mi?()=>{so(),ca()}:void 0}
                            onOpenSettings=${Ho?()=>{Sn(!1),A({section:"models"})}:void 0}
                            thinkingLevel=${me}
                            thinkingLevels=${Ki?.thinkingLevels??[]}
                            onSelectThinking=${(m)=>{Gl(m)}}
                            rootRef=${Pi}
                        />
                    `}
                    ${xe&&!p&&e`
                        <div class="compose-model-popup compose-session-popup" data-testid="session-popup" ref=${Hr} tabIndex="-1" onKeyDown=${Er}>
                            <div class="compose-session-popup-header">
                                <label class="compose-model-popup-title compose-session-search-heading" for="compose-session-search">Search sessions</label>
                                <button type="button" class="compose-session-popup-close" aria-label="Close session picker" onClick=${()=>{De(!1),requestAnimationFrame(()=>zr.current?.querySelector?.("button")?.focus?.())}}>×</button>
                            </div>
                            <input
                                id="compose-session-search"
                                class="compose-session-search"
                                type="search"
                                value=${$t}
                                placeholder="Handle, JID, state, or model"
                                autocomplete="off"
                                onInput=${(m)=>{let _=m.currentTarget.value,R=Ie(Ee($r,_),de,dr).flatMap((N)=>N.items);Nn.current=R.map((N)=>({type:"session",key:`session:${N.chat_jid}`,label:`@${N.agent_name} — ${N.chat_jid}${N.is_active?" active":""}${N.archived_at?" archived":""}`,chat:N,disabled:N.archived_at?!_n||N?.capabilities?.restore===!1:!kn||N?.capabilities?.open===!1}));let I=gc(R,_);Qt(Nn.current[I]),Or(_)}}
                                onKeyDown=${Er}
                            />
                            <div
                                class="compose-model-popup-menu compose-session-popup-results"
                                role="listbox"
                                aria-label=${ge("compose.sessionsAndAgents")}
                                aria-activedescendant=${ut[Mt]?.type==="session"?`compose-session-option-${encodeURIComponent(ut[Mt].chat.chat_jid)}`:void 0}
                            >
                                ${!to&&e`
                                    <div class="compose-model-popup-empty">${ge("compose.noSessions")}</div>
                                `}
                                ${to&&ls.length===0&&e`
                                    <div class="compose-model-popup-empty">No sessions match “${$t}”.</div>
                                `}
                                ${ds.map((m,_)=>{let R=us.find((Se)=>Se.items.includes(m)),I=R?.items[0]===m,N=Boolean(m.archived_at),re=!N&&Tl.has(m.chat_jid),ue=m.chat_jid===(m.root_chat_jid||m.chat_jid),pe=!ue&&!m.is_active&&!N&&typeof ln==="function"&&m?.capabilities?.archive!==!1,ye=N&&zi,ot=ye&&al===m.chat_jid,ve=pe&&cl===m.chat_jid,tt=ot||ve,qt=kt(m,{currentChatJid:de}),Cr=G(m.agent_name),dt=Ke(m,{currentChatJid:de}),Ar=m.root_chat_jid||m.chat_jid,zn=m.model||m.model_label||"",Ln=fc(m);return e`
                                        ${I&&e`<div class="compose-session-section-heading" role="presentation">${R.label}</div>`}
                                        <div key=${m.chat_jid} class=${`compose-model-popup-item-row${N?" archived":""}`}>
                                            ${N?e`<span class="compose-session-row-pin-spacer" aria-hidden="true"></span>`:e`<button
                                                    type="button"
                                                    class=${`compose-session-row-pin${re?" pinned":""}`}
                                                    title=${re?`Unpin @${m.agent_name}`:`Pin @${m.agent_name}`}
                                                    aria-label=${re?`Unpin @${m.agent_name}`:`Pin @${m.agent_name}`}
                                                    aria-pressed=${re?"true":"false"}
                                                    aria-keyshortcuts="Alt+Enter"
                                                    onClick=${(Se)=>{Se.preventDefault(),Se.stopPropagation(),ks(m.chat_jid)}}
                                                >${re?"★":"☆"}</button>`}
                                            <button
                                                id=${`compose-session-option-${encodeURIComponent(m.chat_jid)}`}
                                                type="button"
                                                role="option"
                                                aria-selected=${Mt===_?"true":"false"}
                                                aria-label=${`${qt}; chat ${m.chat_jid}; root ${Ar}; ${zn?`model ${zn}; `:""}${dt.join(", ")||"idle"}`}
                                                class=${`compose-model-popup-item session-item${N?" archived":""}${Mt===_?" active":""}`}
                                                data-testid="session-item"
                                                onClick=${()=>{if(N){ea(m.chat_jid);return}Zi(m.chat_jid)}}
                                                disabled=${N?!_n||m?.capabilities?.restore===!1:!kn||m?.capabilities?.open===!1}
                                                title=${N?`Restore archived ${qt}`:`Switch to ${qt}`}
                                            >
                                                <span class="compose-session-row-content" style=${bf(m)?"font-weight:700":""}>
                                                    <span class="compose-session-row-main">
                                                        <span class="compose-session-row-label">${Cr}</span>
                                                        <span class="compose-session-row-meta">
                                                            <span class="compose-session-row-jid">${m.chat_jid}</span>
                                                            ${Ln&&e`<span class="compose-session-row-metrics"> · ${Ln}</span>`}
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
                                                onClick=${(Se)=>{Se.stopPropagation(),De(!1);let et=new URL(window.location.href);et.searchParams.set("chat_jid",m.chat_jid),et.searchParams.set("chat_only","1");let st=document.createElement("a");st.href=et.toString(),st.target="_blank",st.rel="noopener",st.style.display="none",document.body.appendChild(st),st.click(),st.remove()}}
                                            >
                                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M6 2h8v8"/>
                                                    <path d="M14 2 7 9"/>
                                                    <path d="M12 9v5H2V4h5"/>
                                                </svg>
                                            </button>
                                            ${(pe||ye)&&e`
                                                ${tt?e`<button
                                                        key=${`${m.chat_jid}:delete-confirm`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete confirming"
                                                        data-chat-jid=${m.chat_jid}
                                                        data-delete-kind=${ye?"purge":"prune"}
                                                        title=${ye?"Confirm permanent deletion":"Confirm branch deletion"}
                                                        aria-label=${ye?ue?`Confirm permanent deletion of archived session @${m.agent_name}`:`Confirm permanent deletion of archived branch @${m.agent_name}`:`Confirm delete @${m.agent_name}`}
                                                        onPointerDown=${(Se)=>{Se.preventDefault(),Se.stopPropagation(),oo(m,{canPurgeArchived:ye,canPrune:pe})}}
                                                        onKeyDown=${(Se)=>{if(Se.key!=="Enter"&&Se.key!==" ")return;Se.preventDefault(),Se.stopPropagation(),oo(m,{canPurgeArchived:ye,canPrune:pe})}}
                                                    >
                                                        <span class="compose-model-popup-item-delete-confirm">OK</span>
                                                    </button>`:e`<button
                                                        key=${`${m.chat_jid}:delete-request`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete"
                                                        title=${ye?ue?"Permanently delete this archived session":"Permanently delete this archived branch":"Delete this branch"}
                                                        aria-label=${ye?ue?`Permanently delete archived session @${m.agent_name}`:`Permanently delete archived branch @${m.agent_name}`:`Delete @${m.agent_name}`}
                                                        onClick=${(Se)=>{if(Se.stopPropagation(),ye){Vo(m.chat_jid);return}if(pe){Jo(m.chat_jid);return}De(!1),ln(m.chat_jid)}}
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
                            ${!$t&&(Cn||kr||En||An)&&e`
                                <div class="compose-model-popup-actions">
                                    ${Cn&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn primary${ut.findIndex((m)=>m.key==="action:new")===Mt?" active":""}`}
                                            onClick=${()=>{na()}}
                                            title=${ge("compose.newBranchTitle")}
                                        >
                                            ${ge("compose.newBranch")}
                                        </button>
                                    `}
                                    ${kr&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:new-root")===Mt?" active":""}`}
                                            onClick=${()=>{ra()}}
                                            title=${ge("compose.newRootTitle")}
                                        >
                                            ${ge("compose.newRoot")}
                                        </button>
                                    `}
                                    ${Ht?.chat_jid&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:rollup")===Mt?" active":""}`}
                                            onClick=${()=>{oa()}}
                                            title=${xr?ge("compose.mergeInto",{target:Ht.agent_name?`@${Ht.agent_name}`:Ht.chat_jid}):ge("compose.mergeBlocked")}
                                            disabled=${!xr}
                                        >
                                            ${ge("compose.mergeCurrent")}
                                        </button>
                                    `}
                                    ${En&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:rename")===Mt?" active":""}`}
                                            onClick=${(m)=>{ta(m)}}
                                            title=${ge("compose.renameSessionTitle")}
                                            disabled=${no}
                                        >
                                            ${ge("compose.renameCurrent")}
                                        </button>
                                    `}
                                    ${An&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn danger${ut.findIndex((m)=>m.key==="action:delete")===Mt?" active":""}`}
                                            onClick=${()=>{sa()}}
                                            title=${ge("compose.pruneSessionTitle")}
                                        >
                                            ${ge("compose.deleteCurrent")}
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
                    <div class="compose-actions ${p?"search-mode":""}">
                    ${p&&e`
                        <label class="compose-search-scope-wrap" title=${ge("compose.searchScope")}>
                            <span class="compose-search-scope-label">${ge("compose.scope")}</span>
                            <select
                                class="compose-search-scope-select"
                                value=${h}
                                onChange=${(m)=>S?.(m.currentTarget.value)}
                            >
                                <option value="current">${ge("compose.scopeCurrent")}</option>
                                <option value="root">${ge("compose.scopeBranchFamily")}</option>
                                <option value="all">${ge("compose.scopeAll")}</option>
                            </select>
                        </label>
                        <label class="compose-search-filter-wrap" title=${ge("compose.filterImagesTitle")}>
                            <input type="checkbox" checked=${zo} onChange=${()=>nl((m)=>!m)} />
                            <span class="compose-search-filter-label">${ge("compose.filterImages")}</span>
                        </label>
                        <label class="compose-search-filter-wrap" title=${ge("compose.filterAttachmentsTitle")}>
                            <input type="checkbox" checked=${qo} onChange=${()=>rl((m)=>!m)} />
                            <span class="compose-search-filter-label">${ge("compose.filterAttachments")}</span>
                        </label>
                        <button
                            class=${`compose-search-match-toggle ${jr==="and"?"active":""}`}
                            onClick=${()=>{let m=jr==="or"?"and":"or";Go(m),fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchMatchMode:m})}).catch((_)=>{})}}
                            title=${jr==="or"?"Any keyword (OR) — click for all keywords (AND)":"All keywords (AND) — click for any keyword (OR)"}
                            type="button"
                        >
                            ${jr==="or"?"OR":"AND"}
                        </button>
                    `}
                    ${Qc&&e`
                    <button
                        class="icon-btn search-toggle"
                        onClick=${p?L:C}
                        title=${p?ge("compose.closeSearch"):ge("compose.search")}
                        disabled=${p?typeof L!=="function":typeof C!=="function"}
                    >
                        ${p?e`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`:e`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`}
                    </button>
                    `}
                    ${$l&&!p&&e`
                        <button
                            class="icon-btn location-btn"
                            onClick=${au}
                            title=${ge("compose.shareLocation")}
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
                            class=${`icon-btn voice-input-btn${Xr?" active":""}${Be.mode==="fallback"?" fallback":""}`}
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
                    ${_l&&!p&&e`
                        <button
                            class=${`icon-btn notification-btn${Fi?" active":""}`}
                            onClick=${Lr}
                            title=${El}
                            type="button"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                        </button>
                    `}
                    ${!p&&e`
                        ${Wt&&It&&e`
                            <button
                                class="icon-btn attach-editor-btn"
                                onClick=${It}
                                title=${`Attach open file: ${Wt}`}
                                type="button"
                                disabled=${D.includes(Wt)}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                            </button>
                        `}
                        ${dn&&e`<label class="icon-btn" title=${ge("compose.attachFile")}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                            <input type="file" multiple hidden onChange=${Zl} disabled=${hi} />
                        </label>`}
                    `}
                    ${!p&&e`
                        <div class="compose-send-stack">
                                <button
                                    class=${eo.className}
                                    id=${Yc}
                                    data-testid="send-button"
                                    type="button"
                                    onClick=${()=>{Pn()}}
                                    disabled=${eo.disabled}
                                    title=${eo.title}
                                    aria-label=${eo.ariaLabel}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                                </button>
                                ${$n&&e`
                                    <button
                                        class=${$n.className}
                                        data-testid="stop-button"
                                        type="button"
                                        onClick=${()=>{if($f($n.mode))Pn("/abort","steer",{clearAfterSubmit:!1,includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,recordHistory:!1})}}
                                        disabled=${$n.disabled}
                                        title=${$n.title}
                                        aria-label=${$n.ariaLabel}
                                    >
                                        ${$n.mode==="compacting"?e`
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
export{ke,B,mt,gt,ht,yt,Ae,Gn,ze,gn,Jn,Ce,v,j,U,_e,oe,H,bt,$e,Qn,w,Te,Yn,hn,yn,bn,vn,x,wn,Zn,Xn,ie,er,tr,vt,xn,wt,nr,K,rr,Ve,or,xt,ir,Ee,Ie,G,St,Ke,kt,sr,At,Ge,ar,k,se,Je};

//# debugId=9F434A6ED0FB3E9264756E2164756E21
//# sourceMappingURL=app-6psj0g65.js.map
