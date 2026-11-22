import{d,t,o,a,r,i,n,e}from"./app-xx1jxe5z.js";import{xr,Sr,kr,nt,$r,E,te}from"./app-214asx3k.js";import{de,L,g,pe,Xe,Le,D,Z,fe,mr,gr}from"./app-nt45trv8.js";import{u}from"./app-fhx9675e.js";import{f,c,A,s}from"./app-x9tm2abs.js";var _e="piclaw:session-picker-preferences-changed";function Ps(){return{pinnedChatJids:[]}}function ma(l){return typeof l==="string"?l.trim():""}function ga(l){if(!l||typeof l!=="object")return Ps();let h=l;return{pinnedChatJids:Array.from(new Set((Array.isArray(h.pinnedChatJids)?h.pinnedChatJids:[]).map(ma).filter(Boolean)))}}function ha(l){try{return l?.localStorage??null}catch{return null}}function H(l=typeof window<"u"?window:null){try{let h=ha(l)?.getItem("piclaw:session-picker-preferences:v1");return h?ga(JSON.parse(h)):Ps()}catch{return Ps()}}function yt(l,h=typeof window<"u"?window:null){let p=ga(l);try{ha(h)?.setItem("piclaw:session-picker-preferences:v1",JSON.stringify(p))}catch(w){console.debug("[session-picker-preferences] Storage unavailable; keeping the in-memory preference result.",w)}try{h?.dispatchEvent?.(new CustomEvent("piclaw:session-picker-preferences-changed",{detail:p}))}catch(w){console.debug("[session-picker-preferences] Preference event delivery unavailable.",w)}return p}function bt(l,h=typeof window<"u"?window:null){let p=ma(l),w=H(h);if(!p)return w;let k=new Set(w.pinnedChatJids);if(k.has(p))k.delete(p);else k.add(p);let x=yt({pinnedChatJids:Array.from(k)},h);return h?.dispatchEvent?.(new CustomEvent("piclaw:picker-pin-write",{detail:{kind:"session",key:p,pinned:k.has(p)}})),x}import{classHighlighter as yu,HighlightStyle as wu,tags as ao}from"#editor-vendor/codemirror";var vu=wu.define([{tag:[ao.function(ao.variableName),ao.function(ao.propertyName)],class:"tok-function"}]),Ls={style(l){let h=yu.style(l),p=vu.style(l);return[h,p].filter(Boolean).join(" ")||null}};import{highlightTree as Ga,StreamLanguage as K,cssLanguage as Su,cppLanguage as $u,goLanguage as ku,htmlLanguage as xu,javascriptLanguage as _u,jsxLanguage as Eu,tsxLanguage as Cu,typescriptLanguage as Au,jsonLanguage as Ru,markdownLanguage as Pu,pythonLanguage as Lu,rustLanguage as Tu,StandardSQL as Mu,xmlLanguage as Du,yamlLanguage as ju,dockerFile as Iu,powerShell as Nu,ruby as Fu,shell as Bu,swift as Ou,toml as Hu,clojure as zu,cmake as qu,coffeeScript as Gu,crystal as Ku,cypher as Wu,d as Uu,diff as Yu,eiffel as Vu,elm as Ju,erlang as Qu,factor as Xu,forth as Zu,fortran as ed,gas as td,gherkin as nd,groovy as rd,haskell as od,haxe as sd,http as id,jinja2 as ad,julia as cd,liveScript as ld,lua as ud,mathematica as dd,fSharp as pd,nginx as fd,octave as md,oz as gd,pascal as hd,perl as bd,properties as yd,protobuf as wd,pug as vd,puppet as Sd,r as $d,sas as kd,sass as xd,scheme as _d,smalltalk as Ed,solr as Cd,sparql as Ad,stex as Rd,stylus as Pd,tcl as Ld,textile as Td,turtle as Md,vb as Dd,verilog as jd,vhdl as Id,wast as Nd,webIDL as Fd,xQuery as Bd}from"#editor-vendor/codemirror";var Ka=98304;function Ke(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}var Od={js:"JavaScript",javascript:"JavaScript",ts:"TypeScript",typescript:"TypeScript",jsx:"JSX",tsx:"TSX",py:"Python",python:"Python",sh:"Shell",shell:"Shell",bash:"Bash",zsh:"Zsh",ps1:"PowerShell",powershell:"PowerShell",md:"Markdown",markdown:"Markdown",yml:"YAML",yaml:"YAML",json:"JSON",html:"HTML",css:"CSS",sql:"SQL",go:"Go",c:"C",cc:"C++",cpp:"C++","c++":"C++",cxx:"C++",h:"C/C++",hh:"C++",hpp:"C++",hxx:"C++",rust:"Rust",rs:"Rust",ruby:"Ruby",swift:"Swift",toml:"TOML",dockerfile:"Dockerfile",asm:"Gas",clj:"Clojure",clojure:"Clojure",cmake:"CMake",coffee:"CoffeeScript",coffeescript:"CoffeeScript",conf:"nginx",cr:"Crystal",crystal:"Crystal",cypher:"Cypher",d:"D",diff:"Diff",eiffel:"Eiffel",elm:"Elm",erl:"Erlang",erlang:"Erlang",f90:"Fortran",f95:"Fortran",factor:"Factor",feature:"Gherkin",forth:"Forth",fortran:"Fortran",fsharp:"ML",gas:"Gas",gherkin:"Gherkin",groovy:"Groovy",haskell:"Haskell",haxe:"Haxe",hs:"Haskell",http:"HTTP",hx:"Haxe",ini:"Properties",jade:"Pug",jinja:"Jinja2",jinja2:"Jinja2",jl:"Julia",julia:"Julia",latex:"LaTeX",livescript:"LiveScript",ls:"LiveScript",lua:"Lua",mathematica:"Mathematica",matlab:"Octave",ml:"ML",nginx:"nginx",ocaml:"ML",octave:"Octave",oz:"Oz",pas:"Pascal",pascal:"Pascal",patch:"Diff",perl:"Perl",pl:"Perl",pm:"Perl",pp:"Puppet",properties:"Properties",proto:"Protobuf",protobuf:"Protobuf",pug:"Pug",puppet:"Puppet",r:"R",rq:"SPARQL",s:"Gas",sas:"SAS",sass:"Sass",scheme:"Scheme",scm:"Scheme",scss:"Sass",smalltalk:"Smalltalk",sml:"ML",sparql:"SPARQL",st:"Smalltalk",styl:"Stylus",stylus:"Stylus",sv:"Verilog",tcl:"Tcl",tex:"LaTeX",textile:"Textile",ttl:"Turtle",turtle:"Turtle",vb:"VB",verilog:"Verilog",vhdl:"VHDL",wasm:"WebAssembly",wast:"WebAssembly",webidl:"WebIDL",wl:"Mathematica",xq:"XQuery",xquery:"XQuery"},Hd=K.define(Bu).parser,zd=K.define(Nu).parser,qd=K.define(Iu).parser,Gd=K.define(Fu).parser,Kd=K.define(Ou).parser,Wd=K.define(Hu).parser,ba=K.define(zu).parser,Ud=K.define(qu).parser,ya=K.define(Gu).parser,wa=K.define(Ku).parser,Yd=K.define(Wu).parser,Vd=K.define(Uu).parser,va=K.define(Yu).parser,Jd=K.define(Vu).parser,Qd=K.define(Ju).parser,Sa=K.define(Qu).parser,Xd=K.define(Xu).parser,Zd=K.define(Zu).parser,Ts=K.define(ed).parser,Ms=K.define(td).parser,$a=K.define(nd).parser,ep=K.define(rd).parser,ka=K.define(od).parser,xa=K.define(sd).parser,tp=K.define(id).parser,_a=K.define(ad).parser,Ea=K.define(cd).parser,Ca=K.define(ld).parser,np=K.define(ud).parser,Aa=K.define(dd).parser,Rr=K.define(pd).parser,rp=K.define(fd).parser,Ra=K.define(md).parser,op=K.define(gd).parser,Pa=K.define(hd).parser,Ds=K.define(bd).parser,La=K.define(yd).parser,Ta=K.define(wd).parser,Ma=K.define(vd).parser,Da=K.define(Sd).parser,sp=K.define($d).parser,ip=K.define(kd).parser,ja=K.define(xd).parser,Ia=K.define(_d).parser,Na=K.define(Ed).parser,ap=K.define(Cd).parser,Fa=K.define(Ad).parser,js=K.define(Rd).parser,Ba=K.define(Pd).parser,cp=K.define(Ld).parser,lp=K.define(Td).parser,Oa=K.define(Md).parser,up=K.define(Dd).parser,Ha=K.define(jd).parser,dp=K.define(Id).parser,za=K.define(Nd).parser,pp=K.define(Fd).parser,qa=K.define(Bd).parser;function vt(l){let h=String(l||"").trim().toLowerCase();if(!h)return"text";return Od[h]||String(l||"").trim()}function wt(l){switch(String(l||"").trim().toLowerCase()){case"js":case"javascript":return _u.parser;case"ts":case"typescript":return Au.parser;case"jsx":return Eu.parser;case"tsx":return Cu.parser;case"py":case"python":return Lu.parser;case"json":return Ru.parser;case"css":return Su.parser;case"html":return xu.parser;case"xml":return Du.parser;case"yaml":case"yml":return ju.parser;case"md":case"markdown":return Pu.parser;case"sql":return Mu.language.parser;case"go":return ku.parser;case"c":case"cc":case"cpp":case"cxx":case"c++":case"h":case"hh":case"hpp":case"hxx":return $u.parser;case"sh":case"bash":case"shell":case"zsh":return Hd;case"ps1":case"powershell":return zd;case"dockerfile":return qd;case"rb":case"ruby":return Gd;case"rs":case"rust":return Tu.parser;case"swift":return Kd;case"toml":return Wd;case"asm":return Ms;case"clj":return ba;case"clojure":return ba;case"cmake":return Ud;case"coffee":return ya;case"coffeescript":return ya;case"cr":return wa;case"crystal":return wa;case"cypher":return Yd;case"d":return Vd;case"diff":return va;case"eiffel":return Jd;case"elm":return Qd;case"erl":return Sa;case"erlang":return Sa;case"f90":return Ts;case"f95":return Ts;case"factor":return Xd;case"feature":return $a;case"forth":return Zd;case"fortran":return Ts;case"fsharp":return Rr;case"gas":return Ms;case"gherkin":return $a;case"groovy":return ep;case"haskell":return ka;case"haxe":return xa;case"hs":return ka;case"http":return tp;case"hx":return xa;case"ini":return La;case"jade":return Ma;case"jinja":return _a;case"jinja2":return _a;case"jl":return Ea;case"julia":return Ea;case"latex":return js;case"livescript":return Ca;case"ls":return Ca;case"lua":return np;case"mathematica":return Aa;case"matlab":return Ra;case"ml":return Rr;case"mllike":return Rr;case"nginx":return rp;case"ocaml":return Rr;case"octave":return Ra;case"oz":return op;case"pas":return Pa;case"pascal":return Pa;case"patch":return va;case"perl":return Ds;case"pl":return Ds;case"pm":return Ds;case"pp":return Da;case"properties":return La;case"proto":return Ta;case"protobuf":return Ta;case"pug":return Ma;case"puppet":return Da;case"r":return sp;case"rq":return Fa;case"s":return Ms;case"sas":return ip;case"sass":return ja;case"scheme":return Ia;case"scm":return Ia;case"scss":return ja;case"smalltalk":return Na;case"sml":return Rr;case"solr":return ap;case"sparql":return Fa;case"st":return Na;case"stex":return js;case"styl":return Ba;case"stylus":return Ba;case"sv":return Ha;case"tcl":return cp;case"tex":return js;case"textile":return lp;case"ttl":return Oa;case"turtle":return Oa;case"vb":return up;case"verilog":return Ha;case"vhdl":return dp;case"wasm":return za;case"wast":return za;case"webidl":return pp;case"wl":return Aa;case"xq":return qa;case"xquery":return qa;default:return null}}function $e(l,h){if(String(l||"").length>Ka)return Ke(l);let p=wt(h);if(!p)return Ke(l);let w=[];try{let C=p.parse(l);Ga(C,Ls,(P,M,T)=>{if(!T||P>=M)return;w.push({from:P,to:M,cls:T})})}catch{return Ke(l)}if(!w.length)return Ke(l);w.sort((C,P)=>C.from-P.from||C.to-P.to);let k=0,x="";for(let C of w){if(C.from>k)x+=Ke(l.slice(k,C.from));x+=`<span class="${Ke(C.cls)}">${Ke(l.slice(C.from,C.to))}</span>`,k=Math.max(k,C.to)}if(k<l.length)x+=Ke(l.slice(k));return x}function Xn(l,h){let p=String(l||"").split(`
`);if(!l)return p;if(String(l||"").length>Ka)return p.map((T)=>Ke(T)||"&nbsp;");let w=wt(h);if(!w)return p.map((T)=>Ke(T));let k=[];try{let T=w.parse(l);Ga(T,Ls,(N,F,B)=>{if(!B||N>=F)return;k.push({from:N,to:F,cls:B})})}catch{return p.map((T)=>Ke(T))}if(!k.length)return p.map((T)=>Ke(T));k.sort((T,N)=>T.from-N.from||T.to-N.to);let x=[],C=0;for(let T of p)x.push(C),C+=T.length+1;let P=[],M=0;for(let T=0;T<p.length;T+=1){let N=x[T],F=N+p[T].length,B="",J=N;while(M<k.length&&k[M].to<=N)M+=1;for(let U=M;U<k.length;U+=1){let ee=k[U];if(ee.from>=F)break;let X=Math.max(N,ee.from),V=Math.min(F,ee.to);if(X>J)B+=Ke(l.slice(J,X));if(V>X)B+=`<span class="${Ke(ee.cls)}">${Ke(l.slice(X,V))}</span>`;J=Math.max(J,V)}if(J<F)B+=Ke(l.slice(J,F));P.push(B||"&nbsp;")}return P}function Ge(l){let h=(l.match(/\.([^.]+)$/)||[])[1]?.toLowerCase()||"",p={ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",cjs:"javascript",py:"python",rb:"ruby",rs:"rust",go:"go",java:"java",c:"c",h:"c",cc:"cpp",cpp:"cpp",cxx:"cpp",hpp:"cpp",hxx:"cpp",cs:"csharp",swift:"swift",kt:"kotlin",sh:"shell",bash:"bash",zsh:"zsh",fish:"shell",ps1:"powershell",psm1:"powershell",json:"json",yaml:"yaml",yml:"yaml",toml:"toml",xml:"xml",html:"html",htm:"html",css:"css",scss:"sass",sass:"sass",sql:"sql",graphql:"graphql",gql:"graphql",dockerfile:"dockerfile",makefile:"makefile",lua:"lua",perl:"perl",pl:"perl",pm:"perl",r:"r",jl:"julia",hs:"haskell",erl:"erlang",clj:"clojure",scm:"scheme",elm:"elm",ex:"elixir",exs:"elixir",proto:"protobuf",tf:"hcl",diff:"diff",patch:"diff",ini:"properties",conf:"nginx",cfg:"properties",v:"verilog",sv:"verilog",vhd:"vhdl",vhdl:"vhdl",pas:"pascal",f90:"fortran",f95:"fortran",cmake:"cmake",groovy:"groovy",gradle:"groovy",tex:"stex",latex:"stex",bib:"stex",d:"d",nim:"nim",zig:"zig",pug:"pug",jade:"pug",styl:"stylus",coffee:"coffeescript",tcl:"tcl",ml:"mllike",sml:"mllike",fs:"mllike",wasm:"wast",wat:"wast",pp:"puppet",feature:"gherkin",ttl:"turtle",rq:"sparql",xq:"xquery"},w=l.split("/").pop()?.toLowerCase()||"";if(w==="dockerfile"||w.startsWith("dockerfile."))return"dockerfile";if(w==="makefile"||w==="gnumakefile")return"cmake";if(w===".env"||w.endsWith(".env"))return"properties";if(w==="cmakelists.txt")return"cmake";if(w==="vagrantfile"||w==="rakefile"||w==="gemfile")return"ruby";return p[h]||""}var Pr=null,Is=new WeakSet;function fp(){if(window.piclawDiagrams)return Promise.resolve();if(Pr)return Pr;let l=document.createElement("script");return l.src="/static/common/js/vendor/pele.js",Pr=new Promise((h,p)=>{l.onload=()=>window.piclawDiagrams?h():p(Error("Mermaid library failed to load")),l.onerror=()=>p(Error("Mermaid library failed to load")),document.head.append(l)}).catch((h)=>{throw l.remove(),Pr=null,h}),Pr}function Wa(l){if(/(?:https?:\/\/|data:|blob:|\/\/)/i.test(l))return!1;return Array.from(l.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(p)=>p[2]?.trim()||"").every((p)=>/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(p))}function mp(l){let h=Uint8Array.from(atob(l),(w)=>w.charCodeAt(0)),p=new TextDecoder().decode(h);for(let w=0;w<2;w++){let k=p.replace(/</g,"&lt;").replace(/>/g,"&gt;"),x=new DOMParser().parseFromString(k,"text/html").documentElement.textContent||"";if(p===x)break;p=x}return p}async function Ua(l,h={}){let w=Array.from(l.querySelectorAll(".mermaid-container[data-mermaid]")).filter((x)=>!Is.has(x));for(let x of w)Is.add(x);if(!w.length)return;try{await fp();for(let x of w){let C=x.dataset.mermaid;if(!l.contains(x)||C===void 0)continue;try{let P=mp(C);if(h.scoped&&!Wa(P))throw Error("External Mermaid resources are unavailable in this view.");let M=window.piclawDiagrams.render(P),T=window.piclawDiagrams.sanitize;if(typeof T!=="function")throw Error("Diagram sanitizer is unavailable");x.innerHTML=T(M),x.removeAttribute("data-mermaid")}catch(P){k(x,P)}}}catch(x){for(let C of w)if(l.contains(C)&&C.hasAttribute("data-mermaid"))k(C,x)}finally{for(let x of w)Is.delete(x)}function k(x,C){h.reportError?.(C);let P=document.createElement("pre");P.className="mermaid-error",P.textContent="Diagram error: "+(C instanceof Error?C.message:String(C)),x.replaceChildren(P),x.removeAttribute("data-mermaid")}}var Ns={background:"#ffffff",foreground:"#18212b",muted:"#536171",accent:"#0969da",border:"#b6bec8",surface:"#f3f5f7",success:"#1a7f37",warning:"#9a6700",danger:"#cf222e"},Ya={background:"#171b22",foreground:"#e6edf3",muted:"#a2afbf",accent:"#79c0ff",border:"#586577",surface:"#242b36",success:"#7ee787",warning:"#e3b341",danger:"#ff7b72"};function Va(l="theme"){if(l==="light")return{...Ns};if(l==="dark")return{...Ya};if(typeof document>"u")return{...Ns};let h=document.documentElement,w=(h.dataset.theme||(h.classList.contains("dark")?"dark":h.classList.contains("light")?"light":typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))==="dark"?Ya:Ns;if(!document.body)return{...w};let k=document.createElement("span");k.style.display="none",document.body.append(k);try{return Object.fromEntries(Object.entries({background:"--bg-primary",foreground:"--text-primary",muted:"--text-secondary",accent:"--accent-color",border:"--border-color",surface:"--bg-secondary",success:"--success-color",warning:"--warning-color",danger:"--danger-color"}).map(([C,P])=>(k.style.color=`var(${P}, ${w[C]})`,[C,getComputedStyle(k).color])))}finally{k.remove()}}var Vf=Object.freeze({bg:"var(--bg-primary, #ffffff)",fg:"var(--text-primary, #18212b)",line:"var(--text-secondary, #536171)",accent:"var(--accent-color, #0969da)",muted:"var(--text-secondary, #536171)",surface:"var(--bg-secondary, #f3f5f7)",border:"var(--border-color, #b6bec8)"});var Tn=Object.freeze({bytes:262144,nodes:2048,depth:32,dimension:2048}),co="http://www.w3.org/2000/svg",Ja=new Set(["svg","g","defs","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","title","desc","linearGradient","radialGradient","stop","clipPath"]),gp=new Set(["x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","width","height","dx","dy","stroke-width","stroke-dashoffset","font-size"]),hp=new Set(["opacity","fill-opacity","stroke-opacity","stop-opacity","stroke-miterlimit","offset"]),Qa={"fill-rule":["nonzero","evenodd"],"clip-rule":["nonzero","evenodd"],"stroke-linecap":["butt","round","square"],"stroke-linejoin":["miter","round","bevel"],"text-anchor":["start","middle","end"],"dominant-baseline":["auto","middle","central","hanging","text-before-edge","text-after-edge","alphabetic"],"font-family":["sans-serif","serif","monospace"],"font-weight":["normal","bold","100","200","300","400","500","600","700","800","900"],"font-style":["normal","italic","oblique"],gradientUnits:["objectBoundingBox","userSpaceOnUse"],clipPathUnits:["userSpaceOnUse","objectBoundingBox"],spreadMethod:["pad","reflect","repeat"]},bp=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,Bs=/^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)$/;function Os(l){let h="";for(let p of new TextEncoder().encode(l))h+=String.fromCharCode(p);return btoa(h)}function vn(l){return new TextDecoder().decode(Uint8Array.from(atob(l),(h)=>h.charCodeAt(0)))}function Hs(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function uo(l){return bp.test(l)&&Number.isFinite(Number(l))&&Math.abs(Number(l))<=1e6}function lo(l){let h=l.trim().split(/[\s,]+/);return h.length&&h.every(uo)?h.map(Number):null}function yp(l,h){if(l==="id")return/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(h);if(gp.has(l))return uo(h.replace(/(?:px|%)$/,""));if(hp.has(l))return uo(h.replace(/%$/,""));if(Object.hasOwn(Qa,l))return Qa[l].includes(h);if(["fill","stroke","color","stop-color"].includes(l))return/^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+,\s/-]+\))$/i.test(h)||Bs.test(h);if(l==="clip-path")return h==="none"||Bs.test(h);if(l==="viewBox"){let p=lo(h);return!!p&&p.length===4&&p[2]>0&&p[3]>0}if(l==="points"||l==="stroke-dasharray")return h==="none"||lo(h)!==null;if(l==="d")return/^[MmZzLlHhVvCcSsQqTtAa\dEe+.,\s-]*$/.test(h);if(l==="transform"||l==="gradientTransform")return h.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/g,(w,k)=>lo(k)?"":w).trim()==="";return!1}var sn=new Map,wp=8,Xa=2097152,Fs=0;function Za(l,h="theme"){if(l.length>Tn.bytes)return null;let p=Va(h),w=JSON.stringify(p)+l,k=sn.get(w);if(k)return sn.delete(w),sn.set(w,k),k.image;let x=vp(l,p),C=2*(w.length+(x?.src.length||0)+(x?.label.length||0));if(C<=Xa){while(sn.size>=wp||Fs+C>Xa){let P=sn.keys().next().value;Fs-=sn.get(P).size,sn.delete(P)}sn.set(w,{image:x,size:C}),Fs+=C}return x}function vp(l,h){if(l.length>Tn.bytes||new TextEncoder().encode(l).byteLength>Tn.bytes)return null;if(/<!\s*(?:DOCTYPE|ENTITY)|<\?/i.test(l))return null;let p=new DOMParser().parseFromString(l,"image/svg+xml"),w=p.documentElement;if(!w||w.localName!=="svg"||p.querySelector("parsererror")||p.doctype)return null;let k=[{node:w,depth:1}],x=0;while(k.length){let{node:V,depth:ne}=k.pop();if(++x>Tn.nodes||ne>Tn.depth)return null;for(let G=V.lastChild;G;G=G.previousSibling){if(x+k.length>=Tn.nodes)return null;k.push({node:G,depth:ne+(G.nodeType===1?1:0)})}}let C=document.implementation.createDocument(co,"svg",null),P=new Map,M=[];function T(V,ne,G){if(V.hasAttribute("xmlns")&&V.getAttribute("xmlns")!==co)return!1;if(V.namespaceURI!==w.namespaceURI||V.namespaceURI&&V.namespaceURI!==co||V.prefix||!Ja.has(V.localName))return!1;if(V!==w&&V.localName==="svg")return!1;let me=G||["defs","clipPath","linearGradient","radialGradient"].includes(V.localName);for(let Ce of Array.from(V.attributes)){if(Ce.namespaceURI||Ce.prefix)continue;let be=Ce.name,He=Ce.value.trim();if(["fill","stroke","color","stop-color"].includes(be)){let cn=He.match(/^var\(--svg-(background|foreground|muted|accent|border|surface|success|warning|danger)\)$/);if(cn)He=h[cn[1]]}if(!yp(be,He))continue;let Kt=He.match(Bs);if(Kt){if(me||!["fill","stroke","clip-path"].includes(be))continue;M.push({element:ne,name:be,id:Kt[1]})}if(be==="id"){if(P.has(He))return!1;P.set(He,ne)}ne.setAttribute(be,He)}for(let Ce of Array.from(V.childNodes))if(Ce.nodeType===1){let be=Ce;if(!Ja.has(be.localName))return!1;let He=C.createElementNS(co,be.localName);if(!T(be,He,me))return!1;ne.appendChild(He)}else if(Ce.nodeType===3||Ce.nodeType===4)ne.appendChild(C.createTextNode(Ce.nodeValue||""));else if(Ce.nodeType!==8)return!1;return!0}if(!T(w,C.documentElement,!1))return null;for(let V of M){let ne=P.get(V.id)?.localName;if(!(V.name==="clip-path"?ne==="clipPath":ne==="linearGradient"||ne==="radialGradient"))V.element.removeAttribute(V.name)}let N=C.documentElement;if(!N.hasAttribute("color"))N.setAttribute("color",h.foreground);if(!N.hasAttribute("fill"))N.setAttribute("fill","currentColor");let F=lo(N.getAttribute("viewBox")||""),B=(V,ne)=>{let G=N.getAttribute(V)?.replace(/px$/,"")||"";return uo(G)&&Number(G)>0?Number(G):ne},J=B("width",F?.[2]||300),U=B("height",F?.[3]||150),ee=Math.min(1,Tn.dimension/Math.max(J,U));if(N.setAttribute("width",String(J*ee)),N.setAttribute("height",String(U*ee)),!F)N.setAttribute("viewBox",`0 0 ${J} ${U}`);N.setAttribute("preserveAspectRatio","xMidYMid meet");let X=(N.querySelector("title")?.textContent?.trim()||N.querySelector("desc")?.textContent?.trim()||"Model-generated SVG").replace(/\s+/g," ").slice(0,256);return Object.freeze({src:`data:image/svg+xml;base64,${Os(new XMLSerializer().serializeToString(N))}`,label:X})}function ec(l,h,p,w={}){if(!/^ {0,3}(?:`{3,}|~{3,})svg\s*$/im.test(l))return h(l);let k=l.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean)||[],x=null,C=/^(?:\uFEFF)?---(?:\r?\n|\r)/.test(l),P=0,M=[],T=[],N=`PICLAWSVG${Array.from(crypto.getRandomValues(new Uint32Array(4)),(B)=>B.toString(16)).join("")}BLOCK`;for(let B=0;B<k.length;B++){let J=k[B].replace(/[\r\n]+$/,"");if(C){if(B>0&&/^(---|\.\.\.)\s*$/.test(J))C=!1;continue}if(x){if(new RegExp(`^ {0,3}${x.char}{${x.length},}\\s*$`).test(J))x=null;continue}let U=J.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(!U)continue;if(x={char:U[1][0],length:U[1].length},!/^svg\s*$/i.test(U[2]))continue;let ee=new RegExp(`^ {0,3}${x.char}{${x.length},}\\s*$`),X=B+1;while(X<k.length&&!ee.test(k[X].replace(/[\r\n]+$/,"")))X++;if(B>P)M.push(k.slice(P,B).join(""));let V=k.slice(B+1,X).join(""),ne=w.sanitize===!1?null:X<k.length?Za(V):null,G=p(V);M.push(`

${N}${T.length}END

`),T.push(w.sanitize===!1&&X<k.length?V:ne?`<div class="model-svg-block" data-svg-surface="theme"><div class="model-svg-controls"><label>SVG background <select class="model-svg-surface" aria-label="SVG background"><option value="theme">Theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><img class="model-svg-image" src="${ne.src}" alt="${Hs(ne.label)}"><details class="model-svg-source"><summary>SVG source</summary>${G}</details></div>`:G),B=X,P=X+1,x=null}if(!T.length)return h(l);if(P<k.length)M.push(k.slice(P).join(""));return h(M.join("")).replace(new RegExp(`(?:<p>)?${N}(\\d+)END(?:<\\/p>)?`,"g"),(B,J)=>T[Number(J)])}function er(l){let h=Array.from(l.querySelectorAll(".model-svg-block"));if(!h.length)return()=>{};let p=(x)=>{let C=x.dataset.svgSurface,P=x.querySelector(".model-svg-image"),M=x.querySelector("[data-svg-source], .code-block__copy[data-code]");if(!P||!M)return;let T=Za(vn(M.dataset.svgSource||M.dataset.code||""),C);if(T&&P.getAttribute("src")!==T.src)P.src=T.src},w=()=>h.forEach((x)=>{if(x.dataset.svgSurface==="theme")p(x)}),k=(x)=>{let C=x.target;if(!C?.matches(".model-svg-surface"))return;let P=C.closest(".model-svg-block");if(!P||!["theme","light","dark"].includes(C.value))return;P.dataset.svgSurface=C.value,p(P)};return l.addEventListener("change",k),window.addEventListener("piclaw-theme-change",w),w(),()=>{l.removeEventListener("change",k),window.removeEventListener("piclaw-theme-change",w)}}function tc(l){if(typeof l!=="string"||!l.trim()||l.length>2048)throw Error("Provide a GitHub/Gitea repository web URL.");let h=l.trim();if(!/^https?:\/\//i.test(h)||/[\\\s]/.test(h))throw Error("Repository URL must use HTTP or HTTPS.");let p=new URL(h);if(!["http:","https:"].includes(p.protocol)||p.username||p.password||p.search||p.hash)throw Error("Repository URL cannot contain credentials, a query or a fragment.");let w=p.pathname.replace(/\/+$/,"").split("/").slice(1);if(w.length<2||w.some((P)=>!/^[a-zA-Z0-9_.-]+$/.test(P)||P==="."||P===".."))throw Error("Use a repository URL ending in owner/repository (an installation subpath is allowed).");if(h.slice(h.indexOf("://")+3).split("/").slice(1).some((P)=>P==="."||P===".."))throw Error("Repository URL cannot contain traversal segments.");if(w.at(-1).endsWith(".git"))w[w.length-1]=w.at(-1).slice(0,-4);if(!w.at(-1))throw Error("Repository name is required.");if(p.hostname.toLowerCase()==="github.com"&&w.length!==2)throw Error("GitHub repository URLs must end at github.com/owner/repository.");if(p.hostname.toLowerCase()!=="github.com"&&w.length!==2&&w.length!==3)throw Error("Gitea repository URLs must be owner/repository or installation-base/owner/repository.");let x=new Set(["issues","issue","pulls","pull","explore","src","commits","commit","actions","releases","projects","settings","wiki","compare","branches","tags","milestones"]),C=w.at(-1).toLowerCase();if(w.some((P)=>x.has(P.toLowerCase()))||/^\d+$/.test(C))throw Error("Repository URL must identify a repository root, not an issue, pull request or explorer page.");return`${p.origin}/${w.join("/")}`}function nc(l,h=null,p=!0){if(typeof DOMParser>"u")return l;let w=null;if(h)try{w=tc(h)}catch{w=null}let k=new DOMParser().parseFromString(l,"text/html"),x=k.createTreeWalker(k.body,NodeFilter.SHOW_TEXT),C=[];while(x.nextNode())C.push(x.currentNode);for(let P of C){if(P.parentElement?.closest("a, code, pre, script, style, svg, math, .katex"))continue;let M=P.nodeValue||"",T=[...M.matchAll(/#(\w+)/g)];if(!T.length)continue;let N=k.createDocumentFragment(),F=0;for(let B of T){let J=B.index,U=J+B[0].length,ee=B[1];if(N.append(k.createTextNode(M.slice(F,J))),F=U,/^\d+$/.test(ee)){let X=M[J-1]||"",V=M[U]||"",ne=!X||/[\s([{>,;:!?]/.test(X);if(!w||!/^[1-9]\d*$/.test(ee)||!ne||/[\p{L}\p{N}_/\-]/u.test(V)){N.append(k.createTextNode(B[0]));continue}let G=k.createElement("a");G.href=`${w}/issues/${ee}`,G.className="project-reference",G.target="_blank",G.rel="noopener noreferrer",G.title=`${w} #${ee}`,G.textContent=B[0],N.append(G)}else{if(!p){N.append(k.createTextNode(B[0]));continue}let X=k.createElement("a");X.href="#",X.className="hashtag",X.setAttribute("data-hashtag",ee),X.textContent=B[0],N.append(X)}}N.append(k.createTextNode(M.slice(F))),P.replaceWith(N)}return k.body.innerHTML}var Sp=new Set(["code","pre","strong","em","b","i","u","s","del","ins","sub","sup","mark","small","br","p","ul","ol","li","blockquote","ruby","rt","rp","span","input"]),$p=new Set(["a","abbr","blockquote","br","code","del","div","em","hr","h1","h2","h3","h4","h5","h6","i","img","input","ins","kbd","li","mark","ol","p","pre","ruby","rt","rp","s","small","span","strong","sub","sup","table","tbody","td","th","thead","tr","u","ul","math","semantics","mrow","mi","mn","mo","mtext","mspace","msup","msub","msubsup","mfrac","msqrt","mroot","mtable","mtr","mtd","annotation","svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]),kp=new Set(["class","title","role","aria-hidden","aria-label","aria-expanded","aria-live","data-mermaid","data-hashtag"]),xp={a:new Set(["href","target","rel"]),img:new Set(["src","alt","title"]),input:new Set(["type","checked","disabled"])},_p=new Set(["http:","https:","mailto:",""]),zs=new Set(["svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]);function Ep(l,h){let p=String(l||"").toLowerCase(),w=String(h||"").toLowerCase();if(!w||w.startsWith("on"))return!1;if(w.startsWith("data-")||w.startsWith("aria-"))return!0;if(zs.has(p))return!0;return(xp[p]||new Set).has(w)||kp.has(w)}function qn(l){return String(l||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;")}function Te(l,h={}){if(!l)return null;let p=String(l).trim();if(!p)return null;if(p.startsWith("#")||p.startsWith("/"))return p;if(p.startsWith("data:")){if(h.allowDataImage&&/^data:image\//i.test(p))return p;return null}if(p.startsWith("blob:"))return p;try{let w=new URL(p,typeof window<"u"?window.location.origin:"http://localhost");if(!_p.has(w.protocol))return null;return w.href}catch{return null}}function rc(l,h={}){if(!l)return"";if(h?.sanitize===!1)return l;let p=new DOMParser().parseFromString(l,"text/html"),w=[],k=p.createTreeWalker(p.body,NodeFilter.SHOW_ELEMENT),x;while(x=k.nextNode())w.push(x);for(let C of w){let P=C.tagName.toLowerCase();if(!$p.has(P)){let M=C.parentNode;if(!M)continue;while(C.firstChild)M.insertBefore(C.firstChild,C);M.removeChild(C);continue}for(let M of Array.from(C.attributes)){let T=M.name.toLowerCase(),N=M.value;if(T.startsWith("on")){C.removeAttribute(M.name);continue}if(Ep(P,T)){if(zs.has(P)&&typeof h.rewriteImageSrc==="function"){let F=Array.from(N.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(J)=>J[2]?.trim()||"");if(/(?:https?:|data:|blob:|\/\/)/i.test(N)||F.some((J)=>!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(J))){C.removeAttribute(M.name);continue}}if(T==="href"||T==="xlink:href"){let F=typeof h.rewriteImageSrc==="function"&&zs.has(P)?/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(N.trim())?N.trim():h.rewriteImageSrc(N):N,B=Te(F);if(!B)C.removeAttribute(M.name);else if(C.setAttribute(M.name,B),P==="a"){if(!C.getAttribute("rel"))C.setAttribute("rel","noopener noreferrer");if(/^https?:\/\//i.test(B))C.setAttribute("target","_blank")}}else if(T==="src"){let F=typeof h.rewriteImageSrc==="function"&&(P==="img"||P==="image")?h.rewriteImageSrc(N):N,B=Te(F,{allowDataImage:P==="img"&&typeof h.rewriteImageSrc!=="function"});if(!B)C.removeAttribute(M.name);else C.setAttribute(M.name,B)}continue}C.removeAttribute(M.name)}}return p.body.innerHTML}function qs(l){if(!l)return l;let h=l.replace(/</g,"&lt;").replace(/>/g,"&gt;");return new DOMParser().parseFromString(h,"text/html").documentElement.textContent}function Cp(l,h=2){if(!l)return l;let p=l;for(let w=0;w<h;w+=1){let k=qs(p);if(k===p)break;p=k}return p}function Ap(l){if(!l)return{text:"",frontmatter:null};let h=l.replace(/^\uFEFF/,"").replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!h.startsWith(`---
`))return{text:h,frontmatter:null};let p=h.split(`
`),w=-1;for(let C=1;C<p.length;C+=1)if(/^(---|\.\.\.)\s*$/.test(p[C])){w=C;break}if(w<=0)return{text:h,frontmatter:null};let k=p.slice(1,w).join(`
`);return{text:p.slice(w+1).join(`
`).replace(/^\n+/,""),frontmatter:k}}function Rp(l){let{text:h,frontmatter:p}=Ap(l);if(p===null)return h;return["<!--frontmatter-block-start-->","```yaml",p,"```","<!--frontmatter-block-end-->",h].filter(Boolean).join(`

`)}function Pp(l){if(!l)return l;return Cp(l,5)}function Lp(l){let h=new TextEncoder().encode(String(l||"")),p="";for(let w of h)p+=String.fromCharCode(w);return btoa(p)}function Tp(l){if(!l)return l;return l.replace(/<pre><code(?:\s+class="language-([A-Za-z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/g,(p,w,k)=>{let x=String(w||"").trim().toLowerCase(),C=qs(k),P=x||"plaintext",M=$e(C,x);return`<pre><code class="hljs language-${qn(P)}">${M}</code></pre>`}).replace(/<!--frontmatter-block-start-->\s*<pre>/g,'<pre class="frontmatter-block">').replace(/<\/pre>\s*<!--frontmatter-block-end-->/g,"</pre>")}var Mp={span:new Set(["title","class","lang","dir"]),input:new Set(["type","checked","disabled"])};function Dp(l,h){let p=Mp[l];if(!p||!h)return"";let w=[],k=/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g,x;while(x=k.exec(h)){let C=(x[1]||"").toLowerCase();if(!C||C.startsWith("on")||!p.has(C))continue;let P=x[2]??x[3]??x[4]??"";w.push(` ${C}="${qn(P)}"`)}return w.join("")}function jp(l){if(!l)return l;return l.replace(/&lt;((?:[^"'<>]|"[^"]*"|'[^']*')*?)(?:&gt;|>)/g,(h,p)=>{let w=p.trim(),k=w.startsWith("/"),x=k?w.slice(1).trim():w,P=x.endsWith("/")?x.slice(0,-1).trim():x,[M=""]=P.split(/\s+/,1),T=M.toLowerCase();if(!T||!Sp.has(T))return h;if(T==="br")return k?"":"<br>";if(k)return`</${T}>`;let N=P.slice(M.length).trim(),F=Dp(T,N);return`<${T}${F}>`})}function oc(l,h=!0){if(typeof l.text!=="string")return;if(l.type==="code"&&h){let p=l.lang?.trim().toLowerCase();if(p==="mermaid"){l.type="html",l.text=`<div class="mermaid-container" data-mermaid="${Lp(Pp(l.text))}"><div class="mermaid-loading">Loading diagram...</div></div>`;return}if(p&&["math","katex","latex"].includes(p)){l.type="html",l.text=`<p>$$
${qn(l.text)}
$$</p>
`;return}}if(l.type!=="html")return;if(/^<!--frontmatter-block-(?:start|end)-->\s*$/.test(l.text))return;l.text=jp(l.text.replace(/</g,"&lt;"))}function Ip(l){if(!window.katex)return l;let h=(C)=>qs(C).replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&").replace(/<br\s*\/?\s*>/gi,`
`),p=(C)=>{let P=[],M=C.replace(/<pre\b[^>]*>\s*<code\b[^>]*>[\s\S]*?<\/code>\s*<\/pre>/gi,(T)=>{let N=P.length;return P.push(T),`@@CODE_BLOCK_${N}@@`});return M=M.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi,(T)=>{let N=P.length;return P.push(T),`@@CODE_INLINE_${N}@@`}),{html:M,blocks:P}},w=(C,P)=>{if(!P.length)return C;return C.replace(/@@CODE_(?:BLOCK|INLINE)_(\d+)@@/g,(M,T)=>{let N=Number(T);return P[N]??""})},k=p(l),x=k.html;return x=x.replace(/(^|\n|<br\s*\/?\s*>|<p>|<\/p>)\s*\$\$([\s\S]+?)\$\$\s*(?=\n|<br\s*\/?\s*>|<\/p>|$)/gi,(C,P,M)=>{try{let T=katex.renderToString(h(M.trim()),{displayMode:!0,throwOnError:!1});return`${P}${T}`}catch(T){let N=T instanceof Error?T.message:String(T);return`<span class="math-error" title="${qn(N)}">${C}</span>`}}),w(x,k.blocks)}function Np(l,h=null){return nc(l,h)}function Fp(l){return{safeHtml:Rp(l||"")}}var Bp=new Set(["NOTE","TIP","IMPORTANT","WARNING","CAUTION"]),Op={NOTE:"Note",TIP:"Tip",IMPORTANT:"Important",WARNING:"Warning",CAUTION:"Caution"};function Hp(l){return l.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>\s*)?(\n)?/gi,(h,p,w)=>{let k=p.toUpperCase();if(!Bp.has(k))return h;let x=Op[k]||k;return`<div class="admonition admonition-${k.toLowerCase()}"><p class="admonition-title">${x}</p><p>`}).replace(/(<div class="admonition admonition-[a-z]+">(?:(?!<\/div>)[\s\S])*?)<\/blockquote>/g,(h,p)=>`${p}</div>`)}function y(l,h,p={}){if(!l)return"";return ec(l,(w)=>zp(w,p),(w)=>`<pre><code class="language-svg" data-svg-source="${Os(w)}">${Hs(w)}</code></pre>`,{sanitize:typeof window>"u"||window.__PICLAW_SANITIZE_SVG_FENCES__!==!1})}function zp(l,h){let{safeHtml:p}=Fp(l),w=window.marked?marked.parse(p,{headerIds:!1,mangle:!1,walkTokens:oc}):qn(p).replace(/\n/g,"<br>");return w=Tp(w),w=Ip(w),w=Np(w,h.projectRepository),w=Hp(w),w=rc(w,h),w}function W(l){if(!l)return"";let h=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`),p=window.marked?marked.parse(h,{walkTokens:(w)=>oc(w,!1)}):qn(h).replace(/\n/g,"<br>");return p=rc(p),p}async function q(l,h={}){await Ua(l,{scoped:typeof h.rewriteImageSrc==="function",reportError:(p)=>console.error("Mermaid render error:",p)})}function Ee(l){if(!l||typeof l!=="object")return null;let h=l.started_at??l.startedAt;if(typeof h!=="string"||!h)return null;let p=Date.parse(h);return Number.isFinite(p)?p:null}function qp(l){if(!l||typeof l!=="object")return null;let h=l.retry_at??l.retryAt;if(typeof h!=="string"||!h)return null;let p=Date.parse(h);return Number.isFinite(p)?p:null}function ce(l){if(!l||typeof l!=="object")return null;let h=l.last_event_at??l.lastEventAt??l.started_at??l.startedAt;if(typeof h!=="string"||!h)return null;let p=Date.parse(h);return Number.isFinite(p)?p:null}function z(l){if(!l||typeof l!=="object")return!1;let h=l.intent_key??l.intentKey;return l.type==="intent"&&h==="compaction"}function xt(l){if(!l||typeof l!=="object")return"";let h=l.title;if(typeof h==="string"&&h.trim())return h.trim();let p=l.tool_name??l.toolName;if(typeof p==="string"&&p.trim())return p.trim();let w=l.status;if(typeof w==="string"&&w.trim())return w.trim();return z(l)?"Compacting context":"Thinking..."}function sc(l){let h=Math.max(0,Math.floor(l/1000)),p=h%60,w=Math.floor(h/60)%60,k=Math.floor(h/3600);if(k>0)return`${k}:${String(w).padStart(2,"0")}:${String(p).padStart(2,"0")}`;return`${w}:${String(p).padStart(2,"0")}`}function Ie(l,h=Date.now()){let p=Ee(l);if(p===null)return null;return sc(Math.max(0,h-p))}function tr(l,h=Date.now()){let p=qp(l);if(p===null)return null;let w=p-h;if(w<=0)return"retrying now";return`retry in ${sc(w)}`}function b(l={}){let h=l.window??(typeof window<"u"?window:null),p=l.navigator??(typeof navigator<"u"?navigator:null);if(p&&p.standalone===!0)return!0;if(!h||typeof h.matchMedia!=="function")return!1;return["(display-mode: standalone)","(display-mode: minimal-ui)","(display-mode: fullscreen)"].some((k)=>{try{return Boolean(h.matchMedia(k)?.matches)}catch{return!1}})}function Re(l={}){let h=l.window??(typeof window<"u"?window:null),p=l.navigator??(typeof navigator<"u"?navigator:null);if(!h&&!p)return!1;let w=String(p?.userAgent||""),k=Number(p?.maxTouchPoints||0),x=/Android|webOS|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(w),C=(()=>{if(!h||typeof h.matchMedia!=="function")return!1;try{return Boolean(h.matchMedia("(pointer: coarse)")?.matches||h.matchMedia("(any-pointer: coarse)")?.matches)}catch{return!1}})();return Boolean(x||k>1||C)}function nr(l,h={}){if(b(h))return null;if(Re(h))return{target:"_blank",features:void 0,mode:"tab"};return{target:Gp(l),features:"popup=yes,width=900,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function wn(l,h={}){let p=h.window??(typeof window<"u"?window:null);if(!p||!l)return null;try{return l.features?p.open("about:blank",l.target,l.features):p.open("about:blank",l.target)}catch{return null}}function xn(l,h={}){if(!l||!l.document)return;try{let p=String(h.title||"Opening branch…"),w=String(h.message||"Preparing a new branch window…");l.document.title=p;let k=l.document.body;if(!k)return;if(typeof l.document.createElement!=="function"){k.textContent=`${p}
${w}`;return}let x=l.document.createElement("div");x.setAttribute("style","font-family: system-ui, sans-serif; padding: 24px; color: #222;");let C=l.document.createElement("h1");C.setAttribute("style","font-size: 18px; margin: 0 0 12px;"),C.textContent=p;let P=l.document.createElement("p");if(P.setAttribute("style","margin: 0; line-height: 1.5;"),P.textContent=w,x.appendChild(C),x.appendChild(P),typeof k.replaceChildren==="function")k.replaceChildren(x);else k.innerHTML="",k.appendChild(x)}catch{return}}function Sn(l,h){if(!l||!h)return;try{if(l.location&&typeof l.location.replace==="function"){l.location.replace(String(h));return}l.location=String(h)}catch{return}}function kn(l){if(!l||typeof l.close!=="function")return;try{l.close()}catch{return}}function v(l,h,p={}){let w=new URL(String(l||"http://localhost/")),k=String(h||"").trim()||"web:default";if(w.searchParams.set("chat_jid",k),w.searchParams.delete("branch_loader"),w.searchParams.delete("branch_source_chat_jid"),w.searchParams.delete("pane_popout"),w.searchParams.delete("pane_path"),w.searchParams.delete("pane_label"),p.chatOnly===!0)w.searchParams.set("chat_only","1");return w.toString()}function An(l,h,p={}){let w=new URL(String(l||"http://localhost/")),k=String(h||"").trim()||"web:default";if(w.searchParams.set("branch_loader","1"),w.searchParams.set("branch_source_chat_jid",k),w.searchParams.delete("chat_jid"),w.searchParams.delete("pane_popout"),w.searchParams.delete("pane_path"),w.searchParams.delete("pane_label"),p.chatOnly===!0)w.searchParams.set("chat_only","1");return w.toString()}function rr(l,h,p={}){let w=new URL(String(l||"http://localhost/")),k=String(h||"").trim();if(!k)return w.toString();if(w.searchParams.set("pane_popout","1"),w.searchParams.set("pane_path",k),p?.label)w.searchParams.set("pane_label",String(p.label));else w.searchParams.delete("pane_label");if(p?.chatJid)w.searchParams.set("chat_jid",String(p.chatJid));let x=p?.params&&typeof p.params==="object"?p.params:null;if(x)for(let[C,P]of Object.entries(x)){let M=String(C||"").trim();if(!M)continue;if(P===null||P===void 0||P==="")w.searchParams.delete(M);else w.searchParams.set(M,String(P))}return w.searchParams.delete("chat_only"),w.searchParams.delete("branch_loader"),w.searchParams.delete("branch_source_chat_jid"),w.toString()}function Gp(l){return`piclaw-chat-${String(l||"web:default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function Kp(l){return`piclaw-pane-${String(l||"pane").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function or(l,h={}){if(b(h))return null;if(Re(h))return{target:"_blank",features:void 0,mode:"tab"};return{target:Kp(l),features:"popup=yes,width=1200,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function le(l){let h=l instanceof Error?l.message:String(l||"").trim(),p=String(h||"").trim();if(!p)return"PiClaw could not open a new branch window.";let w=p.toLowerCase();if(w.includes("no stable turn boundary"))return"This chat is still in flight and does not yet have a stable turn boundary to fork from.";if(w.includes("cannot fork a branch while the source chat is still active"))return"This chat is still active. Please wait for the current turn to settle, then try again.";if(w.includes("cancelled"))return"Branch creation was cancelled before a new chat window could be opened.";if(w.includes("did not return a chat id"))return"PiClaw created no usable branch id for the new window. Please try again.";if(w.includes("failed to fork branch")||w.includes("failed to fork chat branch"))return"PiClaw could not create the new branch. Please try again.";return p}var po=new Map,Gs=new Set,an,Ks=()=>{for(let l of Gs)l()};function ir(l,h){if(!l||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(h.id)||!h.label||typeof h.start!=="function"||typeof h.availability!=="function")throw Error("Invalid dictation provider registration.");if(po.has(h.id))throw Error("Duplicate dictation provider.");let p=Object.freeze({owner:l,provider:Object.freeze({...h})});po.set(h.id,p);let w=!1;return()=>{if(w)return;if(w=!0,an===p)an=void 0;po.delete(h.id),Ks()}}function sr(l,h){if(h===null){if(an?.owner===l)an=void 0,Ks();return}let p=po.get(h);if(!p||p.owner!==l)throw Error("Dictation provider belongs to another add-on or is unregistered.");if(an&&an!==p)throw Error("Another enabled dictation provider owns the composer.");an=p,Ks()}function Mn(){return an}function fo(l){return Gs.add(l),()=>{Gs.delete(l)}}var Wp=[[`Continue working toward the active thread goal.
`,"Continue goal","objective"],[`The active thread goal objective was edited by the user.
`,"Goal updated","untrusted_objective"],[`The active thread goal has reached its token budget.
`,"Goal budget reached","objective"],[`The current Plan Sidebar checklist has no pending or in-progress items.
`,"Finalize goal","objective"]];function St(l){let h=/^🎯 (?:Continue goal|Goal updated|Goal budget reached|Finalize goal): /.test(l),p=Wp.find(([k])=>l.startsWith(k));if(!h&&!p)return l;let w=/\n\n<piclaw_goal_input>([^\n]*)<\/piclaw_goal_input>$/.exec(l);if(!w)return l;try{let k=JSON.parse(w[1]);if(!k||Object.keys(k).sort().join(",")!=="generation,goalId"||typeof k.goalId!=="string"||!k.goalId.trim()||k.goalId!==k.goalId.trim()||k.goalId.length>256||!Number.isSafeInteger(k.generation)||k.generation<1)return l;let x=l.slice(0,w.index);if(h)return x;let[,C,P]=p,M=new RegExp(`<${P}>
([\\s\\S]*?)
</${P}>`).exec(x)?.[1];if(M===void 0)return l;let T={lt:"<",gt:">",amp:"&",quot:'"',"#39":"'",apos:"'"};return`\uD83C\uDFAF ${C}: ${M.replace(/&(lt|gt|amp|quot|#39|apos);/g,(N,F)=>T[F])}`}catch{return l}}class Ws{host;timeoutMs;current;pendingSubmit;constructor(l,h=15000){this.host=l;this.timeoutMs=h;if(!Number.isSafeInteger(h)||h<=0)throw Error("Invalid dictation deadline.")}get active(){return!!this.current}async start(l){if(this.current)throw Error("A dictation session already owns this composer.");if(!l.availability().available){this.host.state("error","Selected dictation provider is unavailable.");return}let h=this.host.readDraft(),p=new AbortController,w,k,x=new Promise((M,T)=>{w=M,k=T}),C={controller:p,provider:l,chatJid:h.chatJid,revision:h.revision,start:Math.min(h.selectionStart,h.selectionEnd),end:Math.max(h.selectionStart,h.selectionEnd),text:h.text,segments:[],starting:x};this.current=C,this.host.state("loading"),Promise.resolve().then(()=>l.start({signal:p.signal,chatJid:h.chatJid,setState:(M)=>{if(this.current!==C||p.signal.aborted)return;if(M==="error")C.error="Dictation provider failed. Draft preserved.",this.cancel(),this.host.state("error",C.error);else if(!C.finishing||M!=="loading"&&M!=="recording")this.host.state(M)},updateSegment:(M)=>this.updateSegment(C,M)})).then(w,k);try{if(await this.bounded(x,p.signal),this.current===C&&!p.signal.aborted&&!C.finishing)this.host.state("recording")}catch{let M=p.signal.aborted;if(p.abort(),!M)C.error="Dictation could not start. Draft preserved.";if(this.cancel(),C.error&&this.current===C)this.host.state("error",C.error)}}updateSegment(l,h){if(this.current!==l||l.controller.signal.aborted||!h.segmentId||h.segmentId.length>128||typeof h.text!=="string"||h.text.length>65536||typeof h.final!=="boolean")return{applied:!1};let p=this.host.readDraft();if(p.chatJid!==l.chatJid||p.revision!==l.revision||p.text!==l.text)return{applied:!1};let w=l.segments.find((N)=>N.id===h.segmentId);if(w?.final)return{applied:w.text===h.text&&h.final};let k=l.segments.map((N)=>({...N})),x=k.findIndex((N)=>N.id===h.segmentId),C={id:h.segmentId,text:h.text,final:h.final};if(x<0){if(k.length>=256)return{applied:!1};k.push(C)}else k[x]=C;let P=k.map((N)=>N.text).join("");if(P.length>131072)return{applied:!1};let M=p.text.slice(0,l.start)+P+p.text.slice(l.end);if(!this.host.writeDraft(M,p.revision))return{applied:!1};let T=this.host.readDraft();if(T.chatJid!==l.chatJid||T.text!==M)return{applied:!1};return l.segments=k,l.end=l.start+P.length,l.text=M,l.revision=T.revision,{applied:!0}}draftChanged(l,h){let p=this.current;if(!p||p.controller.signal.aborted)return;if(l.chatJid!==p.chatJid||h.chatJid!==p.chatJid||l.revision!==p.revision||l.text!==p.text){this.cancel();return}let w=0;while(w<l.text.length&&w<h.text.length&&l.text[w]===h.text[w])w++;let k=0;while(k<l.text.length-w&&k<h.text.length-w&&l.text.at(-1-k)===h.text.at(-1-k))k++;let x=l.text.length-k,C=h.text.length-l.text.length;if(x<=p.start&&w<p.start)p.start+=C,p.end+=C;else if(w<p.end||p.start===p.end&&w===p.start){this.cancel();return}p.text=h.text,p.revision=h.revision}finish(){let l=this.current;if(!l)return Promise.resolve({status:"cancelled"});if(!l.finishing)this.host.state("finishing"),l.finishing=(async()=>{try{let h=await this.bounded(l.starting,l.controller.signal),p=await this.bounded(Promise.resolve().then(()=>h.finish()),l.controller.signal);if(l.error)throw Error("Dictation provider failed.");if(this.current!==l||l.controller.signal.aborted)return{status:"cancelled"};if(p.status!=="finished")return this.cancel(),{status:"cancelled"};return l.controller.abort(),this.current=void 0,this.host.state("idle"),p}catch{if(l.controller.signal.aborted&&!l.error)return{status:"cancelled"};if(this.current===l)l.error="Dictation could not finish. Draft preserved; send again explicitly.",this.cancel(),this.host.state("error",l.error);throw Error("Dictation finish failed.")}})();return l.finishing}cancel(){let l=this.current;if(!l)return Promise.resolve();if(l.controller.abort(),!l.cancelling)l.cancelling=(async()=>{try{await(await l.starting).cancel()}catch{l.error??="Dictation cleanup failed."}finally{if(this.current===l)if(this.current=void 0,l.error)this.host.state("error",l.error);else this.host.state("idle")}})();return l.cancelling}submit(l){if(this.pendingSubmit)return this.pendingSubmit;let h=this.current;return this.pendingSubmit=(async()=>{if(h){if((await this.finish()).status!=="finished")return!1}return await l(),!0})().finally(()=>{this.pendingSubmit=void 0}),this.pendingSubmit}bounded(l,h){return new Promise((p,w)=>{let k,x=()=>{clearTimeout(k),w(Error("Dictation cancelled."))};if(h.aborted){w(Error("Dictation cancelled."));return}h.addEventListener("abort",x,{once:!0}),k=setTimeout(()=>{h.removeEventListener("abort",x),w(Error("Dictation deadline exceeded."))},this.timeoutMs),l.then((C)=>{clearTimeout(k),h.removeEventListener("abort",x),p(C)},(C)=>{clearTimeout(k),h.removeEventListener("abort",x),w(C)})})}}function ic(l){let h=0,p=l.read(),w=!1,k=0,C=new Ws({readDraft:()=>(P(),{...l.read(),revision:h}),writeDraft:(N,F)=>{if(P(),w||h!==F)return!1;return l.write(N),h++,p={...l.read(),text:N},!0},state:l.state});function P(){let N=l.read();if(N.text!==p.text||N.chatJid!==p.chatJid){k++;let F={...p,revision:h};h++,p=N,C.draftChanged(F,{...N,revision:h})}}let M=Mn()?.provider,T=fo(()=>{let N=Mn()?.provider;if(N!==M){if(k++,C.active)C.cancel();if(N)l.providerSelected?.()}M=N});return{get selected(){return Mn()?.provider},get active(){return C.active},draftChanged:P,async toggle(){P();let N=Mn()?.provider;if(!N)return!1;if(C.active)await C.finish();else await C.start(N);return!0},submit(N){P();let F=k,B=l.read().chatJid,J=Mn()?.provider;return C.submit(async()=>{if(P(),w||k!==F||l.read().chatJid!==B||Mn()?.provider!==J)return;await N()})},async dispose(){w=!0,T(),await C.cancel()},cancel:()=>(k++,C.cancel())}}var Us="piclaw:statusbar-compose-slot";function Ys(){if(typeof document>"u")return null;return document.querySelector(".workbench-statusbar-compose")}function Cn(){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent("piclaw:statusbar-compose-slot"))}function mo(l){return String(l||"").toLowerCase().replace(/^@/,"").replace(/\s+/g," ").trim()}function Up(l,h){let p=mo(l),w=mo(h);if(!w)return!1;return p.startsWith(w)||p.includes(w)}function kt(l){if(!l)return!1;if(l.defaultPrevented||l.repeat)return!1;if(l.isComposing)return!1;if(l.ctrlKey||l.metaKey||l.altKey)return!1;return typeof l.key==="string"&&l.key.length===1&&/\S/.test(l.key)}function ac(l,h,p=Date.now(),w=700){let k=l&&typeof l==="object"?l:{value:"",updatedAt:0},x=String(h||"").trim().toLowerCase();if(!x)return{value:"",updatedAt:p};return{value:!k.value||!Number.isFinite(k.updatedAt)||p-k.updatedAt>w?x:`${k.value}${x}`,updatedAt:p}}function Yp(l,h){let p=Math.max(0,Number(l)||0);if(p<=0)return[];let k=((Number.isInteger(h)?h:0)%p+p)%p,x=[];for(let C=0;C<p;C+=1)x.push((k+C)%p);return x}function Vp(l,h,p=0,w=(k)=>k){let k=mo(h);if(!k)return-1;let x=Array.isArray(l)?l:[],C=Yp(x.length,p),P=x.map((M)=>mo(w(M)));for(let M of C)if(P[M].startsWith(k))return M;for(let M of C)if(P[M].includes(k))return M;return-1}function cc(l,h,p=-1,w=(k)=>k){let k=Array.isArray(l)?l:[];if(p>=0&&p<k.length){let x=w(k[p]);if(Up(x,h))return p}return Vp(k,h,0,w)}class Vs{publish;generation=0;constructor(l){this.publish=l}begin(l){let h=++this.generation;return this.publish("sending"),h}acknowledged(l){this.finished(l)}finished(l){if(l===this.generation)this.publish(null)}failed(l){this.finished(l)}reset(){this.generation++,this.publish(null)}}function go(l){return String(l||"").trim().toLowerCase()}function Js(l){let h=String(l||"").match(/^@([a-zA-Z0-9_-]*)$/);if(!h)return null;return go(h[1]||"")}function Jp(l){let h=new Set,p=[];for(let w of Array.isArray(l)?l:[]){let k=go(w?.agent_name);if(!k||h.has(k))continue;h.add(k),p.push(w)}return p}function lc(l,h,p={}){let w=Js(h);if(w==null)return[];let k=typeof p?.currentChatJid==="string"?p.currentChatJid:null;return Jp(l).filter((x)=>{if(k&&x?.chat_jid===k)return!1;return go(x?.agent_name).startsWith(w)})}function Qs(l){let h=go(l);return h?`@${h} `:""}var Qp={streaming:"Streaming",working:"Working",compacting:"Compacting",retrying:"Retrying",bash_running:"Running shell"};function ar(l){if(!l?.is_active)return"";let h=String(l.activity_status||"").trim();return Qp[h]||"Working"}function Q(l,h=220){let p=String(l??"").replace(/\r\n?/g,`
`).replace(/!\[[^\]]*\]\([^)]*\)/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/```+/g,"").replace(/`([^`]+)`/g,"$1").replace(/^#{1,6}\s+/gm,"").replace(/^>\s?/gm,"").replace(/^\s*[-*+]\s+/gm,"").replace(/[*_~]{1,3}/g,"").replace(/\s+/g," ").trim();if(p.length<=h)return p;return`${p.slice(0,Math.max(0,h-1)).trimEnd()}…`}function dc(l){if(!l)return null;if(typeof l==="string")try{return dc(JSON.parse(l))}catch{return null}if(typeof l!=="object"||Array.isArray(l))return null;let h=l,p=h.arguments??h.input??h.params??h.parameters??h.args??h.payload;return p&&typeof p==="object"&&!Array.isArray(p)?p:h}function Xp(l){let h=Q(l?.title,220);if(h)return h;let p=Q(l?.tool_name??l?.toolName,220);if(!p)return"";let w=dc(l?.tool_args??l?.toolArgs);if(!w)return p;let x=[w.command,Array.isArray(w.commands)?w.commands.filter((C)=>typeof C==="string").join(" && "):"",w.path??w.filePath??w.target,Array.isArray(w.paths)?w.paths.filter((C)=>typeof C==="string").join(", "):"",w.fileName??w.filename??w.file,w.url,w.query].map((C)=>typeof C==="string"?Q(C,120):"").filter(Boolean).sort((C,P)=>P.length-C.length)[0];return x?`${p}: ${x}`:p}function Zp(l){let h=typeof l?.type==="string"?l.type.trim():"";if(h!=="tool_call"&&h!=="tool_status")return null;let p=Q(l.status??l.tool_status??l.toolStatus,220);if(h==="tool_status"&&/^(done|failed|cancelled|canceled|aborted)$/i.test(p))return null;let w=p&&!/^working(?:\.{3}|…)?$/i.test(p)?p:"",k=[Xp(l),w].filter(Boolean).join(" — ");return k?{kind:"tool",label:"Tool",text:Q(k)}:null}function uc(l,h){let p=Q(typeof h==="string"?h:h?.text);return p?{kind:l,label:l==="thinking"?"Thinking":"Draft",text:p}:null}function cr(l,h=null){if(!l||l.status!=="active")return{preview:null,retained:null};let p=l.data?.turn_id??l.data?.turnId,w=typeof p==="string"?p.trim():"",k=w&&h?.turnId===w?h:null,x=uc("draft",l.draft)||uc("thinking",l.thought),C=x&&w?{...x,turnId:w}:k;return{preview:x||Zp(l.data)||C,retained:C}}function ho(l){let h=typeof l==="string"?Date.parse(l):NaN;return Number.isFinite(h)?h:-1/0}function Je(l,h){let p=ho(l.last_activity_at),w=ho(h.last_activity_at);if(p!==w)return w-p;let k=ho(l.archived_at),x=ho(h.archived_at);return k===x?0:x-k}function lr(l,h=Date.now()){let p=Date.parse(String(l??""));if(!Number.isFinite(p))return"";let w=Math.max(0,Math.round((h-p)/1000));if(w<60)return"now";let k=Math.round(w/60);if(k<60)return`${k}m`;let x=Math.round(k/60);if(x<24)return`${x}h`;let C=Math.round(x/24);if(C<7)return`${C}d`;return new Date(p).toLocaleDateString(void 0,{month:"short",day:"numeric"})}function At(l){let h=Number(l?.context_percent??l?.contextPercent??l?.context_usage?.percent);if(Number.isFinite(h)&&h>=0)return Math.min(100,h);let p=Number(l?.context_tokens),w=Number(l?.context_window);if(Number.isFinite(p)&&Number.isFinite(w)&&w>0&&p>=0)return Math.min(100,p/w*100);return null}function ur(l){return Boolean(l?.ctrlKey||l?.metaKey||l?.button===1)}var ef={current:"Current",pinned:"Pinned",active:"Active",tree:"This session tree",other:"Other sessions",archived:"Archived"};function he(l){return typeof l==="string"?l.trim():""}function Xs(l){if(l==null)return null;let h=Number(l);return Number.isFinite(h)&&h>=0?h:null}function pc(l){if(l>=1e6){let h=l/1e6;return`${Number.isInteger(h)?h.toFixed(0):h.toFixed(1)}M`}if(l>=1000)return`${Math.round(l/1000)}K`;return String(Math.round(l))}function fc(l){let h=he(l?.model)||he(l?.model_label),p=Xs(l?.context_tokens??l?.contextTokens??l?.context_usage?.tokens),w=Xs(l?.context_window??l?.contextWindow??l?.context_usage?.contextWindow),k=Xs(l?.context_percent??l?.contextPercent??l?.context_usage?.percent),x=k==null?null:Math.min(100,k),C=p!=null&&w!=null&&w>0?`${pc(p)} / ${pc(w)}${x==null?"":` (${Math.round(x)}% context)`}`:x==null?"":`${Math.round(x)}% context`;return[h,C].filter(Boolean).join(" · ")}function tf(l){let h=Boolean(l?.archived_at),p=Boolean(l?.is_active)&&!h;return[he(l?.agent_name)?`@${he(l.agent_name)}`:"",he(l?.agent_name),he(l?.chat_jid),he(l?.root_chat_jid),he(l?.model),he(l?.model_label),he(l?.provider),h?"archived":p?"active":"idle",he(l?.parent_branch_id),he(l?.branch_id)].filter(Boolean).join(" ").toLocaleLowerCase()}function mc(l,h){let p=he(h).toLocaleLowerCase().split(/\s+/).filter(Boolean);if(p.length===0)return!0;let w=tf(l);return p.every((k)=>w.includes(k))}function nf(l,h){if(!mc(l,h))return 4;let p=he(l?.agent_name).toLocaleLowerCase(),w=he(h).toLocaleLowerCase().split(/\s+/).map((k)=>k.replace(/^@/,"")).filter(Boolean);if(!p||w.length===0)return 3;if(w.some((k)=>p===k))return 0;if(w.some((k)=>p.startsWith(k)))return 1;if(w.some((k)=>p.includes(k)))return 2;return 3}function gc(l,h){let p=0,w=Number.POSITIVE_INFINITY;for(let k=0;k<l.length;k+=1){let x=nf(l[k],h);if(x>=w)continue;if(p=k,w=x,x===0)break}return p}function hc(l,h){let p=he(h);if(!p)return-1;return l.findIndex((w)=>he(w?.chat_jid)===p)}function Pe(l,h){let p=he(h).toLocaleLowerCase();if(!p)return l;let w=new Set(l.filter((x)=>mc(x,p)).map((x)=>he(x.chat_jid))),k=new Map(l.map((x)=>[he(x.branch_id),x]).filter(([x])=>Boolean(x)));for(let x of l){if(!w.has(he(x.chat_jid)))continue;let C=he(x.parent_branch_id);while(C){let P=k.get(C);if(!P)break;w.add(he(P.chat_jid)),C=he(P.parent_branch_id)}}return l.filter((x)=>w.has(he(x.chat_jid)))}function Me(l,h,p=[]){let w=he(h),k=l.find((M)=>he(M.chat_jid)===w),x=he(k?.root_chat_jid)||w,C=new Set(Array.from(p,he).filter(Boolean)),P=new Map([["current",[]],["pinned",[]],["active",[]],["tree",[]],["other",[]],["archived",[]]]);for(let M of l){let T=he(M.chat_jid),F=Boolean(M.archived_at)?"archived":T===w?"current":Boolean(M.is_active)?"active":C.has(T)?"pinned":(he(M.root_chat_jid)||T)===x?"tree":"other";P.get(F).push(M)}return["current","active","pinned","tree","other","archived"].map((M)=>({key:M,label:ef[M],items:P.get(M).sort(Je)})).filter((M)=>M.items.length>0)}function bc(l,h,p,w=8){if(h<=0)return 0;let k=Math.max(0,Math.min(l,h-1));if(p==="Home")return 0;if(p==="End")return h-1;if(p==="ArrowDown")return(k+1)%h;if(p==="ArrowUp")return(k-1+h)%h;if(p==="PageDown")return Math.min(h-1,k+w);if(p==="PageUp")return Math.max(0,k-w);return k}function yc(l={}){if(l.searchMode)return!1;return Boolean(l.showSessionSwitcherButton)}function wc(l,h,p={}){if(!l||l.isComposing)return!1;if(!yc(p))return!1;if(l.ctrlKey||l.metaKey||l.altKey)return!1;if(l.key!=="@")return!1;return String(h||"")===""}function Zs(l,h={}){if(!yc(h))return!1;return String(l||"")==="@"}function Y(l){let h=ei(l);return h?`@${h}`:""}function ei(l){return String(l||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-")}function Ct(l,h=""){let p=String(l||""),w=ei(p),k=ei(h);if(!p.trim())return{normalized:w,handle:"",canSubmit:!1,kind:"error",message:"Enter a branch handle."};if(!w)return{normalized:w,handle:"",canSubmit:!1,kind:"error",message:"Handle must contain at least one letter or number."};let x=`@${w}`;if(w===k)return{normalized:w,handle:x,canSubmit:!1,kind:"info",message:`Already using ${x}.`};if(w!==p.trim())return{normalized:w,handle:x,canSubmit:!0,kind:"info",message:`Will save as ${x}. Letters, numbers, - and _ are allowed; leading @ is optional.`};return{normalized:w,handle:x,canSubmit:!0,kind:"success",message:`Saving as ${x}.`}}function Qe(l,h={}){let p=[],w=typeof h.currentChatJid==="string"?h.currentChatJid.trim():"",k=typeof l?.chat_jid==="string"?l.chat_jid.trim():"";if(w&&k===w)p.push("current");if(l?.archived_at)p.push("archived");else{if(l?.is_compacting||l?.activity_status==="compacting")p.push("compacting");if(l?.is_active)p.push("active")}return p}function vc(l){let h=Y(l?.agent_name)||String(l?.chat_jid||"").trim(),p=typeof l?.chat_jid==="string"&&l.chat_jid.trim()?l.chat_jid.trim():"unknown-chat";return`${h} — ${p}`}function _t(l,h={}){let p=Qe(l,h);return p.length>0?`${vc(l)} • ${p.join(" • ")}`:vc(l)}function dr(l,h,p){let w=Y(l),k=Y(h),x=String(p||"").trim();if(w&&k&&w!==k)return`Restored archived ${w} as ${k} because ${w} is already in use.`;if(k)return`Restored ${k}.`;if(w)return`Restored ${w}.`;return`Restored ${x||"branch"}.`}function $t({steerQueued:l=!1,pulsing:h=!1}={}){let p=["turn-dot"];if(l)p.push("turn-dot-queued");if(h)p.push("turn-dot-pulsing");return p.join(" ")}function ti({pulsing:l=!1}={}){let h=["compose-inline-status-dot"];if(l)h.push("compose-inline-status-dot-pulsing");return h.join(" ")}function Ye(l,{isLastActivity:h=!1,pendingRequest:p=!1}={}){if(p)return"dot";if(h)return"none";if(l?.type==="error")return"none";let w=typeof l?.type==="string"?l.type:"";if(Boolean(typeof l?.tool_name==="string"&&l.tool_name.trim()||l?.tool_args))return"spinner";if(l?.type==="intent")return"dot";if(w==="tool_call"||w==="tool_status"||w==="thinking"||w==="waiting")return"spinner";return"dot"}function pr(l,h={}){return Ye(l,h)==="dot"}var Sc=350;function rf(l){return String(l||"Connecting").replace(/[-_]+/g," ").replace(/^./,(h)=>h.toUpperCase())}function of(l,h={}){let p=typeof l==="string"&&l.trim()?l.trim():"connecting";if(p==="connected")return{show:!1,statusClass:"connected",label:"Connected",title:"Connection: Connected"};if(p!=="disconnected"){let P=rf(p);return{show:!0,statusClass:p,label:P,title:`Connection: ${P}`}}let w=Number.isFinite(Number(h?.delayMs))?Math.max(0,Number(h.delayMs)):Sc,k=Number.isFinite(Number(h?.nowMs))?Number(h.nowMs):Date.now(),x=Number.isFinite(Number(h?.disconnectedAtMs))?Number(h.disconnectedAtMs):k;return k-x>=w?{show:!0,statusClass:"disconnected",label:"Reconnecting",title:"Reconnecting"}:{show:!1,statusClass:"connecting",label:"Connecting",title:"Connecting"}}function $c(l,h={}){let p=Number.isFinite(Number(h?.delayMs))?Math.max(0,Number(h.delayMs)):Sc,[w,k]=t(null),[x,C]=t(()=>Date.now());return o(()=>{if(l==="disconnected"){let P=Date.now();k((M)=>M??P),C(P);return}k(null),C(Date.now())},[l]),o(()=>{if(l!=="disconnected"||w===null)return;let P=p-(Date.now()-w);if(P<=0)return;let M=0,T=0,N=setTimeout(()=>{if(typeof requestAnimationFrame!=="function"){C(Date.now());return}M=requestAnimationFrame(()=>{T=requestAnimationFrame(()=>{C(Date.now())})})},P);return()=>{if(clearTimeout(N),M)cancelAnimationFrame(M);if(T)cancelAnimationFrame(T)}},[l,w,p]),i(()=>of(l,{delayMs:p,disconnectedAtMs:w,nowMs:x}),[l,p,w,x])}function S({prefix:l="file",label:h,title:p,onRemove:w,onClick:k,removeTitle:x="Remove",icon:C="file"}){let P=`${l}-file-pill`,M=`${l}-file-name`,T=`${l}-file-remove`,N=C==="message"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>`:C==="folder"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>`:e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>`;return e`
    <span class=${P} title=${p||h} onClick=${k}>
      ${N}
      <span class=${M}>${h}</span>
      ${w&&e`
        <button
          class=${T}
          onClick=${(F)=>{F.preventDefault(),F.stopPropagation(),w()}}
          title=${x}
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `}
    </span>
  `}async function ni(l,h,p,w){if(typeof l!=="function")return!1;try{let k=await l(h);if(!k)return!1;return p(k),w?.(k),!0}catch(k){return!1}}var sf=0;function kc(l,h){return`compose-model-option-${l}-${encodeURIComponent(h)}`}function af(l){let h=[],p=Z(l.contextWindow);if(p)h.push(p);if(l.reasoning)h.push("reasoning");return h.push(...l.variants.filter((w)=>w!=="stable").slice(0,2)),h}function xc({anchor:l=null,entries:h,loading:p=!1,switching:w=!1,onSelect:k,onTogglePin:x,onClose:C,onCompact:P,onOpenSettings:M,thinkingLevel:T=null,thinkingLevels:N=[],onSelectThinking:F,rootRef:B}){let[J,U]=t(""),[ee,X]=t(null),V=r(null),ne=r(new Map),G=r(null);if(G.current==null)G.current=++sf;let me=`compose-model-search-${G.current}`,Ce=`compose-model-results-${G.current}`,be=i(()=>mr(h,{query:J}),[h,J]),He=i(()=>be.renderedEntries,[be]);o(()=>{V.current?.focus()},[]),o(()=>{if(He.some((Fe)=>Fe.key===ee))return;let O=He.find((Fe)=>Fe.current);X(O?.key??He[0]?.key??null)},[ee,He]),o(()=>{ne.current.get(ee)?.scrollIntoView?.({block:"nearest"})},[ee]);let Kt=n((O)=>{if(!O||w)return;k(O)},[k,w]),cn=n((O)=>{if(O.isComposing)return;let Fe={ArrowDown:"next",ArrowUp:"previous",Home:"first",End:"last",PageDown:"page-next",PageUp:"page-previous"};if(O.key==="Escape"){O.preventDefault(),C();return}if(O.target!==V.current)return;if(O.key==="Enter"){let It=be.renderedEntries.find((qe)=>qe.key===ee);if(It)if(O.preventDefault(),O.altKey)x?.(It);else Kt(It);return}let Wt=Fe[O.key];if(!Wt||(O.key==="Home"||O.key==="End")&&!O.ctrlKey&&!O.metaKey)return;O.preventDefault(),X(gr(be.renderedEntries,ee,Wt))},[ee,Kt,C,x,be.renderedEntries]),Lr=(O)=>{let Fe=O.current,Wt=O.key===ee,It=af(O);return e`
            <button
                id=${kc(G.current,O.key)}
                key=${O.key}
                type="button"
                role="option"
                aria-label=${`${O.displayName}, ${O.pinned?"pinned":"not pinned"}. Alt+Enter to ${O.pinned?"unpin":"pin"}.`}
                aria-keyshortcuts="Alt+Enter"
                aria-selected=${Fe?"true":"false"}
                tabIndex=${-1}
                class=${`compose-model-catalogue-option${Fe?" selected":""}${Wt?" focused":""}`}
                ref=${(qe)=>qe?ne.current.set(O.key,qe):ne.current.delete(O.key)}
                onMouseDown=${(qe)=>qe.preventDefault()}
                onMouseEnter=${()=>X(O.key)}
                onClick=${()=>Kt(O)}
            >
                <span
                    class=${`compose-model-catalogue-pin${O.pinned?" pinned":""}`}
                    aria-hidden="true"
                    title=${O.pinned?"Unpin model":"Pin model"}
                    onClick=${(qe)=>{qe.preventDefault(),qe.stopPropagation(),X(O.key),x?.(O)}}
                >${O.pinned?"★":"☆"}</span>
                <span class="compose-model-catalogue-option-content">
                    <span class="compose-model-catalogue-option-primary">
                        <span class="compose-model-catalogue-option-name">${O.displayName}</span>
                        ${fe(O.pricing)&&e`<span class="compose-model-catalogue-option-price">${fe(O.pricing)}</span>`}
                    </span>
                    ${O.displayName!==O.key&&e`<span class="compose-model-catalogue-option-key">${O.key}</span>`}
                    ${It.length>0&&e`
                        <span class="compose-model-catalogue-option-badges">
                            ${It.map((qe)=>e`<span class="compose-model-catalogue-badge" key=${qe}>${qe}</span>`)}
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
                <label class="compose-model-catalogue-search-label" for=${me}>Search models</label>
                <div class="compose-model-catalogue-search-row">
                    <input
                        id=${me}
                        ref=${V}
                        class="compose-model-catalogue-search"
                        type="search"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls=${Ce}
                        aria-activedescendant=${ee?kc(G.current,ee):void 0}
                        placeholder="Search models…"
                        value=${J}
                        onInput=${(O)=>U(O.currentTarget.value)}
                    />
                    ${J&&e`<button type="button" class="compose-model-catalogue-clear" onClick=${()=>U("")} aria-label="Clear model search">×</button>`}
                </div>
                <div class="compose-model-catalogue-summary" aria-live="polite">
                    <span>${be.totalMatches} ${be.totalMatches===1?"model":"models"}</span>
                    ${p&&e`<span>Refreshing…</span>`}
                </div>
            </div>
            <div id=${Ce} class="compose-model-popup-menu compose-model-catalogue-results" role="listbox" aria-label="Models">
                ${be.sections.map((O)=>e`
                    <section class=${`compose-model-catalogue-section ${`compose-model-catalogue-section--${O.key}`}`} key=${O.key} role="presentation">
                        <div class="compose-model-catalogue-section-heading" role="presentation">
                            <span>${O.label}</span><span>${O.totalCount}</span>
                        </div>
                        ${O.entries.map(Lr)}
                        ${O.groups.map((Fe)=>e`
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
                        ${p?"Loading models…":J?`No models match “${J}”.`:"No models available."}
                    </div>
                `}
                ${be.hiddenCount>0&&e`<div class="compose-model-catalogue-limit-note">Showing ${be.renderedEntries.length} of ${be.totalMatches}; refine your search to see more.</div>`}
            </div>
            <div class="compose-model-catalogue-footer">
                <div class="compose-model-catalogue-footer-start">
                    ${N.length>0&&e`
                        <label class="compose-model-catalogue-thinking">
                            <span>Thinking</span>
                            <select
                                aria-label="Thinking level"
                                value=${T||N[0]?.id||""}
                                disabled=${w||typeof F!=="function"}
                                onChange=${(O)=>F?.(O.currentTarget.value)}
                            >
                                ${N.map((O)=>e`<option key=${O.id} value=${O.id}>${O.label}</option>`)}
                            </select>
                        </label>
                    `}
                    ${P&&e`<button type="button" class="compose-model-popup-btn" onClick=${P}>Compact context</button>`}
                </div>
                ${M&&e`<button type="button" class="compose-model-popup-btn primary" onClick=${M}>Open Models settings</button>`}
            </div>
        </div>
    `}function cf(l={}){let h=l.navigator??(typeof navigator<"u"?navigator:null);if(!h)return!1;let p=String(h.userAgent||"");if(/iPad|iPhone/.test(p))return!0;return h.platform==="MacIntel"&&Number(h.maxTouchPoints||0)>1}function lf(l={}){let h=l.window??(typeof window<"u"?window:null);if(!h)return null;return h.SpeechRecognition||h.webkitSpeechRecognition||null}function ri(l={}){let h=l.window??(typeof window<"u"?window:null),p=typeof l.secureContext==="boolean"?l.secureContext:Boolean(h?.isSecureContext),w=b(l),k=cf(l),x=lf(l);if(!p)return{mode:"unavailable",showButton:!1,canStart:!1,reason:"secure-context-required",title:"Voice input requires HTTPS",detail:"Native browser speech input needs a secure context (HTTPS or localhost).",recognitionCtor:null,ios:k,standalone:w,secureContext:p};if(k&&w)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-standalone-fallback",title:"Use keyboard dictation",detail:"Speech input is intentionally downgraded in iPhone/iPad standalone web apps because browser-native recognition is not reliable there. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:x,ios:k,standalone:w,secureContext:p};if(!x){if(k)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-keyboard-dictation",title:"Use keyboard dictation",detail:"This browser does not expose native in-page speech recognition here. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:null,ios:k,standalone:w,secureContext:p};return{mode:"unavailable",showButton:!1,canStart:!1,reason:"unsupported",title:"Voice input unavailable",detail:"This browser does not expose native speech recognition in this context.",recognitionCtor:null,ios:k,standalone:w,secureContext:p}}return{mode:"native",showButton:!0,canStart:!0,reason:"supported",title:"Start voice input",detail:k?"Browser-native speech input is available here, but Safari/WebKit reliability may still vary.":"Browser-native speech input is available.",recognitionCtor:x,ios:k,standalone:w,secureContext:p}}function _c(l,h="",p=""){let w=String(l||""),k=String(h||"").trim(),x=String(p||"").trim(),C=[k,x].filter(Boolean).join(" ").trim();if(!C)return w;if(!w)return C;let P=/[\s\n]$/.test(w)?"":" ";return`${w}${P}${C}`}function Ec(l,h=0){let p="",w="",k=l&&typeof l.length==="number"?l:[];for(let x=Math.max(0,h);x<k.length;x+=1){let C=k[x];if(!C||!C[0])continue;let P=String(C[0].transcript||"").trim();if(!P)continue;if(C.isFinal)p=`${p} ${P}`.trim();else w=`${w} ${P}`.trim()}return{finalText:p,interimText:w}}function oi(l,h=null){let p=String(l||"").trim().toLowerCase();switch(p){case"not-allowed":case"service-not-allowed":return h?.ios?"Microphone or speech-recognition permission was denied. On iPhone/iPad, using keyboard dictation may be more reliable.":"Microphone or speech-recognition permission was denied by the browser.";case"no-speech":return"No speech was detected. Try again and speak after the listening indicator appears.";case"audio-capture":return"The browser could not access a microphone for speech recognition.";case"network":return"The browser speech-recognition service reported a network or service failure.";case"aborted":return"Voice input was stopped.";default:return p?`Voice input failed (${p}).`:"Voice input failed."}}var uf=[{name:"/model",description:"Select model or list available models"},{name:"/cycle-model",description:"Cycle to the next available model"},{name:"/thinking",description:"Show or set thinking/effort level"},{name:"/effort",description:"Show or set thinking/effort level (alias for /thinking)"},{name:"/cycle-thinking",description:"Cycle thinking level"},{name:"/theme",description:"Set UI theme (no name to show available themes)"},{name:"/tint",description:"Tint default light/dark UI (usage: /tint #hex or /tint off)"},{name:"/btw",description:"Open a side conversation panel without interrupting the main chat"},{name:"/state",description:"Show current session state"},{name:"/stats",description:"Show session token and cost stats"},{name:"/context",description:"Show context window usage"},{name:"/quota",description:"Show cached provider quota / rate-limit usage"},{name:"/last",description:"Show last assistant response"},{name:"/compact",description:"Manually compact the session"},{name:"/auto-compact",description:"Toggle auto-compaction"},{name:"/auto-retry",description:"Toggle auto-retry"},{name:"/abort",description:"Abort the current response"},{name:"/abort-retry",description:"Abort retry backoff"},{name:"/abort-bash",description:"Abort running bash command"},{name:"/shell",description:"Run a shell command and return output"},{name:"/bash",description:"Run a shell command and add output to context"},{name:"/queue",description:"Queue a follow-up message (one-at-a-time)"},{name:"/queue-all",description:"Queue a follow-up message (batch all)"},{name:"/steer",description:"Steer the current response"},{name:"/steering-mode",description:"Set steering mode (all|one)"},{name:"/followup-mode",description:"Set follow-up mode (all|one)"},{name:"/session-name",description:"Set or show the session name"},{name:"/new-session",description:"Start a new session"},{name:"/switch-session",description:"Switch to a session file"},{name:"/session-rotate",description:"Rotate the current persisted session into an archived file"},{name:"/rollup",description:"Merge the current branch chat back into its parent chat"},{name:"/clone",description:"Duplicate the current active branch into a new session"},{name:"/fork",description:"Fork from a previous message"},{name:"/forks",description:"List forkable messages"},{name:"/tree",description:"List the session tree"},{name:"/label",description:"Set or clear a label on a tree entry"},{name:"/labels",description:"List labeled entries"},{name:"/agent-name",description:"Set or show the agent display name"},{name:"/agent-avatar",description:"Set or show the agent avatar URL"},{name:"/user-name",description:"Set or show your display name"},{name:"/user-avatar",description:"Set or show your avatar URL"},{name:"/user-github",description:"Set name/avatar from GitHub profile"},{name:"/export-html",description:"Export session to HTML"},{name:"/passkey",description:"Manage passkeys (enrol/list/delete)"},{name:"/totp",description:"Show a TOTP enrolment QR code"},{name:"/qr",description:"Generate a QR code for text or URL"},{name:"/search",description:"Search notes and skills in the workspace"},{name:"/dream",description:"Run Dream memory maintenance over recent days (default 7)"},{name:"/tasks",description:"List scheduled tasks"},{name:"/scheduled",description:"List scheduled tasks"},{name:"/pair",description:"Manage remote peer connections (/pair request <url> | /pair list)"},{name:"/ask",description:"Send a prompt to a paired remote instance (/ask <instance_id|fingerprint> <prompt>)"},{name:"/restart",description:"Restart the agent and stop subprocesses"},{name:"/exit",description:"Exit the current piclaw process immediately (Supervisor will restart it)"},{name:"/login",description:"Login to an AI model provider (OAuth or API key)"},{name:"/logout",description:"Logout from an AI model provider"},{name:"/settings",description:"Open the settings pane"},{name:"/help",description:"Open keyboard shortcuts help"},{name:"/commands",description:"List available commands"},{name:"/skill:",description:"Run a workspace skill (e.g. /skill:visual-artifact-generator, /skill:web-search)"}],Cc="piclaw_compose_history",si="piclaw_compose_height",df=50,Ac=70,Rc=300,Pc=520;function Dc(){if(typeof window>"u")return Ac;return window.innerWidth>=1024?Ac:df}function pf(){if(typeof window>"u")return Rc;return Math.min(Math.floor(window.innerHeight*0.4),Rc)}function ff(){if(typeof window>"u")return Pc;return Math.min(Math.floor(window.innerHeight*0.5),Pc)}function ii(l){let h=Dc(),p=Math.max(h,ff());return Math.min(Math.max(Math.round(Number(l)||h),h),p)}function mf(l=null,h=si){let p=l?.getItem?.(h)??f(h);if(!p)return null;let w=parseInt(p,10);return Number.isFinite(w)?ii(w):null}function gf(l,h,p=!1){if(p)return{shouldApply:!1,nextToken:h,text:""};if(!l||typeof l!=="object")return{shouldApply:!1,nextToken:h,text:""};let w=typeof l.token==="string"?l.token:"",k=typeof l.text==="string"?l.text:"";if(!w||w===h||!k.trim())return{shouldApply:!1,nextToken:h,text:""};return{shouldApply:!0,nextToken:w,text:k}}function hf(l="web:default"){let h=typeof l==="string"&&l.trim()?l.trim():"web:default";if(h==="web:default")return Cc;return`${Cc}:${encodeURIComponent(h)}`}function ue(l,h=null,p=null){let w=new Set,k=p instanceof Set?p:new Set(Array.isArray(p)?p:[]),x=[];for(let C of Array.isArray(l)?l:[]){let P=typeof C?.chat_jid==="string"?C.chat_jid.trim():"";if(!P||w.has(P)||k.has(P))continue;if(!(typeof C?.agent_name==="string"?C.agent_name.trim():""))continue;w.add(P),x.push(C)}return x.sort((C,P)=>{let M=Boolean(C?.archived_at),T=Boolean(P?.archived_at);if(M!==T)return M?1:-1;let N=String(C?.agent_name||"").trim(),F=String(P?.agent_name||"").trim(),B=N.localeCompare(F,void 0,{sensitivity:"base"});if(B!==0)return B;let J=String(C?.chat_jid||"").trim(),U=String(P?.chat_jid||"").trim();return J.localeCompare(U,void 0,{sensitivity:"base"})}),x}function bf(l){return Boolean(l?.is_active&&!l?.archived_at)}function yf(l,h=null){let p=Array.isArray(l)?l:[],w=typeof h==="string"?h.trim():"";if(w){let x=p.findIndex((C)=>{if(C?.disabled)return!1;if(C?.type!=="session")return!1;return(typeof C?.chat?.chat_jid==="string"?C.chat.chat_jid.trim():"")===w});if(x>=0)return x}let k=p.findIndex((x)=>!x?.disabled);return k>=0?k:0}function Lc(l,h){let p=typeof h?.command?.message==="string"?h.command.message.trim():"";if(!h?.ui_only||!p)return null;let w=typeof l==="string"?l.trim():"";if(!w.startsWith("/"))return null;let k=w.split(/\s+/).filter(Boolean),x=k[0]?.toLowerCase()||"";if(!(k.length>1)&&(x==="/thinking"||x==="/effort"))return p;return null}function wf(l,h,p=!1){if(l)return{mode:"queue",className:"icon-btn send-btn queue-mode",title:"Queue follow-up (Enter)",ariaLabel:"Queue follow-up message",disabled:!h};return{mode:"send",className:"icon-btn send-btn",title:"Send (Enter)",ariaLabel:"Send message",disabled:!h}}function Tc(l,h,p={}){if(!l||p.searchMode)return!1;if(!(l.key===" "||l.key==="Spacebar"||l.code==="Space"))return!1;if(l.ctrlKey||l.metaKey||l.altKey||l.repeat)return!1;if(!p.speechButtonVisible||p.speechButtonActive)return!1;if(!p.canStartSpeech)return!1;return String(h||"").trim().length===0}function vf(l,h){if(!h||!l)return!1;return l.key===" "||l.key==="Spacebar"||l.code==="Space"}function Sf(l,h=!1){if(!l)return null;if(h)return{mode:"compacting",className:"icon-btn send-btn abort-mode compacting-mode",title:"Compacting context — Stop response",ariaLabel:"Compacting context — Stop response",disabled:!1};return{mode:"abort",className:"icon-btn send-btn abort-mode",title:"Stop response",ariaLabel:"Stop response",disabled:!1}}function $f(l){return l==="abort"||l==="compacting"}function kf(l,h=0){if(l?.visible===!1)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};let p=typeof l?.message==="string"&&l.message.trim()?l.message.trim():null,w=l?.indicator&&typeof l.indicator==="object"?l.indicator:null;if(!p&&!w)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};if(w?.mode==="hidden")return{visible:Boolean(p),title:p||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!1};if(w?.mode==="custom"&&Array.isArray(w.frames)&&w.frames.length>0){let k=w.frames,x=Number.isFinite(h)&&h>=0?Math.floor(h)%k.length:0;return{visible:!0,title:p||"Thinking…",indicatorText:k[x],animateDot:!1,animateSpinner:!1}}return{visible:!0,title:p||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!0}}function xf({usage:l,onCompact:h,compactionLabel:p="",compactionTitle:w=""}){let k=Number.isFinite(l.percent)?Math.min(100,Math.max(0,l.percent)):null,x=Number.isFinite(l.tokens)&&l.tokens>=0?l.tokens:null,C=Number.isFinite(l.contextWindow)&&l.contextWindow>0?l.contextWindow:null,P=typeof h==="function",M=P?"Compact context":"Context usage",T=k==null?"unavailable":`${k.toFixed(0)}%`,N=`Context: ${vo(x)} / ${vo(C)} tokens (${T})`,F=typeof p==="string"?p.trim():"",B=typeof w==="string"?w.trim():"",J=F?`${N}
${B||"Smart compaction"} · ${F}`:`${N}
${M}`,U=9,ee=2*Math.PI*9,X=(k??0)/100*ee,V=k==null?"var(--text-secondary)":k>90?"var(--context-red, #ef4444)":k>75?"var(--context-amber, #f59e0b)":"var(--context-green, #22c55e)";return e`
        <button
            class=${`compose-context-pie icon-btn${F?" is-compacting":""}`}
            type="button"
            title=${J}
            aria-label=${J}
            disabled=${!P}
            onClick=${(ne)=>{if(ne.preventDefault(),ne.stopPropagation(),P)h()}}
        >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r=${9}
                    fill="none"
                    stroke="var(--context-track, rgba(128,128,128,0.2))"
                    stroke-width="2.5" />
                <circle cx="12" cy="12" r=${9}
                    fill="none"
                    stroke=${V}
                    stroke-width="2.5"
                    stroke-dasharray=${`${X} ${ee}`}
                    stroke-linecap="round"
                    transform="rotate(-90 12 12)" />
            </svg>
            ${F&&e`<span class="compose-context-pie-timer">${F}</span>`}
        </button>
    `}function vo(l){if(l==null)return"?";if(l>=1e6)return(l/1e6).toFixed(1)+"M";if(l>=1000)return(l/1000).toFixed(0)+"K";return String(l)}function jt(l){if(l==null)return null;let h=Number(l);return Number.isFinite(h)?h:null}function _f(l){if(!l||typeof l!=="object")return null;let h=jt(l.cacheHitRate);if(h!=null)return h;let p=jt(l.inputTokens)??0,w=jt(l.cacheReadTokens)??0,k=jt(l.cacheWriteTokens)??0,x=p+w+k;if(l.cacheReadReported===!1||x<=0)return null;if(w<=0&&l.cacheReadReported!==!0)return null;return w/x*100}function Ef(l){let h=jt(l);if(h==null)return null;return`${Math.max(0,Math.min(100,h)).toFixed(1)}%`}function Gn(l,h){let p=jt(h);return p!=null?`${l} ${vo(p)}`:null}function yo(l,h="USD"){let p=jt(l);if(p==null||p<0)return null;let w=p.toFixed(p>=0.01?2:4);return h==="USD"?`$${w}`:h?`${h} ${w}`:`${w} (currency unknown)`}function Cf(l){if(l?.provider!=="openrouter"||l?.availability!=="available")return null;return[`Key spend: ${yo(l.key_usage_usd)||"unavailable"}`,`Key limit: ${l.key_limit_configured===!0?yo(l.key_limit_usd)||"unavailable":l.key_limit_unlimited?"not configured (unlimited)":"unavailable"}`,`Key remaining: ${yo(l.key_limit_remaining_usd)||"unavailable"}`].join(" • ")}function Af(l,h=null){let p=l&&typeof l==="object"?l.cacheUsage:null;if(!p||typeof p!=="object")return null;let w=p.latest&&typeof p.latest==="object"?p.latest:null;if(!w)return null;let k=typeof w.provider==="string"&&w.provider.trim()?w.provider.trim():null,x=typeof w.model==="string"&&w.model.trim()?w.model.trim():null,C=x?!k||x.startsWith(`${k}/`)?x:`${k}/${x}`:k,P=typeof w.responseModel==="string"&&w.responseModel.trim()?w.responseModel.trim():null,M=ai(h,C),T=Boolean(h&&C&&!M),N=_f(w),F=Ef(N),B=F?`CH${F}`:"CH—",J=jt(w.totalTokens),U=yo(w.costTotal,w.costProvenance==="provider_reported"?w.providerCostCurrency??null:"USD"),ee=typeof w.costProvenance==="string"?w.costProvenance:null,X=ee==="provider_reported"?U:ee==="catalogue_estimate"&&U?`~${U}`:null,V=T?"Prev":"Last",ne=[Gn("in",w.inputTokens),Gn("out",w.outputTokens),Gn("reason",w.reasoningTokens),Gn("cache-r",w.cacheReadTokens),Gn("cache-w",w.cacheWriteTokens),Gn("total",w.totalTokens)].filter(Boolean).join(", "),G=ee==="provider_reported"&&U?`Provider-reported cost: ${U}`:ee==="catalogue_estimate"&&U?`Catalogue cost estimate: ~${U}`:"Cost unavailable",me=F?`Prompt cache hit: ${F}`:w.cacheReadReported===!1?"Prompt cache telemetry unavailable":"Prompt cache hit unavailable",Ce=[`${T?"Previous":"Latest"} run${C?`: ${C}`:""}`,P&&P!==w.model?`Response model: ${P}`:null,ne||null,me,G].filter(Boolean);return{label:[T?V:null,J==null?null:vo(J),B,X].filter(Boolean).join(" • "),title:Ce.join(" • "),cacheHitRate:N,costTotal:jt(w.costTotal),costProvenance:ee,requestedModel:C,responseModel:P,isPreviousModel:T}}function Rf(l){if(!l||typeof l!=="object")return"Price unknown";let h=[["in",l.input_per_million??l.inputPerMillion],["out",l.output_per_million??l.outputPerMillion],["cache-r",l.cache_read_per_million??l.cacheReadPerMillion],["cache-w",l.cache_write_per_million??l.cacheWritePerMillion]].map(([p,w])=>{let k=jt(w);if(k==null||k<0)return null;return`${p} $${k.toFixed(k>=1?2:4).replace(/0+$/,"").replace(/\.$/,"")}`}).filter(Boolean);return h.length>0?`${h.join(" / ")} per 1M`:"Price unknown"}function bo(l,h){let p=g(h);return D(l,{...pe(p)})}function Pf(l){let h=Array.isArray(l?.model_options)&&l.model_options.length>0;return D(l).map((p)=>({label:p.key,provider:p.provider,id:p.id,name:p.displayName===p.key?null:p.displayName,contextWindow:p.contextWindow,pricing:p.pricing,reasoning:h?p.reasoning:null,...p.current?{current:!0}:{}}))}function Lf(l,h){let p=typeof l==="string"?l.trim():"";if(p)return{showPicker:!0,label:p,hasAvailableModels:!0};let w=Pf(h).length>0||Number(h?.available_model_count)>0;return{showPicker:w,label:w?"Select model":"",hasAvailableModels:w}}function wo(l){return(typeof l==="string"?l.trim():"")||null}function So(l){return wo(l)?.toLowerCase()??null}function jc(l,h){let p=So(l),w=So(h);if(!p||!w)return!1;return p===w||p.endsWith(`/${w}`)||w.endsWith(`/${p}`)}function ai(l,h){let p=So(l),w=So(h);if(!p||!w)return!1;return p.includes("/")&&w.includes("/")?p===w:jc(p,w)}function Tf(l,h){let p=h&&typeof h==="object"?h:{},w=wo(p.latest_response_model??p.response_model??p.responseModel??p.routed_model??p.routedModel);if(!w)return null;let k=wo(p.latest_requested_model??p.requested_model??p.requestedModel??p.current??p.model??l);if(k&&jc(w,k))return null;let x=wo(l??p.current??p.model);if(x&&k&&!ai(x,k))return null;return{label:`Routed: ${w}`,title:k?`Requested model: ${k} • Routed model: ${w}`:`Routed model: ${w}`,requestedModel:k,responseModel:w}}function Mf(l){if(!l)return l;let h=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!h.includes(" @ ")||!h.includes(`:
`))return l;let p=h.split(`
`),w=[],k=0,x=!1;while(k<p.length){let P=p[k].trim();if(!P){k+=1;continue}if(P==="Messages:"||P.startsWith("Channel:")||P.startsWith("Chat:")){x=!0,k+=1;continue}if(/^[^\n]+\s@\s[^\n]+:$/.test(P)){x=!0,k+=1;let M=[];while(k<p.length){let T=p[k],N=T.trim();if(/^[^\n]+\s@\s[^\n]+:$/.test(N))break;if(N.startsWith("Channel:")||N.startsWith("Chat:")||N==="Messages:")break;M.push(T.startsWith("  ")?T.slice(2):T),k+=1}if(M.length>0)w.push(M.join(`
`).trim());continue}return l}return x&&w.length>0?w.filter(Boolean).join(`

`):l}function Ic(l){let h=String(l||"").trim(),p=h.match(/^`([^`]+)`$/);return(p?p[1]:h).trim()}function Df(l){if(!l)return{content:l,fileRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let T=0;T<p.length;T+=1)if(p[T].trim()==="Files:"&&p[T+1]&&/^\s*-\s+/.test(p[T+1])){w=T;break}if(w===-1)return{content:l,fileRefs:[]};let k=[],x=w+1;for(;x<p.length;x+=1){let T=p[x];if(/^\s*-\s+/.test(T)){let N=Ic(T.replace(/^\s*-\s+/,"").trim());if(N)k.push(N)}else if(!T.trim())break;else break}if(k.length===0)return{content:l,fileRefs:[]};let C=p.slice(0,w),P=p.slice(x);return{content:[...C,...P].join(`
`).replace(/\n{3,}/g,`

`).trim(),fileRefs:k}}function jf(l){if(!l)return{content:l,folderRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let T=0;T<p.length;T+=1)if(p[T].trim()==="Folders:"&&p[T+1]&&/^\s*-\s+/.test(p[T+1])){w=T;break}if(w===-1)return{content:l,folderRefs:[]};let k=[],x=w+1;for(;x<p.length;x+=1){let T=p[x];if(/^\s*-\s+/.test(T)){let N=Ic(T.replace(/^\s*-\s+/,"").trim());if(N)k.push(N)}else if(!T.trim())break;else break}if(k.length===0)return{content:l,folderRefs:[]};let C=p.slice(0,w),P=p.slice(x);return{content:[...C,...P].join(`
`).replace(/\n{3,}/g,`

`).trim(),folderRefs:k}}function If(l){if(!l)return{content:l,messageRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let T=0;T<p.length;T+=1)if(p[T].trim()==="Referenced messages:"&&p[T+1]&&/^\s*-\s+/.test(p[T+1])){w=T;break}if(w===-1)return{content:l,messageRefs:[]};let k=[],x=w+1;for(;x<p.length;x+=1){let T=p[x];if(/^\s*-\s+/.test(T)){let N=T.replace(/^\s*-\s+/,"").trim().match(/^message:(\S+)$/i);if(N)k.push(N[1])}else if(!T.trim())break;else break}if(k.length===0)return{content:l,messageRefs:[]};let C=p.slice(0,w),P=p.slice(x);return{content:[...C,...P].join(`
`).replace(/\n{3,}/g,`

`).trim(),messageRefs:k}}function Nf(l){if(!l)return{content:l,attachmentRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let T=0;T<p.length;T+=1)if(p[T].trim()==="Attachments:"&&p[T+1]&&/^\s*-\s+/.test(p[T+1])){w=T;break}if(w===-1)return{content:l,attachmentRefs:[]};let k=[],x=w+1;for(;x<p.length;x+=1){let T=p[x];if(/^\s*-\s+/.test(T)){let N=T.replace(/^\s*-\s+/,"").trim(),F=N.match(/^attachment:(\d+)(?:\s*\((.+)\))?$/i);if(F)k.push({id:F[1],label:(F[2]||"").trim()||`attachment:${F[1]}`,raw:N})}else if(!T.trim())break;else break}if(k.length===0)return{content:l,attachmentRefs:[]};let C=p.slice(0,w),P=p.slice(x);return{content:[...C,...P].join(`
`).replace(/\n{3,}/g,`

`).trim(),attachmentRefs:k}}function Nc(l){let h=Mf(l||""),p=Df(h||""),w=jf(p.content||""),k=If(w.content||""),x=Nf(k.content||"");return{text:x.content||"",fileRefs:p.fileRefs,folderRefs:w.folderRefs,messageRefs:k.messageRefs,attachmentRefs:x.attachmentRefs}}function Ff(l){let h=Nc(l),p=h.attachmentRefs.length>0?`Attachments:
${h.attachmentRefs.map((k)=>`- ${k.raw}`).join(`
`)}`:"";return{content:[String(h.text||"").trim(),p].filter(Boolean).join(`

`).trim(),fileRefs:[...h.fileRefs],folderRefs:[...h.folderRefs],messageRefs:[...h.messageRefs],attachmentRefs:[...h.attachmentRefs]}}async function Bf(l){let{queuedItem:h,buildDraft:p=Ff,onRemoveQueuedFollowup:w,setSubmitError:k,setSubmitNotice:x,setMediaFiles:C,onSetFileRefs:P,onSetFolderRefs:M,onSetMessageRefs:T,setContent:N,textareaRef:F,resizeTextarea:B=()=>{},scheduleRaf:J=(G)=>requestAnimationFrame(G),isCurrent:U=()=>!0,canRestoreDraft:ee=()=>!0,logger:X=console}=l||{};if(!h||!U()||typeof w!=="function")return!1;let V=p(h?.content||"");try{if(await w(h)!==!0)return!1}catch(G){return X?.warn?.("[compose-box] Failed to remove returned queued follow-up.",G),!1}if(!U())return!1;if(!ee())return x?.("Queued message removed; existing draft preserved."),!1;let ne=V.content;return X?.info?.("[compose-box] Returning queued item to editor",{text:ne?.slice(0,80),fileRefs:V.fileRefs?.length,folderRefs:V.folderRefs?.length,messageRefs:V.messageRefs?.length}),k?.(null),x?.(null),C?.([]),P?.(V.fileRefs),M?.(V.folderRefs),T?.(V.messageRefs),N?.(ne),J(()=>{let G=F?.current;if(!U()||!G)return;if(G.value=ne,typeof G.dispatchEvent==="function")G.dispatchEvent(new Event("input",{bubbles:!0}));B();let me=ne.length;G.selectionStart=me,G.selectionEnd=me,G.focus()}),!0}function Of({items:l=[],onInjectQueuedFollowup:h,onRemoveQueuedFollowup:p,onMoveQueuedFollowup:w,onReturnQueuedFollowup:k,onOpenFilePill:x}){let{t:C}=s(),P=r(new Set),[M,T]=t(()=>new Set),N=async(F)=>{let B=F.row_id;if(P.current.has(B)||!h)return;P.current.add(B),T(new Set(P.current));try{await h(F)}finally{P.current.delete(B),T(new Set(P.current))}};if(!Array.isArray(l)||l.length===0)return null;return e`
        <div class="compose-queue-stack">
            ${l.map((F,B)=>{let J=typeof F?.content==="string"?St(F.content):"",U=Nc(J);if(!U.text.trim()&&U.fileRefs.length===0&&U.folderRefs.length===0&&U.messageRefs.length===0&&U.attachmentRefs.length===0)return null;let ee=F?.mode==="steer",X=M.has(F.row_id),V=!X&&B>0&&l[B-1]?.mode==="steer"===ee,ne=!X&&B<l.length-1&&l[B+1]?.mode==="steer"===ee,G=!0;return e`
                    <div class=${`compose-queue-stack-item${ee?" is-steering":""}`} data-testid="queue-item" data-queue-mode=${ee?"steer":"followUp"} role="listitem">
                        <div class="compose-queue-stack-content" title=${J}>
                            ${ee&&e`<div class="compose-queue-stack-mode">${C("compose.queueSteering")}</div>`}
                            ${U.text.trim()&&e`<div class="compose-queue-stack-text">${U.text}</div>`}
                            ${(U.messageRefs.length>0||U.fileRefs.length>0||U.folderRefs.length>0||U.attachmentRefs.length>0)&&e`
                                <div class="compose-queue-stack-refs">
                                    ${U.messageRefs.map((me)=>e`
                                        <${S}
                                            key=${"queue-msg-"+me}
                                            prefix="compose"
                                            label=${"msg:"+me}
                                            title=${"Message reference: "+me}
                                            icon="message"
                                        />
                                    `)}
                                    ${U.fileRefs.map((me)=>{let Ce=me.split("/").pop()||me;return e`
                                            <${S}
                                                key=${"queue-file-"+me}
                                                prefix="compose"
                                                label=${Ce}
                                                title=${me}
                                                onClick=${()=>x?.(me)}
                                            />
                                        `})}
                                    ${U.folderRefs.map((me)=>{let Ce=me.split("/").pop()||me;return e`
                                            <${S}
                                                key=${"queue-folder-"+me}
                                                prefix="compose"
                                                label=${Ce}
                                                title=${me}
                                                icon="folder"
                                                onClick=${()=>x?.(me)}
                                            />
                                        `})}
                                    ${U.attachmentRefs.map((me)=>e`
                                        <${S}
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
                                    disabled=${!V}
                                    onClick=${()=>V&&w?.(B,B-1)}
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
                                    onClick=${()=>ne&&w?.(B,B+1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </button>
                            `}
                            ${G&&e`
                                <button
                                    class="compose-queue-stack-move-btn queue-edit"
                                    data-action="edit"
                                    type="button"
                                    title=${C("compose.editInCompose")}
                                    aria-label=${C("compose.returnToEditor")}
                                    disabled=${X}
                                    onClick=${(me)=>{me.stopPropagation(),k?.(F)}}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                </button>
                            `}
                            ${!ee&&e`<button
                                class="compose-queue-stack-steer-btn"
                                type="button"
                                title=${C("compose.injectSteer")}
                                aria-label=${C("compose.injectSteer")}
                                aria-busy=${X?"true":void 0}
                                disabled=${X}
                                onClick=${()=>void N(F)}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h12a2 2 0 0 0 2-2V8" />
                                    <polyline points="14 12 18 8 22 12" />
                                </svg>
                                <span>${C(X?"compose.requestingSteer":"compose.steer")}</span>
                            </button>`}
                            <button
                                class="compose-queue-stack-close-btn queue-remove"
                                data-action="remove"
                                type="button"
                                title=${C("compose.cancelQueued")}
                                aria-label=${C("compose.cancelQueued")}
                                disabled=${X}
                                onClick=${()=>p?.(F)}
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
    `}var Mc=Object.freeze([]);function Ze({onPost:l,onFocus:h,searchMode:p,searchScope:w="current",onSearch:k,onSearchScopeChange:x,onEnterSearch:C,onExitSearch:P,fileRefs:M=[],onRemoveFileRef:T,onClearFileRefs:N,folderRefs:F=[],onRemoveFolderRef:B,onClearFolderRefs:J,messageRefs:U=[],onRemoveMessageRef:ee,onClearMessageRefs:X,activeModel:V=null,agentModelsPayload:ne=null,modelUsage:G=null,thinkingLevel:me=null,supportsThinking:Ce=!1,contextUsage:be=null,onContextCompact:He,notificationsEnabled:Kt=!1,notificationPermission:cn="default",onToggleNotifications:Lr,onModelChange:O,onModelStateChange:Fe,activeEditorPath:Wt=null,onAttachEditorFile:It,onOpenFilePill:qe,followupQueueItems:Fc=[],onInjectQueuedFollowup:Bc,onRemoveQueuedFollowup:$o,onMoveQueuedFollowup:Oc,onSubmitIntercept:Hc,onMessageResponse:ci,isAgentActive:Kn=!1,activeChatAgents:pt=Mc,currentChatJid:se="web:default",connectionStatus:zc="connected",stateAccessFailed:qc=!1,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,onSubmitError:Eo,onSwitchChat:Co,onRenameSession:Ao,isRenameSessionInProgress:li=!1,onCreateSession:Ro,onCreateRootSession:Po,onDeleteSession:ln,onPurgeArchivedSession:Lo,onRestoreSession:To,showQueueStack:Gc=!0,statusNotice:Nt=null,extensionWorkingState:Tr=null,prefillRequest:ui=null,draftValue:Dn=void 0,services:Mo=null,capabilities:Do=null,storageNamespace:Mr="",preferenceRuntime:di=void 0,onContentChange:Kc,onSubmissionStateChange:pi,disabled:jo=!1,onJumpToLatest:Io,timelineAway:Wc=!1,timelineHasNew:fi=!1,inputId:Uc,sendButtonId:Yc}){let[we,ft]=t(()=>typeof Dn==="string"?Dn:""),{t:ge}=s(),un=Mo&&typeof Mo==="object"?Mo:{},at=Do&&typeof Do==="object"?Do:{},No=un.sendAgentMessage??E,Fo=un.getAgentModels??te,Vc=un.uploadMedia??$r,Jc=un.fetchCommands??((m)=>fetch(`/agent/commands?chat_jid=${encodeURIComponent(m)}`).then((_)=>_.ok?_.json():null)),Wn=un.browserStorage&&typeof un.browserStorage==="object"?un.browserStorage:{getItem:f,setItem:c},jn=at.persistBrowserState!==!1,We=di===void 0?typeof window<"u"?window:null:di,Ut=We,Bo=at.commands!==!1,Oo=at.mentions!==!1,dn=at.media!==!1,Qc=at.search!==!1,Xc=at.location!==!1,Dr=at.speech!==!1,Zc=at.notifications!==!1,el=at.modelPicker!==!1,Ho=at.modelSettings!==!1,mi=at.modelCompaction!==!1,tl=at.sessionRollup!==!1,[pn,gi]=t(""),[zo,nl]=t(!1),[qo,rl]=t(!1),[jr,Go]=t("or"),[fn,mn]=t([]),[Ft,Ko]=t(null),[hi,bi]=t(!1),[ol,sl]=t(null),Yt=r(null);if(!Yt.current)Yt.current=new Vs(sl);o(()=>{let m=Yt.current;return m.reset(),()=>m.reset()},[se]);let[il,Ir]=t(!1),[Bt,tt]=t([]),[Nr,Fr]=t(0),[Un,rt]=t(!1),Wo=r(null),[Vt,ct]=t([]),[Uo,Br]=t(0),[Yn,lt]=t(!1),[Jt,Yo]=t(!1),[Ue,gn]=t(!1),[ke,De]=t(!1),[mt,Or]=t(""),[Vn,yi]=t(()=>H(Ut).pinnedChatJids),[al,Vo]=t(null),[cl,Jo]=t(null),[wi,vi]=t(()=>new Set),Qo=r(new Set),gt=r(se),Xo=r(ne),Lt=r(0),Jn=r(0);gt.current=se,Xo.current=ne;let[ll,In]=t([]);o(()=>{let m=()=>{let _=g(We),R=new Set(_.pinnedKeys);In((j)=>j.map((I)=>({...I,pinned:R.has(I.key),lastUsedAt:_.recentByKey[I.key]??null})))};if(We?.addEventListener?.(de,m),typeof window<"u"&&We===window)window.addEventListener("storage",m);return()=>{if(We?.removeEventListener?.(de,m),typeof window<"u"&&We===window)window.removeEventListener("storage",m)}},[ne,We]),o(()=>{let m=()=>{yi(H(Ut).pinnedChatJids)};if(Ut?.addEventListener?.(_e,m),typeof window<"u"&&Ut===window)window.addEventListener("storage",m);return()=>{if(Ut?.removeEventListener?.(_e,m),typeof window<"u"&&Ut===window)window.removeEventListener("storage",m)}},[Ut]),o(()=>{let m=(_)=>{let R=_?.detail;if(R?.source==="compose")return;if(R?.chatJid&&R.chatJid!==se)return;let j=R?.payload;if(!j||typeof j!=="object")return;let I=j.model??j.current;if(In(bo(j,We)),Fe?.({...j,model:I??null}),I)O?.(I)};return window.addEventListener("piclaw:model-state-changed",m),()=>window.removeEventListener("piclaw:model-state-changed",m)},[se,We,O,Fe]),o(()=>{Lt.current+=1,Jn.current+=1,Yo(!1)},[se]);let[ul,dl]=t(null),Si=r(null),Nn=r([]),Qt=n((m)=>{let _=m?.key??null;Si.current=_,dl(_)},[]),[pl,$i]=t(!1),[ki,xi]=t(!1),[,fl]=t(0),_i=r(se);_i.current=se;let[Ei,ze]=t(null),[Ci,Xt]=t(null),[Be,ml]=t(()=>Dr?ri():{showButton:!1,canStart:!1}),[ht,Tt]=t({kind:"idle",title:"",detail:""}),[gl,Ai]=t(()=>Date.now()),[hl,Ri]=t(0),ae=r(null),Zo=Mr?`${Mr}:${si}`:si,Qn=r(jn?mf(Wn,Zo):null),es=r(null),ts=r(null),Pi=r(null),Zn=r(null),Hr=r(null),Li=r([]),zr=r(null),ns=r(null),Zt=r({value:"",updatedAt:0}),[,bl]=t(0);o(()=>fo(()=>bl((m)=>m+1)),[]);let qr=r(null);qr.current={read:()=>({text:ae.current?.value??we,chatJid:se,selectionStart:ae.current?.selectionStart??we.length,selectionEnd:ae.current?.selectionEnd??we.length}),write:(m)=>{if(ae.current)ae.current.value=m;ft(m)},state:(m)=>Tt({kind:m==="recording"||m==="finishing"?"listening":m==="loading"?"requesting_permission":m==="error"?"error":"idle",title:m==="error"?"Dictation failed; draft preserved":m==="finishing"?"Finishing dictation":"",detail:""})};let Oe=r(null);if(!Oe.current)Oe.current=ic({read:()=>qr.current.read(),write:(m)=>qr.current.write(m),state:(m,_)=>qr.current.state(m,_),providerSelected:()=>{let m=Ae.current;if(m)Ae.current=null,m.abort?.(),Rt()}});o(()=>{Oe.current?.draftChanged()},[we,se]),o(()=>()=>{Oe.current?.dispose()},[]);let Ae=r(null),Ti=r(""),en=r(""),tn=r(""),Gr=r(""),Kr=r(!1),Fn=r(!1),rs=r(!1),os=r(!1),ss=r(fn);ss.current=fn;let Wr=r(M),Ur=r(F),Yr=r(U);Wr.current=M,Ur.current=F,Yr.current=U;let fr=r(0),Vr=r(!1),Mi=200,hr=jn?`${Mr?`${Mr}:`:""}${hf(se)}`:"",Di=(m)=>{let _=new Set,R=[];for(let j of m||[]){if(typeof j!=="string")continue;let I=j.trim();if(!I||_.has(I))continue;_.add(I),R.push(I)}return R},ji=(m=hr)=>{if(!jn||!m)return[];let _=Wn.getItem?.(m)??null;if(!_)return[];try{let R=JSON.parse(_);if(!Array.isArray(R))return[];return Di(R)}catch{return[]}},yl=(m,_=hr)=>{if(!jn||!_)return;Wn.setItem?.(_,JSON.stringify(m))},Jr=r(ji(hr)),Bn=r(-1),br=r(""),Ii=r("");o(()=>{Jr.current=ji(hr),Bn.current=-1,br.current=""},[hr]),o(()=>{if(typeof Dn!=="string"||Dn===we)return;ft(Dn),requestAnimationFrame(()=>Et())},[Dn]),o(()=>{Kc?.(we)},[we]),o(()=>{if(!p)return;fetch("/agent/settings-data").then((m)=>m.json()).then((m)=>{if(m?.searchMatchMode)Go(m.searchMatchMode)}).catch(()=>{Go((m)=>m||"or")})},[p]),o(()=>{let m=!1;if(!Bo)return Wo.current=[],()=>{m=!0};return Promise.resolve(Jc(se||"web:default")).then((R)=>{if(m||!R?.commands)return;Wo.current=R.commands.map((j)=>({name:j.name,description:j.description||""}))}).catch((R)=>{console.debug("[compose] failed to fetch dynamic commands",R)}),()=>{m=!0}},[se,Bo]),o(()=>{let m=gf(ui,Ii.current,p);if(!m.shouldApply)return;Ii.current=m.nextToken,ze(null),ft(m.text),ys(m.text),ws(m.text),requestAnimationFrame(()=>{Et();let _=ae.current;if(!_)return;try{_.focus({preventScroll:!0})}catch{_.focus()}let R=m.text.length;_.setSelectionRange?.(R,R)})},[ui,p]),o(()=>{ml(Dr?ri():{showButton:!1,canStart:!1})},[Dr]);let wl=!jo&&(Oe.current?.active||we.trim()||fn.length>0||M.length>0||F.length>0||U.length>0),vl=ht.kind!=="idle",Sl=ht.kind==="requesting_permission"||ht.kind==="listening",Qr=Oe.current?.selected,is=Dr&&!p&&Boolean(Qr||Be?.showButton),Xr=ht.kind==="requesting_permission"||ht.kind==="listening",Ni=Xr?"Stop voice input":Qr?"Voice input":Be?.title||"Voice input",$l=Xc&&typeof window<"u"&&typeof navigator<"u"&&Boolean(navigator.geolocation)&&Boolean(window.isSecureContext),kl=typeof window<"u"&&typeof Notification<"u",xl=typeof window<"u"?Boolean(window.isSecureContext):!1,_l=Zc&&kl&&xl&&cn!=="denied",Fi=cn==="granted"&&Kt,nn=z(Nt),Bi=xt(Nt),as=typeof Nt?.detail==="string"&&Nt.detail.trim()?Nt.detail.trim():"",cs=nn?Ie(Nt,gl):null,On=kf(Tr,hl),Ot=Tr?.indicator&&typeof Tr.indicator==="object"?Tr.indicator:null,El=Fi?"Disable notifications":"Enable notifications",Cl=fn.length>0||M.length>0||F.length>0||U.length>0,Zr=$c(qc?zc:"connected"),{label:Al,title:Rl}=Zr,Oi=wf(Kn,wl,nn),eo=hi?{...Oi,disabled:!0,title:Ft?"Uploading attachments…":"Sending…",ariaLabel:Ft?"Uploading attachments":"Sending message"}:Oi,hn=Sf(Kn,nn),Hi=i(()=>(Array.isArray(pt)?pt:Mc).filter((m)=>!m?.archived_at),[pt]),Ne=(()=>{for(let m of Array.isArray(pt)?pt:[]){let _=typeof m?.chat_jid==="string"?m.chat_jid.trim():"";if(_&&_===se)return m}return null})(),Pl=Boolean(Ne&&Ne.chat_jid===(Ne.root_chat_jid||Ne.chat_jid)),Ll=Boolean(Pl&&(Ne?.chat_jid||se)==="web:default"),Ht=(()=>{let m=typeof Ne?.parent_branch_id==="string"?Ne.parent_branch_id.trim():"",_=typeof Ne?.branch_id==="string"?Ne.branch_id.trim():"";if(!Ne||!m||!_||Ne.archived_at)return null;if((Array.isArray(pt)?pt:[]).filter((I)=>{let re=typeof I?.parent_branch_id==="string"?I.parent_branch_id.trim():"";return re&&re===_}).length>0)return null;return(Array.isArray(pt)?pt:[]).find((I)=>{let re=typeof I?.branch_id==="string"?I.branch_id.trim():"";return re&&re===m&&!I?.archived_at})||null})(),yr=i(()=>ue(pt,se,wi),[pt,se,wi]),Tl=i(()=>new Set(Vn),[Vn]),ls=i(()=>Pe(yr,mt),[yr,mt]),us=i(()=>Me(ls,se,Vn),[ls,se,Vn]),ds=i(()=>us.flatMap((m)=>m.items),[us]);Li.current=yr;let to=yr.length>0,bn=to&&typeof Co==="function",yn=to&&typeof To==="function",no=Boolean(li||Vr.current),$n=!p&&typeof Ao==="function"&&Ne?.capabilities?.rename!==!1&&!no,_n=!p&&typeof Ro==="function"&&Ne?.capabilities?.fork!==!1,wr=!p&&typeof Po==="function",vr=tl&&!p&&!Kn&&!ki&&Boolean(Ht?.chat_jid),En=!p&&typeof ln==="function"&&Ne?.capabilities?.archive!==!1&&!Ll,zi=!p&&typeof Lo==="function",Rn=!p&&(bn||yn||$n||_n||wr||vr||En||zi),qi=el?Lf(V,ne):{showPicker:!1,label:"",hasAvailableModels:!1},{showPicker:ro,label:Hn}=qi,ps=Ce&&me?` (${me})`:"",Gi=ps.trim()?`${me}`:"",fs=Tf(V,ne),_r=Af(be,V),ms=typeof G?.hint_short==="string"?G.hint_short.trim():"",Ki=D(ne).find((m)=>ai(m.key,V)),Wi=Rf(Ki?.pricing),Ml=Cf(G),Ui=[Gi?{key:"thinking",text:Gi}:null,fs?.label?{key:"routed",text:fs.label}:null,ms?{key:"quota",text:ms}:null,_r?.label?{key:"run",text:_r.label}:null].filter(Boolean),Dl=Ui.map((m)=>m.text).join(" • "),gs=Hn.indexOf("/"),hs=gs>0?Hn.slice(0,gs+1):"",jl=hs?Hn.slice(gs+1):Hn,Il=[V?`Current model: ${Hn}${ps}`:null,fs?.title||null,G?.plan?`Plan: ${G.plan}`:null,ms||null,G?.availability&&G.availability!=="available"?`Usage telemetry: ${G.availability.replaceAll("_"," ")}`:null,G?.stale?`Usage telemetry stale after ${String(G.refresh_failure||"refresh failure").replaceAll("_"," ")}`:null,Ml,Wi?`Catalogue pricing: ${Wi}`:null,_r?.title||null,G?.primary?.reset_description||null,G?.secondary?.reset_description||null].filter(Boolean),Yi=Jt?"Switching model…":Il.join(" • ")||(ro?"Select a model (tap to open model picker)":`Current model: ${Hn}${ps} (tap to open model picker)`),Vi=!p&&(ro||_r||be),[zt,Nl]=t(()=>Ys());o(()=>{if(typeof window>"u")return;let m=()=>Nl(Ys());return window.addEventListener(Us,m),m(),()=>window.removeEventListener(Us,m)},[]);let bs=(m)=>{if(!m||typeof m!=="object")return;let _=m.model??m.current;if(typeof Fe==="function")Fe({...m,model:_??null,thinking_level:m.thinking_level??null,thinking_level_label:m.thinking_level_label??null,supports_thinking:m.supports_thinking,provider_usage:m.provider_usage??null});if(_&&typeof O==="function")O(_);window.dispatchEvent?.(new CustomEvent("piclaw:model-state-changed",{detail:{chatJid:se,payload:m,source:"compose"}}))},Ji=(m,_)=>{let R=ii(_);return m.style.minHeight=`${R}px`,m.style.height=`${R}px`,m.style.overflowY=m.scrollHeight>R?"auto":"hidden",R},Et=(m)=>{let _=m||ae.current;if(!_)return;let R=Qn.current;if(R!=null){Ji(_,R);return}_.style.minHeight="",_.style.height="auto";let j=Math.max(Dc(),Math.min(_.scrollHeight,pf()));_.style.height=`${j}px`,_.style.overflowY=_.scrollHeight>j?"auto":"hidden"},ys=(m)=>{if(!m.startsWith("/")||m.includes(`
`)){rt(!1),tt([]);return}let _=m.toLowerCase().split(" ")[0];if(_.length<1){rt(!1),tt([]);return}let j=(Wo.current||uf).filter((I)=>I.name.startsWith(_)||I.name.replace(/-/g,"").startsWith(_.replace(/-/g,"")));if(j.length>0&&!(j.length===1&&j[0].name===_))lt(!1),ct([]),tt(j),Fr(0),rt(!0);else rt(!1),tt([])},Qi=(m)=>{let _=we,R=_.indexOf(" "),j=R>=0?_.slice(R):"",I=m.name+j;ft(I),rt(!1),tt([]),requestAnimationFrame(()=>{let re=ae.current;if(!re)return;let oe=I.length;re.selectionStart=oe,re.selectionEnd=oe,re.focus()})},ws=(m)=>{if(Zs(m,{searchMode:p,showSessionSwitcherButton:Rn})){lt(!1),ct([]);return}if(Js(m)==null){lt(!1),ct([]);return}let _=lc(Hi,m,{currentChatJid:se});if(_.length>0&&!(_.length===1&&Qs(_[0].agent_name).trim().toLowerCase()===String(m||"").trim().toLowerCase()))rt(!1),tt([]),ct(_),Br(0),lt(!0);else lt(!1),ct([])},Xi=(m)=>{let _=Qs(m?.agent_name);if(!_)return;ft(_),lt(!1),ct([]),requestAnimationFrame(()=>{let R=ae.current;if(!R)return;let j=_.length;R.selectionStart=j,R.selectionEnd=j,R.focus()})},vs=()=>{if(p||!bn&&!yn&&!$n&&!_n&&!En)return!1;return Zt.current={value:"",updatedAt:0},gn(!1),rt(!1),tt([]),lt(!1),ct([]),Or(""),De(!0),!0},Fl=(m)=>{if(m?.preventDefault?.(),m?.stopPropagation?.(),p||!bn&&!yn&&!$n&&!_n&&!En)return;if(ke){Zt.current={value:"",updatedAt:0},De(!1);return}vs()},Zi=(m)=>{let _=typeof m==="string"?m.trim():"";if(De(!1),!_||_===se){requestAnimationFrame(()=>ae.current?.focus());return}Co?.(_)},ea=async(m)=>{let _=typeof m==="string"?m.trim():"";if(De(!1),!_||typeof To!=="function"){requestAnimationFrame(()=>ae.current?.focus());return}try{await To(_)}catch(R){console.warn("Failed to restore session:",R),requestAnimationFrame(()=>ae.current?.focus())}},Ss=n((m)=>{let _=typeof m==="string"?m.trim():"";if(!_||Qo.current.has(_))return!1;return Qo.current.add(_),vi((R)=>{let j=new Set(R instanceof Set?R:[]);return j.add(_),j}),!0},[]),$s=n((m,_)=>{let R=typeof m==="string"?m.trim():"";if(!R)return;if(Qo.current.delete(R),_)return;vi((j)=>{let I=new Set(j instanceof Set?j:[]);return I.delete(R),I})},[]),oo=n(async(m,_={})=>{let R=typeof m?.chat_jid==="string"?m.chat_jid.trim():"";if(!R)return;if(_.canPurgeArchived){if(!Ss(R))return;Vo(null);let j=!1;try{j=await Lo?.(R,{confirmed:!0})!==!1}catch(I){console.warn("Failed to purge archived session:",I)}if($s(R,j),j)De(!1);return}if(_.canPrune){if(!Ss(R))return;Jo(null);let j=!1;try{j=await ln(R,{confirmed:!0})!==!1}catch(I){console.warn("Failed to delete session:",I)}if($s(R,j),j)De(!1)}},[$s,Ss,ln,Lo]);o(()=>{if(!ke)return;let m=(_)=>{let R=Hr.current;if(!R)return;let I=_.target?.closest?.("button.compose-model-popup-item-delete.confirming[data-chat-jid]");if(!I||!R.contains(I))return;_.preventDefault?.(),_.stopPropagation?.(),_.stopImmediatePropagation?.();let re=typeof I.dataset?.chatJid==="string"?I.dataset.chatJid.trim():"";if(!re)return;let oe=Li.current.find((ie)=>ie?.chat_jid===re)||{chat_jid:re};oo(oe,{canPurgeArchived:I.dataset?.deleteKind==="purge",canPrune:I.dataset?.deleteKind==="prune"})};return document.addEventListener("pointerdown",m,!0),document.addEventListener("mousedown",m,!0),document.addEventListener("touchstart",m,!0),()=>{document.removeEventListener("pointerdown",m,!0),document.removeEventListener("mousedown",m,!0),document.removeEventListener("touchstart",m,!0)}},[oo,ke]);let ut=i(()=>{let m=[];for(let _ of ds){let R=Boolean(_?.archived_at),j=typeof _?.agent_name==="string"?_.agent_name.trim():"",I=typeof _?.chat_jid==="string"?_.chat_jid.trim():"";if(!j||!I)continue;m.push({type:"session",key:`session:${I}`,label:`@${j} — ${I}${_?.is_active?" active":""}${R?" archived":""}`,chat:_,disabled:R?!yn||_?.capabilities?.restore===!1:!bn||_?.capabilities?.open===!1})}if(!mt&&_n)m.push({type:"action",key:"action:new",label:"New branch",action:"new",disabled:!1});if(!mt&&wr)m.push({type:"action",key:"action:new-root",label:"New root session…",action:"new-root",disabled:!1});if(!mt&&Ht?.chat_jid)m.push({type:"action",key:"action:rollup",label:"Merge current w/ parent",action:"rollup",disabled:!vr});if(!mt&&$n)m.push({type:"action",key:"action:rename",label:"Rename current session",action:"rename",disabled:no});if(!mt&&En)m.push({type:"action",key:"action:delete",label:"Delete current session",action:"delete",disabled:!1});return m},[ds,mt,yn,bn,_n,wr,Ht,vr,$n,En,no]);Nn.current=ut;let Mt=Math.max(0,ut.findIndex((m)=>m.key===ul)),ks=n((m)=>{let _=bt(m,Ut);yi(_.pinnedChatJids);let R=Nn.current,j=R.filter((ve)=>ve?.type==="session").map((ve)=>ve.chat),I=Me(j,se,_.pinnedChatJids).flatMap((ve)=>ve.items),re=R.filter((ve)=>ve?.type==="session"),oe=R.filter((ve)=>ve?.type!=="session"),ie=new Map(re.map((ve)=>[ve.chat.chat_jid,ve])),ye=I.map((ve)=>ie.get(ve.chat_jid)).filter(Boolean);Nn.current=[...ye,...oe];let ot=hc(I,m);if(ot>=0)Qt(ye[ot])},[se,Qt]),ta=async(m)=>{if(m?.preventDefault)m.preventDefault();if(m?.stopPropagation)m.stopPropagation();if(typeof Ao!=="function"||li||Vr.current)return;Vr.current=!0,De(!1);try{await Ao()}catch(_){console.warn("Failed to rename session:",_)}finally{Vr.current=!1}requestAnimationFrame(()=>ae.current?.focus())},na=async()=>{if(typeof Ro!=="function")return;De(!1);try{await Ro()}catch(m){console.warn("Failed to create session:",m)}requestAnimationFrame(()=>ae.current?.focus())},ra=async()=>{if(typeof Po!=="function")return;De(!1);let m=typeof window<"u"?window.prompt("New root session handle (for example: ops)"):"",_=String(m||"").trim();if(!_){requestAnimationFrame(()=>ae.current?.focus());return}try{await Po(_)}catch(R){console.warn("Failed to create root session:",R)}requestAnimationFrame(()=>ae.current?.focus())},oa=async()=>{let m=typeof Ht?.chat_jid==="string"?Ht.chat_jid.trim():"";if(!m||ki||Kn)return;De(!1),ze(null),Xt(null),xi(!0);try{let _=await No("default","/rollup",null,[],null,se);ci?.(_),l?.(_);let R=_?.command;if(R?.status==="error"){let I=R?.message||"Failed to merge current session with parent.";ze(I),Eo?.(I);return}let j=typeof R?.rolled_up_to==="string"&&R.rolled_up_to.trim()?R.rolled_up_to.trim():m;Co?.(j)}catch(_){let R=_?.message||"Failed to merge current session with parent.";ze(R),Eo?.(R),console.warn("Failed to merge session with parent:",_)}finally{xi(!1)}requestAnimationFrame(()=>ae.current?.focus())},sa=async()=>{if(typeof ln!=="function")return;De(!1);try{await ln(se)}catch(m){console.warn("Failed to delete session:",m)}requestAnimationFrame(()=>ae.current?.focus())},ia=(m,_,R)=>{let j=ae.current;if(!j||!R)return;let I=m,re=!1,oe=se;R.classList.add("dragging"),document.body.style.cursor="row-resize",document.body.style.userSelect="none";let ie=(et)=>{if(Math.abs(et-_)>4)re=!0;I=Ji(j,m+(_-et)),Qn.current=I},ye=(et)=>{ie(et.clientY)},ot=(et)=>{let qt=et.touches[0];if(!qt)return;et.preventDefault(),ie(qt.clientY)},ve=(et)=>{if(R.classList.remove("dragging"),document.body.style.cursor="",document.body.style.userSelect="",jn)Wn.setItem?.(Zo,String(Math.round(I)));if(document.removeEventListener("mousemove",ye),document.removeEventListener("mouseup",ve),document.removeEventListener("touchmove",ot),document.removeEventListener("touchend",ve),document.removeEventListener("touchcancel",ve),!re&&et?.type!=="touchcancel"&&j.isConnected&&_i.current===oe)Io?.()};document.addEventListener("mousemove",ye),document.addEventListener("mouseup",ve),document.addEventListener("touchmove",ot,{passive:!1}),document.addEventListener("touchend",ve),document.addEventListener("touchcancel",ve)},Bl=(m)=>{let _=ae.current;if(!_)return;m.preventDefault(),ia(_.getBoundingClientRect().height,m.clientY,m.currentTarget)},Ol=(m)=>{let _=ae.current,R=m.touches?.[0];if(!_||!R)return;m.preventDefault(),ia(_.getBoundingClientRect().height,R.clientY,m.currentTarget)},rn=(m)=>{if(p)gi(m);else{if(ft(m),Bo)ys(m);else rt(!1),tt([]);if(Oo)ws(m);else lt(!1),ct([])}requestAnimationFrame(()=>Et())},Hl=(m)=>{let _=p?pn:we,R=_&&!_.endsWith(`
`)?`
`:"",j=`${_}${R}${m}`.trimStart();rn(j)},xs=n(()=>{requestAnimationFrame(()=>{let m=ae.current;if(!m)return;try{m.focus({preventScroll:!0})}catch{m.focus()}})},[]),Rt=n(()=>{Tt({kind:"idle",title:"",detail:""})},[]),_s=n((m=en.current,_=tn.current)=>{if(p)return;rn(_c(Ti.current,m,_))},[p]),Dt=n(()=>{Kr.current=!0;let m=Ae.current;if(!m){Rt();return}try{m.stop()}catch{Ae.current=null,Rt()}},[Rt]),Es=n(()=>{if(Oe.current?.selected){Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));return}if(ze(null),Xt(null),Ae.current){Dt();return}if(!Be?.showButton)return;if(Be.mode==="fallback"){xs(),Tt({kind:"guidance",title:Be.title||"Use keyboard dictation",detail:Be.detail||"Use your keyboard dictation mic for voice input here."});return}if(!Be?.canStart||!Be?.recognitionCtor){Tt({kind:"error",title:Be?.title||"Voice input unavailable",detail:Be?.detail||"This browser does not expose native speech recognition in this context."});return}try{let m=new Be.recognitionCtor;if(Ae.current=m,Ti.current=String(we||""),en.current="",tn.current="",Gr.current="",Kr.current=!1,m.lang=typeof navigator<"u"&&navigator.language?navigator.language:"en-US",m.interimResults=!0,m.continuous=!1,"maxAlternatives"in m)m.maxAlternatives=1;m.onstart=()=>{if(Ae.current!==m||Oe.current?.selected)return;Tt({kind:"listening",title:"Listening…",detail:"Speak now. Tap the mic again to stop."})},m.onresult=(_)=>{if(Ae.current!==m||Oe.current?.selected)return;let{finalText:R,interimText:j}=Ec(_?.results,_?.resultIndex||0);if(R)en.current=`${en.current} ${R}`.trim();tn.current=j,_s(),Tt({kind:"listening",title:"Listening…",detail:j?`Heard: ${j}`:"Speak now. Tap the mic again to stop."})},m.onerror=(_)=>{if(Ae.current!==m||Oe.current?.selected)return;let R=String(_?.error||"").trim();if(Gr.current=R,Ae.current=null,tn.current="",R==="aborted"){Rt();return}Tt({kind:"error",title:"Voice input failed",detail:oi(R,Be)})},m.onend=()=>{if(Ae.current!==m||Oe.current?.selected)return;let _=Gr.current,R=Kr.current,j=Boolean(en.current.trim()||tn.current.trim());if(Ae.current=null,Kr.current=!1,Gr.current="",tn.current.trim())en.current=`${en.current} ${tn.current}`.trim(),tn.current="";if(j)_s(en.current,"");if(_&&_!=="aborted")return;if(!j&&!R){Tt({kind:"error",title:"No speech detected",detail:oi("no-speech",Be)});return}Rt()},Tt({kind:"requesting_permission",title:"Starting voice input…",detail:"Allow microphone access if the browser asks."}),xs(),m.start()}catch(m){Ae.current=null,Tt({kind:"error",title:"Voice input failed",detail:m?.message||"Could not start native browser speech recognition."})}},[_s,Rt,we,xs,Be,Dt]),aa=async(m,_=null)=>{if(p||Jt)return;let R=se,j=++Lt.current;ze(null),Xt(null),Yo(!0);try{let I=await No("default",m,null,[],null,R);if(j!==Lt.current||R!==gt.current)return!1;if(I?.error||I?.command===!1||I?.command?.status==="error")throw Error(I?.error||I?.command?.message||"Model switch failed.");let re=null,oe=await ni(Fo,R,(ie)=>{if(j===Lt.current&&R===gt.current)bs(ie)},(ie)=>{if(j!==Lt.current||R!==gt.current)return;re=D(ie).find((ye)=>ye.current)?.key??L(ie?.current??ie?.model)??null,In(bo(ie,We))});if(j!==Lt.current||R!==gt.current)return!1;if(!oe||_&&re!==_)throw Error("The server did not confirm the model switch.");if(_)Le(_,new Date().toISOString(),We);return Xt(Lc(m,I)),l?.(I),!0}catch(I){return console.error("Failed to switch model:",I),alert("Failed to switch model: "+I.message),!1}finally{if(j===Lt.current)Yo(!1)}},zl=(m)=>{if(m.pointerType==="mouse")return;let _=ae.current?.value??(p?pn:we);if(!Tc({key:" ",code:"Space",ctrlKey:m.ctrlKey,metaKey:m.metaKey,altKey:m.altKey},_,{searchMode:p,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||Be?.canStart&&Be?.recognitionCtor)}))return;m.preventDefault(),Fn.current=!0,rs.current=!0,Es()},Cs=(m)=>{if(!Fn.current)return;if(m?.preventDefault?.(),Fn.current=!1,Oe.current?.selected)Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));else if(Ae.current)Dt()},ql=(m)=>{if(rs.current){rs.current=!1,m.preventDefault();return}Es()},Gl=async(m)=>{let _=typeof m==="string"?m.trim():"";if(!_||Jt)return;await aa(`/thinking ${_}`)},Kl=async(m)=>{let _=typeof m==="string"?m:typeof m?.key==="string"?m.key:typeof m?.label==="string"?m.label:"";if(!_||Jt)return;if(await aa(`/model ${_}`,_))gn(!1),requestAnimationFrame(()=>Zn.current?.focus?.())},Wl=(m)=>{if(!m||m.disabled)return;if(m.type==="session"){let _=m.chat;if(_?.archived_at)ea(_.chat_jid);else Zi(_.chat_jid);return}if(m.type==="action"){if(m.action==="new"){na();return}if(m.action==="new-root"){ra();return}if(m.action==="rollup"){oa();return}if(m.action==="rename"){ta();return}if(m.action==="delete")sa()}},so=n(()=>{gn(!1),requestAnimationFrame(()=>Zn.current?.focus?.())},[]),Ul=(m)=>{m.preventDefault(),m.stopPropagation(),Zt.current={value:"",updatedAt:0},De(!1),gn((_)=>{if(!_)In(bo(ne,We));return!_})},ca=async()=>{if(p)return;He?.(),await Pn("/compact",null,{includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,clearAfterSubmit:!1,recordHistory:!1})},Yl=(m)=>{if(m==="queue"||m==="steer"||m==="auto")return m;return Kn?"queue":void 0},Pn=async(m,_,R={})=>{if(!R.dictationFinished&&Oe.current?.active&&!/^\/abort\s*$/i.test(String(m||""))){let it=m==null||m===(ae.current?.value??we);try{await Oe.current.submit(async()=>{await Pn(it?ae.current?.value??we:m,_,{...R,dictationFinished:!0})})}catch{ze("Dictation could not finish. Draft preserved; send again explicitly.")}return}let j=typeof m==="string"?m:we;if(Ho&&/^\/settings\s*$/i.test(j.trim())){ft(""),requestAnimationFrame(()=>Et()),A();return}if(Ho&&/^\/help\s*$/i.test(j.trim())){ft(""),requestAnimationFrame(()=>Et()),A({section:"keyboard"});return}let I=/^\/abort\s*$/i.test(j.trim());if(os.current&&!I)return;let{includeMedia:re=!0,includeFileRefs:oe=!0,includeFolderRefs:ie=!0,includeMessageRefs:ye=!0,clearAfterSubmit:ot=!0,recordHistory:ve=!0}=R||{},et=typeof m==="string"?m:m&&typeof m?.target?.value==="string"?m.target.value:we,qt=typeof et==="string"?et:"";if(!qt.trim()&&(re?fn.length===0:!0)&&(oe?M.length===0:!0)&&(ie?F.length===0:!0)&&(ye?U.length===0:!0))return;let Cr=!I;if(Cr)os.current=!0,bi(!0),pi?.(!0);if(Ae.current)Dt();Rt(),rt(!1),tt([]),lt(!1),ct([]),De(!1),ze(null),Xt(null);let dt=Cr?Yt.current.begin(se):null,Ar=re?[...fn]:[],zn=oe?[...M]:[],Ln=ie?[...F]:[],Se=ye?[...U]:[],Ve=qt.trim(),st=se,da=Lt.current;if(ve&&Ve){let it=Jr.current,xe=Di(it.filter((Gt)=>Gt!==Ve));if(xe.push(Ve),xe.length>Mi)xe.splice(0,xe.length-Mi);Jr.current=xe,yl(xe),Bn.current=-1,br.current=""}let uu=()=>{let it=(xe,Gt)=>[...new Set([...xe||[],...Gt||[]])];if(re)mn((xe)=>[...Ar.filter((Gt)=>!xe.includes(Gt)),...xe]);if(oe)ko?.(it(zn,Wr.current));if(ie)xo?.(it(Ln,Ur.current));if(ye)_o?.(it(Se,Yr.current));ft((xe)=>{if(!Ve)return xe;if(!xe.trim())return Ve;if(xe.trim()===Ve)return xe;return`${Ve}

${xe}`}),requestAnimationFrame(()=>Et())};if(ot)ft(""),mn([]),N?.(),J?.(),X?.();(async()=>{try{let it=await Hc?.({content:Ve,submitMode:_,fileRefs:zn,folderRefs:Ln,messageRefs:Se,mediaFiles:Ar});if(it){l?.(it);return}let xe=await nt(dn?Ar:[],(je,Pt)=>Vc(je,{onProgress:Pt}),{onProgress:Ko}),Gt=xe.filter(({result:je})=>je.id).map(({name:je,result:Pt})=>({name:je,id:Pt.id})),du=xe.filter(({result:je})=>je.storage==="workspace").map(({result:je})=>je.path),pu=Gt.map(({id:je})=>je),pa=[...zn,...du],fu=pa.length?`Files:
${pa.map((je)=>`- ${je}`).join(`
`)}`:"",mu=Ln.length?`Folders:
${Ln.map((je)=>`- ${je}`).join(`
`)}`:"",gu=Se.length?`Referenced messages:
${Se.map((je)=>`- message:${je}`).join(`
`)}`:"",hu=Gt.length?`Attachments:
${Gt.map(({id:je,name:Pt},io)=>{let Rs=Pt||`attachment-${io+1}`;return`- attachment:${je} (${Rs})`}).join(`
`)}`:"",bu=[Ve,fu,mu,gu,hu].filter(Boolean).join(`

`);Ko(null);let on=await No("default",bu,null,pu,Yl(_),st);kr(on);let fa=Sr(on);if(fa&&gt.current===st)ze(fa);if(ci?.(on),dt!==null)if(on?.command?.status==="error")Yt.current.failed(dt);else Yt.current.acknowledged(dt);if(on?.command&&on.command.status!=="error"){let je=/^\/(?:model\s+\S+|cycle-model)\s*$/i.test(Ve.trim());await ni(Fo,st,(Pt)=>{if(da===Lt.current&&st===gt.current)bs(Pt)},(Pt)=>{if(da!==Lt.current||st!==gt.current)return;let io=D(Pt).find((Rs)=>Rs.current)?.key??L(Pt?.current??Pt?.model)??null;if(je&&io)Le(io,new Date().toISOString(),We)})}Xt(Lc(Ve,on)),l?.(on)}catch(it){if(ot)uu();let xe=it?.message||"Failed to send message.";if(dt!==null)Yt.current.failed(dt);ze(xe),Eo?.(xe),console.error("Failed to post:",it)}finally{if(Cr){if(dt!==null)Yt.current.finished(dt);Ko(null),bi(!1),os.current=!1,pi?.(!1)}}})()},Vl=(m)=>Bc?.(m),Jl=n((m)=>{let _=se,R=ae.current,j=R?.value??we,I=Wr.current,re=Ur.current,oe=Yr.current,ie=ss.current;return Bf({queuedItem:m,onRemoveQueuedFollowup:$o,isCurrent:()=>gt.current===_&&ae.current===R,canRestoreDraft:()=>(ae.current?.value??we)===j&&Wr.current===I&&Ur.current===re&&Yr.current===oe&&ss.current===ie,setSubmitError:ze,setSubmitNotice:Xt,setMediaFiles:mn,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,setContent:ft,textareaRef:ae,resizeTextarea:Et})},[se,we,$o,ko,xo,_o,Et]),Er=n((m)=>{if(p||!Ue&&!ke||m?.isComposing)return!1;let _=()=>{m.preventDefault?.(),m.stopPropagation?.()},R=()=>{Zt.current={value:"",updatedAt:0}};if(Ue&&m.target?.closest?.("[data-compose-model-catalogue]"))return!1;if(m.key==="Escape"){if(_(),R(),Ue)so();if(ke)De(!1),Or(""),requestAnimationFrame(()=>zr.current?.querySelector?.("button")?.focus?.());return!0}if(Ue)return!1;if(ke){let j=Nn.current,I=Math.max(0,j.findIndex((oe)=>oe.key===Si.current)),re=Boolean(m.target?.classList?.contains?.("compose-session-search"));if(["ArrowDown","ArrowUp","Home","End","PageDown","PageUp"].includes(m.key)){if(_(),R(),j.length>0){let oe=bc(I,j.length,m.key);Qt(j[oe])}return!0}if(m.key==="Enter"&&m.altKey&&j.length>0){_(),R();let oe=j[I];if(oe?.type==="session"&&!oe.chat?.archived_at)ks(oe.chat.chat_jid);return!0}if((m.key==="Enter"||m.key==="Tab")&&j.length>0)return _(),R(),Wl(j[I]),!0;if(!re&&kt(m)&&j.length>0){_();let oe=ac(Zt.current,m.key);Zt.current=oe;let ie=cc(j,oe.value,I,(ye)=>ye.label);if(ie>=0)Qt(j[ie]);return!0}}return!1},[p,Ue,ke,Qt,so,ks]),Ql=(m)=>{if(m.isComposing||m.defaultPrevented)return;if(m.key==="Enter"&&(m.ctrlKey||m.metaKey)&&!m.shiftKey&&!m.altKey&&!p){let R=xr(m);if(m.preventDefault(),R)Pn(ae.current?.value??we,"steer");return}if(p&&m.key==="Escape"){m.preventDefault(),gi(""),P?.();return}if(Er(m))return;let _=ae.current?.value??(p?pn:we);if(Tc(m,_,{searchMode:p,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||Be?.canStart&&Be?.recognitionCtor)})){m.preventDefault(),Fn.current=!0,Es();return}if(wc(m,_,{searchMode:p,showSessionSwitcherButton:Rn})){m.preventDefault(),vs();return}if(Yn&&Vt.length>0){let R=ae.current?.value??(p?pn:we);if(!String(R||"").match(/^@([a-zA-Z0-9_-]*)$/))lt(!1),ct([]);else{if(m.key==="ArrowDown"){m.preventDefault(),Br((j)=>(j+1)%Vt.length);return}if(m.key==="ArrowUp"){m.preventDefault(),Br((j)=>(j-1+Vt.length)%Vt.length);return}if(m.key==="Tab"||m.key==="Enter"){m.preventDefault(),Xi(Vt[Uo]);return}if(m.key==="Escape"){m.preventDefault(),lt(!1),ct([]);return}}}if(Un&&Bt.length>0){let R=ae.current?.value??(p?pn:we);if(!String(R||"").startsWith("/"))rt(!1),tt([]);else{if(m.key==="ArrowDown"){m.preventDefault(),Fr((j)=>(j+1)%Bt.length);return}if(m.key==="ArrowUp"){m.preventDefault(),Fr((j)=>(j-1+Bt.length)%Bt.length);return}if(m.key==="Tab"){m.preventDefault(),Qi(Bt[Nr]);return}if(m.key==="Enter"&&!m.shiftKey){if(!_.includes(" ")){m.preventDefault();let I=Bt[Nr];rt(!1),tt([]),Pn(I.name);return}}if(m.key==="Escape"){m.preventDefault(),rt(!1),tt([]);return}}}if(!p&&(m.key==="ArrowUp"||m.key==="ArrowDown")&&!m.metaKey&&!m.ctrlKey&&!m.altKey&&!m.shiftKey){let R=ae.current;if(!R)return;let j=R.value||"",I=R.selectionStart===0&&R.selectionEnd===0,re=R.selectionStart===j.length&&R.selectionEnd===j.length;if(m.key==="ArrowUp"&&I||m.key==="ArrowDown"&&re){let oe=Jr.current;if(!oe.length)return;m.preventDefault();let ie=Bn.current;if(m.key==="ArrowUp"){if(ie===-1)br.current=j,ie=oe.length-1;else if(ie>0)ie-=1;Bn.current=ie,rn(oe[ie]||"")}else{if(ie===-1)return;if(ie<oe.length-1)ie+=1,Bn.current=ie,rn(oe[ie]||"");else Bn.current=-1,rn(br.current||""),br.current=""}requestAnimationFrame(()=>{let ye=ae.current;if(!ye)return;let ot=ye.value.length;ye.selectionStart=ot,ye.selectionEnd=ot});return}}if(m.key==="Enter"&&!m.shiftKey&&(m.ctrlKey||m.metaKey)){if(m.preventDefault(),p){if(_.trim())k?.(_.trim(),w,{images:zo,attachments:qo})}return}if(m.key==="Enter"&&!m.shiftKey&&!m.ctrlKey&&!m.metaKey&&!m.altKey&&!m.repeat){if(m.preventDefault(),p){if(_.trim())k?.(_.trim(),w,{images:zo,attachments:qo})}else Pn(_);return}if(m.key==="Escape"){if(Ue||ke||Un||Yn)return;m.preventDefault(),ae.current?.blur()}},Xl=(m)=>{if(vf(m,Fn.current)){if(m.preventDefault(),Fn.current=!1,Oe.current?.selected)Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));else if(Ae.current)Dt()}},As=(m)=>{if(!dn)return;let _=Array.from(m||[]).filter((R)=>R instanceof File&&!String(R.name||"").startsWith(".DS_Store"));if(!_.length)return;mn((R)=>[...R,..._]),ze(null)};o(()=>{let m=async(_)=>{let R=_?.detail?.mediaId;if(!R)return;try{let{getMediaBlob:j}=await (u("kqw49f9y"),import("./api-kqw49f9y.js")),I=await j(R),re=new File([I],`annotated-${R}.png`,{type:I.type||"image/png"});mn((oe)=>[...oe,re]),ae.current?.focus()}catch(j){console.warn("[compose-box] Failed to attach annotated image:",j)}};return window.addEventListener("piclaw:compose-media-attach",m),()=>window.removeEventListener("piclaw:compose-media-attach",m)},[]);let Zl=(m)=>{As(m.target.files),m.target.value=""},eu=(m)=>{if(p||!dn)return;m.preventDefault(),m.stopPropagation(),fr.current+=1,Ir(!0)},tu=(m)=>{if(p)return;if(m.preventDefault(),m.stopPropagation(),fr.current=Math.max(0,fr.current-1),fr.current===0)Ir(!1)},nu=(m)=>{if(p||!dn)return;if(m.preventDefault(),m.stopPropagation(),m.dataTransfer)m.dataTransfer.dropEffect="copy";Ir(!0)},ru=(m)=>{if(p||!dn)return;m.preventDefault(),m.stopPropagation(),fr.current=0,Ir(!1),As(m.dataTransfer?.files||[])},ou=(m)=>{if(p||!dn)return;let _=m.clipboardData?.items;if(!_||!_.length)return;let R=[];for(let j of _){if(j.kind!=="file")continue;let I=j.getAsFile?.();if(I)R.push(I)}if(R.length>0)m.preventDefault(),As(R)},su=(m)=>{mn((_)=>_.filter((R,j)=>j!==m))},iu=()=>{ze(null),mn([]),N?.(),J?.(),X?.()},au=()=>{if(!navigator.geolocation){alert("Geolocation is not available in this browser.");return}navigator.geolocation.getCurrentPosition((m)=>{let{latitude:_,longitude:R,accuracy:j}=m.coords,I=`${_.toFixed(5)}, ${R.toFixed(5)}`,re=Number.isFinite(j)?` ±${Math.round(j)}m`:"",oe=`https://maps.google.com/?q=${_},${R}`,ie=`Location: ${I}${re} ${oe}`;Hl(ie)},(m)=>{let _=m?.message||"Unable to retrieve location.";alert(`Location error: ${_}`)},{enableHighAccuracy:!0,timeout:1e4,maximumAge:0})};o(()=>{if(!Ue)return;let m=se,_=++Jn.current,R=Xo.current;Zt.current={value:"",updatedAt:0},$i(!0),Promise.resolve(Fo(m)).then((j)=>{if(_!==Jn.current||m!==gt.current)return;if(Xo.current!==R)return;In(bo(j,We)),bs(j)}).catch((j)=>{if(_!==Jn.current||m!==gt.current)return;console.warn("Failed to load model list:",j),In([])}).finally(()=>{if(_===Jn.current)$i(!1)})},[Ue,se]),o(()=>{if(p)gn(!1),De(!1),rt(!1),tt([]),lt(!1),ct([])},[p]),o(()=>{if(ke&&!Rn)De(!1)},[ke,Rn]),o(()=>{if(!ke)Vo(null),Jo(null),Or("")},[ke]),o(()=>{if(!ke)return;let m=yf(ut,se);Qt(ut[m]),Zt.current={value:"",updatedAt:0}},[ke,se,Qt]),o(()=>{if(!Ue)return;let m=(_)=>{let R=Pi.current,j=Zn.current,I=_.target;if(R&&R.contains(I))return;if(j&&j.contains(I))return;gn(!1)};return document.addEventListener("pointerdown",m),()=>document.removeEventListener("pointerdown",m)},[Ue]),o(()=>{if(!ke)return;let m=(_)=>{let R=Hr.current,j=zr.current,I=_.target;if(R&&R.contains(I))return;if(j&&j.contains(I))return;De(!1)};return document.addEventListener("pointerdown",m),()=>document.removeEventListener("pointerdown",m)},[ke]),o(()=>{if(p||!Ue&&!ke)return;let m=(_)=>{Er(_)};return document.addEventListener("keydown",m,!0),()=>document.removeEventListener("keydown",m,!0)},[p,Ue,ke,Er]),o(()=>{if(!ke)return;let m=Hr.current,_=m?.querySelector?.(".compose-session-search");if(document.activeElement!==_)_?.focus?.();m?.querySelector?.(".compose-model-popup-item.active")?.scrollIntoView?.({block:"nearest"})},[ke,Mt,ut.length]),o(()=>{if(!Yn||!ts.current)return;ts.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Yn,Uo,Vt.length]),o(()=>{if(!Un||!es.current)return;es.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Un,Nr,Bt.length]),o(()=>{let m=(R)=>{if(!R||typeof R!=="object")return!1;if(R.isContentEditable)return!0;if(typeof R.closest!=="function")return!1;return Boolean(R.closest('input, textarea, select, [contenteditable="true"], .compose-box, .compose-model-popup, .compose-session-popup, .settings-dialog, .workspace-sidebar, .editor-pane-container, .dock-panel, .timeline-menu-dropdown, .rename-branch-overlay, .agent-request-modal, .attachment-preview-modal, .vnc-pane-shell, .kanban-plugin, .timeline-quick-actions'))},_=(R)=>{if(R.defaultPrevented||R.ctrlKey||R.metaKey||R.altKey)return;let j=ae.current;if(!j)return;let I=document.activeElement===j;if(R.key==="Escape"&&!I&&!m(R.target)){R.preventDefault(),j.focus();return}if(R.key==="/"&&!I&&!m(R.target))R.preventDefault(),rn("/"),requestAnimationFrame(()=>{j.focus(),j.selectionStart=1,j.selectionEnd=1,ys("/")})};return window.addEventListener("keydown",_),()=>window.removeEventListener("keydown",_)},[]),o(()=>{let m=()=>{let re=ns.current?.clientWidth||0;fl((oe)=>oe===re?oe:re)};m();let _=ns.current,R=0,j=()=>{if(R)cancelAnimationFrame(R);R=requestAnimationFrame(()=>{R=0,m()})},I=null;if(_&&typeof ResizeObserver<"u")I=new ResizeObserver(()=>j()),I.observe(_);if(typeof window<"u")window.addEventListener("resize",j);return()=>{if(R)cancelAnimationFrame(R);if(I?.disconnect?.(),typeof window<"u")window.removeEventListener("resize",j)}},[p,V,Ne?.agent_name,Rn,be?.percent]);let cu=(m)=>{let _=m.target.value;if(Ae.current&&m?.isTrusted)Dt();if(ze(null),Xt(null),ht.kind==="guidance"||ht.kind==="error")Rt();if(ke)De(!1);if(Et(m.target),Zs(_,{searchMode:p,showSessionSwitcherButton:Rn})){rn(""),requestAnimationFrame(()=>{let R=ae.current;if(!R)return;R.value="",R.selectionStart=0,R.selectionEnd=0,R.focus()}),vs();return}rn(_)};o(()=>{requestAnimationFrame(()=>Et())},[we,pn,p]),o(()=>{if(typeof window>"u")return;let m=()=>{if(Qn.current!=null){let _=ii(Qn.current);if(Qn.current=_,jn)Wn.setItem?.(Zo,String(_))}requestAnimationFrame(()=>Et())};return window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[]),o(()=>{if(!p)return;if(Oe.current?.cancel(),Ae.current)Dt();return},[p,Dt]),o(()=>{if(Ae.current)Dt();Rt()},[se,Rt,Dt]),o(()=>()=>{if(!Ae.current)return;try{Ae.current.stop()}catch(m){console.debug("[compose] failed to stop speech recognition during cleanup",m)}Ae.current=null},[]),o(()=>{if(!nn)return;Ai(Date.now());let m=setInterval(()=>Ai(Date.now()),1000);return()=>clearInterval(m)},[nn,Nt?.started_at,Nt?.startedAt]),o(()=>{if(Ri(0),Ot?.mode!=="custom"||!Array.isArray(Ot.frames)||Ot.frames.length<=1)return;let m=typeof Ot.intervalMs==="number"&&Number.isFinite(Ot.intervalMs)&&Ot.intervalMs>0?Ot.intervalMs:120,_=setInterval(()=>{Ri((R)=>(R+1)%Ot.frames.length)},m);return()=>clearInterval(_)},[Ot]),o(()=>{if(p||!Oo)return;ws(we)},[Oo,Hi,se,we,p]);let la=Vi?e`
                    <div class="compose-meta-row">
                        ${(ro||_r)&&e`
                            <div class="compose-model-meta">
                                ${ro&&e`
                                    <button
                                        ref=${Zn}
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
    `:null;a(()=>{if(!zt)return;d(la,zt)});let[lu,ua]=t(null);return a(()=>{if(!Ue||!zt){ua(null);return}let m=()=>{let _=Zn.current?.getBoundingClientRect?.(),R=zt.closest?.(".workbench-statusbar")?.getBoundingClientRect?.();if(!_||!R)return;ua({left:Math.round(_.left),bottom:Math.round(window.innerHeight-R.top+6)})};return m(),window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[Ue,zt]),o(()=>()=>{if(zt)d(null,zt)},[zt]),e`
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
                <div class=${`compose-inline-status compose-speech-status compose-speech-status-${ht.kind}`} role="status" aria-live="polite">
                    <div class="compose-inline-status-row">
                        <span class=${ti({pulsing:Sl})} aria-hidden="true"></span>
                        <span class="compose-inline-status-title">${ht.title}</span>
                    </div>
                    ${ht.detail&&e`<div class="compose-inline-status-detail">${ht.detail}</div>`}
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
                    onOpenFilePill=${qe}
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
                ${Rn&&e`
                    <div
                        ref=${zr}
                        class="compose-session-trigger-group compose-session-trigger-top"
                    >
                        <button
                            type="button"
                            class=${`compose-session-trigger compose-session-trigger-pill${ke?" active":""}`}
                            data-testid="session-switcher"
                            onClick=${Fl}
                            title=${Ne?.chat_jid||se}
                            aria-label=${Ne?.agent_name?`Manage sessions for @${Ne.agent_name}`:"Manage Sessions/Agents"}
                            aria-expanded=${ke?"true":"false"}
                        >
                            <span class="compose-current-agent-label active">${Ne?.agent_name?`@${Ne.agent_name}`:"Sessions"}</span>
                        </button>
                    </div>
                `}
                <div class="compose-input-main">
                    ${Cl&&e`
                        <div class="compose-file-refs">
                            ${U.map((m)=>e`
                                    <${S}
                                        key=${"msg-"+m}
                                        prefix="compose"
                                        label=${"msg:"+m}
                                        title=${"Message reference: "+m}
                                        removeTitle="Remove reference"
                                        icon="message"
                                        onRemove=${()=>ee?.(m)}
                                    />
                                `)}
                            ${M.map((m)=>{let _=m.split("/").pop()||m;return e`
                                    <${S}
                                        prefix="compose"
                                        label=${_}
                                        title=${m}
                                        onClick=${()=>qe?.(m)}
                                        removeTitle="Remove file"
                                        onRemove=${()=>T?.(m)}
                                    />
                                `})}
                            ${F.map((m)=>{let _=m.split("/").pop()||m;return e`
                                    <${S}
                                        prefix="compose"
                                        label=${_}
                                        title=${m}
                                        icon="folder"
                                        onClick=${()=>qe?.(m)}
                                        removeTitle="Remove folder hint"
                                        onRemove=${()=>B?.(m)}
                                    />
                                `})}
                            ${fn.map((m,_)=>{let R=m?.name||`attachment-${_+1}`;return e`
                                    <${S}
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
                        ref=${ae}
                        data-testid="compose-input"
                        placeholder=${p?ge("compose.searchPlaceholder"):ge("compose.placeholder")}
                        value=${p?pn:we}
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
                                    onMouseDown=${(R)=>{R.preventDefault(),Xi(m)}}
                                    onMouseEnter=${()=>Br(_)}
                                >
                                    <span class="slash-name">@${m.agent_name}</span>
                                    <span class="slash-desc">${m.chat_jid||"Active agent"}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${Un&&Bt.length>0&&e`
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
                    ${Ue&&!p&&e`
                        <${xc}
                            anchor=${lu}
                            entries=${ll}
                            loading=${pl}
                            switching=${Jt}
                            onSelect=${(m)=>{Kl(m)}}
                            onTogglePin=${(m)=>Xe(m.key,We)}
                            onClose=${so}
                            onCompact=${mi?()=>{so(),ca()}:void 0}
                            onOpenSettings=${Ho?()=>{gn(!1),A({section:"models"})}:void 0}
                            thinkingLevel=${me}
                            thinkingLevels=${Ki?.thinkingLevels??[]}
                            onSelectThinking=${(m)=>{Gl(m)}}
                            rootRef=${Pi}
                        />
                    `}
                    ${ke&&!p&&e`
                        <div class="compose-model-popup compose-session-popup" data-testid="session-popup" ref=${Hr} tabIndex="-1" onKeyDown=${Er}>
                            <div class="compose-session-popup-header">
                                <label class="compose-model-popup-title compose-session-search-heading" for="compose-session-search">Search sessions</label>
                                <button type="button" class="compose-session-popup-close" aria-label="Close session picker" onClick=${()=>{De(!1),requestAnimationFrame(()=>zr.current?.querySelector?.("button")?.focus?.())}}>×</button>
                            </div>
                            <input
                                id="compose-session-search"
                                class="compose-session-search"
                                type="search"
                                value=${mt}
                                placeholder="Handle, JID, state, or model"
                                autocomplete="off"
                                onInput=${(m)=>{let _=m.currentTarget.value,R=Me(Pe(yr,_),se,Vn).flatMap((I)=>I.items);Nn.current=R.map((I)=>({type:"session",key:`session:${I.chat_jid}`,label:`@${I.agent_name} — ${I.chat_jid}${I.is_active?" active":""}${I.archived_at?" archived":""}`,chat:I,disabled:I.archived_at?!yn||I?.capabilities?.restore===!1:!bn||I?.capabilities?.open===!1}));let j=gc(R,_);Qt(Nn.current[j]),Or(_)}}
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
                                    <div class="compose-model-popup-empty">No sessions match “${mt}”.</div>
                                `}
                                ${ds.map((m,_)=>{let R=us.find((Se)=>Se.items.includes(m)),j=R?.items[0]===m,I=Boolean(m.archived_at),re=!I&&Tl.has(m.chat_jid),oe=m.chat_jid===(m.root_chat_jid||m.chat_jid),ie=!oe&&!m.is_active&&!I&&typeof ln==="function"&&m?.capabilities?.archive!==!1,ye=I&&zi,ot=ye&&al===m.chat_jid,ve=ie&&cl===m.chat_jid,et=ot||ve,qt=_t(m,{currentChatJid:se}),Cr=Y(m.agent_name),dt=Qe(m,{currentChatJid:se}),Ar=m.root_chat_jid||m.chat_jid,zn=m.model||m.model_label||"",Ln=fc(m);return e`
                                        ${j&&e`<div class="compose-session-section-heading" role="presentation">${R.label}</div>`}
                                        <div key=${m.chat_jid} class=${`compose-model-popup-item-row${I?" archived":""}`}>
                                            ${I?e`<span class="compose-session-row-pin-spacer" aria-hidden="true"></span>`:e`<button
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
                                                class=${`compose-model-popup-item session-item${I?" archived":""}${Mt===_?" active":""}`}
                                                data-testid="session-item"
                                                onClick=${()=>{if(I){ea(m.chat_jid);return}Zi(m.chat_jid)}}
                                                disabled=${I?!yn||m?.capabilities?.restore===!1:!bn||m?.capabilities?.open===!1}
                                                title=${I?`Restore archived ${qt}`:`Switch to ${qt}`}
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
                                                onClick=${(Se)=>{Se.stopPropagation(),De(!1);let Ve=new URL(window.location.href);Ve.searchParams.set("chat_jid",m.chat_jid),Ve.searchParams.set("chat_only","1");let st=document.createElement("a");st.href=Ve.toString(),st.target="_blank",st.rel="noopener",st.style.display="none",document.body.appendChild(st),st.click(),st.remove()}}
                                            >
                                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M6 2h8v8"/>
                                                    <path d="M14 2 7 9"/>
                                                    <path d="M12 9v5H2V4h5"/>
                                                </svg>
                                            </button>
                                            ${(ie||ye)&&e`
                                                ${et?e`<button
                                                        key=${`${m.chat_jid}:delete-confirm`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete confirming"
                                                        data-chat-jid=${m.chat_jid}
                                                        data-delete-kind=${ye?"purge":"prune"}
                                                        title=${ye?"Confirm permanent deletion":"Confirm branch deletion"}
                                                        aria-label=${ye?oe?`Confirm permanent deletion of archived session @${m.agent_name}`:`Confirm permanent deletion of archived branch @${m.agent_name}`:`Confirm delete @${m.agent_name}`}
                                                        onPointerDown=${(Se)=>{Se.preventDefault(),Se.stopPropagation(),oo(m,{canPurgeArchived:ye,canPrune:ie})}}
                                                        onKeyDown=${(Se)=>{if(Se.key!=="Enter"&&Se.key!==" ")return;Se.preventDefault(),Se.stopPropagation(),oo(m,{canPurgeArchived:ye,canPrune:ie})}}
                                                    >
                                                        <span class="compose-model-popup-item-delete-confirm">OK</span>
                                                    </button>`:e`<button
                                                        key=${`${m.chat_jid}:delete-request`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete"
                                                        title=${ye?oe?"Permanently delete this archived session":"Permanently delete this archived branch":"Delete this branch"}
                                                        aria-label=${ye?oe?`Permanently delete archived session @${m.agent_name}`:`Permanently delete archived branch @${m.agent_name}`:`Delete @${m.agent_name}`}
                                                        onClick=${(Se)=>{if(Se.stopPropagation(),ye){Vo(m.chat_jid);return}if(ie){Jo(m.chat_jid);return}De(!1),ln(m.chat_jid)}}
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
                            ${!mt&&(_n||wr||$n||En)&&e`
                                <div class="compose-model-popup-actions">
                                    ${_n&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn primary${ut.findIndex((m)=>m.key==="action:new")===Mt?" active":""}`}
                                            onClick=${()=>{na()}}
                                            title=${ge("compose.newBranchTitle")}
                                        >
                                            ${ge("compose.newBranch")}
                                        </button>
                                    `}
                                    ${wr&&e`
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
                                            title=${vr?ge("compose.mergeInto",{target:Ht.agent_name?`@${Ht.agent_name}`:Ht.chat_jid}):ge("compose.mergeBlocked")}
                                            disabled=${!vr}
                                        >
                                            ${ge("compose.mergeCurrent")}
                                        </button>
                                    `}
                                    ${$n&&e`
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
                                    ${En&&e`
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
                                value=${w}
                                onChange=${(m)=>x?.(m.currentTarget.value)}
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
                        onClick=${p?P:C}
                        title=${p?ge("compose.closeSearch"):ge("compose.search")}
                        disabled=${p?typeof P!=="function":typeof C!=="function"}
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
                                disabled=${M.includes(Wt)}
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
                                ${hn&&e`
                                    <button
                                        class=${hn.className}
                                        data-testid="stop-button"
                                        type="button"
                                        onClick=${()=>{if($f(hn.mode))Pn("/abort","steer",{clearAfterSubmit:!1,includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,recordHistory:!1})}}
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
export{_e,H,yt,bt,vt,wt,$e,Xn,Ge,vn,er,Te,y,W,q,Ee,ce,z,xt,Ie,tr,b,Re,nr,wn,xn,Sn,kn,v,An,rr,or,le,ir,sr,St,Cn,kt,ar,Q,cr,Je,lr,At,ur,Pe,Me,Y,Ct,Qe,_t,dr,$t,Ye,pr,S,ue,Ze};

//# debugId=3DF3B8541B2013D564756E2164756E21
//# sourceMappingURL=app-rt2xrf2c.js.map
