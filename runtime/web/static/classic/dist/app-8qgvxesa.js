import{d,t,o,a,r,i,n,e}from"./app-p2arjngp.js";import{Cr,_r,$r,it,Rr,T,re}from"./app-43bh51ak.js";import{fe,O,g,me,et,Fe,D,ee,ge,br,vr}from"./app-bf69xg8m.js";import{u}from"./app-06dq0paq.js";import{f,c,A,s}from"./app-dg3gg17f.js";var Te="piclaw:session-picker-preferences-changed";function Ps(){return{pinnedChatJids:[]}}function ma(l){return typeof l==="string"?l.trim():""}function ga(l){if(!l||typeof l!=="object")return Ps();let h=l;return{pinnedChatJids:Array.from(new Set((Array.isArray(h.pinnedChatJids)?h.pinnedChatJids:[]).map(ma).filter(Boolean)))}}function ha(l){try{return l?.localStorage??null}catch{return null}}function q(l=typeof window<"u"?window:null){try{let h=ha(l)?.getItem("piclaw:session-picker-preferences:v1");return h?ga(JSON.parse(h)):Ps()}catch{return Ps()}}function wt(l,h=typeof window<"u"?window:null){let p=ga(l);try{ha(h)?.setItem("piclaw:session-picker-preferences:v1",JSON.stringify(p))}catch(w){console.debug("[session-picker-preferences] Storage unavailable; keeping the in-memory preference result.",w)}try{h?.dispatchEvent?.(new CustomEvent("piclaw:session-picker-preferences-changed",{detail:p}))}catch(w){console.debug("[session-picker-preferences] Preference event delivery unavailable.",w)}return p}function xt(l,h=typeof window<"u"?window:null){let p=ma(l),w=q(h);if(!p)return w;let k=new Set(w.pinnedChatJids);if(k.has(p))k.delete(p);else k.add(p);let x=wt({pinnedChatJids:Array.from(k)},h);return h?.dispatchEvent?.(new CustomEvent("piclaw:picker-pin-write",{detail:{kind:"session",key:p,pinned:k.has(p)}})),x}import{classHighlighter as yu,HighlightStyle as wu,tags as ao}from"#editor-vendor/codemirror";var vu=wu.define([{tag:[ao.function(ao.variableName),ao.function(ao.propertyName)],class:"tok-function"}]),Ls={style(l){let h=yu.style(l),p=vu.style(l);return[h,p].filter(Boolean).join(" ")||null}};import{highlightTree as Ga,StreamLanguage as G,cssLanguage as Su,cppLanguage as $u,goLanguage as ku,htmlLanguage as xu,javascriptLanguage as _u,jsxLanguage as Eu,tsxLanguage as Cu,typescriptLanguage as Au,jsonLanguage as Ru,markdownLanguage as Pu,pythonLanguage as Lu,rustLanguage as Tu,StandardSQL as Mu,xmlLanguage as Du,yamlLanguage as ju,dockerFile as Iu,powerShell as Nu,ruby as Fu,shell as Bu,swift as Ou,toml as Hu,clojure as zu,cmake as qu,coffeeScript as Gu,crystal as Ku,cypher as Wu,d as Uu,diff as Yu,eiffel as Vu,elm as Ju,erlang as Qu,factor as Xu,forth as Zu,fortran as ed,gas as td,gherkin as nd,groovy as rd,haskell as od,haxe as sd,http as id,jinja2 as ad,julia as cd,liveScript as ld,lua as ud,mathematica as dd,fSharp as pd,nginx as fd,octave as md,oz as gd,pascal as hd,perl as bd,properties as yd,protobuf as wd,pug as vd,puppet as Sd,r as $d,sas as kd,sass as xd,scheme as _d,smalltalk as Ed,solr as Cd,sparql as Ad,stex as Rd,stylus as Pd,tcl as Ld,textile as Td,turtle as Md,vb as Dd,verilog as jd,vhdl as Id,wast as Nd,webIDL as Fd,xQuery as Bd}from"#editor-vendor/codemirror";var Ka=98304;function Ge(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}var Od={js:"JavaScript",javascript:"JavaScript",ts:"TypeScript",typescript:"TypeScript",jsx:"JSX",tsx:"TSX",py:"Python",python:"Python",sh:"Shell",shell:"Shell",bash:"Bash",zsh:"Zsh",ps1:"PowerShell",powershell:"PowerShell",md:"Markdown",markdown:"Markdown",yml:"YAML",yaml:"YAML",json:"JSON",html:"HTML",css:"CSS",sql:"SQL",go:"Go",c:"C",cc:"C++",cpp:"C++","c++":"C++",cxx:"C++",h:"C/C++",hh:"C++",hpp:"C++",hxx:"C++",rust:"Rust",rs:"Rust",ruby:"Ruby",swift:"Swift",toml:"TOML",dockerfile:"Dockerfile",asm:"Gas",clj:"Clojure",clojure:"Clojure",cmake:"CMake",coffee:"CoffeeScript",coffeescript:"CoffeeScript",conf:"nginx",cr:"Crystal",crystal:"Crystal",cypher:"Cypher",d:"D",diff:"Diff",eiffel:"Eiffel",elm:"Elm",erl:"Erlang",erlang:"Erlang",f90:"Fortran",f95:"Fortran",factor:"Factor",feature:"Gherkin",forth:"Forth",fortran:"Fortran",fsharp:"ML",gas:"Gas",gherkin:"Gherkin",groovy:"Groovy",haskell:"Haskell",haxe:"Haxe",hs:"Haskell",http:"HTTP",hx:"Haxe",ini:"Properties",jade:"Pug",jinja:"Jinja2",jinja2:"Jinja2",jl:"Julia",julia:"Julia",latex:"LaTeX",livescript:"LiveScript",ls:"LiveScript",lua:"Lua",mathematica:"Mathematica",matlab:"Octave",ml:"ML",nginx:"nginx",ocaml:"ML",octave:"Octave",oz:"Oz",pas:"Pascal",pascal:"Pascal",patch:"Diff",perl:"Perl",pl:"Perl",pm:"Perl",pp:"Puppet",properties:"Properties",proto:"Protobuf",protobuf:"Protobuf",pug:"Pug",puppet:"Puppet",r:"R",rq:"SPARQL",s:"Gas",sas:"SAS",sass:"Sass",scheme:"Scheme",scm:"Scheme",scss:"Sass",smalltalk:"Smalltalk",sml:"ML",sparql:"SPARQL",st:"Smalltalk",styl:"Stylus",stylus:"Stylus",sv:"Verilog",tcl:"Tcl",tex:"LaTeX",textile:"Textile",ttl:"Turtle",turtle:"Turtle",vb:"VB",verilog:"Verilog",vhdl:"VHDL",wasm:"WebAssembly",wast:"WebAssembly",webidl:"WebIDL",wl:"Mathematica",xq:"XQuery",xquery:"XQuery"},Hd=G.define(Bu).parser,zd=G.define(Nu).parser,qd=G.define(Iu).parser,Gd=G.define(Fu).parser,Kd=G.define(Ou).parser,Wd=G.define(Hu).parser,ba=G.define(zu).parser,Ud=G.define(qu).parser,ya=G.define(Gu).parser,wa=G.define(Ku).parser,Yd=G.define(Wu).parser,Vd=G.define(Uu).parser,va=G.define(Yu).parser,Jd=G.define(Vu).parser,Qd=G.define(Ju).parser,Sa=G.define(Qu).parser,Xd=G.define(Xu).parser,Zd=G.define(Zu).parser,Ts=G.define(ed).parser,Ms=G.define(td).parser,$a=G.define(nd).parser,ep=G.define(rd).parser,ka=G.define(od).parser,xa=G.define(sd).parser,tp=G.define(id).parser,_a=G.define(ad).parser,Ea=G.define(cd).parser,Ca=G.define(ld).parser,np=G.define(ud).parser,Aa=G.define(dd).parser,Ar=G.define(pd).parser,rp=G.define(fd).parser,Ra=G.define(md).parser,op=G.define(gd).parser,Pa=G.define(hd).parser,Ds=G.define(bd).parser,La=G.define(yd).parser,Ta=G.define(wd).parser,Ma=G.define(vd).parser,Da=G.define(Sd).parser,sp=G.define($d).parser,ip=G.define(kd).parser,ja=G.define(xd).parser,Ia=G.define(_d).parser,Na=G.define(Ed).parser,ap=G.define(Cd).parser,Fa=G.define(Ad).parser,js=G.define(Rd).parser,Ba=G.define(Pd).parser,cp=G.define(Ld).parser,lp=G.define(Td).parser,Oa=G.define(Md).parser,up=G.define(Dd).parser,Ha=G.define(jd).parser,dp=G.define(Id).parser,za=G.define(Nd).parser,pp=G.define(Fd).parser,qa=G.define(Bd).parser;function St(l){let h=String(l||"").trim().toLowerCase();if(!h)return"text";return Od[h]||String(l||"").trim()}function kt(l){switch(String(l||"").trim().toLowerCase()){case"js":case"javascript":return _u.parser;case"ts":case"typescript":return Au.parser;case"jsx":return Eu.parser;case"tsx":return Cu.parser;case"py":case"python":return Lu.parser;case"json":return Ru.parser;case"css":return Su.parser;case"html":return xu.parser;case"xml":return Du.parser;case"yaml":case"yml":return ju.parser;case"md":case"markdown":return Pu.parser;case"sql":return Mu.language.parser;case"go":return ku.parser;case"c":case"cc":case"cpp":case"cxx":case"c++":case"h":case"hh":case"hpp":case"hxx":return $u.parser;case"sh":case"bash":case"shell":case"zsh":return Hd;case"ps1":case"powershell":return zd;case"dockerfile":return qd;case"rb":case"ruby":return Gd;case"rs":case"rust":return Tu.parser;case"swift":return Kd;case"toml":return Wd;case"asm":return Ms;case"clj":return ba;case"clojure":return ba;case"cmake":return Ud;case"coffee":return ya;case"coffeescript":return ya;case"cr":return wa;case"crystal":return wa;case"cypher":return Yd;case"d":return Vd;case"diff":return va;case"eiffel":return Jd;case"elm":return Qd;case"erl":return Sa;case"erlang":return Sa;case"f90":return Ts;case"f95":return Ts;case"factor":return Xd;case"feature":return $a;case"forth":return Zd;case"fortran":return Ts;case"fsharp":return Ar;case"gas":return Ms;case"gherkin":return $a;case"groovy":return ep;case"haskell":return ka;case"haxe":return xa;case"hs":return ka;case"http":return tp;case"hx":return xa;case"ini":return La;case"jade":return Ma;case"jinja":return _a;case"jinja2":return _a;case"jl":return Ea;case"julia":return Ea;case"latex":return js;case"livescript":return Ca;case"ls":return Ca;case"lua":return np;case"mathematica":return Aa;case"matlab":return Ra;case"ml":return Ar;case"mllike":return Ar;case"nginx":return rp;case"ocaml":return Ar;case"octave":return Ra;case"oz":return op;case"pas":return Pa;case"pascal":return Pa;case"patch":return va;case"perl":return Ds;case"pl":return Ds;case"pm":return Ds;case"pp":return Da;case"properties":return La;case"proto":return Ta;case"protobuf":return Ta;case"pug":return Ma;case"puppet":return Da;case"r":return sp;case"rq":return Fa;case"s":return Ms;case"sas":return ip;case"sass":return ja;case"scheme":return Ia;case"scm":return Ia;case"scss":return ja;case"smalltalk":return Na;case"sml":return Ar;case"solr":return ap;case"sparql":return Fa;case"st":return Na;case"stex":return js;case"styl":return Ba;case"stylus":return Ba;case"sv":return Ha;case"tcl":return cp;case"tex":return js;case"textile":return lp;case"ttl":return Oa;case"turtle":return Oa;case"vb":return up;case"verilog":return Ha;case"vhdl":return dp;case"wasm":return za;case"wast":return za;case"webidl":return pp;case"wl":return Aa;case"xq":return qa;case"xquery":return qa;default:return null}}function Ee(l,h){if(String(l||"").length>Ka)return Ge(l);let p=kt(h);if(!p)return Ge(l);let w=[];try{let E=p.parse(l);Ga(E,Ls,(R,L,P)=>{if(!P||R>=L)return;w.push({from:R,to:L,cls:P})})}catch{return Ge(l)}if(!w.length)return Ge(l);w.sort((E,R)=>E.from-R.from||E.to-R.to);let k=0,x="";for(let E of w){if(E.from>k)x+=Ge(l.slice(k,E.from));x+=`<span class="${Ge(E.cls)}">${Ge(l.slice(E.from,E.to))}</span>`,k=Math.max(k,E.to)}if(k<l.length)x+=Ge(l.slice(k));return x}function rr(l,h){let p=String(l||"").split(`
`);if(!l)return p;if(String(l||"").length>Ka)return p.map((P)=>Ge(P)||"&nbsp;");let w=kt(h);if(!w)return p.map((P)=>Ge(P));let k=[];try{let P=w.parse(l);Ga(P,Ls,(I,N,F)=>{if(!F||I>=N)return;k.push({from:I,to:N,cls:F})})}catch{return p.map((P)=>Ge(P))}if(!k.length)return p.map((P)=>Ge(P));k.sort((P,I)=>P.from-I.from||P.to-I.to);let x=[],E=0;for(let P of p)x.push(E),E+=P.length+1;let R=[],L=0;for(let P=0;P<p.length;P+=1){let I=x[P],N=I+p[P].length,F="",Y=I;while(L<k.length&&k[L].to<=I)L+=1;for(let W=L;W<k.length;W+=1){let Q=k[W];if(Q.from>=N)break;let J=Math.max(I,Q.from),U=Math.min(N,Q.to);if(J>Y)F+=Ge(l.slice(Y,J));if(U>J)F+=`<span class="${Ge(Q.cls)}">${Ge(l.slice(J,U))}</span>`;Y=Math.max(Y,U)}if(Y<N)F+=Ge(l.slice(Y,N));R.push(F||"&nbsp;")}return R}function Je(l){let h=(l.match(/\.([^.]+)$/)||[])[1]?.toLowerCase()||"",p={ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",cjs:"javascript",py:"python",rb:"ruby",rs:"rust",go:"go",java:"java",c:"c",h:"c",cc:"cpp",cpp:"cpp",cxx:"cpp",hpp:"cpp",hxx:"cpp",cs:"csharp",swift:"swift",kt:"kotlin",sh:"shell",bash:"bash",zsh:"zsh",fish:"shell",ps1:"powershell",psm1:"powershell",json:"json",yaml:"yaml",yml:"yaml",toml:"toml",xml:"xml",html:"html",htm:"html",css:"css",scss:"sass",sass:"sass",sql:"sql",graphql:"graphql",gql:"graphql",dockerfile:"dockerfile",makefile:"makefile",lua:"lua",perl:"perl",pl:"perl",pm:"perl",r:"r",jl:"julia",hs:"haskell",erl:"erlang",clj:"clojure",scm:"scheme",elm:"elm",ex:"elixir",exs:"elixir",proto:"protobuf",tf:"hcl",diff:"diff",patch:"diff",ini:"properties",conf:"nginx",cfg:"properties",v:"verilog",sv:"verilog",vhd:"vhdl",vhdl:"vhdl",pas:"pascal",f90:"fortran",f95:"fortran",cmake:"cmake",groovy:"groovy",gradle:"groovy",tex:"stex",latex:"stex",bib:"stex",d:"d",nim:"nim",zig:"zig",pug:"pug",jade:"pug",styl:"stylus",coffee:"coffeescript",tcl:"tcl",ml:"mllike",sml:"mllike",fs:"mllike",wasm:"wast",wat:"wast",pp:"puppet",feature:"gherkin",ttl:"turtle",rq:"sparql",xq:"xquery"},w=l.split("/").pop()?.toLowerCase()||"";if(w==="dockerfile"||w.startsWith("dockerfile."))return"dockerfile";if(w==="makefile"||w==="gnumakefile")return"cmake";if(w===".env"||w.endsWith(".env"))return"properties";if(w==="cmakelists.txt")return"cmake";if(w==="vagrantfile"||w==="rakefile"||w==="gemfile")return"ruby";return p[h]||""}var Pr=null,Is=new WeakSet;function fp(){if(window.piclawDiagrams)return Promise.resolve();if(Pr)return Pr;let l=document.createElement("script");return l.src="/static/common/js/vendor/pele.js",Pr=new Promise((h,p)=>{l.onload=()=>window.piclawDiagrams?h():p(Error("Mermaid library failed to load")),l.onerror=()=>p(Error("Mermaid library failed to load")),document.head.append(l)}).catch((h)=>{throw l.remove(),Pr=null,h}),Pr}function Wa(l){if(/(?:https?:\/\/|data:|blob:|\/\/)/i.test(l))return!1;return Array.from(l.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(p)=>p[2]?.trim()||"").every((p)=>/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(p))}function mp(l){let h=Uint8Array.from(atob(l),(w)=>w.charCodeAt(0)),p=new TextDecoder().decode(h);for(let w=0;w<2;w++){let k=p.replace(/</g,"&lt;").replace(/>/g,"&gt;"),x=new DOMParser().parseFromString(k,"text/html").documentElement.textContent||"";if(p===x)break;p=x}return p}async function Ua(l,h={}){let w=Array.from(l.querySelectorAll(".mermaid-container[data-mermaid]")).filter((x)=>!Is.has(x));for(let x of w)Is.add(x);if(!w.length)return;try{await fp();for(let x of w){let E=x.dataset.mermaid;if(!l.contains(x)||E===void 0)continue;try{let R=mp(E);if(h.scoped&&!Wa(R))throw Error("External Mermaid resources are unavailable in this view.");let L=window.piclawDiagrams.render(R),P=window.piclawDiagrams.sanitize;if(typeof P!=="function")throw Error("Diagram sanitizer is unavailable");x.innerHTML=P(L),x.removeAttribute("data-mermaid")}catch(R){k(x,R)}}}catch(x){for(let E of w)if(l.contains(E)&&E.hasAttribute("data-mermaid"))k(E,x)}finally{for(let x of w)Is.delete(x)}function k(x,E){h.reportError?.(E);let R=document.createElement("pre");R.className="mermaid-error",R.textContent="Diagram error: "+(E instanceof Error?E.message:String(E)),x.replaceChildren(R),x.removeAttribute("data-mermaid")}}var Ns={background:"#ffffff",foreground:"#18212b",muted:"#536171",accent:"#0969da",border:"#b6bec8",surface:"#f3f5f7",success:"#1a7f37",warning:"#9a6700",danger:"#cf222e"},Ya={background:"#171b22",foreground:"#e6edf3",muted:"#a2afbf",accent:"#79c0ff",border:"#586577",surface:"#242b36",success:"#7ee787",warning:"#e3b341",danger:"#ff7b72"};function Va(l="theme"){if(l==="light")return{...Ns};if(l==="dark")return{...Ya};if(typeof document>"u")return{...Ns};let h=document.documentElement,w=(h.dataset.theme||(h.classList.contains("dark")?"dark":h.classList.contains("light")?"light":typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))==="dark"?Ya:Ns;if(!document.body)return{...w};let k=document.createElement("span");k.style.display="none",document.body.append(k);try{return Object.fromEntries(Object.entries({background:"--bg-primary",foreground:"--text-primary",muted:"--text-secondary",accent:"--accent-color",border:"--border-color",surface:"--bg-secondary",success:"--success-color",warning:"--warning-color",danger:"--danger-color"}).map(([E,R])=>(k.style.color=`var(${R}, ${w[E]})`,[E,getComputedStyle(k).color])))}finally{k.remove()}}var Vf=Object.freeze({bg:"var(--bg-primary, #ffffff)",fg:"var(--text-primary, #18212b)",line:"var(--text-secondary, #536171)",accent:"var(--accent-color, #0969da)",muted:"var(--text-secondary, #536171)",surface:"var(--bg-secondary, #f3f5f7)",border:"var(--border-color, #b6bec8)"});var Ln=Object.freeze({bytes:262144,nodes:2048,depth:32,dimension:2048}),co="http://www.w3.org/2000/svg",Ja=new Set(["svg","g","defs","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","title","desc","linearGradient","radialGradient","stop","clipPath"]),gp=new Set(["x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","width","height","dx","dy","stroke-width","stroke-dashoffset","font-size"]),hp=new Set(["opacity","fill-opacity","stroke-opacity","stop-opacity","stroke-miterlimit","offset"]),Qa={"fill-rule":["nonzero","evenodd"],"clip-rule":["nonzero","evenodd"],"stroke-linecap":["butt","round","square"],"stroke-linejoin":["miter","round","bevel"],"text-anchor":["start","middle","end"],"dominant-baseline":["auto","middle","central","hanging","text-before-edge","text-after-edge","alphabetic"],"font-family":["sans-serif","serif","monospace"],"font-weight":["normal","bold","100","200","300","400","500","600","700","800","900"],"font-style":["normal","italic","oblique"],gradientUnits:["objectBoundingBox","userSpaceOnUse"],clipPathUnits:["userSpaceOnUse","objectBoundingBox"],spreadMethod:["pad","reflect","repeat"]},bp=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,Bs=/^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)$/;function Os(l){let h="";for(let p of new TextEncoder().encode(l))h+=String.fromCharCode(p);return btoa(h)}function kn(l){return new TextDecoder().decode(Uint8Array.from(atob(l),(h)=>h.charCodeAt(0)))}function Hs(l){return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function uo(l){return bp.test(l)&&Number.isFinite(Number(l))&&Math.abs(Number(l))<=1e6}function lo(l){let h=l.trim().split(/[\s,]+/);return h.length&&h.every(uo)?h.map(Number):null}function yp(l,h){if(l==="id")return/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(h);if(gp.has(l))return uo(h.replace(/(?:px|%)$/,""));if(hp.has(l))return uo(h.replace(/%$/,""));if(Object.hasOwn(Qa,l))return Qa[l].includes(h);if(["fill","stroke","color","stop-color"].includes(l))return/^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+,\s/-]+\))$/i.test(h)||Bs.test(h);if(l==="clip-path")return h==="none"||Bs.test(h);if(l==="viewBox"){let p=lo(h);return!!p&&p.length===4&&p[2]>0&&p[3]>0}if(l==="points"||l==="stroke-dasharray")return h==="none"||lo(h)!==null;if(l==="d")return/^[MmZzLlHhVvCcSsQqTtAa\dEe+.,\s-]*$/.test(h);if(l==="transform"||l==="gradientTransform")return h.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/g,(w,k)=>lo(k)?"":w).trim()==="";return!1}var sn=new Map,wp=8,Xa=2097152,Fs=0;function Za(l,h="theme"){if(l.length>Ln.bytes)return null;let p=Va(h),w=JSON.stringify(p)+l,k=sn.get(w);if(k)return sn.delete(w),sn.set(w,k),k.image;let x=vp(l,p),E=2*(w.length+(x?.src.length||0)+(x?.label.length||0));if(E<=Xa){while(sn.size>=wp||Fs+E>Xa){let R=sn.keys().next().value;Fs-=sn.get(R).size,sn.delete(R)}sn.set(w,{image:x,size:E}),Fs+=E}return x}function vp(l,h){if(l.length>Ln.bytes||new TextEncoder().encode(l).byteLength>Ln.bytes)return null;if(/<!\s*(?:DOCTYPE|ENTITY)|<\?/i.test(l))return null;let p=new DOMParser().parseFromString(l,"image/svg+xml"),w=p.documentElement;if(!w||w.localName!=="svg"||p.querySelector("parsererror")||p.doctype)return null;let k=[{node:w,depth:1}],x=0;while(k.length){let{node:U,depth:te}=k.pop();if(++x>Ln.nodes||te>Ln.depth)return null;for(let H=U.lastChild;H;H=H.previousSibling){if(x+k.length>=Ln.nodes)return null;k.push({node:H,depth:te+(H.nodeType===1?1:0)})}}let E=document.implementation.createDocument(co,"svg",null),R=new Map,L=[];function P(U,te,H){if(U.hasAttribute("xmlns")&&U.getAttribute("xmlns")!==co)return!1;if(U.namespaceURI!==w.namespaceURI||U.namespaceURI&&U.namespaceURI!==co||U.prefix||!Ja.has(U.localName))return!1;if(U!==w&&U.localName==="svg")return!1;let ce=H||["defs","clipPath","linearGradient","radialGradient"].includes(U.localName);for(let xe of Array.from(U.attributes)){if(xe.namespaceURI||xe.prefix)continue;let be=xe.name,He=xe.value.trim();if(["fill","stroke","color","stop-color"].includes(be)){let cn=He.match(/^var\(--svg-(background|foreground|muted|accent|border|surface|success|warning|danger)\)$/);if(cn)He=h[cn[1]]}if(!yp(be,He))continue;let Kt=He.match(Bs);if(Kt){if(ce||!["fill","stroke","clip-path"].includes(be))continue;L.push({element:te,name:be,id:Kt[1]})}if(be==="id"){if(R.has(He))return!1;R.set(He,te)}te.setAttribute(be,He)}for(let xe of Array.from(U.childNodes))if(xe.nodeType===1){let be=xe;if(!Ja.has(be.localName))return!1;let He=E.createElementNS(co,be.localName);if(!P(be,He,ce))return!1;te.appendChild(He)}else if(xe.nodeType===3||xe.nodeType===4)te.appendChild(E.createTextNode(xe.nodeValue||""));else if(xe.nodeType!==8)return!1;return!0}if(!P(w,E.documentElement,!1))return null;for(let U of L){let te=R.get(U.id)?.localName;if(!(U.name==="clip-path"?te==="clipPath":te==="linearGradient"||te==="radialGradient"))U.element.removeAttribute(U.name)}let I=E.documentElement;if(!I.hasAttribute("color"))I.setAttribute("color",h.foreground);if(!I.hasAttribute("fill"))I.setAttribute("fill","currentColor");let N=lo(I.getAttribute("viewBox")||""),F=(U,te)=>{let H=I.getAttribute(U)?.replace(/px$/,"")||"";return uo(H)&&Number(H)>0?Number(H):te},Y=F("width",N?.[2]||300),W=F("height",N?.[3]||150),Q=Math.min(1,Ln.dimension/Math.max(Y,W));if(I.setAttribute("width",String(Y*Q)),I.setAttribute("height",String(W*Q)),!N)I.setAttribute("viewBox",`0 0 ${Y} ${W}`);I.setAttribute("preserveAspectRatio","xMidYMid meet");let J=(I.querySelector("title")?.textContent?.trim()||I.querySelector("desc")?.textContent?.trim()||"Model-generated SVG").replace(/\s+/g," ").slice(0,256);return Object.freeze({src:`data:image/svg+xml;base64,${Os(new XMLSerializer().serializeToString(I))}`,label:J})}function ec(l,h,p,w={}){if(!/^ {0,3}(?:`{3,}|~{3,})svg\s*$/im.test(l))return h(l);let k=l.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean)||[],x=null,E=/^(?:\uFEFF)?---(?:\r?\n|\r)/.test(l),R=0,L=[],P=[],I=`PICLAWSVG${Array.from(crypto.getRandomValues(new Uint32Array(4)),(F)=>F.toString(16)).join("")}BLOCK`;for(let F=0;F<k.length;F++){let Y=k[F].replace(/[\r\n]+$/,"");if(E){if(F>0&&/^(---|\.\.\.)\s*$/.test(Y))E=!1;continue}if(x){if(new RegExp(`^ {0,3}${x.char}{${x.length},}\\s*$`).test(Y))x=null;continue}let W=Y.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(!W)continue;if(x={char:W[1][0],length:W[1].length},!/^svg\s*$/i.test(W[2]))continue;let Q=new RegExp(`^ {0,3}${x.char}{${x.length},}\\s*$`),J=F+1;while(J<k.length&&!Q.test(k[J].replace(/[\r\n]+$/,"")))J++;if(F>R)L.push(k.slice(R,F).join(""));let U=k.slice(F+1,J).join(""),te=w.sanitize===!1?null:J<k.length?Za(U):null,H=p(U);L.push(`

${I}${P.length}END

`),P.push(w.sanitize===!1&&J<k.length?U:te?`<div class="model-svg-block" data-svg-surface="theme"><div class="model-svg-controls"><label>SVG background <select class="model-svg-surface" aria-label="SVG background"><option value="theme">Theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><img class="model-svg-image" src="${te.src}" alt="${Hs(te.label)}"><details class="model-svg-source"><summary>SVG source</summary>${H}</details></div>`:H),F=J,R=J+1,x=null}if(!P.length)return h(l);if(R<k.length)L.push(k.slice(R).join(""));return h(L.join("")).replace(new RegExp(`(?:<p>)?${I}(\\d+)END(?:<\\/p>)?`,"g"),(F,Y)=>P[Number(Y)])}function or(l){let h=Array.from(l.querySelectorAll(".model-svg-block"));if(!h.length)return()=>{};let p=(x)=>{let E=x.dataset.svgSurface,R=x.querySelector(".model-svg-image"),L=x.querySelector("[data-svg-source], .code-block__copy[data-code]");if(!R||!L)return;let P=Za(kn(L.dataset.svgSource||L.dataset.code||""),E);if(P&&R.getAttribute("src")!==P.src)R.src=P.src},w=()=>h.forEach((x)=>{if(x.dataset.svgSurface==="theme")p(x)}),k=(x)=>{let E=x.target;if(!E?.matches(".model-svg-surface"))return;let R=E.closest(".model-svg-block");if(!R||!["theme","light","dark"].includes(E.value))return;R.dataset.svgSurface=E.value,p(R)};return l.addEventListener("change",k),window.addEventListener("piclaw-theme-change",w),w(),()=>{l.removeEventListener("change",k),window.removeEventListener("piclaw-theme-change",w)}}function tc(l){if(typeof l!=="string"||!l.trim()||l.length>2048)throw Error("Provide a GitHub/Gitea repository web URL.");let h=l.trim();if(!/^https?:\/\//i.test(h)||/[\\\s]/.test(h))throw Error("Repository URL must use HTTP or HTTPS.");let p=new URL(h);if(!["http:","https:"].includes(p.protocol)||p.username||p.password||p.search||p.hash)throw Error("Repository URL cannot contain credentials, a query or a fragment.");let w=p.pathname.replace(/\/+$/,"").split("/").slice(1);if(w.length<2||w.some((R)=>!/^[a-zA-Z0-9_.-]+$/.test(R)||R==="."||R===".."))throw Error("Use a repository URL ending in owner/repository (an installation subpath is allowed).");if(h.slice(h.indexOf("://")+3).split("/").slice(1).some((R)=>R==="."||R===".."))throw Error("Repository URL cannot contain traversal segments.");if(w.at(-1).endsWith(".git"))w[w.length-1]=w.at(-1).slice(0,-4);if(!w.at(-1))throw Error("Repository name is required.");if(p.hostname.toLowerCase()==="github.com"&&w.length!==2)throw Error("GitHub repository URLs must end at github.com/owner/repository.");if(p.hostname.toLowerCase()!=="github.com"&&w.length!==2&&w.length!==3)throw Error("Gitea repository URLs must be owner/repository or installation-base/owner/repository.");let x=new Set(["issues","issue","pulls","pull","explore","src","commits","commit","actions","releases","projects","settings","wiki","compare","branches","tags","milestones"]),E=w.at(-1).toLowerCase();if(w.some((R)=>x.has(R.toLowerCase()))||/^\d+$/.test(E))throw Error("Repository URL must identify a repository root, not an issue, pull request or explorer page.");return`${p.origin}/${w.join("/")}`}function nc(l,h=null,p=!0){if(typeof DOMParser>"u")return l;let w=null;if(h)try{w=tc(h)}catch{w=null}let k=new DOMParser().parseFromString(l,"text/html"),x=k.createTreeWalker(k.body,NodeFilter.SHOW_TEXT),E=[];while(x.nextNode())E.push(x.currentNode);for(let R of E){if(R.parentElement?.closest("a, code, pre, script, style, svg, math, .katex"))continue;let L=R.nodeValue||"",P=[...L.matchAll(/#(\w+)/g)];if(!P.length)continue;let I=k.createDocumentFragment(),N=0;for(let F of P){let Y=F.index,W=Y+F[0].length,Q=F[1];if(I.append(k.createTextNode(L.slice(N,Y))),N=W,/^\d+$/.test(Q)){let J=L[Y-1]||"",U=L[W]||"",te=!J||/[\s([{>,;:!?]/.test(J);if(!w||!/^[1-9]\d*$/.test(Q)||!te||/[\p{L}\p{N}_/\-]/u.test(U)){I.append(k.createTextNode(F[0]));continue}let H=k.createElement("a");H.href=`${w}/issues/${Q}`,H.className="project-reference",H.target="_blank",H.rel="noopener noreferrer",H.title=`${w} #${Q}`,H.textContent=F[0],I.append(H)}else{if(!p){I.append(k.createTextNode(F[0]));continue}let J=k.createElement("a");J.href="#",J.className="hashtag",J.setAttribute("data-hashtag",Q),J.textContent=F[0],I.append(J)}}I.append(k.createTextNode(L.slice(N))),R.replaceWith(I)}return k.body.innerHTML}var Sp=new Set(["code","pre","strong","em","b","i","u","s","del","ins","sub","sup","mark","small","br","p","ul","ol","li","blockquote","ruby","rt","rp","span","input"]),$p=new Set(["a","abbr","blockquote","br","code","del","div","em","hr","h1","h2","h3","h4","h5","h6","i","img","input","ins","kbd","li","mark","ol","p","pre","ruby","rt","rp","s","small","span","strong","sub","sup","table","tbody","td","th","thead","tr","u","ul","math","semantics","mrow","mi","mn","mo","mtext","mspace","msup","msub","msubsup","mfrac","msqrt","mroot","mtable","mtr","mtd","annotation","svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]),kp=new Set(["class","title","role","aria-hidden","aria-label","aria-expanded","aria-live","data-mermaid","data-hashtag"]),xp={a:new Set(["href","target","rel"]),img:new Set(["src","alt","title"]),input:new Set(["type","checked","disabled"])},_p=new Set(["http:","https:","mailto:",""]),zs=new Set(["svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]);function Ep(l,h){let p=String(l||"").toLowerCase(),w=String(h||"").toLowerCase();if(!w||w.startsWith("on"))return!1;if(w.startsWith("data-")||w.startsWith("aria-"))return!0;if(zs.has(p))return!0;return(xp[p]||new Set).has(w)||kp.has(w)}function qn(l){return String(l||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;")}function Ie(l,h={}){if(!l)return null;let p=String(l).trim();if(!p)return null;if(p.startsWith("#")||p.startsWith("/"))return p;if(p.startsWith("data:")){if(h.allowDataImage&&/^data:image\//i.test(p))return p;return null}if(p.startsWith("blob:"))return p;try{let w=new URL(p,typeof window<"u"?window.location.origin:"http://localhost");if(!_p.has(w.protocol))return null;return w.href}catch{return null}}function rc(l,h={}){if(!l)return"";if(h?.sanitize===!1)return l;let p=new DOMParser().parseFromString(l,"text/html"),w=[],k=p.createTreeWalker(p.body,NodeFilter.SHOW_ELEMENT),x;while(x=k.nextNode())w.push(x);for(let E of w){let R=E.tagName.toLowerCase();if(!$p.has(R)){let L=E.parentNode;if(!L)continue;while(E.firstChild)L.insertBefore(E.firstChild,E);L.removeChild(E);continue}for(let L of Array.from(E.attributes)){let P=L.name.toLowerCase(),I=L.value;if(P.startsWith("on")){E.removeAttribute(L.name);continue}if(Ep(R,P)){if(zs.has(R)&&typeof h.rewriteImageSrc==="function"){let N=Array.from(I.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(Y)=>Y[2]?.trim()||"");if(/(?:https?:|data:|blob:|\/\/)/i.test(I)||N.some((Y)=>!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(Y))){E.removeAttribute(L.name);continue}}if(P==="href"||P==="xlink:href"){let N=typeof h.rewriteImageSrc==="function"&&zs.has(R)?/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(I.trim())?I.trim():h.rewriteImageSrc(I):I,F=Ie(N);if(!F)E.removeAttribute(L.name);else if(E.setAttribute(L.name,F),R==="a"){if(!E.getAttribute("rel"))E.setAttribute("rel","noopener noreferrer");if(/^https?:\/\//i.test(F))E.setAttribute("target","_blank")}}else if(P==="src"){let N=typeof h.rewriteImageSrc==="function"&&(R==="img"||R==="image")?h.rewriteImageSrc(I):I,F=Ie(N,{allowDataImage:R==="img"&&typeof h.rewriteImageSrc!=="function"});if(!F)E.removeAttribute(L.name);else E.setAttribute(L.name,F)}continue}E.removeAttribute(L.name)}}return p.body.innerHTML}function qs(l){if(!l)return l;let h=l.replace(/</g,"&lt;").replace(/>/g,"&gt;");return new DOMParser().parseFromString(h,"text/html").documentElement.textContent}function Cp(l,h=2){if(!l)return l;let p=l;for(let w=0;w<h;w+=1){let k=qs(p);if(k===p)break;p=k}return p}function Ap(l){if(!l)return{text:"",frontmatter:null};let h=l.replace(/^\uFEFF/,"").replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!h.startsWith(`---
`))return{text:h,frontmatter:null};let p=h.split(`
`),w=-1;for(let E=1;E<p.length;E+=1)if(/^(---|\.\.\.)\s*$/.test(p[E])){w=E;break}if(w<=0)return{text:h,frontmatter:null};let k=p.slice(1,w).join(`
`);return{text:p.slice(w+1).join(`
`).replace(/^\n+/,""),frontmatter:k}}function Rp(l){let{text:h,frontmatter:p}=Ap(l);if(p===null)return h;return["<!--frontmatter-block-start-->","```yaml",p,"```","<!--frontmatter-block-end-->",h].filter(Boolean).join(`

`)}function Pp(l){if(!l)return l;return Cp(l,5)}function Lp(l){let h=new TextEncoder().encode(String(l||"")),p="";for(let w of h)p+=String.fromCharCode(w);return btoa(p)}function Tp(l){if(!l)return l;return l.replace(/<pre><code(?:\s+class="language-([A-Za-z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/g,(p,w,k)=>{let x=String(w||"").trim().toLowerCase(),E=qs(k),R=x||"plaintext",L=Ee(E,x);return`<pre><code class="hljs language-${qn(R)}">${L}</code></pre>`}).replace(/<!--frontmatter-block-start-->\s*<pre>/g,'<pre class="frontmatter-block">').replace(/<\/pre>\s*<!--frontmatter-block-end-->/g,"</pre>")}var Mp={span:new Set(["title","class","lang","dir"]),input:new Set(["type","checked","disabled"])};function Dp(l,h){let p=Mp[l];if(!p||!h)return"";let w=[],k=/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g,x;while(x=k.exec(h)){let E=(x[1]||"").toLowerCase();if(!E||E.startsWith("on")||!p.has(E))continue;let R=x[2]??x[3]??x[4]??"";w.push(` ${E}="${qn(R)}"`)}return w.join("")}function jp(l){if(!l)return l;return l.replace(/&lt;((?:[^"'<>]|"[^"]*"|'[^']*')*?)(?:&gt;|>)/g,(h,p)=>{let w=p.trim(),k=w.startsWith("/"),x=k?w.slice(1).trim():w,R=x.endsWith("/")?x.slice(0,-1).trim():x,[L=""]=R.split(/\s+/,1),P=L.toLowerCase();if(!P||!Sp.has(P))return h;if(P==="br")return k?"":"<br>";if(k)return`</${P}>`;let I=R.slice(L.length).trim(),N=Dp(P,I);return`<${P}${N}>`})}function oc(l,h=!0){if(typeof l.text!=="string")return;if(l.type==="code"&&h){let p=l.lang?.trim().toLowerCase();if(p==="mermaid"){l.type="html",l.text=`<div class="mermaid-container" data-mermaid="${Lp(Pp(l.text))}"><div class="mermaid-loading">Loading diagram...</div></div>`;return}if(p&&["math","katex","latex"].includes(p)){l.type="html",l.text=`<p>$$
${qn(l.text)}
$$</p>
`;return}}if(l.type!=="html")return;if(/^<!--frontmatter-block-(?:start|end)-->\s*$/.test(l.text))return;l.text=jp(l.text.replace(/</g,"&lt;"))}function Ip(l){if(!window.katex)return l;let h=(E)=>qs(E).replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&").replace(/<br\s*\/?\s*>/gi,`
`),p=(E)=>{let R=[],L=E.replace(/<pre\b[^>]*>\s*<code\b[^>]*>[\s\S]*?<\/code>\s*<\/pre>/gi,(P)=>{let I=R.length;return R.push(P),`@@CODE_BLOCK_${I}@@`});return L=L.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi,(P)=>{let I=R.length;return R.push(P),`@@CODE_INLINE_${I}@@`}),{html:L,blocks:R}},w=(E,R)=>{if(!R.length)return E;return E.replace(/@@CODE_(?:BLOCK|INLINE)_(\d+)@@/g,(L,P)=>{let I=Number(P);return R[I]??""})},k=p(l),x=k.html;return x=x.replace(/(^|\n|<br\s*\/?\s*>|<p>|<\/p>)\s*\$\$([\s\S]+?)\$\$\s*(?=\n|<br\s*\/?\s*>|<\/p>|$)/gi,(E,R,L)=>{try{let P=katex.renderToString(h(L.trim()),{displayMode:!0,throwOnError:!1});return`${R}${P}`}catch(P){let I=P instanceof Error?P.message:String(P);return`<span class="math-error" title="${qn(I)}">${E}</span>`}}),w(x,k.blocks)}function Np(l,h=null){return nc(l,h)}function Fp(l){return{safeHtml:Rp(l||"")}}var Bp=new Set(["NOTE","TIP","IMPORTANT","WARNING","CAUTION"]),Op={NOTE:"Note",TIP:"Tip",IMPORTANT:"Important",WARNING:"Warning",CAUTION:"Caution"};function Hp(l){return l.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>\s*)?(\n)?/gi,(h,p,w)=>{let k=p.toUpperCase();if(!Bp.has(k))return h;let x=Op[k]||k;return`<div class="admonition admonition-${k.toLowerCase()}"><p class="admonition-title">${x}</p><p>`}).replace(/(<div class="admonition admonition-[a-z]+">(?:(?!<\/div>)[\s\S])*?)<\/blockquote>/g,(h,p)=>`${p}</div>`)}function y(l,h,p={}){if(!l)return"";return ec(l,(w)=>zp(w,p),(w)=>`<pre><code class="language-svg" data-svg-source="${Os(w)}">${Hs(w)}</code></pre>`,{sanitize:typeof window>"u"||window.__PICLAW_SANITIZE_SVG_FENCES__!==!1})}function zp(l,h){let{safeHtml:p}=Fp(l),w=window.marked?marked.parse(p,{headerIds:!1,mangle:!1,walkTokens:oc}):qn(p).replace(/\n/g,"<br>");return w=Tp(w),w=Ip(w),w=Np(w,h.projectRepository),w=Hp(w),w=rc(w,h),w}function z(l){if(!l)return"";let h=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`),p=window.marked?marked.parse(h,{walkTokens:(w)=>oc(w,!1)}):qn(h).replace(/\n/g,"<br>");return p=rc(p),p}async function V(l,h={}){await Ua(l,{scoped:typeof h.rewriteImageSrc==="function",reportError:(p)=>console.error("Mermaid render error:",p)})}function Re(l){if(!l||typeof l!=="object")return null;let h=l.started_at??l.startedAt;if(typeof h!=="string"||!h)return null;let p=Date.parse(h);return Number.isFinite(p)?p:null}function qp(l){if(!l||typeof l!=="object")return null;let h=l.retry_at??l.retryAt;if(typeof h!=="string"||!h)return null;let p=Date.parse(h);return Number.isFinite(p)?p:null}function ue(l){if(!l||typeof l!=="object")return null;let h=l.last_event_at??l.lastEventAt??l.started_at??l.startedAt;if(typeof h!=="string"||!h)return null;let p=Date.parse(h);return Number.isFinite(p)?p:null}function K(l){if(!l||typeof l!=="object")return!1;let h=l.intent_key??l.intentKey;return l.type==="intent"&&h==="compaction"}function At(l){if(!l||typeof l!=="object")return"";let h=l.title;if(typeof h==="string"&&h.trim())return h.trim();let p=l.tool_name??l.toolName;if(typeof p==="string"&&p.trim())return p.trim();let w=l.status;if(typeof w==="string"&&w.trim())return w.trim();return K(l)?"Compacting context":"Thinking..."}function sc(l){let h=Math.max(0,Math.floor(l/1000)),p=h%60,w=Math.floor(h/60)%60,k=Math.floor(h/3600);if(k>0)return`${k}:${String(w).padStart(2,"0")}:${String(p).padStart(2,"0")}`;return`${w}:${String(p).padStart(2,"0")}`}function Pe(l,h=Date.now()){let p=Re(l);if(p===null)return null;return sc(Math.max(0,h-p))}function ir(l,h=Date.now()){let p=qp(l);if(p===null)return null;let w=p-h;if(w<=0)return"retrying now";return`retry in ${sc(w)}`}function b(l={}){let h=l.window??(typeof window<"u"?window:null),p=l.navigator??(typeof navigator<"u"?navigator:null);if(p&&p.standalone===!0)return!0;if(!h||typeof h.matchMedia!=="function")return!1;return["(display-mode: standalone)","(display-mode: minimal-ui)","(display-mode: fullscreen)"].some((k)=>{try{return Boolean(h.matchMedia(k)?.matches)}catch{return!1}})}function Me(l={}){let h=l.window??(typeof window<"u"?window:null),p=l.navigator??(typeof navigator<"u"?navigator:null);if(!h&&!p)return!1;let w=String(p?.userAgent||""),k=Number(p?.maxTouchPoints||0),x=/Android|webOS|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(w),E=(()=>{if(!h||typeof h.matchMedia!=="function")return!1;try{return Boolean(h.matchMedia("(pointer: coarse)")?.matches||h.matchMedia("(any-pointer: coarse)")?.matches)}catch{return!1}})();return Boolean(x||k>1||E)}function sr(l,h={}){if(b(h))return null;if(Me(h))return{target:"_blank",features:void 0,mode:"tab"};return{target:Gp(l),features:"popup=yes,width=900,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function An(l,h={}){let p=h.window??(typeof window<"u"?window:null);if(!p||!l)return null;try{return l.features?p.open("about:blank",l.target,l.features):p.open("about:blank",l.target)}catch{return null}}function Cn(l,h={}){if(!l||!l.document)return;try{let p=String(h.title||"Opening branch…"),w=String(h.message||"Preparing a new branch window…");l.document.title=p;let k=l.document.body;if(!k)return;if(typeof l.document.createElement!=="function"){k.textContent=`${p}
${w}`;return}let x=l.document.createElement("div");x.setAttribute("style","font-family: system-ui, sans-serif; padding: 24px; color: #222;");let E=l.document.createElement("h1");E.setAttribute("style","font-size: 18px; margin: 0 0 12px;"),E.textContent=p;let R=l.document.createElement("p");if(R.setAttribute("style","margin: 0; line-height: 1.5;"),R.textContent=w,x.appendChild(E),x.appendChild(R),typeof k.replaceChildren==="function")k.replaceChildren(x);else k.innerHTML="",k.appendChild(x)}catch{return}}function _n(l,h){if(!l||!h)return;try{if(l.location&&typeof l.location.replace==="function"){l.location.replace(String(h));return}l.location=String(h)}catch{return}}function $n(l){if(!l||typeof l.close!=="function")return;try{l.close()}catch{return}}function v(l,h,p={}){let w=new URL(String(l||"http://localhost/")),k=String(h||"").trim()||"web:default";if(w.searchParams.set("chat_jid",k),w.searchParams.delete("branch_loader"),w.searchParams.delete("branch_source_chat_jid"),w.searchParams.delete("pane_popout"),w.searchParams.delete("pane_path"),w.searchParams.delete("pane_label"),p.chatOnly===!0)w.searchParams.set("chat_only","1");return w.toString()}function Tn(l,h,p={}){let w=new URL(String(l||"http://localhost/")),k=String(h||"").trim()||"web:default";if(w.searchParams.set("branch_loader","1"),w.searchParams.set("branch_source_chat_jid",k),w.searchParams.delete("chat_jid"),w.searchParams.delete("pane_popout"),w.searchParams.delete("pane_path"),w.searchParams.delete("pane_label"),p.chatOnly===!0)w.searchParams.set("chat_only","1");return w.toString()}function ar(l,h,p={}){let w=new URL(String(l||"http://localhost/")),k=String(h||"").trim();if(!k)return w.toString();if(w.searchParams.set("pane_popout","1"),w.searchParams.set("pane_path",k),p?.label)w.searchParams.set("pane_label",String(p.label));else w.searchParams.delete("pane_label");if(p?.chatJid)w.searchParams.set("chat_jid",String(p.chatJid));let x=p?.params&&typeof p.params==="object"?p.params:null;if(x)for(let[E,R]of Object.entries(x)){let L=String(E||"").trim();if(!L)continue;if(R===null||R===void 0||R==="")w.searchParams.delete(L);else w.searchParams.set(L,String(R))}return w.searchParams.delete("chat_only"),w.searchParams.delete("branch_loader"),w.searchParams.delete("branch_source_chat_jid"),w.toString()}function Gp(l){return`piclaw-chat-${String(l||"web:default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function Kp(l){return`piclaw-pane-${String(l||"pane").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function cr(l,h={}){if(b(h))return null;if(Me(h))return{target:"_blank",features:void 0,mode:"tab"};return{target:Kp(l),features:"popup=yes,width=1200,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function de(l){let h=l instanceof Error?l.message:String(l||"").trim(),p=String(h||"").trim();if(!p)return"PiClaw could not open a new branch window.";let w=p.toLowerCase();if(w.includes("no stable turn boundary"))return"This chat is still in flight and does not yet have a stable turn boundary to fork from.";if(w.includes("cannot fork a branch while the source chat is still active"))return"This chat is still active. Please wait for the current turn to settle, then try again.";if(w.includes("cancelled"))return"Branch creation was cancelled before a new chat window could be opened.";if(w.includes("did not return a chat id"))return"PiClaw created no usable branch id for the new window. Please try again.";if(w.includes("failed to fork branch")||w.includes("failed to fork chat branch"))return"PiClaw could not create the new branch. Please try again.";return p}var po=new Map,Gs=new Set,an,Ks=()=>{for(let l of Gs)l()};function lr(l,h){if(!l||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(h.id)||!h.label||typeof h.start!=="function"||typeof h.availability!=="function")throw Error("Invalid dictation provider registration.");if(po.has(h.id))throw Error("Duplicate dictation provider.");let p=Object.freeze({owner:l,provider:Object.freeze({...h})});po.set(h.id,p);let w=!1;return()=>{if(w)return;if(w=!0,an===p)an=void 0;po.delete(h.id),Ks()}}function ur(l,h){if(h===null){if(an?.owner===l)an=void 0,Ks();return}let p=po.get(h);if(!p||p.owner!==l)throw Error("Dictation provider belongs to another add-on or is unregistered.");if(an&&an!==p)throw Error("Another enabled dictation provider owns the composer.");an=p,Ks()}function Mn(){return an}function fo(l){return Gs.add(l),()=>{Gs.delete(l)}}var Wp=[[`Continue working toward the active thread goal.
`,"Continue goal","objective"],[`The active thread goal objective was edited by the user.
`,"Goal updated","untrusted_objective"],[`The active thread goal has reached its token budget.
`,"Goal budget reached","objective"],[`The current Plan Sidebar checklist has no pending or in-progress items.
`,"Finalize goal","objective"]];function Ct(l){let h=/^🎯 (?:Continue goal|Goal updated|Goal budget reached|Finalize goal): /.test(l),p=Wp.find(([k])=>l.startsWith(k));if(!h&&!p)return l;let w=/\n\n<piclaw_goal_input>([^\n]*)<\/piclaw_goal_input>$/.exec(l);if(!w)return l;try{let k=JSON.parse(w[1]);if(!k||Object.keys(k).sort().join(",")!=="generation,goalId"||typeof k.goalId!=="string"||!k.goalId.trim()||k.goalId!==k.goalId.trim()||k.goalId.length>256||!Number.isSafeInteger(k.generation)||k.generation<1)return l;let x=l.slice(0,w.index);if(h)return x;let[,E,R]=p,L=new RegExp(`<${R}>
([\\s\\S]*?)
</${R}>`).exec(x)?.[1];if(L===void 0)return l;let P={lt:"<",gt:">",amp:"&",quot:'"',"#39":"'",apos:"'"};return`\uD83C\uDFAF ${E}: ${L.replace(/&(lt|gt|amp|quot|#39|apos);/g,(I,N)=>P[N])}`}catch{return l}}class Ws{host;timeoutMs;current;pendingSubmit;constructor(l,h=15000){this.host=l;this.timeoutMs=h;if(!Number.isSafeInteger(h)||h<=0)throw Error("Invalid dictation deadline.")}get active(){return!!this.current}async start(l){if(this.current)throw Error("A dictation session already owns this composer.");if(!l.availability().available){this.host.state("error","Selected dictation provider is unavailable.");return}let h=this.host.readDraft(),p=new AbortController,w,k,x=new Promise((L,P)=>{w=L,k=P}),E={controller:p,provider:l,chatJid:h.chatJid,revision:h.revision,start:Math.min(h.selectionStart,h.selectionEnd),end:Math.max(h.selectionStart,h.selectionEnd),text:h.text,segments:[],starting:x};this.current=E,this.host.state("loading"),Promise.resolve().then(()=>l.start({signal:p.signal,chatJid:h.chatJid,setState:(L)=>{if(this.current!==E||p.signal.aborted)return;if(L==="error")E.error="Dictation provider failed. Draft preserved.",this.cancel(),this.host.state("error",E.error);else if(!E.finishing||L!=="loading"&&L!=="recording")this.host.state(L)},updateSegment:(L)=>this.updateSegment(E,L)})).then(w,k);try{if(await this.bounded(x,p.signal),this.current===E&&!p.signal.aborted&&!E.finishing)this.host.state("recording")}catch{let L=p.signal.aborted;if(p.abort(),!L)E.error="Dictation could not start. Draft preserved.";if(this.cancel(),E.error&&this.current===E)this.host.state("error",E.error)}}updateSegment(l,h){if(this.current!==l||l.controller.signal.aborted||!h.segmentId||h.segmentId.length>128||typeof h.text!=="string"||h.text.length>65536||typeof h.final!=="boolean")return{applied:!1};let p=this.host.readDraft();if(p.chatJid!==l.chatJid||p.revision!==l.revision||p.text!==l.text)return{applied:!1};let w=l.segments.find((I)=>I.id===h.segmentId);if(w?.final)return{applied:w.text===h.text&&h.final};let k=l.segments.map((I)=>({...I})),x=k.findIndex((I)=>I.id===h.segmentId),E={id:h.segmentId,text:h.text,final:h.final};if(x<0){if(k.length>=256)return{applied:!1};k.push(E)}else k[x]=E;let R=k.map((I)=>I.text).join("");if(R.length>131072)return{applied:!1};let L=p.text.slice(0,l.start)+R+p.text.slice(l.end);if(!this.host.writeDraft(L,p.revision))return{applied:!1};let P=this.host.readDraft();if(P.chatJid!==l.chatJid||P.text!==L)return{applied:!1};return l.segments=k,l.end=l.start+R.length,l.text=L,l.revision=P.revision,{applied:!0}}draftChanged(l,h){let p=this.current;if(!p||p.controller.signal.aborted)return;if(l.chatJid!==p.chatJid||h.chatJid!==p.chatJid||l.revision!==p.revision||l.text!==p.text){this.cancel();return}let w=0;while(w<l.text.length&&w<h.text.length&&l.text[w]===h.text[w])w++;let k=0;while(k<l.text.length-w&&k<h.text.length-w&&l.text.at(-1-k)===h.text.at(-1-k))k++;let x=l.text.length-k,E=h.text.length-l.text.length;if(x<=p.start&&w<p.start)p.start+=E,p.end+=E;else if(w<p.end||p.start===p.end&&w===p.start){this.cancel();return}p.text=h.text,p.revision=h.revision}finish(){let l=this.current;if(!l)return Promise.resolve({status:"cancelled"});if(!l.finishing)this.host.state("finishing"),l.finishing=(async()=>{try{let h=await this.bounded(l.starting,l.controller.signal),p=await this.bounded(Promise.resolve().then(()=>h.finish()),l.controller.signal);if(l.error)throw Error("Dictation provider failed.");if(this.current!==l||l.controller.signal.aborted)return{status:"cancelled"};if(p.status!=="finished")return this.cancel(),{status:"cancelled"};return l.controller.abort(),this.current=void 0,this.host.state("idle"),p}catch{if(l.controller.signal.aborted&&!l.error)return{status:"cancelled"};if(this.current===l)l.error="Dictation could not finish. Draft preserved; send again explicitly.",this.cancel(),this.host.state("error",l.error);throw Error("Dictation finish failed.")}})();return l.finishing}cancel(){let l=this.current;if(!l)return Promise.resolve();if(l.controller.abort(),!l.cancelling)l.cancelling=(async()=>{try{await(await l.starting).cancel()}catch{l.error??="Dictation cleanup failed."}finally{if(this.current===l)if(this.current=void 0,l.error)this.host.state("error",l.error);else this.host.state("idle")}})();return l.cancelling}submit(l){if(this.pendingSubmit)return this.pendingSubmit;let h=this.current;return this.pendingSubmit=(async()=>{if(h){if((await this.finish()).status!=="finished")return!1}return await l(),!0})().finally(()=>{this.pendingSubmit=void 0}),this.pendingSubmit}bounded(l,h){return new Promise((p,w)=>{let k,x=()=>{clearTimeout(k),w(Error("Dictation cancelled."))};if(h.aborted){w(Error("Dictation cancelled."));return}h.addEventListener("abort",x,{once:!0}),k=setTimeout(()=>{h.removeEventListener("abort",x),w(Error("Dictation deadline exceeded."))},this.timeoutMs),l.then((E)=>{clearTimeout(k),h.removeEventListener("abort",x),p(E)},(E)=>{clearTimeout(k),h.removeEventListener("abort",x),w(E)})})}}function ic(l){let h=0,p=l.read(),w=!1,k=0,E=new Ws({readDraft:()=>(R(),{...l.read(),revision:h}),writeDraft:(I,N)=>{if(R(),w||h!==N)return!1;return l.write(I),h++,p={...l.read(),text:I},!0},state:l.state});function R(){let I=l.read();if(I.text!==p.text||I.chatJid!==p.chatJid){k++;let N={...p,revision:h};h++,p=I,E.draftChanged(N,{...I,revision:h})}}let L=Mn()?.provider,P=fo(()=>{let I=Mn()?.provider;if(I!==L){if(k++,E.active)E.cancel();if(I)l.providerSelected?.()}L=I});return{get selected(){return Mn()?.provider},get active(){return E.active},draftChanged:R,async toggle(){R();let I=Mn()?.provider;if(!I)return!1;if(E.active)await E.finish();else await E.start(I);return!0},submit(I){R();let N=k,F=l.read().chatJid,Y=Mn()?.provider;return E.submit(async()=>{if(R(),w||k!==N||l.read().chatJid!==F||Mn()?.provider!==Y)return;await I()})},async dispose(){w=!0,P(),await E.cancel()},cancel:()=>(k++,E.cancel())}}var Us="piclaw:statusbar-compose-slot";function Ys(){if(typeof document>"u")return null;return document.querySelector(".workbench-statusbar-compose")}function En(){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent("piclaw:statusbar-compose-slot"))}function mo(l){return String(l||"").toLowerCase().replace(/^@/,"").replace(/\s+/g," ").trim()}function Up(l,h){let p=mo(l),w=mo(h);if(!w)return!1;return p.startsWith(w)||p.includes(w)}function _t(l){if(!l)return!1;if(l.defaultPrevented||l.repeat)return!1;if(l.isComposing)return!1;if(l.ctrlKey||l.metaKey||l.altKey)return!1;return typeof l.key==="string"&&l.key.length===1&&/\S/.test(l.key)}function ac(l,h,p=Date.now(),w=700){let k=l&&typeof l==="object"?l:{value:"",updatedAt:0},x=String(h||"").trim().toLowerCase();if(!x)return{value:"",updatedAt:p};return{value:!k.value||!Number.isFinite(k.updatedAt)||p-k.updatedAt>w?x:`${k.value}${x}`,updatedAt:p}}function Yp(l,h){let p=Math.max(0,Number(l)||0);if(p<=0)return[];let k=((Number.isInteger(h)?h:0)%p+p)%p,x=[];for(let E=0;E<p;E+=1)x.push((k+E)%p);return x}function Vp(l,h,p=0,w=(k)=>k){let k=mo(h);if(!k)return-1;let x=Array.isArray(l)?l:[],E=Yp(x.length,p),R=x.map((L)=>mo(w(L)));for(let L of E)if(R[L].startsWith(k))return L;for(let L of E)if(R[L].includes(k))return L;return-1}function cc(l,h,p=-1,w=(k)=>k){let k=Array.isArray(l)?l:[];if(p>=0&&p<k.length){let x=w(k[p]);if(Up(x,h))return p}return Vp(k,h,0,w)}class Vs{publish;generation=0;constructor(l){this.publish=l}begin(l){let h=++this.generation;return this.publish("sending"),h}acknowledged(l){this.finished(l)}finished(l){if(l===this.generation)this.publish(null)}failed(l){this.finished(l)}reset(){this.generation++,this.publish(null)}}function go(l){return String(l||"").trim().toLowerCase()}function Js(l){let h=String(l||"").match(/^@([a-zA-Z0-9_-]*)$/);if(!h)return null;return go(h[1]||"")}function Jp(l){let h=new Set,p=[];for(let w of Array.isArray(l)?l:[]){let k=go(w?.agent_name);if(!k||h.has(k))continue;h.add(k),p.push(w)}return p}function lc(l,h,p={}){let w=Js(h);if(w==null)return[];let k=typeof p?.currentChatJid==="string"?p.currentChatJid:null;return Jp(l).filter((x)=>{if(k&&x?.chat_jid===k)return!1;return go(x?.agent_name).startsWith(w)})}function Qs(l){let h=go(l);return h?`@${h} `:""}var Qp={streaming:"Streaming",working:"Working",compacting:"Compacting",retrying:"Retrying",bash_running:"Running shell"};function dr(l){if(!l?.is_active)return"";let h=String(l.activity_status||"").trim();return Qp[h]||"Working"}function Z(l,h=220){let p=String(l??"").replace(/\r\n?/g,`
`).replace(/!\[[^\]]*\]\([^)]*\)/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/```+/g,"").replace(/`([^`]+)`/g,"$1").replace(/^#{1,6}\s+/gm,"").replace(/^>\s?/gm,"").replace(/^\s*[-*+]\s+/gm,"").replace(/[*_~]{1,3}/g,"").replace(/\s+/g," ").trim();if(p.length<=h)return p;return`${p.slice(0,Math.max(0,h-1)).trimEnd()}…`}function dc(l){if(!l)return null;if(typeof l==="string")try{return dc(JSON.parse(l))}catch{return null}if(typeof l!=="object"||Array.isArray(l))return null;let h=l,p=h.arguments??h.input??h.params??h.parameters??h.args??h.payload;return p&&typeof p==="object"&&!Array.isArray(p)?p:h}function Xp(l){let h=Z(l?.title,220);if(h)return h;let p=Z(l?.tool_name??l?.toolName,220);if(!p)return"";let w=dc(l?.tool_args??l?.toolArgs);if(!w)return p;let x=[w.command,Array.isArray(w.commands)?w.commands.filter((E)=>typeof E==="string").join(" && "):"",w.path??w.filePath??w.target,Array.isArray(w.paths)?w.paths.filter((E)=>typeof E==="string").join(", "):"",w.fileName??w.filename??w.file,w.url,w.query].map((E)=>typeof E==="string"?Z(E,120):"").filter(Boolean).sort((E,R)=>R.length-E.length)[0];return x?`${p}: ${x}`:p}function Zp(l){let h=typeof l?.type==="string"?l.type.trim():"";if(h!=="tool_call"&&h!=="tool_status")return null;let p=Z(l.status??l.tool_status??l.toolStatus,220);if(h==="tool_status"&&/^(done|failed|cancelled|canceled|aborted)$/i.test(p))return null;let w=p&&!/^working(?:\.{3}|…)?$/i.test(p)?p:"",k=[Xp(l),w].filter(Boolean).join(" — ");return k?{kind:"tool",label:"Tool",text:Z(k)}:null}function uc(l,h){let p=Z(typeof h==="string"?h:h?.text);return p?{kind:l,label:l==="thinking"?"Thinking":"Draft",text:p}:null}function pr(l,h=null){if(!l||l.status!=="active")return{preview:null,retained:null};let p=l.data?.turn_id??l.data?.turnId,w=typeof p==="string"?p.trim():"",k=w&&h?.turnId===w?h:null,x=uc("draft",l.draft)||uc("thinking",l.thought),E=x&&w?{...x,turnId:w}:k;return{preview:x||Zp(l.data)||E,retained:E}}function ho(l){let h=typeof l==="string"?Date.parse(l):NaN;return Number.isFinite(h)?h:-1/0}function Qe(l,h){let p=ho(l.last_activity_at),w=ho(h.last_activity_at);if(p!==w)return w-p;let k=ho(l.archived_at),x=ho(h.archived_at);return k===x?0:x-k}function fr(l,h=Date.now()){let p=Date.parse(String(l??""));if(!Number.isFinite(p))return"";let w=Math.max(0,Math.round((h-p)/1000));if(w<60)return"now";let k=Math.round(w/60);if(k<60)return`${k}m`;let x=Math.round(k/60);if(x<24)return`${x}h`;let E=Math.round(x/24);if(E<7)return`${E}d`;return new Date(p).toLocaleDateString(void 0,{month:"short",day:"numeric"})}function $t(l){let h=Number(l?.context_percent??l?.contextPercent??l?.context_usage?.percent);if(Number.isFinite(h)&&h>=0)return Math.min(100,h);let p=Number(l?.context_tokens),w=Number(l?.context_window);if(Number.isFinite(p)&&Number.isFinite(w)&&w>0&&p>=0)return Math.min(100,p/w*100);return null}function mr(l){return Boolean(l?.ctrlKey||l?.metaKey||l?.button===1)}var ef={current:"Current",pinned:"Pinned",active:"Active",tree:"This session tree",other:"Other sessions",archived:"Archived"};function he(l){return typeof l==="string"?l.trim():""}function Xs(l){if(l==null)return null;let h=Number(l);return Number.isFinite(h)&&h>=0?h:null}function pc(l){if(l>=1e6){let h=l/1e6;return`${Number.isInteger(h)?h.toFixed(0):h.toFixed(1)}M`}if(l>=1000)return`${Math.round(l/1000)}K`;return String(Math.round(l))}function fc(l){let h=he(l?.model)||he(l?.model_label),p=Xs(l?.context_tokens??l?.contextTokens??l?.context_usage?.tokens),w=Xs(l?.context_window??l?.contextWindow??l?.context_usage?.contextWindow),k=Xs(l?.context_percent??l?.contextPercent??l?.context_usage?.percent),x=k==null?null:Math.min(100,k),E=p!=null&&w!=null&&w>0?`${pc(p)} / ${pc(w)}${x==null?"":` (${Math.round(x)}% context)`}`:x==null?"":`${Math.round(x)}% context`;return[h,E].filter(Boolean).join(" · ")}function tf(l){let h=Boolean(l?.archived_at),p=Boolean(l?.is_active)&&!h;return[he(l?.agent_name)?`@${he(l.agent_name)}`:"",he(l?.agent_name),he(l?.chat_jid),he(l?.root_chat_jid),he(l?.model),he(l?.model_label),he(l?.provider),h?"archived":p?"active":"idle",he(l?.parent_branch_id),he(l?.branch_id)].filter(Boolean).join(" ").toLocaleLowerCase()}function mc(l,h){let p=he(h).toLocaleLowerCase().split(/\s+/).filter(Boolean);if(p.length===0)return!0;let w=tf(l);return p.every((k)=>w.includes(k))}function nf(l,h){if(!mc(l,h))return 4;let p=he(l?.agent_name).toLocaleLowerCase(),w=he(h).toLocaleLowerCase().split(/\s+/).map((k)=>k.replace(/^@/,"")).filter(Boolean);if(!p||w.length===0)return 3;if(w.some((k)=>p===k))return 0;if(w.some((k)=>p.startsWith(k)))return 1;if(w.some((k)=>p.includes(k)))return 2;return 3}function gc(l,h){let p=0,w=Number.POSITIVE_INFINITY;for(let k=0;k<l.length;k+=1){let x=nf(l[k],h);if(x>=w)continue;if(p=k,w=x,x===0)break}return p}function hc(l,h){let p=he(h);if(!p)return-1;return l.findIndex((w)=>he(w?.chat_jid)===p)}function De(l,h){let p=he(h).toLocaleLowerCase();if(!p)return l;let w=new Set(l.filter((x)=>mc(x,p)).map((x)=>he(x.chat_jid))),k=new Map(l.map((x)=>[he(x.branch_id),x]).filter(([x])=>Boolean(x)));for(let x of l){if(!w.has(he(x.chat_jid)))continue;let E=he(x.parent_branch_id);while(E){let R=k.get(E);if(!R)break;w.add(he(R.chat_jid)),E=he(R.parent_branch_id)}}return l.filter((x)=>w.has(he(x.chat_jid)))}function Le(l,h,p=[]){let w=he(h),k=l.find((L)=>he(L.chat_jid)===w),x=he(k?.root_chat_jid)||w,E=new Set(Array.from(p,he).filter(Boolean)),R=new Map([["current",[]],["pinned",[]],["active",[]],["tree",[]],["other",[]],["archived",[]]]);for(let L of l){let P=he(L.chat_jid),N=Boolean(L.archived_at)?"archived":P===w?"current":Boolean(L.is_active)?"active":E.has(P)?"pinned":(he(L.root_chat_jid)||P)===x?"tree":"other";R.get(N).push(L)}return["current","active","pinned","tree","other","archived"].map((L)=>({key:L,label:ef[L],items:R.get(L).sort(Qe)})).filter((L)=>L.items.length>0)}function bc(l,h,p,w=8){if(h<=0)return 0;let k=Math.max(0,Math.min(l,h-1));if(p==="Home")return 0;if(p==="End")return h-1;if(p==="ArrowDown")return(k+1)%h;if(p==="ArrowUp")return(k-1+h)%h;if(p==="PageDown")return Math.min(h-1,k+w);if(p==="PageUp")return Math.max(0,k-w);return k}function yc(l={}){if(l.searchMode)return!1;return Boolean(l.showSessionSwitcherButton)}function wc(l,h,p={}){if(!l||l.isComposing)return!1;if(!yc(p))return!1;if(l.ctrlKey||l.metaKey||l.altKey)return!1;if(l.key!=="@")return!1;return String(h||"")===""}function Zs(l,h={}){if(!yc(h))return!1;return String(l||"")==="@"}function X(l){let h=ei(l);return h?`@${h}`:""}function ei(l){return String(l||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-")}function Tt(l,h=""){let p=String(l||""),w=ei(p),k=ei(h);if(!p.trim())return{normalized:w,handle:"",canSubmit:!1,kind:"error",message:"Enter a branch handle."};if(!w)return{normalized:w,handle:"",canSubmit:!1,kind:"error",message:"Handle must contain at least one letter or number."};let x=`@${w}`;if(w===k)return{normalized:w,handle:x,canSubmit:!1,kind:"info",message:`Already using ${x}.`};if(w!==p.trim())return{normalized:w,handle:x,canSubmit:!0,kind:"info",message:`Will save as ${x}. Letters, numbers, - and _ are allowed; leading @ is optional.`};return{normalized:w,handle:x,canSubmit:!0,kind:"success",message:`Saving as ${x}.`}}function Ye(l,h={}){let p=[],w=typeof h.currentChatJid==="string"?h.currentChatJid.trim():"",k=typeof l?.chat_jid==="string"?l.chat_jid.trim():"";if(w&&k===w)p.push("current");if(l?.archived_at)p.push("archived");else{if(l?.is_compacting||l?.activity_status==="compacting")p.push("compacting");if(l?.is_active)p.push("active")}return p}function vc(l){let h=X(l?.agent_name)||String(l?.chat_jid||"").trim(),p=typeof l?.chat_jid==="string"&&l.chat_jid.trim()?l.chat_jid.trim():"unknown-chat";return`${h} — ${p}`}function Et(l,h={}){let p=Ye(l,h);return p.length>0?`${vc(l)} • ${p.join(" • ")}`:vc(l)}function gr(l,h,p){let w=X(l),k=X(h),x=String(p||"").trim();if(w&&k&&w!==k)return`Restored archived ${w} as ${k} because ${w} is already in use.`;if(k)return`Restored ${k}.`;if(w)return`Restored ${w}.`;return`Restored ${x||"branch"}.`}function It({steerQueued:l=!1,pulsing:h=!1}={}){let p=["turn-dot"];if(l)p.push("turn-dot-queued");if(h)p.push("turn-dot-pulsing");return p.join(" ")}function ti({pulsing:l=!1}={}){let h=["compose-inline-status-dot"];if(l)h.push("compose-inline-status-dot-pulsing");return h.join(" ")}function Ze(l,{isLastActivity:h=!1,pendingRequest:p=!1}={}){if(p)return"dot";if(h)return"none";if(l?.type==="error")return"none";let w=typeof l?.type==="string"?l.type:"";if(Boolean(typeof l?.tool_name==="string"&&l.tool_name.trim()||l?.tool_args))return"spinner";if(l?.type==="intent")return"dot";if(w==="tool_call"||w==="tool_status"||w==="thinking"||w==="waiting")return"spinner";return"dot"}function hr(l,h={}){return Ze(l,h)==="dot"}var Sc=350;function rf(l){return String(l||"Connecting").replace(/[-_]+/g," ").replace(/^./,(h)=>h.toUpperCase())}function of(l,h={}){let p=typeof l==="string"&&l.trim()?l.trim():"connecting";if(p==="connected")return{show:!1,statusClass:"connected",label:"Connected",title:"Connection: Connected"};if(p!=="disconnected"){let R=rf(p);return{show:!0,statusClass:p,label:R,title:`Connection: ${R}`}}let w=Number.isFinite(Number(h?.delayMs))?Math.max(0,Number(h.delayMs)):Sc,k=Number.isFinite(Number(h?.nowMs))?Number(h.nowMs):Date.now(),x=Number.isFinite(Number(h?.disconnectedAtMs))?Number(h.disconnectedAtMs):k;return k-x>=w?{show:!0,statusClass:"disconnected",label:"Reconnecting",title:"Reconnecting"}:{show:!1,statusClass:"connecting",label:"Connecting",title:"Connecting"}}function $c(l,h={}){let p=Number.isFinite(Number(h?.delayMs))?Math.max(0,Number(h.delayMs)):Sc,[w,k]=t(null),[x,E]=t(()=>Date.now());return o(()=>{if(l==="disconnected"){let R=Date.now();k((L)=>L??R),E(R);return}k(null),E(Date.now())},[l]),o(()=>{if(l!=="disconnected"||w===null)return;let R=p-(Date.now()-w);if(R<=0)return;let L=0,P=0,I=setTimeout(()=>{if(typeof requestAnimationFrame!=="function"){E(Date.now());return}L=requestAnimationFrame(()=>{P=requestAnimationFrame(()=>{E(Date.now())})})},R);return()=>{if(clearTimeout(I),L)cancelAnimationFrame(L);if(P)cancelAnimationFrame(P)}},[l,w,p]),i(()=>of(l,{delayMs:p,disconnectedAtMs:w,nowMs:x}),[l,p,w,x])}function S({prefix:l="file",label:h,title:p,onRemove:w,onClick:k,removeTitle:x="Remove",icon:E="file"}){let R=`${l}-file-pill`,L=`${l}-file-name`,P=`${l}-file-remove`,I=E==="message"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>`:E==="folder"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>`:e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>`;return e`
    <span class=${R} title=${p||h} onClick=${k}>
      ${I}
      <span class=${L}>${h}</span>
      ${w&&e`
        <button
          class=${P}
          onClick=${(N)=>{N.preventDefault(),N.stopPropagation(),w()}}
          title=${x}
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `}
    </span>
  `}async function ni(l,h,p,w){if(typeof l!=="function")return!1;try{let k=await l(h);if(!k)return!1;return p(k),w?.(k),!0}catch(k){return!1}}var sf=0;function kc(l,h){return`compose-model-option-${l}-${encodeURIComponent(h)}`}function af(l){let h=[],p=ee(l.contextWindow);if(p)h.push(p);if(l.reasoning)h.push("reasoning");return h.push(...l.variants.filter((w)=>w!=="stable").slice(0,2)),h}function xc({anchor:l=null,entries:h,loading:p=!1,switching:w=!1,onSelect:k,onTogglePin:x,onClose:E,onCompact:R,onOpenSettings:L,thinkingLevel:P=null,thinkingLevels:I=[],onSelectThinking:N,rootRef:F}){let[Y,W]=t(""),[Q,J]=t(null),U=r(null),te=r(new Map),H=r(null);if(H.current==null)H.current=++sf;let ce=`compose-model-search-${H.current}`,xe=`compose-model-results-${H.current}`,be=i(()=>br(h,{query:Y}),[h,Y]),He=i(()=>be.renderedEntries,[be]);o(()=>{U.current?.focus()},[]),o(()=>{if(He.some((Ne)=>Ne.key===Q))return;let B=He.find((Ne)=>Ne.current);J(B?.key??He[0]?.key??null)},[Q,He]),o(()=>{te.current.get(Q)?.scrollIntoView?.({block:"nearest"})},[Q]);let Kt=n((B)=>{if(!B||w)return;k(B)},[k,w]),cn=n((B)=>{if(B.isComposing)return;let Ne={ArrowDown:"next",ArrowUp:"previous",Home:"first",End:"last",PageDown:"page-next",PageUp:"page-previous"};if(B.key==="Escape"){B.preventDefault(),E();return}if(B.target!==U.current)return;if(B.key==="Enter"){let jt=be.renderedEntries.find((qe)=>qe.key===Q);if(jt)if(B.preventDefault(),B.altKey)x?.(jt);else Kt(jt);return}let Wt=Ne[B.key];if(!Wt||(B.key==="Home"||B.key==="End")&&!B.ctrlKey&&!B.metaKey)return;B.preventDefault(),J(vr(be.renderedEntries,Q,Wt))},[Q,Kt,E,x,be.renderedEntries]),Lr=(B)=>{let Ne=B.current,Wt=B.key===Q,jt=af(B);return e`
            <button
                id=${kc(H.current,B.key)}
                key=${B.key}
                type="button"
                role="option"
                aria-label=${`${B.displayName}, ${B.pinned?"pinned":"not pinned"}. Alt+Enter to ${B.pinned?"unpin":"pin"}.`}
                aria-keyshortcuts="Alt+Enter"
                aria-selected=${Ne?"true":"false"}
                tabIndex=${-1}
                class=${`compose-model-catalogue-option${Ne?" selected":""}${Wt?" focused":""}`}
                ref=${(qe)=>qe?te.current.set(B.key,qe):te.current.delete(B.key)}
                onMouseDown=${(qe)=>qe.preventDefault()}
                onMouseEnter=${()=>J(B.key)}
                onClick=${()=>Kt(B)}
            >
                <span
                    class=${`compose-model-catalogue-pin${B.pinned?" pinned":""}`}
                    aria-hidden="true"
                    title=${B.pinned?"Unpin model":"Pin model"}
                    onClick=${(qe)=>{qe.preventDefault(),qe.stopPropagation(),J(B.key),x?.(B)}}
                >${B.pinned?"★":"☆"}</span>
                <span class="compose-model-catalogue-option-content">
                    <span class="compose-model-catalogue-option-primary">
                        <span class="compose-model-catalogue-option-name">${B.displayName}</span>
                        ${ge(B.pricing)&&e`<span class="compose-model-catalogue-option-price">${ge(B.pricing)}</span>`}
                    </span>
                    ${B.displayName!==B.key&&e`<span class="compose-model-catalogue-option-key">${B.key}</span>`}
                    ${jt.length>0&&e`
                        <span class="compose-model-catalogue-option-badges">
                            ${jt.map((qe)=>e`<span class="compose-model-catalogue-badge" key=${qe}>${qe}</span>`)}
                        </span>
                    `}

                </span>
            </button>
        `};return e`
        <div
            class=${`compose-model-popup compose-model-catalogue${l?" is-statusbar-anchored":""}`}
            style=${l?`--model-popup-left: ${l.left}px; --model-popup-bottom: ${l.bottom}px`:void 0}
            data-compose-model-catalogue="true"
            ref=${F}
            onKeyDown=${cn}
        >
            <div class="compose-model-catalogue-header">
                <label class="compose-model-catalogue-search-label" for=${ce}>Search models</label>
                <div class="compose-model-catalogue-search-row">
                    <input
                        id=${ce}
                        ref=${U}
                        class="compose-model-catalogue-search"
                        type="search"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls=${xe}
                        aria-activedescendant=${Q?kc(H.current,Q):void 0}
                        placeholder="Search models…"
                        value=${Y}
                        onInput=${(B)=>W(B.currentTarget.value)}
                    />
                    ${Y&&e`<button type="button" class="compose-model-catalogue-clear" onClick=${()=>W("")} aria-label="Clear model search">×</button>`}
                </div>
                <div class="compose-model-catalogue-summary" aria-live="polite">
                    <span>${be.totalMatches} ${be.totalMatches===1?"model":"models"}</span>
                    ${p&&e`<span>Refreshing…</span>`}
                </div>
            </div>
            <div id=${xe} class="compose-model-popup-menu compose-model-catalogue-results" role="listbox" aria-label="Models">
                ${be.sections.map((B)=>e`
                    <section class=${`compose-model-catalogue-section ${`compose-model-catalogue-section--${B.key}`}`} key=${B.key} role="presentation">
                        <div class="compose-model-catalogue-section-heading" role="presentation">
                            <span>${B.label}</span><span>${B.totalCount}</span>
                        </div>
                        ${B.entries.map(Lr)}
                        ${B.groups.map((Ne)=>e`
                            <div class="compose-model-catalogue-group" key=${Ne.key} role="group" aria-label=${Ne.label}>
                                <div class="compose-model-catalogue-group-heading" role="presentation">
                                    <span>${Ne.label}</span><span>${Ne.totalCount}</span>
                                </div>
                                ${Ne.entries.map(Lr)}
                            </div>
                        `)}
                    </section>
                `)}
                ${be.totalMatches===0&&e`
                    <div class="compose-model-popup-empty">
                        ${p?"Loading models…":Y?`No models match “${Y}”.`:"No models available."}
                    </div>
                `}
                ${be.hiddenCount>0&&e`<div class="compose-model-catalogue-limit-note">Showing ${be.renderedEntries.length} of ${be.totalMatches}; refine your search to see more.</div>`}
            </div>
            <div class="compose-model-catalogue-footer">
                <div class="compose-model-catalogue-footer-start">
                    ${I.length>0&&e`
                        <label class="compose-model-catalogue-thinking">
                            <span>Thinking</span>
                            <select
                                aria-label="Thinking level"
                                value=${P||I[0]?.id||""}
                                disabled=${w||typeof N!=="function"}
                                onChange=${(B)=>N?.(B.currentTarget.value)}
                            >
                                ${I.map((B)=>e`<option key=${B.id} value=${B.id}>${B.label}</option>`)}
                            </select>
                        </label>
                    `}
                    ${R&&e`<button type="button" class="compose-model-popup-btn" onClick=${R}>Compact context</button>`}
                </div>
                ${L&&e`<button type="button" class="compose-model-popup-btn primary" onClick=${L}>Open Models settings</button>`}
            </div>
        </div>
    `}function cf(l={}){let h=l.navigator??(typeof navigator<"u"?navigator:null);if(!h)return!1;let p=String(h.userAgent||"");if(/iPad|iPhone/.test(p))return!0;return h.platform==="MacIntel"&&Number(h.maxTouchPoints||0)>1}function lf(l={}){let h=l.window??(typeof window<"u"?window:null);if(!h)return null;return h.SpeechRecognition||h.webkitSpeechRecognition||null}function ri(l={}){let h=l.window??(typeof window<"u"?window:null),p=typeof l.secureContext==="boolean"?l.secureContext:Boolean(h?.isSecureContext),w=b(l),k=cf(l),x=lf(l);if(!p)return{mode:"unavailable",showButton:!1,canStart:!1,reason:"secure-context-required",title:"Voice input requires HTTPS",detail:"Native browser speech input needs a secure context (HTTPS or localhost).",recognitionCtor:null,ios:k,standalone:w,secureContext:p};if(k&&w)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-standalone-fallback",title:"Use keyboard dictation",detail:"Speech input is intentionally downgraded in iPhone/iPad standalone web apps because browser-native recognition is not reliable there. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:x,ios:k,standalone:w,secureContext:p};if(!x){if(k)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-keyboard-dictation",title:"Use keyboard dictation",detail:"This browser does not expose native in-page speech recognition here. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:null,ios:k,standalone:w,secureContext:p};return{mode:"unavailable",showButton:!1,canStart:!1,reason:"unsupported",title:"Voice input unavailable",detail:"This browser does not expose native speech recognition in this context.",recognitionCtor:null,ios:k,standalone:w,secureContext:p}}return{mode:"native",showButton:!0,canStart:!0,reason:"supported",title:"Start voice input",detail:k?"Browser-native speech input is available here, but Safari/WebKit reliability may still vary.":"Browser-native speech input is available.",recognitionCtor:x,ios:k,standalone:w,secureContext:p}}function _c(l,h="",p=""){let w=String(l||""),k=String(h||"").trim(),x=String(p||"").trim(),E=[k,x].filter(Boolean).join(" ").trim();if(!E)return w;if(!w)return E;let R=/[\s\n]$/.test(w)?"":" ";return`${w}${R}${E}`}function Ec(l,h=0){let p="",w="",k=l&&typeof l.length==="number"?l:[];for(let x=Math.max(0,h);x<k.length;x+=1){let E=k[x];if(!E||!E[0])continue;let R=String(E[0].transcript||"").trim();if(!R)continue;if(E.isFinal)p=`${p} ${R}`.trim();else w=`${w} ${R}`.trim()}return{finalText:p,interimText:w}}function oi(l,h=null){let p=String(l||"").trim().toLowerCase();switch(p){case"not-allowed":case"service-not-allowed":return h?.ios?"Microphone or speech-recognition permission was denied. On iPhone/iPad, using keyboard dictation may be more reliable.":"Microphone or speech-recognition permission was denied by the browser.";case"no-speech":return"No speech was detected. Try again and speak after the listening indicator appears.";case"audio-capture":return"The browser could not access a microphone for speech recognition.";case"network":return"The browser speech-recognition service reported a network or service failure.";case"aborted":return"Voice input was stopped.";default:return p?`Voice input failed (${p}).`:"Voice input failed."}}var uf=[{name:"/model",description:"Select model or list available models"},{name:"/cycle-model",description:"Cycle to the next available model"},{name:"/thinking",description:"Show or set thinking/effort level"},{name:"/effort",description:"Show or set thinking/effort level (alias for /thinking)"},{name:"/cycle-thinking",description:"Cycle thinking level"},{name:"/theme",description:"Set UI theme (no name to show available themes)"},{name:"/tint",description:"Tint default light/dark UI (usage: /tint #hex or /tint off)"},{name:"/btw",description:"Open a side conversation panel without interrupting the main chat"},{name:"/state",description:"Show current session state"},{name:"/stats",description:"Show session token and cost stats"},{name:"/context",description:"Show context window usage"},{name:"/quota",description:"Show cached provider quota / rate-limit usage"},{name:"/last",description:"Show last assistant response"},{name:"/compact",description:"Manually compact the session"},{name:"/auto-compact",description:"Toggle auto-compaction"},{name:"/auto-retry",description:"Toggle auto-retry"},{name:"/abort",description:"Abort the current response"},{name:"/abort-retry",description:"Abort retry backoff"},{name:"/abort-bash",description:"Abort running bash command"},{name:"/shell",description:"Run a shell command and return output"},{name:"/bash",description:"Run a shell command and add output to context"},{name:"/queue",description:"Queue a follow-up message (one-at-a-time)"},{name:"/queue-all",description:"Queue a follow-up message (batch all)"},{name:"/steer",description:"Steer the current response"},{name:"/steering-mode",description:"Set steering mode (all|one)"},{name:"/followup-mode",description:"Set follow-up mode (all|one)"},{name:"/session-name",description:"Set or show the session name"},{name:"/new-session",description:"Start a new session"},{name:"/switch-session",description:"Switch to a session file"},{name:"/session-rotate",description:"Rotate the current persisted session into an archived file"},{name:"/rollup",description:"Merge the current branch chat back into its parent chat"},{name:"/clone",description:"Duplicate the current active branch into a new session"},{name:"/fork",description:"Fork from a previous message"},{name:"/forks",description:"List forkable messages"},{name:"/tree",description:"List the session tree"},{name:"/label",description:"Set or clear a label on a tree entry"},{name:"/labels",description:"List labeled entries"},{name:"/agent-name",description:"Set or show the agent display name"},{name:"/agent-avatar",description:"Set or show the agent avatar URL"},{name:"/user-name",description:"Set or show your display name"},{name:"/user-avatar",description:"Set or show your avatar URL"},{name:"/user-github",description:"Set name/avatar from GitHub profile"},{name:"/export-html",description:"Export session to HTML"},{name:"/passkey",description:"Manage passkeys (enrol/list/delete)"},{name:"/totp",description:"Show a TOTP enrolment QR code"},{name:"/qr",description:"Generate a QR code for text or URL"},{name:"/search",description:"Search notes and skills in the workspace"},{name:"/dream",description:"Run Dream memory maintenance over recent days (default 7)"},{name:"/tasks",description:"List scheduled tasks"},{name:"/scheduled",description:"List scheduled tasks"},{name:"/pair",description:"Manage remote peer connections (/pair request <url> | /pair list)"},{name:"/ask",description:"Send a prompt to a paired remote instance (/ask <instance_id|fingerprint> <prompt>)"},{name:"/restart",description:"Restart the agent and stop subprocesses"},{name:"/exit",description:"Exit the current piclaw process immediately (Supervisor will restart it)"},{name:"/login",description:"Login to an AI model provider (OAuth or API key)"},{name:"/logout",description:"Logout from an AI model provider"},{name:"/settings",description:"Open the settings pane"},{name:"/help",description:"Open keyboard shortcuts help"},{name:"/commands",description:"List available commands"},{name:"/skill:",description:"Run a workspace skill (e.g. /skill:visual-artifact-generator, /skill:web-search)"}],Cc="piclaw_compose_history",si="piclaw_compose_height",df=50,Ac=70,Rc=300,Pc=520;function Dc(){if(typeof window>"u")return Ac;return window.innerWidth>=1024?Ac:df}function pf(){if(typeof window>"u")return Rc;return Math.min(Math.floor(window.innerHeight*0.4),Rc)}function ff(){if(typeof window>"u")return Pc;return Math.min(Math.floor(window.innerHeight*0.5),Pc)}function ii(l){let h=Dc(),p=Math.max(h,ff());return Math.min(Math.max(Math.round(Number(l)||h),h),p)}function mf(l=null,h=si){let p=l?.getItem?.(h)??f(h);if(!p)return null;let w=parseInt(p,10);return Number.isFinite(w)?ii(w):null}function gf(l,h,p=!1){if(p)return{shouldApply:!1,nextToken:h,text:""};if(!l||typeof l!=="object")return{shouldApply:!1,nextToken:h,text:""};let w=typeof l.token==="string"?l.token:"",k=typeof l.text==="string"?l.text:"";if(!w||w===h||!k.trim())return{shouldApply:!1,nextToken:h,text:""};return{shouldApply:!0,nextToken:w,text:k}}function hf(l="web:default"){let h=typeof l==="string"&&l.trim()?l.trim():"web:default";if(h==="web:default")return Cc;return`${Cc}:${encodeURIComponent(h)}`}function pe(l,h=null,p=null){let w=new Set,k=p instanceof Set?p:new Set(Array.isArray(p)?p:[]),x=[];for(let E of Array.isArray(l)?l:[]){let R=typeof E?.chat_jid==="string"?E.chat_jid.trim():"";if(!R||w.has(R)||k.has(R))continue;if(!(typeof E?.agent_name==="string"?E.agent_name.trim():""))continue;w.add(R),x.push(E)}return x.sort((E,R)=>{let L=Boolean(E?.archived_at),P=Boolean(R?.archived_at);if(L!==P)return L?1:-1;let I=String(E?.agent_name||"").trim(),N=String(R?.agent_name||"").trim(),F=I.localeCompare(N,void 0,{sensitivity:"base"});if(F!==0)return F;let Y=String(E?.chat_jid||"").trim(),W=String(R?.chat_jid||"").trim();return Y.localeCompare(W,void 0,{sensitivity:"base"})}),x}function bf(l){return Boolean(l?.is_active&&!l?.archived_at)}function yf(l,h=null){let p=Array.isArray(l)?l:[],w=typeof h==="string"?h.trim():"";if(w){let x=p.findIndex((E)=>{if(E?.disabled)return!1;if(E?.type!=="session")return!1;return(typeof E?.chat?.chat_jid==="string"?E.chat.chat_jid.trim():"")===w});if(x>=0)return x}let k=p.findIndex((x)=>!x?.disabled);return k>=0?k:0}function Lc(l,h){let p=typeof h?.command?.message==="string"?h.command.message.trim():"";if(!h?.ui_only||!p)return null;let w=typeof l==="string"?l.trim():"";if(!w.startsWith("/"))return null;let k=w.split(/\s+/).filter(Boolean),x=k[0]?.toLowerCase()||"";if(!(k.length>1)&&(x==="/thinking"||x==="/effort"))return p;return null}function wf(l,h,p=!1){if(l)return{mode:"queue",className:"icon-btn send-btn queue-mode",title:"Queue follow-up (Enter)",ariaLabel:"Queue follow-up message",disabled:!h};return{mode:"send",className:"icon-btn send-btn",title:"Send (Enter)",ariaLabel:"Send message",disabled:!h}}function Tc(l,h,p={}){if(!l||p.searchMode)return!1;if(!(l.key===" "||l.key==="Spacebar"||l.code==="Space"))return!1;if(l.ctrlKey||l.metaKey||l.altKey||l.repeat)return!1;if(!p.speechButtonVisible||p.speechButtonActive)return!1;if(!p.canStartSpeech)return!1;return String(h||"").trim().length===0}function vf(l,h){if(!h||!l)return!1;return l.key===" "||l.key==="Spacebar"||l.code==="Space"}function Sf(l,h=!1){if(!l)return null;if(h)return{mode:"compacting",className:"icon-btn send-btn abort-mode compacting-mode",title:"Compacting context — Stop response",ariaLabel:"Compacting context — Stop response",disabled:!1};return{mode:"abort",className:"icon-btn send-btn abort-mode",title:"Stop response",ariaLabel:"Stop response",disabled:!1}}function $f(l){return l==="abort"||l==="compacting"}function kf(l,h=0){if(l?.visible===!1)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};let p=typeof l?.message==="string"&&l.message.trim()?l.message.trim():null,w=l?.indicator&&typeof l.indicator==="object"?l.indicator:null;if(!p&&!w)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};if(w?.mode==="hidden")return{visible:Boolean(p),title:p||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!1};if(w?.mode==="custom"&&Array.isArray(w.frames)&&w.frames.length>0){let k=w.frames,x=Number.isFinite(h)&&h>=0?Math.floor(h)%k.length:0;return{visible:!0,title:p||"Thinking…",indicatorText:k[x],animateDot:!1,animateSpinner:!1}}return{visible:!0,title:p||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!0}}function xf({usage:l,onCompact:h,compactionLabel:p="",compactionTitle:w=""}){let k=Number.isFinite(l.percent)?Math.min(100,Math.max(0,l.percent)):null,x=Number.isFinite(l.tokens)&&l.tokens>=0?l.tokens:null,E=Number.isFinite(l.contextWindow)&&l.contextWindow>0?l.contextWindow:null,R=typeof h==="function",L=R?"Compact context":"Context usage",P=k==null?"unavailable":`${k.toFixed(0)}%`,I=`Context: ${vo(x)} / ${vo(E)} tokens (${P})`,N=typeof p==="string"?p.trim():"",F=typeof w==="string"?w.trim():"",Y=N?`${I}
${F||"Smart compaction"} · ${N}`:`${I}
${L}`,W=9,Q=2*Math.PI*9,J=(k??0)/100*Q,U=k==null?"var(--text-secondary)":k>90?"var(--context-red, #ef4444)":k>75?"var(--context-amber, #f59e0b)":"var(--context-green, #22c55e)";return e`
        <button
            class=${`compose-context-pie icon-btn${N?" is-compacting":""}`}
            type="button"
            title=${Y}
            aria-label=${Y}
            disabled=${!R}
            onClick=${(te)=>{if(te.preventDefault(),te.stopPropagation(),R)h()}}
        >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r=${9}
                    fill="none"
                    stroke="var(--context-track, rgba(128,128,128,0.2))"
                    stroke-width="2.5" />
                <circle cx="12" cy="12" r=${9}
                    fill="none"
                    stroke=${U}
                    stroke-width="2.5"
                    stroke-dasharray=${`${J} ${Q}`}
                    stroke-linecap="round"
                    transform="rotate(-90 12 12)" />
            </svg>
            ${N&&e`<span class="compose-context-pie-timer">${N}</span>`}
        </button>
    `}function vo(l){if(l==null)return"?";if(l>=1e6)return(l/1e6).toFixed(1)+"M";if(l>=1000)return(l/1000).toFixed(0)+"K";return String(l)}function Dt(l){if(l==null)return null;let h=Number(l);return Number.isFinite(h)?h:null}function _f(l){if(!l||typeof l!=="object")return null;let h=Dt(l.cacheHitRate);if(h!=null)return h;let p=Dt(l.inputTokens)??0,w=Dt(l.cacheReadTokens)??0,k=Dt(l.cacheWriteTokens)??0,x=p+w+k;if(l.cacheReadReported===!1||x<=0)return null;if(w<=0&&l.cacheReadReported!==!0)return null;return w/x*100}function Ef(l){let h=Dt(l);if(h==null)return null;return`${Math.max(0,Math.min(100,h)).toFixed(1)}%`}function Gn(l,h){let p=Dt(h);return p!=null?`${l} ${vo(p)}`:null}function yo(l,h="USD"){let p=Dt(l);if(p==null||p<0)return null;let w=p.toFixed(p>=0.01?2:4);return h==="USD"?`$${w}`:h?`${h} ${w}`:`${w} (currency unknown)`}function Cf(l){if(l?.provider!=="openrouter"||l?.availability!=="available")return null;return[`Key spend: ${yo(l.key_usage_usd)||"unavailable"}`,`Key limit: ${l.key_limit_configured===!0?yo(l.key_limit_usd)||"unavailable":l.key_limit_unlimited?"not configured (unlimited)":"unavailable"}`,`Key remaining: ${yo(l.key_limit_remaining_usd)||"unavailable"}`].join(" • ")}function Af(l,h=null){let p=l&&typeof l==="object"?l.cacheUsage:null;if(!p||typeof p!=="object")return null;let w=p.latest&&typeof p.latest==="object"?p.latest:null;if(!w)return null;let k=typeof w.provider==="string"&&w.provider.trim()?w.provider.trim():null,x=typeof w.model==="string"&&w.model.trim()?w.model.trim():null,E=x?!k||x.startsWith(`${k}/`)?x:`${k}/${x}`:k,R=typeof w.responseModel==="string"&&w.responseModel.trim()?w.responseModel.trim():null,L=ai(h,E),P=Boolean(h&&E&&!L),I=_f(w),N=Ef(I),F=N?`CH${N}`:"CH—",Y=Dt(w.totalTokens),W=yo(w.costTotal,w.costProvenance==="provider_reported"?w.providerCostCurrency??null:"USD"),Q=typeof w.costProvenance==="string"?w.costProvenance:null,J=Q==="provider_reported"?W:Q==="catalogue_estimate"&&W?`~${W}`:null,U=P?"Prev":"Last",te=[Gn("in",w.inputTokens),Gn("out",w.outputTokens),Gn("reason",w.reasoningTokens),Gn("cache-r",w.cacheReadTokens),Gn("cache-w",w.cacheWriteTokens),Gn("total",w.totalTokens)].filter(Boolean).join(", "),H=Q==="provider_reported"&&W?`Provider-reported cost: ${W}`:Q==="catalogue_estimate"&&W?`Catalogue cost estimate: ~${W}`:"Cost unavailable",ce=N?`Prompt cache hit: ${N}`:w.cacheReadReported===!1?"Prompt cache telemetry unavailable":"Prompt cache hit unavailable",xe=[`${P?"Previous":"Latest"} run${E?`: ${E}`:""}`,R&&R!==w.model?`Response model: ${R}`:null,te||null,ce,H].filter(Boolean);return{label:[P?U:null,Y==null?null:vo(Y),F,J].filter(Boolean).join(" • "),title:xe.join(" • "),cacheHitRate:I,costTotal:Dt(w.costTotal),costProvenance:Q,requestedModel:E,responseModel:R,isPreviousModel:P}}function Rf(l){if(!l||typeof l!=="object")return"Price unknown";let h=[["in",l.input_per_million??l.inputPerMillion],["out",l.output_per_million??l.outputPerMillion],["cache-r",l.cache_read_per_million??l.cacheReadPerMillion],["cache-w",l.cache_write_per_million??l.cacheWritePerMillion]].map(([p,w])=>{let k=Dt(w);if(k==null||k<0)return null;return`${p} $${k.toFixed(k>=1?2:4).replace(/0+$/,"").replace(/\.$/,"")}`}).filter(Boolean);return h.length>0?`${h.join(" / ")} per 1M`:"Price unknown"}function bo(l,h){let p=g(h);return D(l,{...me(p)})}function Pf(l){let h=Array.isArray(l?.model_options)&&l.model_options.length>0;return D(l).map((p)=>({label:p.key,provider:p.provider,id:p.id,name:p.displayName===p.key?null:p.displayName,contextWindow:p.contextWindow,pricing:p.pricing,reasoning:h?p.reasoning:null,...p.current?{current:!0}:{}}))}function Lf(l,h){let p=typeof l==="string"?l.trim():"";if(p)return{showPicker:!0,label:p,hasAvailableModels:!0};let w=Pf(h).length>0||Number(h?.available_model_count)>0;return{showPicker:w,label:w?"Select model":"",hasAvailableModels:w}}function wo(l){return(typeof l==="string"?l.trim():"")||null}function So(l){return wo(l)?.toLowerCase()??null}function jc(l,h){let p=So(l),w=So(h);if(!p||!w)return!1;return p===w||p.endsWith(`/${w}`)||w.endsWith(`/${p}`)}function ai(l,h){let p=So(l),w=So(h);if(!p||!w)return!1;return p.includes("/")&&w.includes("/")?p===w:jc(p,w)}function Tf(l,h){let p=h&&typeof h==="object"?h:{},w=wo(p.latest_response_model??p.response_model??p.responseModel??p.routed_model??p.routedModel);if(!w)return null;let k=wo(p.latest_requested_model??p.requested_model??p.requestedModel??p.current??p.model??l);if(k&&jc(w,k))return null;let x=wo(l??p.current??p.model);if(x&&k&&!ai(x,k))return null;return{label:`Routed: ${w}`,title:k?`Requested model: ${k} • Routed model: ${w}`:`Routed model: ${w}`,requestedModel:k,responseModel:w}}function Mf(l){if(!l)return l;let h=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!h.includes(" @ ")||!h.includes(`:
`))return l;let p=h.split(`
`),w=[],k=0,x=!1;while(k<p.length){let R=p[k].trim();if(!R){k+=1;continue}if(R==="Messages:"||R.startsWith("Channel:")||R.startsWith("Chat:")){x=!0,k+=1;continue}if(/^[^\n]+\s@\s[^\n]+:$/.test(R)){x=!0,k+=1;let L=[];while(k<p.length){let P=p[k],I=P.trim();if(/^[^\n]+\s@\s[^\n]+:$/.test(I))break;if(I.startsWith("Channel:")||I.startsWith("Chat:")||I==="Messages:")break;L.push(P.startsWith("  ")?P.slice(2):P),k+=1}if(L.length>0)w.push(L.join(`
`).trim());continue}return l}return x&&w.length>0?w.filter(Boolean).join(`

`):l}function Ic(l){let h=String(l||"").trim(),p=h.match(/^`([^`]+)`$/);return(p?p[1]:h).trim()}function Df(l){if(!l)return{content:l,fileRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let P=0;P<p.length;P+=1)if(p[P].trim()==="Files:"&&p[P+1]&&/^\s*-\s+/.test(p[P+1])){w=P;break}if(w===-1)return{content:l,fileRefs:[]};let k=[],x=w+1;for(;x<p.length;x+=1){let P=p[x];if(/^\s*-\s+/.test(P)){let I=Ic(P.replace(/^\s*-\s+/,"").trim());if(I)k.push(I)}else if(!P.trim())break;else break}if(k.length===0)return{content:l,fileRefs:[]};let E=p.slice(0,w),R=p.slice(x);return{content:[...E,...R].join(`
`).replace(/\n{3,}/g,`

`).trim(),fileRefs:k}}function jf(l){if(!l)return{content:l,folderRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let P=0;P<p.length;P+=1)if(p[P].trim()==="Folders:"&&p[P+1]&&/^\s*-\s+/.test(p[P+1])){w=P;break}if(w===-1)return{content:l,folderRefs:[]};let k=[],x=w+1;for(;x<p.length;x+=1){let P=p[x];if(/^\s*-\s+/.test(P)){let I=Ic(P.replace(/^\s*-\s+/,"").trim());if(I)k.push(I)}else if(!P.trim())break;else break}if(k.length===0)return{content:l,folderRefs:[]};let E=p.slice(0,w),R=p.slice(x);return{content:[...E,...R].join(`
`).replace(/\n{3,}/g,`

`).trim(),folderRefs:k}}function If(l){if(!l)return{content:l,messageRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let P=0;P<p.length;P+=1)if(p[P].trim()==="Referenced messages:"&&p[P+1]&&/^\s*-\s+/.test(p[P+1])){w=P;break}if(w===-1)return{content:l,messageRefs:[]};let k=[],x=w+1;for(;x<p.length;x+=1){let P=p[x];if(/^\s*-\s+/.test(P)){let I=P.replace(/^\s*-\s+/,"").trim().match(/^message:(\S+)$/i);if(I)k.push(I[1])}else if(!P.trim())break;else break}if(k.length===0)return{content:l,messageRefs:[]};let E=p.slice(0,w),R=p.slice(x);return{content:[...E,...R].join(`
`).replace(/\n{3,}/g,`

`).trim(),messageRefs:k}}function Nf(l){if(!l)return{content:l,attachmentRefs:[]};let p=l.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),w=-1;for(let P=0;P<p.length;P+=1)if(p[P].trim()==="Attachments:"&&p[P+1]&&/^\s*-\s+/.test(p[P+1])){w=P;break}if(w===-1)return{content:l,attachmentRefs:[]};let k=[],x=w+1;for(;x<p.length;x+=1){let P=p[x];if(/^\s*-\s+/.test(P)){let I=P.replace(/^\s*-\s+/,"").trim(),N=I.match(/^attachment:(\d+)(?:\s*\((.+)\))?$/i);if(N)k.push({id:N[1],label:(N[2]||"").trim()||`attachment:${N[1]}`,raw:I})}else if(!P.trim())break;else break}if(k.length===0)return{content:l,attachmentRefs:[]};let E=p.slice(0,w),R=p.slice(x);return{content:[...E,...R].join(`
`).replace(/\n{3,}/g,`

`).trim(),attachmentRefs:k}}function Nc(l){let h=Mf(l||""),p=Df(h||""),w=jf(p.content||""),k=If(w.content||""),x=Nf(k.content||"");return{text:x.content||"",fileRefs:p.fileRefs,folderRefs:w.folderRefs,messageRefs:k.messageRefs,attachmentRefs:x.attachmentRefs}}function Ff(l){let h=Nc(l),p=h.attachmentRefs.length>0?`Attachments:
${h.attachmentRefs.map((k)=>`- ${k.raw}`).join(`
`)}`:"";return{content:[String(h.text||"").trim(),p].filter(Boolean).join(`

`).trim(),fileRefs:[...h.fileRefs],folderRefs:[...h.folderRefs],messageRefs:[...h.messageRefs],attachmentRefs:[...h.attachmentRefs]}}async function Bf(l){let{queuedItem:h,buildDraft:p=Ff,onRemoveQueuedFollowup:w,setSubmitError:k,setSubmitNotice:x,setMediaFiles:E,onSetFileRefs:R,onSetFolderRefs:L,onSetMessageRefs:P,setContent:I,textareaRef:N,resizeTextarea:F=()=>{},scheduleRaf:Y=(H)=>requestAnimationFrame(H),isCurrent:W=()=>!0,canRestoreDraft:Q=()=>!0,logger:J=console}=l||{};if(!h||!W()||typeof w!=="function")return!1;let U=p(h?.content||"");try{if(await w(h)!==!0)return!1}catch(H){return J?.warn?.("[compose-box] Failed to remove returned queued follow-up.",H),!1}if(!W())return!1;if(!Q())return x?.("Queued message removed; existing draft preserved."),!1;let te=U.content;return J?.info?.("[compose-box] Returning queued item to editor",{text:te?.slice(0,80),fileRefs:U.fileRefs?.length,folderRefs:U.folderRefs?.length,messageRefs:U.messageRefs?.length}),k?.(null),x?.(null),E?.([]),R?.(U.fileRefs),L?.(U.folderRefs),P?.(U.messageRefs),I?.(te),Y(()=>{let H=N?.current;if(!W()||!H)return;if(H.value=te,typeof H.dispatchEvent==="function")H.dispatchEvent(new Event("input",{bubbles:!0}));F();let ce=te.length;H.selectionStart=ce,H.selectionEnd=ce,H.focus()}),!0}function Of({items:l=[],onInjectQueuedFollowup:h,onRemoveQueuedFollowup:p,onMoveQueuedFollowup:w,onReturnQueuedFollowup:k,onOpenFilePill:x}){let{t:E}=s(),R=r(new Set),[L,P]=t(()=>new Set),I=async(N)=>{let F=N.row_id;if(R.current.has(F)||!h)return;R.current.add(F),P(new Set(R.current));try{await h(N)}finally{R.current.delete(F),P(new Set(R.current))}};if(!Array.isArray(l)||l.length===0)return null;return e`
        <div class="compose-queue-stack">
            ${l.map((N,F)=>{let Y=typeof N?.content==="string"?Ct(N.content):"",W=Nc(Y);if(!W.text.trim()&&W.fileRefs.length===0&&W.folderRefs.length===0&&W.messageRefs.length===0&&W.attachmentRefs.length===0)return null;let Q=N?.mode==="steer",J=L.has(N.row_id),U=!J&&F>0&&l[F-1]?.mode==="steer"===Q,te=!J&&F<l.length-1&&l[F+1]?.mode==="steer"===Q,H=!0;return e`
                    <div class=${`compose-queue-stack-item${Q?" is-steering":""}`} data-testid="queue-item" data-queue-mode=${Q?"steer":"followUp"} role="listitem">
                        <div class="compose-queue-stack-content" title=${Y}>
                            ${Q&&e`<div class="compose-queue-stack-mode">${E("compose.queueSteering")}</div>`}
                            ${W.text.trim()&&e`<div class="compose-queue-stack-text">${W.text}</div>`}
                            ${(W.messageRefs.length>0||W.fileRefs.length>0||W.folderRefs.length>0||W.attachmentRefs.length>0)&&e`
                                <div class="compose-queue-stack-refs">
                                    ${W.messageRefs.map((ce)=>e`
                                        <${S}
                                            key=${"queue-msg-"+ce}
                                            prefix="compose"
                                            label=${"msg:"+ce}
                                            title=${"Message reference: "+ce}
                                            icon="message"
                                        />
                                    `)}
                                    ${W.fileRefs.map((ce)=>{let xe=ce.split("/").pop()||ce;return e`
                                            <${S}
                                                key=${"queue-file-"+ce}
                                                prefix="compose"
                                                label=${xe}
                                                title=${ce}
                                                onClick=${()=>x?.(ce)}
                                            />
                                        `})}
                                    ${W.folderRefs.map((ce)=>{let xe=ce.split("/").pop()||ce;return e`
                                            <${S}
                                                key=${"queue-folder-"+ce}
                                                prefix="compose"
                                                label=${xe}
                                                title=${ce}
                                                icon="folder"
                                                onClick=${()=>x?.(ce)}
                                            />
                                        `})}
                                    ${W.attachmentRefs.map((ce)=>e`
                                        <${S}
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
                                    disabled=${!U}
                                    onClick=${()=>U&&w?.(F,F-1)}
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
                                    disabled=${!te}
                                    onClick=${()=>te&&w?.(F,F+1)}
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
                                    disabled=${J}
                                    onClick=${(ce)=>{ce.stopPropagation(),k?.(N)}}
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
                                aria-busy=${J?"true":void 0}
                                disabled=${J}
                                onClick=${()=>void I(N)}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h12a2 2 0 0 0 2-2V8" />
                                    <polyline points="14 12 18 8 22 12" />
                                </svg>
                                <span>${E(J?"compose.requestingSteer":"compose.steer")}</span>
                            </button>`}
                            <button
                                class="compose-queue-stack-close-btn queue-remove"
                                data-action="remove"
                                type="button"
                                title=${E("compose.cancelQueued")}
                                aria-label=${E("compose.cancelQueued")}
                                disabled=${J}
                                onClick=${()=>p?.(N)}
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
    `}var Mc=Object.freeze([]);function Xe({onPost:l,onFocus:h,searchMode:p,searchScope:w="current",onSearch:k,onSearchScopeChange:x,onEnterSearch:E,onExitSearch:R,fileRefs:L=[],onRemoveFileRef:P,onClearFileRefs:I,folderRefs:N=[],onRemoveFolderRef:F,onClearFolderRefs:Y,messageRefs:W=[],onRemoveMessageRef:Q,onClearMessageRefs:J,activeModel:U=null,agentModelsPayload:te=null,modelUsage:H=null,thinkingLevel:ce=null,supportsThinking:xe=!1,contextUsage:be=null,onContextCompact:He,notificationsEnabled:Kt=!1,notificationPermission:cn="default",onToggleNotifications:Lr,onModelChange:B,onModelStateChange:Ne,activeEditorPath:Wt=null,onAttachEditorFile:jt,onOpenFilePill:qe,followupQueueItems:Fc=[],onInjectQueuedFollowup:Bc,onRemoveQueuedFollowup:$o,onMoveQueuedFollowup:Oc,onSubmitIntercept:Hc,onMessageResponse:ci,isAgentActive:Kn=!1,activeChatAgents:pt=Mc,currentChatJid:se="web:default",connectionStatus:zc="connected",stateAccessFailed:qc=!1,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,onSubmitError:Eo,onSwitchChat:Co,onRenameSession:Ao,isRenameSessionInProgress:li=!1,onCreateSession:Ro,onCreateRootSession:Po,onDeleteSession:ln,onPurgeArchivedSession:Lo,onRestoreSession:To,showQueueStack:Gc=!0,statusNotice:Nt=null,extensionWorkingState:Tr=null,prefillRequest:ui=null,draftValue:Dn=void 0,services:Mo=null,capabilities:Do=null,storageNamespace:Mr="",preferenceRuntime:di=void 0,onContentChange:Kc,onSubmissionStateChange:pi,disabled:jo=!1,onJumpToLatest:Io,timelineAway:Wc=!1,timelineHasNew:fi=!1,inputId:Uc,sendButtonId:Yc}){let[we,ft]=t(()=>typeof Dn==="string"?Dn:""),{t:le}=s(),un=Mo&&typeof Mo==="object"?Mo:{},at=Do&&typeof Do==="object"?Do:{},No=un.sendAgentMessage??T,Fo=un.getAgentModels??re,Vc=un.uploadMedia??Rr,Jc=un.fetchCommands??((m)=>fetch(`/agent/commands?chat_jid=${encodeURIComponent(m)}`).then((_)=>_.ok?_.json():null)),Wn=un.browserStorage&&typeof un.browserStorage==="object"?un.browserStorage:{getItem:f,setItem:c},jn=at.persistBrowserState!==!1,Ke=di===void 0?typeof window<"u"?window:null:di,Ut=Ke,Bo=at.commands!==!1,Oo=at.mentions!==!1,dn=at.media!==!1,Qc=at.search!==!1,Xc=at.location!==!1,Dr=at.speech!==!1,Zc=at.notifications!==!1,el=at.modelPicker!==!1,Ho=at.modelSettings!==!1,mi=at.modelCompaction!==!1,tl=at.sessionRollup!==!1,[pn,gi]=t(""),[zo,nl]=t(!1),[qo,rl]=t(!1),[jr,Go]=t("or"),[fn,mn]=t([]),[Ft,Ko]=t(null),[hi,bi]=t(!1),[ol,sl]=t(null),Yt=r(null);if(!Yt.current)Yt.current=new Vs(sl);o(()=>{let m=Yt.current;return m.reset(),()=>m.reset()},[se]);let[il,Ir]=t(!1),[Bt,tt]=t([]),[Nr,Fr]=t(0),[Un,nt]=t(!1),Wo=r(null),[Vt,ct]=t([]),[Uo,Br]=t(0),[Yn,lt]=t(!1),[Jt,Yo]=t(!1),[We,gn]=t(!1),[$e,Ce]=t(!1),[mt,Or]=t(""),[Vn,yi]=t(()=>q(Ut).pinnedChatJids),[al,Vo]=t(null),[cl,Jo]=t(null),[wi,vi]=t(()=>new Set),Qo=r(new Set),gt=r(se),Xo=r(te),Rt=r(0),Jn=r(0);gt.current=se,Xo.current=te;let[ll,In]=t([]);o(()=>{let m=()=>{let _=g(Ke),C=new Set(_.pinnedKeys);In((M)=>M.map((j)=>({...j,pinned:C.has(j.key),lastUsedAt:_.recentByKey[j.key]??null})))};if(Ke?.addEventListener?.(fe,m),typeof window<"u"&&Ke===window)window.addEventListener("storage",m);return()=>{if(Ke?.removeEventListener?.(fe,m),typeof window<"u"&&Ke===window)window.removeEventListener("storage",m)}},[te,Ke]),o(()=>{let m=()=>{yi(q(Ut).pinnedChatJids)};if(Ut?.addEventListener?.(Te,m),typeof window<"u"&&Ut===window)window.addEventListener("storage",m);return()=>{if(Ut?.removeEventListener?.(Te,m),typeof window<"u"&&Ut===window)window.removeEventListener("storage",m)}},[Ut]),o(()=>{let m=(_)=>{let C=_?.detail;if(C?.source==="compose")return;if(C?.chatJid&&C.chatJid!==se)return;let M=C?.payload;if(!M||typeof M!=="object")return;let j=M.model??M.current;if(In(bo(M,Ke)),Ne?.({...M,model:j??null}),j)B?.(j)};return window.addEventListener("piclaw:model-state-changed",m),()=>window.removeEventListener("piclaw:model-state-changed",m)},[se,Ke,B,Ne]),o(()=>{Rt.current+=1,Jn.current+=1,Yo(!1)},[se]);let[ul,dl]=t(null),Si=r(null),Nn=r([]),Qt=n((m)=>{let _=m?.key??null;Si.current=_,dl(_)},[]),[pl,$i]=t(!1),[ki,xi]=t(!1),[,fl]=t(0),_i=r(se);_i.current=se;let[Ei,ze]=t(null),[Ci,Xt]=t(null),[Be,ml]=t(()=>Dr?ri():{showButton:!1,canStart:!1}),[ht,Pt]=t({kind:"idle",title:"",detail:""}),[gl,Ai]=t(()=>Date.now()),[hl,Ri]=t(0),ae=r(null),Zo=Mr?`${Mr}:${si}`:si,Qn=r(jn?mf(Wn,Zo):null),es=r(null),ts=r(null),Pi=r(null),Xn=r(null),Hr=r(null),Li=r([]),zr=r(null),ns=r(null),Zt=r({value:"",updatedAt:0}),[,bl]=t(0);o(()=>fo(()=>bl((m)=>m+1)),[]);let qr=r(null);qr.current={read:()=>({text:ae.current?.value??we,chatJid:se,selectionStart:ae.current?.selectionStart??we.length,selectionEnd:ae.current?.selectionEnd??we.length}),write:(m)=>{if(ae.current)ae.current.value=m;ft(m)},state:(m)=>Pt({kind:m==="recording"||m==="finishing"?"listening":m==="loading"?"requesting_permission":m==="error"?"error":"idle",title:m==="error"?"Dictation failed; draft preserved":m==="finishing"?"Finishing dictation":"",detail:""})};let Oe=r(null);if(!Oe.current)Oe.current=ic({read:()=>qr.current.read(),write:(m)=>qr.current.write(m),state:(m,_)=>qr.current.state(m,_),providerSelected:()=>{let m=_e.current;if(m)_e.current=null,m.abort?.(),yt()}});o(()=>{Oe.current?.draftChanged()},[we,se]),o(()=>()=>{Oe.current?.dispose()},[]);let _e=r(null),Ti=r(""),en=r(""),tn=r(""),Gr=r(""),Kr=r(!1),Fn=r(!1),rs=r(!1),os=r(!1),ss=r(fn);ss.current=fn;let Wr=r(L),Ur=r(N),Yr=r(W);Wr.current=L,Ur.current=N,Yr.current=W;let Zn=r(0),Vr=r(!1),Mi=200,er=jn?`${Mr?`${Mr}:`:""}${hf(se)}`:"",Di=(m)=>{let _=new Set,C=[];for(let M of m||[]){if(typeof M!=="string")continue;let j=M.trim();if(!j||_.has(j))continue;_.add(j),C.push(j)}return C},ji=(m=er)=>{if(!jn||!m)return[];let _=Wn.getItem?.(m)??null;if(!_)return[];try{let C=JSON.parse(_);if(!Array.isArray(C))return[];return Di(C)}catch{return[]}},yl=(m,_=er)=>{if(!jn||!_)return;Wn.setItem?.(_,JSON.stringify(m))},Jr=r(ji(er)),Bn=r(-1),tr=r(""),Ii=r("");o(()=>{Jr.current=ji(er),Bn.current=-1,tr.current=""},[er]),o(()=>{if(typeof Dn!=="string"||Dn===we)return;ft(Dn),requestAnimationFrame(()=>bt())},[Dn]),o(()=>{Kc?.(we)},[we]),o(()=>{if(!p)return;fetch("/agent/settings-data").then((m)=>m.json()).then((m)=>{if(m?.searchMatchMode)Go(m.searchMatchMode)}).catch(()=>{Go((m)=>m||"or")})},[p]),o(()=>{let m=!1;if(!Bo)return Wo.current=[],()=>{m=!0};return Promise.resolve(Jc(se||"web:default")).then((C)=>{if(m||!C?.commands)return;Wo.current=C.commands.map((M)=>({name:M.name,description:M.description||""}))}).catch((C)=>{console.debug("[compose] failed to fetch dynamic commands",C)}),()=>{m=!0}},[se,Bo]),o(()=>{let m=gf(ui,Ii.current,p);if(!m.shouldApply)return;Ii.current=m.nextToken,ze(null),ft(m.text),ys(m.text),ws(m.text),requestAnimationFrame(()=>{bt();let _=ae.current;if(!_)return;try{_.focus({preventScroll:!0})}catch{_.focus()}let C=m.text.length;_.setSelectionRange?.(C,C)})},[ui,p]),o(()=>{ml(Dr?ri():{showButton:!1,canStart:!1})},[Dr]);let wl=!jo&&(Oe.current?.active||we.trim()||fn.length>0||L.length>0||N.length>0||W.length>0),vl=ht.kind!=="idle",Sl=ht.kind==="requesting_permission"||ht.kind==="listening",Qr=Oe.current?.selected,is=Dr&&!p&&Boolean(Qr||Be?.showButton),Xr=ht.kind==="requesting_permission"||ht.kind==="listening",Ni=Xr?"Stop voice input":Qr?"Voice input":Be?.title||"Voice input",$l=Xc&&typeof window<"u"&&typeof navigator<"u"&&Boolean(navigator.geolocation)&&Boolean(window.isSecureContext),kl=typeof window<"u"&&typeof Notification<"u",xl=typeof window<"u"?Boolean(window.isSecureContext):!1,_l=Zc&&kl&&xl&&cn!=="denied",Fi=cn==="granted"&&Kt,nn=K(Nt),Bi=At(Nt),as=typeof Nt?.detail==="string"&&Nt.detail.trim()?Nt.detail.trim():"",cs=nn?Pe(Nt,gl):null,On=kf(Tr,hl),Ot=Tr?.indicator&&typeof Tr.indicator==="object"?Tr.indicator:null,El=Fi?"Disable notifications":"Enable notifications",Cl=fn.length>0||L.length>0||N.length>0||W.length>0,Zr=$c(qc?zc:"connected"),{label:Al,title:Rl}=Zr,Oi=wf(Kn,wl,nn),eo=hi?{...Oi,disabled:!0,title:Ft?"Uploading attachments…":"Sending…",ariaLabel:Ft?"Uploading attachments":"Sending message"}:Oi,hn=Sf(Kn,nn),Hi=i(()=>(Array.isArray(pt)?pt:Mc).filter((m)=>!m?.archived_at),[pt]),je=(()=>{for(let m of Array.isArray(pt)?pt:[]){let _=typeof m?.chat_jid==="string"?m.chat_jid.trim():"";if(_&&_===se)return m}return null})(),Pl=Boolean(je&&je.chat_jid===(je.root_chat_jid||je.chat_jid)),Ll=Boolean(Pl&&(je?.chat_jid||se)==="web:default"),Ht=(()=>{let m=typeof je?.parent_branch_id==="string"?je.parent_branch_id.trim():"",_=typeof je?.branch_id==="string"?je.branch_id.trim():"";if(!je||!m||!_||je.archived_at)return null;if((Array.isArray(pt)?pt:[]).filter((j)=>{let ne=typeof j?.parent_branch_id==="string"?j.parent_branch_id.trim():"";return ne&&ne===_}).length>0)return null;return(Array.isArray(pt)?pt:[]).find((j)=>{let ne=typeof j?.branch_id==="string"?j.branch_id.trim():"";return ne&&ne===m&&!j?.archived_at})||null})(),nr=i(()=>pe(pt,se,wi),[pt,se,wi]),Tl=i(()=>new Set(Vn),[Vn]),ls=i(()=>De(nr,mt),[nr,mt]),us=i(()=>Le(ls,se,Vn),[ls,se,Vn]),ds=i(()=>us.flatMap((m)=>m.items),[us]);Li.current=nr;let to=nr.length>0,bn=to&&typeof Co==="function",yn=to&&typeof To==="function",no=Boolean(li||Vr.current),wn=!p&&typeof Ao==="function"&&je?.capabilities?.rename!==!1&&!no,vn=!p&&typeof Ro==="function"&&je?.capabilities?.fork!==!1,yr=!p&&typeof Po==="function",wr=tl&&!p&&!Kn&&!ki&&Boolean(Ht?.chat_jid),Sn=!p&&typeof ln==="function"&&je?.capabilities?.archive!==!1&&!Ll,zi=!p&&typeof Lo==="function",xn=!p&&(bn||yn||wn||vn||yr||wr||Sn||zi),qi=el?Lf(U,te):{showPicker:!1,label:"",hasAvailableModels:!1},{showPicker:ro,label:Hn}=qi,ps=xe&&ce?` (${ce})`:"",Gi=ps.trim()?`${ce}`:"",fs=Tf(U,te),Sr=Af(be,U),ms=typeof H?.hint_short==="string"?H.hint_short.trim():"",Ki=D(te).find((m)=>ai(m.key,U)),Wi=Rf(Ki?.pricing),Ml=Cf(H),Ui=[Gi?{key:"thinking",text:Gi}:null,fs?.label?{key:"routed",text:fs.label}:null,ms?{key:"quota",text:ms}:null,Sr?.label?{key:"run",text:Sr.label}:null].filter(Boolean),Dl=Ui.map((m)=>m.text).join(" • "),gs=Hn.indexOf("/"),hs=gs>0?Hn.slice(0,gs+1):"",jl=hs?Hn.slice(gs+1):Hn,Il=[U?`Current model: ${Hn}${ps}`:null,fs?.title||null,H?.plan?`Plan: ${H.plan}`:null,ms||null,H?.availability&&H.availability!=="available"?`Usage telemetry: ${H.availability.replaceAll("_"," ")}`:null,H?.stale?`Usage telemetry stale after ${String(H.refresh_failure||"refresh failure").replaceAll("_"," ")}`:null,Ml,Wi?`Catalogue pricing: ${Wi}`:null,Sr?.title||null,H?.primary?.reset_description||null,H?.secondary?.reset_description||null].filter(Boolean),Yi=Jt?"Switching model…":Il.join(" • ")||(ro?"Select a model (tap to open model picker)":`Current model: ${Hn}${ps} (tap to open model picker)`),Vi=!p&&(ro||Sr||be),[zt,Nl]=t(()=>Ys());o(()=>{if(typeof window>"u")return;let m=()=>Nl(Ys());return window.addEventListener(Us,m),m(),()=>window.removeEventListener(Us,m)},[]);let bs=(m)=>{if(!m||typeof m!=="object")return;let _=m.model??m.current;if(typeof Ne==="function")Ne({...m,model:_??null,thinking_level:m.thinking_level??null,thinking_level_label:m.thinking_level_label??null,supports_thinking:m.supports_thinking,provider_usage:m.provider_usage??null});if(_&&typeof B==="function")B(_);window.dispatchEvent?.(new CustomEvent("piclaw:model-state-changed",{detail:{chatJid:se,payload:m,source:"compose"}}))},Ji=(m,_)=>{let C=ii(_);return m.style.minHeight=`${C}px`,m.style.height=`${C}px`,m.style.overflowY=m.scrollHeight>C?"auto":"hidden",C},bt=(m)=>{let _=m||ae.current;if(!_)return;let C=Qn.current;if(C!=null){Ji(_,C);return}_.style.minHeight="",_.style.height="auto";let M=Math.max(Dc(),Math.min(_.scrollHeight,pf()));_.style.height=`${M}px`,_.style.overflowY=_.scrollHeight>M?"auto":"hidden"},ys=(m)=>{if(!m.startsWith("/")||m.includes(`
`)){nt(!1),tt([]);return}let _=m.toLowerCase().split(" ")[0];if(_.length<1){nt(!1),tt([]);return}let M=(Wo.current||uf).filter((j)=>j.name.startsWith(_)||j.name.replace(/-/g,"").startsWith(_.replace(/-/g,"")));if(M.length>0&&!(M.length===1&&M[0].name===_))lt(!1),ct([]),tt(M),Fr(0),nt(!0);else nt(!1),tt([])},Qi=(m)=>{let _=we,C=_.indexOf(" "),M=C>=0?_.slice(C):"",j=m.name+M;ft(j),nt(!1),tt([]),requestAnimationFrame(()=>{let ne=ae.current;if(!ne)return;let oe=j.length;ne.selectionStart=oe,ne.selectionEnd=oe,ne.focus()})},ws=(m)=>{if(Zs(m,{searchMode:p,showSessionSwitcherButton:xn})){lt(!1),ct([]);return}if(Js(m)==null){lt(!1),ct([]);return}let _=lc(Hi,m,{currentChatJid:se});if(_.length>0&&!(_.length===1&&Qs(_[0].agent_name).trim().toLowerCase()===String(m||"").trim().toLowerCase()))nt(!1),tt([]),ct(_),Br(0),lt(!0);else lt(!1),ct([])},Xi=(m)=>{let _=Qs(m?.agent_name);if(!_)return;ft(_),lt(!1),ct([]),requestAnimationFrame(()=>{let C=ae.current;if(!C)return;let M=_.length;C.selectionStart=M,C.selectionEnd=M,C.focus()})},vs=()=>{if(p||!bn&&!yn&&!wn&&!vn&&!Sn)return!1;return Zt.current={value:"",updatedAt:0},gn(!1),nt(!1),tt([]),lt(!1),ct([]),Or(""),Ce(!0),!0},Fl=(m)=>{if(m?.preventDefault?.(),m?.stopPropagation?.(),p||!bn&&!yn&&!wn&&!vn&&!Sn)return;if($e){Zt.current={value:"",updatedAt:0},Ce(!1);return}vs()},Zi=(m)=>{let _=typeof m==="string"?m.trim():"";if(Ce(!1),!_||_===se){requestAnimationFrame(()=>ae.current?.focus());return}Co?.(_)},ea=async(m)=>{let _=typeof m==="string"?m.trim():"";if(Ce(!1),!_||typeof To!=="function"){requestAnimationFrame(()=>ae.current?.focus());return}try{await To(_)}catch(C){console.warn("Failed to restore session:",C),requestAnimationFrame(()=>ae.current?.focus())}},Ss=n((m)=>{let _=typeof m==="string"?m.trim():"";if(!_||Qo.current.has(_))return!1;return Qo.current.add(_),vi((C)=>{let M=new Set(C instanceof Set?C:[]);return M.add(_),M}),!0},[]),$s=n((m,_)=>{let C=typeof m==="string"?m.trim():"";if(!C)return;if(Qo.current.delete(C),_)return;vi((M)=>{let j=new Set(M instanceof Set?M:[]);return j.delete(C),j})},[]),oo=n(async(m,_={})=>{let C=typeof m?.chat_jid==="string"?m.chat_jid.trim():"";if(!C)return;if(_.canPurgeArchived){if(!Ss(C))return;Vo(null);let M=!1;try{M=await Lo?.(C,{confirmed:!0})!==!1}catch(j){console.warn("Failed to purge archived session:",j)}if($s(C,M),M)Ce(!1);return}if(_.canPrune){if(!Ss(C))return;Jo(null);let M=!1;try{M=await ln(C,{confirmed:!0})!==!1}catch(j){console.warn("Failed to delete session:",j)}if($s(C,M),M)Ce(!1)}},[$s,Ss,ln,Lo]);o(()=>{if(!$e)return;let m=(_)=>{let C=Hr.current;if(!C)return;let j=_.target?.closest?.("button.compose-model-popup-item-delete.confirming[data-chat-jid]");if(!j||!C.contains(j))return;_.preventDefault?.(),_.stopPropagation?.(),_.stopImmediatePropagation?.();let ne=typeof j.dataset?.chatJid==="string"?j.dataset.chatJid.trim():"";if(!ne)return;let oe=Li.current.find((ie)=>ie?.chat_jid===ne)||{chat_jid:ne};oo(oe,{canPurgeArchived:j.dataset?.deleteKind==="purge",canPrune:j.dataset?.deleteKind==="prune"})};return document.addEventListener("pointerdown",m,!0),document.addEventListener("mousedown",m,!0),document.addEventListener("touchstart",m,!0),()=>{document.removeEventListener("pointerdown",m,!0),document.removeEventListener("mousedown",m,!0),document.removeEventListener("touchstart",m,!0)}},[oo,$e]);let ut=i(()=>{let m=[];for(let _ of ds){let C=Boolean(_?.archived_at),M=typeof _?.agent_name==="string"?_.agent_name.trim():"",j=typeof _?.chat_jid==="string"?_.chat_jid.trim():"";if(!M||!j)continue;m.push({type:"session",key:`session:${j}`,label:`@${M} — ${j}${_?.is_active?" active":""}${C?" archived":""}`,chat:_,disabled:C?!yn||_?.capabilities?.restore===!1:!bn||_?.capabilities?.open===!1})}if(!mt&&vn)m.push({type:"action",key:"action:new",label:"New branch",action:"new",disabled:!1});if(!mt&&yr)m.push({type:"action",key:"action:new-root",label:"New root session…",action:"new-root",disabled:!1});if(!mt&&Ht?.chat_jid)m.push({type:"action",key:"action:rollup",label:"Merge current w/ parent",action:"rollup",disabled:!wr});if(!mt&&wn)m.push({type:"action",key:"action:rename",label:"Rename current session",action:"rename",disabled:no});if(!mt&&Sn)m.push({type:"action",key:"action:delete",label:"Delete current session",action:"delete",disabled:!1});return m},[ds,mt,yn,bn,vn,yr,Ht,wr,wn,Sn,no]);Nn.current=ut;let Lt=Math.max(0,ut.findIndex((m)=>m.key===ul)),ks=n((m)=>{let _=xt(m,Ut);yi(_.pinnedChatJids);let C=Nn.current,M=C.filter((ve)=>ve?.type==="session").map((ve)=>ve.chat),j=Le(M,se,_.pinnedChatJids).flatMap((ve)=>ve.items),ne=C.filter((ve)=>ve?.type==="session"),oe=C.filter((ve)=>ve?.type!=="session"),ie=new Map(ne.map((ve)=>[ve.chat.chat_jid,ve])),ye=j.map((ve)=>ie.get(ve.chat_jid)).filter(Boolean);Nn.current=[...ye,...oe];let rt=hc(j,m);if(rt>=0)Qt(ye[rt])},[se,Qt]),ta=async(m)=>{if(m?.preventDefault)m.preventDefault();if(m?.stopPropagation)m.stopPropagation();if(typeof Ao!=="function"||li||Vr.current)return;Vr.current=!0,Ce(!1);try{await Ao()}catch(_){console.warn("Failed to rename session:",_)}finally{Vr.current=!1}requestAnimationFrame(()=>ae.current?.focus())},na=async()=>{if(typeof Ro!=="function")return;Ce(!1);try{await Ro()}catch(m){console.warn("Failed to create session:",m)}requestAnimationFrame(()=>ae.current?.focus())},ra=async()=>{if(typeof Po!=="function")return;Ce(!1);let m=typeof window<"u"?window.prompt("New root session handle (for example: ops)"):"",_=String(m||"").trim();if(!_){requestAnimationFrame(()=>ae.current?.focus());return}try{await Po(_)}catch(C){console.warn("Failed to create root session:",C)}requestAnimationFrame(()=>ae.current?.focus())},oa=async()=>{let m=typeof Ht?.chat_jid==="string"?Ht.chat_jid.trim():"";if(!m||ki||Kn)return;Ce(!1),ze(null),Xt(null),xi(!0);try{let _=await No("default","/rollup",null,[],null,se);ci?.(_),l?.(_);let C=_?.command;if(C?.status==="error"){let j=C?.message||"Failed to merge current session with parent.";ze(j),Eo?.(j);return}let M=typeof C?.rolled_up_to==="string"&&C.rolled_up_to.trim()?C.rolled_up_to.trim():m;Co?.(M)}catch(_){let C=_?.message||"Failed to merge current session with parent.";ze(C),Eo?.(C),console.warn("Failed to merge session with parent:",_)}finally{xi(!1)}requestAnimationFrame(()=>ae.current?.focus())},sa=async()=>{if(typeof ln!=="function")return;Ce(!1);try{await ln(se)}catch(m){console.warn("Failed to delete session:",m)}requestAnimationFrame(()=>ae.current?.focus())},ia=(m,_,C)=>{let M=ae.current;if(!M||!C)return;let j=m,ne=!1,oe=se;C.classList.add("dragging"),document.body.style.cursor="row-resize",document.body.style.userSelect="none";let ie=(Ve)=>{if(Math.abs(Ve-_)>4)ne=!0;j=Ji(M,m+(_-Ve)),Qn.current=j},ye=(Ve)=>{ie(Ve.clientY)},rt=(Ve)=>{let qt=Ve.touches[0];if(!qt)return;Ve.preventDefault(),ie(qt.clientY)},ve=(Ve)=>{if(C.classList.remove("dragging"),document.body.style.cursor="",document.body.style.userSelect="",jn)Wn.setItem?.(Zo,String(Math.round(j)));if(document.removeEventListener("mousemove",ye),document.removeEventListener("mouseup",ve),document.removeEventListener("touchmove",rt),document.removeEventListener("touchend",ve),document.removeEventListener("touchcancel",ve),!ne&&Ve?.type!=="touchcancel"&&M.isConnected&&_i.current===oe)Io?.()};document.addEventListener("mousemove",ye),document.addEventListener("mouseup",ve),document.addEventListener("touchmove",rt,{passive:!1}),document.addEventListener("touchend",ve),document.addEventListener("touchcancel",ve)},Bl=(m)=>{let _=ae.current;if(!_)return;m.preventDefault(),ia(_.getBoundingClientRect().height,m.clientY,m.currentTarget)},Ol=(m)=>{let _=ae.current,C=m.touches?.[0];if(!_||!C)return;m.preventDefault(),ia(_.getBoundingClientRect().height,C.clientY,m.currentTarget)},rn=(m)=>{if(p)gi(m);else{if(ft(m),Bo)ys(m);else nt(!1),tt([]);if(Oo)ws(m);else lt(!1),ct([])}requestAnimationFrame(()=>bt())},Hl=(m)=>{let _=p?pn:we,C=_&&!_.endsWith(`
`)?`
`:"",M=`${_}${C}${m}`.trimStart();rn(M)},xs=n(()=>{requestAnimationFrame(()=>{let m=ae.current;if(!m)return;try{m.focus({preventScroll:!0})}catch{m.focus()}})},[]),yt=n(()=>{Pt({kind:"idle",title:"",detail:""})},[]),_s=n((m=en.current,_=tn.current)=>{if(p)return;rn(_c(Ti.current,m,_))},[p]),Mt=n(()=>{Kr.current=!0;let m=_e.current;if(!m){yt();return}try{m.stop()}catch{_e.current=null,yt()}},[yt]),Es=n(()=>{if(Oe.current?.selected){Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));return}if(ze(null),Xt(null),_e.current){Mt();return}if(!Be?.showButton)return;if(Be.mode==="fallback"){xs(),Pt({kind:"guidance",title:Be.title||"Use keyboard dictation",detail:Be.detail||"Use your keyboard dictation mic for voice input here."});return}if(!Be?.canStart||!Be?.recognitionCtor){Pt({kind:"error",title:Be?.title||"Voice input unavailable",detail:Be?.detail||"This browser does not expose native speech recognition in this context."});return}try{let m=new Be.recognitionCtor;if(_e.current=m,Ti.current=String(we||""),en.current="",tn.current="",Gr.current="",Kr.current=!1,m.lang=typeof navigator<"u"&&navigator.language?navigator.language:"en-US",m.interimResults=!0,m.continuous=!1,"maxAlternatives"in m)m.maxAlternatives=1;m.onstart=()=>{if(_e.current!==m||Oe.current?.selected)return;Pt({kind:"listening",title:"Listening…",detail:"Speak now. Tap the mic again to stop."})},m.onresult=(_)=>{if(_e.current!==m||Oe.current?.selected)return;let{finalText:C,interimText:M}=Ec(_?.results,_?.resultIndex||0);if(C)en.current=`${en.current} ${C}`.trim();tn.current=M,_s(),Pt({kind:"listening",title:"Listening…",detail:M?`Heard: ${M}`:"Speak now. Tap the mic again to stop."})},m.onerror=(_)=>{if(_e.current!==m||Oe.current?.selected)return;let C=String(_?.error||"").trim();if(Gr.current=C,_e.current=null,tn.current="",C==="aborted"){yt();return}Pt({kind:"error",title:"Voice input failed",detail:oi(C,Be)})},m.onend=()=>{if(_e.current!==m||Oe.current?.selected)return;let _=Gr.current,C=Kr.current,M=Boolean(en.current.trim()||tn.current.trim());if(_e.current=null,Kr.current=!1,Gr.current="",tn.current.trim())en.current=`${en.current} ${tn.current}`.trim(),tn.current="";if(M)_s(en.current,"");if(_&&_!=="aborted")return;if(!M&&!C){Pt({kind:"error",title:"No speech detected",detail:oi("no-speech",Be)});return}yt()},Pt({kind:"requesting_permission",title:"Starting voice input…",detail:"Allow microphone access if the browser asks."}),xs(),m.start()}catch(m){_e.current=null,Pt({kind:"error",title:"Voice input failed",detail:m?.message||"Could not start native browser speech recognition."})}},[_s,yt,we,xs,Be,Mt]),aa=async(m,_=null)=>{if(p||Jt)return;let C=se,M=++Rt.current;ze(null),Xt(null),Yo(!0);try{let j=await No("default",m,null,[],null,C);if(M!==Rt.current||C!==gt.current)return!1;if(j?.error||j?.command===!1||j?.command?.status==="error")throw Error(j?.error||j?.command?.message||"Model switch failed.");let ne=null,oe=await ni(Fo,C,(ie)=>{if(M===Rt.current&&C===gt.current)bs(ie)},(ie)=>{if(M!==Rt.current||C!==gt.current)return;ne=D(ie).find((ye)=>ye.current)?.key??O(ie?.current??ie?.model)??null,In(bo(ie,Ke))});if(M!==Rt.current||C!==gt.current)return!1;if(!oe||_&&ne!==_)throw Error("The server did not confirm the model switch.");if(_)Fe(_,new Date().toISOString(),Ke);return Xt(Lc(m,j)),l?.(j),!0}catch(j){return console.error("Failed to switch model:",j),alert("Failed to switch model: "+j.message),!1}finally{if(M===Rt.current)Yo(!1)}},zl=(m)=>{if(m.pointerType==="mouse")return;let _=ae.current?.value??(p?pn:we);if(!Tc({key:" ",code:"Space",ctrlKey:m.ctrlKey,metaKey:m.metaKey,altKey:m.altKey},_,{searchMode:p,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||Be?.canStart&&Be?.recognitionCtor)}))return;m.preventDefault(),Fn.current=!0,rs.current=!0,Es()},Cs=(m)=>{if(!Fn.current)return;if(m?.preventDefault?.(),Fn.current=!1,Oe.current?.selected)Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));else if(_e.current)Mt()},ql=(m)=>{if(rs.current){rs.current=!1,m.preventDefault();return}Es()},Gl=async(m)=>{let _=typeof m==="string"?m.trim():"";if(!_||Jt)return;await aa(`/thinking ${_}`)},Kl=async(m)=>{let _=typeof m==="string"?m:typeof m?.key==="string"?m.key:typeof m?.label==="string"?m.label:"";if(!_||Jt)return;if(await aa(`/model ${_}`,_))gn(!1),requestAnimationFrame(()=>Xn.current?.focus?.())},Wl=(m)=>{if(!m||m.disabled)return;if(m.type==="session"){let _=m.chat;if(_?.archived_at)ea(_.chat_jid);else Zi(_.chat_jid);return}if(m.type==="action"){if(m.action==="new"){na();return}if(m.action==="new-root"){ra();return}if(m.action==="rollup"){oa();return}if(m.action==="rename"){ta();return}if(m.action==="delete")sa()}},so=n(()=>{gn(!1),requestAnimationFrame(()=>Xn.current?.focus?.())},[]),Ul=(m)=>{m.preventDefault(),m.stopPropagation(),Zt.current={value:"",updatedAt:0},Ce(!1),gn((_)=>{if(!_)In(bo(te,Ke));return!_})},ca=async()=>{if(p)return;He?.(),await Rn("/compact",null,{includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,clearAfterSubmit:!1,recordHistory:!1})},Yl=(m)=>{if(m==="queue"||m==="steer"||m==="auto")return m;return Kn?"queue":void 0},Rn=async(m,_,C={})=>{if(!C.dictationFinished&&Oe.current?.active&&!/^\/abort\s*$/i.test(String(m||""))){let st=m==null||m===(ae.current?.value??we);try{await Oe.current.submit(async()=>{await Rn(st?ae.current?.value??we:m,_,{...C,dictationFinished:!0})})}catch{ze("Dictation could not finish. Draft preserved; send again explicitly.")}return}let M=typeof m==="string"?m:we;if(Ho&&/^\/settings\s*$/i.test(M.trim())){ft(""),requestAnimationFrame(()=>bt()),A();return}if(Ho&&/^\/help\s*$/i.test(M.trim())){ft(""),requestAnimationFrame(()=>bt()),A({section:"keyboard"});return}let j=/^\/abort\s*$/i.test(M.trim());if(os.current&&!j)return;let{includeMedia:ne=!0,includeFileRefs:oe=!0,includeFolderRefs:ie=!0,includeMessageRefs:ye=!0,clearAfterSubmit:rt=!0,recordHistory:ve=!0}=C||{},Ve=typeof m==="string"?m:m&&typeof m?.target?.value==="string"?m.target.value:we,qt=typeof Ve==="string"?Ve:"";if(!qt.trim()&&(ne?fn.length===0:!0)&&(oe?L.length===0:!0)&&(ie?N.length===0:!0)&&(ye?W.length===0:!0))return;let xr=!j;if(xr)os.current=!0,bi(!0),pi?.(!0);if(_e.current)Mt();yt(),nt(!1),tt([]),lt(!1),ct([]),Ce(!1),ze(null),Xt(null);let dt=xr?Yt.current.begin(se):null,Er=ne?[...fn]:[],zn=oe?[...L]:[],Pn=ie?[...N]:[],Se=ye?[...W]:[],Ue=qt.trim(),ot=se,da=Rt.current;if(ve&&Ue){let st=Jr.current,ke=Di(st.filter((Gt)=>Gt!==Ue));if(ke.push(Ue),ke.length>Mi)ke.splice(0,ke.length-Mi);Jr.current=ke,yl(ke),Bn.current=-1,tr.current=""}let uu=()=>{let st=(ke,Gt)=>[...new Set([...ke||[],...Gt||[]])];if(ne)mn((ke)=>[...Er.filter((Gt)=>!ke.includes(Gt)),...ke]);if(oe)ko?.(st(zn,Wr.current));if(ie)xo?.(st(Pn,Ur.current));if(ye)_o?.(st(Se,Yr.current));ft((ke)=>{if(!Ue)return ke;if(!ke.trim())return Ue;if(ke.trim()===Ue)return ke;return`${Ue}

${ke}`}),requestAnimationFrame(()=>bt())};if(rt)ft(""),mn([]),I?.(),Y?.(),J?.();(async()=>{try{let st=await Hc?.({content:Ue,submitMode:_,fileRefs:zn,folderRefs:Pn,messageRefs:Se,mediaFiles:Er});if(st){l?.(st);return}let ke=await it(dn?Er:[],(Ae,vt)=>Vc(Ae,{onProgress:vt}),{onProgress:Ko}),Gt=ke.filter(({result:Ae})=>Ae.id).map(({name:Ae,result:vt})=>({name:Ae,id:vt.id})),du=ke.filter(({result:Ae})=>Ae.storage==="workspace").map(({result:Ae})=>Ae.path),pu=Gt.map(({id:Ae})=>Ae),pa=[...zn,...du],fu=pa.length?`Files:
${pa.map((Ae)=>`- ${Ae}`).join(`
`)}`:"",mu=Pn.length?`Folders:
${Pn.map((Ae)=>`- ${Ae}`).join(`
`)}`:"",gu=Se.length?`Referenced messages:
${Se.map((Ae)=>`- message:${Ae}`).join(`
`)}`:"",hu=Gt.length?`Attachments:
${Gt.map(({id:Ae,name:vt},io)=>{let Rs=vt||`attachment-${io+1}`;return`- attachment:${Ae} (${Rs})`}).join(`
`)}`:"",bu=[Ue,fu,mu,gu,hu].filter(Boolean).join(`

`);Ko(null);let on=await No("default",bu,null,pu,Yl(_),ot);$r(on);let fa=_r(on);if(fa&&gt.current===ot)ze(fa);if(ci?.(on),dt!==null)if(on?.command?.status==="error")Yt.current.failed(dt);else Yt.current.acknowledged(dt);if(on?.command&&on.command.status!=="error"){let Ae=/^\/(?:model\s+\S+|cycle-model)\s*$/i.test(Ue.trim());await ni(Fo,ot,(vt)=>{if(da===Rt.current&&ot===gt.current)bs(vt)},(vt)=>{if(da!==Rt.current||ot!==gt.current)return;let io=D(vt).find((Rs)=>Rs.current)?.key??O(vt?.current??vt?.model)??null;if(Ae&&io)Fe(io,new Date().toISOString(),Ke)})}Xt(Lc(Ue,on)),l?.(on)}catch(st){if(rt)uu();let ke=st?.message||"Failed to send message.";if(dt!==null)Yt.current.failed(dt);ze(ke),Eo?.(ke),console.error("Failed to post:",st)}finally{if(xr){if(dt!==null)Yt.current.finished(dt);Ko(null),bi(!1),os.current=!1,pi?.(!1)}}})()},Vl=(m)=>Bc?.(m),Jl=n((m)=>{let _=se,C=ae.current,M=C?.value??we,j=Wr.current,ne=Ur.current,oe=Yr.current,ie=ss.current;return Bf({queuedItem:m,onRemoveQueuedFollowup:$o,isCurrent:()=>gt.current===_&&ae.current===C,canRestoreDraft:()=>(ae.current?.value??we)===M&&Wr.current===j&&Ur.current===ne&&Yr.current===oe&&ss.current===ie,setSubmitError:ze,setSubmitNotice:Xt,setMediaFiles:mn,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,setContent:ft,textareaRef:ae,resizeTextarea:bt})},[se,we,$o,ko,xo,_o,bt]),kr=n((m)=>{if(p||!We&&!$e||m?.isComposing)return!1;let _=()=>{m.preventDefault?.(),m.stopPropagation?.()},C=()=>{Zt.current={value:"",updatedAt:0}};if(We&&m.target?.closest?.("[data-compose-model-catalogue]"))return!1;if(m.key==="Escape"){if(_(),C(),We)so();if($e)Ce(!1),Or(""),requestAnimationFrame(()=>zr.current?.querySelector?.("button")?.focus?.());return!0}if(We)return!1;if($e){let M=Nn.current,j=Math.max(0,M.findIndex((oe)=>oe.key===Si.current)),ne=Boolean(m.target?.classList?.contains?.("compose-session-search"));if(["ArrowDown","ArrowUp","Home","End","PageDown","PageUp"].includes(m.key)){if(_(),C(),M.length>0){let oe=bc(j,M.length,m.key);Qt(M[oe])}return!0}if(m.key==="Enter"&&m.altKey&&M.length>0){_(),C();let oe=M[j];if(oe?.type==="session"&&!oe.chat?.archived_at)ks(oe.chat.chat_jid);return!0}if((m.key==="Enter"||m.key==="Tab")&&M.length>0)return _(),C(),Wl(M[j]),!0;if(!ne&&_t(m)&&M.length>0){_();let oe=ac(Zt.current,m.key);Zt.current=oe;let ie=cc(M,oe.value,j,(ye)=>ye.label);if(ie>=0)Qt(M[ie]);return!0}}return!1},[p,We,$e,Qt,so,ks]),Ql=(m)=>{if(m.isComposing||m.defaultPrevented)return;if(m.key==="Enter"&&(m.ctrlKey||m.metaKey)&&!m.shiftKey&&!m.altKey&&!p){let C=Cr(m);if(m.preventDefault(),C)Rn(ae.current?.value??we,"steer");return}if(p&&m.key==="Escape"){m.preventDefault(),gi(""),R?.();return}if(kr(m))return;let _=ae.current?.value??(p?pn:we);if(Tc(m,_,{searchMode:p,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||Be?.canStart&&Be?.recognitionCtor)})){m.preventDefault(),Fn.current=!0,Es();return}if(wc(m,_,{searchMode:p,showSessionSwitcherButton:xn})){m.preventDefault(),vs();return}if(Yn&&Vt.length>0){let C=ae.current?.value??(p?pn:we);if(!String(C||"").match(/^@([a-zA-Z0-9_-]*)$/))lt(!1),ct([]);else{if(m.key==="ArrowDown"){m.preventDefault(),Br((M)=>(M+1)%Vt.length);return}if(m.key==="ArrowUp"){m.preventDefault(),Br((M)=>(M-1+Vt.length)%Vt.length);return}if(m.key==="Tab"||m.key==="Enter"){m.preventDefault(),Xi(Vt[Uo]);return}if(m.key==="Escape"){m.preventDefault(),lt(!1),ct([]);return}}}if(Un&&Bt.length>0){let C=ae.current?.value??(p?pn:we);if(!String(C||"").startsWith("/"))nt(!1),tt([]);else{if(m.key==="ArrowDown"){m.preventDefault(),Fr((M)=>(M+1)%Bt.length);return}if(m.key==="ArrowUp"){m.preventDefault(),Fr((M)=>(M-1+Bt.length)%Bt.length);return}if(m.key==="Tab"){m.preventDefault(),Qi(Bt[Nr]);return}if(m.key==="Enter"&&!m.shiftKey){if(!_.includes(" ")){m.preventDefault();let j=Bt[Nr];nt(!1),tt([]),Rn(j.name);return}}if(m.key==="Escape"){m.preventDefault(),nt(!1),tt([]);return}}}if(!p&&(m.key==="ArrowUp"||m.key==="ArrowDown")&&!m.metaKey&&!m.ctrlKey&&!m.altKey&&!m.shiftKey){let C=ae.current;if(!C)return;let M=C.value||"",j=C.selectionStart===0&&C.selectionEnd===0,ne=C.selectionStart===M.length&&C.selectionEnd===M.length;if(m.key==="ArrowUp"&&j||m.key==="ArrowDown"&&ne){let oe=Jr.current;if(!oe.length)return;m.preventDefault();let ie=Bn.current;if(m.key==="ArrowUp"){if(ie===-1)tr.current=M,ie=oe.length-1;else if(ie>0)ie-=1;Bn.current=ie,rn(oe[ie]||"")}else{if(ie===-1)return;if(ie<oe.length-1)ie+=1,Bn.current=ie,rn(oe[ie]||"");else Bn.current=-1,rn(tr.current||""),tr.current=""}requestAnimationFrame(()=>{let ye=ae.current;if(!ye)return;let rt=ye.value.length;ye.selectionStart=rt,ye.selectionEnd=rt});return}}if(m.key==="Enter"&&!m.shiftKey&&(m.ctrlKey||m.metaKey)){if(m.preventDefault(),p){if(_.trim())k?.(_.trim(),w,{images:zo,attachments:qo})}return}if(m.key==="Enter"&&!m.shiftKey&&!m.ctrlKey&&!m.metaKey&&!m.altKey&&!m.repeat){if(m.preventDefault(),p){if(_.trim())k?.(_.trim(),w,{images:zo,attachments:qo})}else Rn(_);return}if(m.key==="Escape"){if(We||$e||Un||Yn)return;m.preventDefault(),ae.current?.blur()}},Xl=(m)=>{if(vf(m,Fn.current)){if(m.preventDefault(),Fn.current=!1,Oe.current?.selected)Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));else if(_e.current)Mt()}},As=(m)=>{if(!dn)return;let _=Array.from(m||[]).filter((C)=>C instanceof File&&!String(C.name||"").startsWith(".DS_Store"));if(!_.length)return;mn((C)=>[...C,..._]),ze(null)};o(()=>{let m=async(_)=>{let C=_?.detail?.mediaId;if(!C)return;try{let{getMediaBlob:M}=await (u("3gw65wv7"),import("./api-3gw65wv7.js")),j=await M(C),ne=new File([j],`annotated-${C}.png`,{type:j.type||"image/png"});mn((oe)=>[...oe,ne]),ae.current?.focus()}catch(M){console.warn("[compose-box] Failed to attach annotated image:",M)}};return window.addEventListener("piclaw:compose-media-attach",m),()=>window.removeEventListener("piclaw:compose-media-attach",m)},[]);let Zl=(m)=>{As(m.target.files),m.target.value=""},eu=(m)=>{if(p||!dn)return;m.preventDefault(),m.stopPropagation(),Zn.current+=1,Ir(!0)},tu=(m)=>{if(p)return;if(m.preventDefault(),m.stopPropagation(),Zn.current=Math.max(0,Zn.current-1),Zn.current===0)Ir(!1)},nu=(m)=>{if(p||!dn)return;if(m.preventDefault(),m.stopPropagation(),m.dataTransfer)m.dataTransfer.dropEffect="copy";Ir(!0)},ru=(m)=>{if(p||!dn)return;m.preventDefault(),m.stopPropagation(),Zn.current=0,Ir(!1),As(m.dataTransfer?.files||[])},ou=(m)=>{if(p||!dn)return;let _=m.clipboardData?.items;if(!_||!_.length)return;let C=[];for(let M of _){if(M.kind!=="file")continue;let j=M.getAsFile?.();if(j)C.push(j)}if(C.length>0)m.preventDefault(),As(C)},su=(m)=>{mn((_)=>_.filter((C,M)=>M!==m))},iu=()=>{ze(null),mn([]),I?.(),Y?.(),J?.()},au=()=>{if(!navigator.geolocation){alert("Geolocation is not available in this browser.");return}navigator.geolocation.getCurrentPosition((m)=>{let{latitude:_,longitude:C,accuracy:M}=m.coords,j=`${_.toFixed(5)}, ${C.toFixed(5)}`,ne=Number.isFinite(M)?` ±${Math.round(M)}m`:"",oe=`https://maps.google.com/?q=${_},${C}`,ie=`Location: ${j}${ne} ${oe}`;Hl(ie)},(m)=>{let _=m?.message||"Unable to retrieve location.";alert(`Location error: ${_}`)},{enableHighAccuracy:!0,timeout:1e4,maximumAge:0})};o(()=>{if(!We)return;let m=se,_=++Jn.current,C=Xo.current;Zt.current={value:"",updatedAt:0},$i(!0),Promise.resolve(Fo(m)).then((M)=>{if(_!==Jn.current||m!==gt.current)return;if(Xo.current!==C)return;In(bo(M,Ke)),bs(M)}).catch((M)=>{if(_!==Jn.current||m!==gt.current)return;console.warn("Failed to load model list:",M),In([])}).finally(()=>{if(_===Jn.current)$i(!1)})},[We,se]),o(()=>{if(p)gn(!1),Ce(!1),nt(!1),tt([]),lt(!1),ct([])},[p]),o(()=>{if($e&&!xn)Ce(!1)},[$e,xn]),o(()=>{if(!$e)Vo(null),Jo(null),Or("")},[$e]),o(()=>{if(!$e)return;let m=yf(ut,se);Qt(ut[m]),Zt.current={value:"",updatedAt:0}},[$e,se,Qt]),o(()=>{if(!We)return;let m=(_)=>{let C=Pi.current,M=Xn.current,j=_.target;if(C&&C.contains(j))return;if(M&&M.contains(j))return;gn(!1)};return document.addEventListener("pointerdown",m),()=>document.removeEventListener("pointerdown",m)},[We]),o(()=>{if(!$e)return;let m=(_)=>{let C=Hr.current,M=zr.current,j=_.target;if(C&&C.contains(j))return;if(M&&M.contains(j))return;Ce(!1)};return document.addEventListener("pointerdown",m),()=>document.removeEventListener("pointerdown",m)},[$e]),o(()=>{if(p||!We&&!$e)return;let m=(_)=>{kr(_)};return document.addEventListener("keydown",m,!0),()=>document.removeEventListener("keydown",m,!0)},[p,We,$e,kr]),o(()=>{if(!$e)return;let m=Hr.current,_=m?.querySelector?.(".compose-session-search");if(document.activeElement!==_)_?.focus?.();m?.querySelector?.(".compose-model-popup-item.active")?.scrollIntoView?.({block:"nearest"})},[$e,Lt,ut.length]),o(()=>{if(!Yn||!ts.current)return;ts.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Yn,Uo,Vt.length]),o(()=>{if(!Un||!es.current)return;es.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Un,Nr,Bt.length]),o(()=>{let m=(C)=>{if(!C||typeof C!=="object")return!1;if(C.isContentEditable)return!0;if(typeof C.closest!=="function")return!1;return Boolean(C.closest('input, textarea, select, [contenteditable="true"], .compose-box, .compose-model-popup, .compose-session-popup, .settings-dialog, .workspace-sidebar, .editor-pane-container, .dock-panel, .timeline-menu-dropdown, .rename-branch-overlay, .agent-request-modal, .attachment-preview-modal, .vnc-pane-shell, .kanban-plugin, .timeline-quick-actions'))},_=(C)=>{if(C.defaultPrevented||C.ctrlKey||C.metaKey||C.altKey)return;let M=ae.current;if(!M)return;let j=document.activeElement===M;if(C.key==="Escape"&&!j&&!m(C.target)){C.preventDefault(),M.focus();return}if(C.key==="/"&&!j&&!m(C.target))C.preventDefault(),rn("/"),requestAnimationFrame(()=>{M.focus(),M.selectionStart=1,M.selectionEnd=1,ys("/")})};return window.addEventListener("keydown",_),()=>window.removeEventListener("keydown",_)},[]),o(()=>{let m=()=>{let ne=ns.current?.clientWidth||0;fl((oe)=>oe===ne?oe:ne)};m();let _=ns.current,C=0,M=()=>{if(C)cancelAnimationFrame(C);C=requestAnimationFrame(()=>{C=0,m()})},j=null;if(_&&typeof ResizeObserver<"u")j=new ResizeObserver(()=>M()),j.observe(_);if(typeof window<"u")window.addEventListener("resize",M);return()=>{if(C)cancelAnimationFrame(C);if(j?.disconnect?.(),typeof window<"u")window.removeEventListener("resize",M)}},[p,U,je?.agent_name,xn,be?.percent]);let cu=(m)=>{let _=m.target.value;if(_e.current&&m?.isTrusted)Mt();if(ze(null),Xt(null),ht.kind==="guidance"||ht.kind==="error")yt();if($e)Ce(!1);if(bt(m.target),Zs(_,{searchMode:p,showSessionSwitcherButton:xn})){rn(""),requestAnimationFrame(()=>{let C=ae.current;if(!C)return;C.value="",C.selectionStart=0,C.selectionEnd=0,C.focus()}),vs();return}rn(_)};o(()=>{requestAnimationFrame(()=>bt())},[we,pn,p]),o(()=>{if(typeof window>"u")return;let m=()=>{if(Qn.current!=null){let _=ii(Qn.current);if(Qn.current=_,jn)Wn.setItem?.(Zo,String(_))}requestAnimationFrame(()=>bt())};return window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[]),o(()=>{if(!p)return;if(Oe.current?.cancel(),_e.current)Mt();return},[p,Mt]),o(()=>{if(_e.current)Mt();yt()},[se,yt,Mt]),o(()=>()=>{if(!_e.current)return;try{_e.current.stop()}catch(m){console.debug("[compose] failed to stop speech recognition during cleanup",m)}_e.current=null},[]),o(()=>{if(!nn)return;Ai(Date.now());let m=setInterval(()=>Ai(Date.now()),1000);return()=>clearInterval(m)},[nn,Nt?.started_at,Nt?.startedAt]),o(()=>{if(Ri(0),Ot?.mode!=="custom"||!Array.isArray(Ot.frames)||Ot.frames.length<=1)return;let m=typeof Ot.intervalMs==="number"&&Number.isFinite(Ot.intervalMs)&&Ot.intervalMs>0?Ot.intervalMs:120,_=setInterval(()=>{Ri((C)=>(C+1)%Ot.frames.length)},m);return()=>clearInterval(_)},[Ot]),o(()=>{if(p||!Oo)return;ws(we)},[Oo,Hi,se,we,p]);let la=Vi?e`
                    <div class="compose-meta-row">
                        ${(ro||Sr)&&e`
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
                        ${!p&&be&&e`
                            <${xf}
                                usage=${be}
                                onCompact=${mi?ca:void 0}
                                compactionLabel=${nn?cs||"0:00":""}
                                compactionTitle=${nn?Bi||"Smart compaction":""}
                            />
                        `}
                    </div>
    `:null;a(()=>{if(!zt)return;d(la,zt)});let[lu,ua]=t(null);return a(()=>{if(!We||!zt){ua(null);return}let m=()=>{let _=Xn.current?.getBoundingClientRect?.(),C=zt.closest?.(".workbench-statusbar")?.getBoundingClientRect?.();if(!_||!C)return;ua({left:Math.round(_.left),bottom:Math.round(window.innerHeight-C.top+6)})};return m(),window.addEventListener("resize",m),()=>window.removeEventListener("resize",m)},[We,zt]),o(()=>()=>{if(zt)d(null,zt)},[zt]),e`
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
                ${xn&&e`
                    <div
                        ref=${zr}
                        class="compose-session-trigger-group compose-session-trigger-top"
                    >
                        <button
                            type="button"
                            class=${`compose-session-trigger compose-session-trigger-pill${$e?" active":""}`}
                            data-testid="session-switcher"
                            onClick=${Fl}
                            title=${je?.chat_jid||se}
                            aria-label=${je?.agent_name?`Manage sessions for @${je.agent_name}`:"Manage Sessions/Agents"}
                            aria-expanded=${$e?"true":"false"}
                        >
                            <span class="compose-current-agent-label active">${je?.agent_name?`@${je.agent_name}`:"Sessions"}</span>
                        </button>
                    </div>
                `}
                <div class="compose-input-main">
                    ${Cl&&e`
                        <div class="compose-file-refs">
                            ${W.map((m)=>e`
                                    <${S}
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
                                    <${S}
                                        prefix="compose"
                                        label=${_}
                                        title=${m}
                                        onClick=${()=>qe?.(m)}
                                        removeTitle="Remove file"
                                        onRemove=${()=>P?.(m)}
                                    />
                                `})}
                            ${N.map((m)=>{let _=m.split("/").pop()||m;return e`
                                    <${S}
                                        prefix="compose"
                                        label=${_}
                                        title=${m}
                                        icon="folder"
                                        onClick=${()=>qe?.(m)}
                                        removeTitle="Remove folder hint"
                                        onRemove=${()=>F?.(m)}
                                    />
                                `})}
                            ${fn.map((m,_)=>{let C=m?.name||`attachment-${_+1}`;return e`
                                    <${S}
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
                        placeholder=${p?le("compose.searchPlaceholder"):le("compose.placeholder")}
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
                                    onMouseDown=${(C)=>{C.preventDefault(),Xi(m)}}
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
                                    onMouseDown=${(C)=>{C.preventDefault(),Qi(m)}}
                                    onMouseEnter=${()=>Fr(_)}
                                >
                                    <span class="slash-name">${m.name}</span>
                                    <span class="slash-desc">${m.description}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${We&&!p&&e`
                        <${xc}
                            anchor=${lu}
                            entries=${ll}
                            loading=${pl}
                            switching=${Jt}
                            onSelect=${(m)=>{Kl(m)}}
                            onTogglePin=${(m)=>et(m.key,Ke)}
                            onClose=${so}
                            onCompact=${mi?()=>{so(),ca()}:void 0}
                            onOpenSettings=${Ho?()=>{gn(!1),A({section:"models"})}:void 0}
                            thinkingLevel=${ce}
                            thinkingLevels=${Ki?.thinkingLevels??[]}
                            onSelectThinking=${(m)=>{Gl(m)}}
                            rootRef=${Pi}
                        />
                    `}
                    ${$e&&!p&&e`
                        <div class="compose-model-popup compose-session-popup" data-testid="session-popup" ref=${Hr} tabIndex="-1" onKeyDown=${kr}>
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
                                onInput=${(m)=>{let _=m.currentTarget.value,C=Le(De(nr,_),se,Vn).flatMap((j)=>j.items);Nn.current=C.map((j)=>({type:"session",key:`session:${j.chat_jid}`,label:`@${j.agent_name} — ${j.chat_jid}${j.is_active?" active":""}${j.archived_at?" archived":""}`,chat:j,disabled:j.archived_at?!yn||j?.capabilities?.restore===!1:!bn||j?.capabilities?.open===!1}));let M=gc(C,_);Qt(Nn.current[M]),Or(_)}}
                                onKeyDown=${kr}
                            />
                            <div
                                class="compose-model-popup-menu compose-session-popup-results"
                                role="listbox"
                                aria-label=${le("compose.sessionsAndAgents")}
                                aria-activedescendant=${ut[Lt]?.type==="session"?`compose-session-option-${encodeURIComponent(ut[Lt].chat.chat_jid)}`:void 0}
                            >
                                ${!to&&e`
                                    <div class="compose-model-popup-empty">${le("compose.noSessions")}</div>
                                `}
                                ${to&&ls.length===0&&e`
                                    <div class="compose-model-popup-empty">No sessions match “${mt}”.</div>
                                `}
                                ${ds.map((m,_)=>{let C=us.find((Se)=>Se.items.includes(m)),M=C?.items[0]===m,j=Boolean(m.archived_at),ne=!j&&Tl.has(m.chat_jid),oe=m.chat_jid===(m.root_chat_jid||m.chat_jid),ie=!oe&&!m.is_active&&!j&&typeof ln==="function"&&m?.capabilities?.archive!==!1,ye=j&&zi,rt=ye&&al===m.chat_jid,ve=ie&&cl===m.chat_jid,Ve=rt||ve,qt=Et(m,{currentChatJid:se}),xr=X(m.agent_name),dt=Ye(m,{currentChatJid:se}),Er=m.root_chat_jid||m.chat_jid,zn=m.model||m.model_label||"",Pn=fc(m);return e`
                                        ${M&&e`<div class="compose-session-section-heading" role="presentation">${C.label}</div>`}
                                        <div key=${m.chat_jid} class=${`compose-model-popup-item-row${j?" archived":""}`}>
                                            ${j?e`<span class="compose-session-row-pin-spacer" aria-hidden="true"></span>`:e`<button
                                                    type="button"
                                                    class=${`compose-session-row-pin${ne?" pinned":""}`}
                                                    title=${ne?`Unpin @${m.agent_name}`:`Pin @${m.agent_name}`}
                                                    aria-label=${ne?`Unpin @${m.agent_name}`:`Pin @${m.agent_name}`}
                                                    aria-pressed=${ne?"true":"false"}
                                                    aria-keyshortcuts="Alt+Enter"
                                                    onClick=${(Se)=>{Se.preventDefault(),Se.stopPropagation(),ks(m.chat_jid)}}
                                                >${ne?"★":"☆"}</button>`}
                                            <button
                                                id=${`compose-session-option-${encodeURIComponent(m.chat_jid)}`}
                                                type="button"
                                                role="option"
                                                aria-selected=${Lt===_?"true":"false"}
                                                aria-label=${`${qt}; chat ${m.chat_jid}; root ${Er}; ${zn?`model ${zn}; `:""}${dt.join(", ")||"idle"}`}
                                                class=${`compose-model-popup-item session-item${j?" archived":""}${Lt===_?" active":""}`}
                                                data-testid="session-item"
                                                onClick=${()=>{if(j){ea(m.chat_jid);return}Zi(m.chat_jid)}}
                                                disabled=${j?!yn||m?.capabilities?.restore===!1:!bn||m?.capabilities?.open===!1}
                                                title=${j?`Restore archived ${qt}`:`Switch to ${qt}`}
                                            >
                                                <span class="compose-session-row-content" style=${bf(m)?"font-weight:700":""}>
                                                    <span class="compose-session-row-main">
                                                        <span class="compose-session-row-label">${xr}</span>
                                                        <span class="compose-session-row-meta">
                                                            <span class="compose-session-row-jid">${m.chat_jid}</span>
                                                            ${Pn&&e`<span class="compose-session-row-metrics"> · ${Pn}</span>`}
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
                                                onClick=${(Se)=>{Se.stopPropagation(),Ce(!1);let Ue=new URL(window.location.href);Ue.searchParams.set("chat_jid",m.chat_jid),Ue.searchParams.set("chat_only","1");let ot=document.createElement("a");ot.href=Ue.toString(),ot.target="_blank",ot.rel="noopener",ot.style.display="none",document.body.appendChild(ot),ot.click(),ot.remove()}}
                                            >
                                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M6 2h8v8"/>
                                                    <path d="M14 2 7 9"/>
                                                    <path d="M12 9v5H2V4h5"/>
                                                </svg>
                                            </button>
                                            ${(ie||ye)&&e`
                                                ${Ve?e`<button
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
                                                        onClick=${(Se)=>{if(Se.stopPropagation(),ye){Vo(m.chat_jid);return}if(ie){Jo(m.chat_jid);return}Ce(!1),ln(m.chat_jid)}}
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
                            ${!mt&&(vn||yr||wn||Sn)&&e`
                                <div class="compose-model-popup-actions">
                                    ${vn&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn primary${ut.findIndex((m)=>m.key==="action:new")===Lt?" active":""}`}
                                            onClick=${()=>{na()}}
                                            title=${le("compose.newBranchTitle")}
                                        >
                                            ${le("compose.newBranch")}
                                        </button>
                                    `}
                                    ${yr&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:new-root")===Lt?" active":""}`}
                                            onClick=${()=>{ra()}}
                                            title=${le("compose.newRootTitle")}
                                        >
                                            ${le("compose.newRoot")}
                                        </button>
                                    `}
                                    ${Ht?.chat_jid&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:rollup")===Lt?" active":""}`}
                                            onClick=${()=>{oa()}}
                                            title=${wr?le("compose.mergeInto",{target:Ht.agent_name?`@${Ht.agent_name}`:Ht.chat_jid}):le("compose.mergeBlocked")}
                                            disabled=${!wr}
                                        >
                                            ${le("compose.mergeCurrent")}
                                        </button>
                                    `}
                                    ${wn&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((m)=>m.key==="action:rename")===Lt?" active":""}`}
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
                                            class=${`compose-model-popup-btn danger${ut.findIndex((m)=>m.key==="action:delete")===Lt?" active":""}`}
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
                    <div class="compose-actions ${p?"search-mode":""}">
                    ${p&&e`
                        <label class="compose-search-scope-wrap" title=${le("compose.searchScope")}>
                            <span class="compose-search-scope-label">${le("compose.scope")}</span>
                            <select
                                class="compose-search-scope-select"
                                value=${w}
                                onChange=${(m)=>x?.(m.currentTarget.value)}
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
                        onClick=${p?R:E}
                        title=${p?le("compose.closeSearch"):le("compose.search")}
                        disabled=${p?typeof R!=="function":typeof E!=="function"}
                    >
                        ${p?e`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`:e`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`}
                    </button>
                    `}
                    ${$l&&!p&&e`
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
                        ${Wt&&jt&&e`
                            <button
                                class="icon-btn attach-editor-btn"
                                onClick=${jt}
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
                    ${!p&&e`
                        <div class="compose-send-stack">
                                <button
                                    class=${eo.className}
                                    id=${Yc}
                                    data-testid="send-button"
                                    type="button"
                                    onClick=${()=>{Rn()}}
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
                                        onClick=${()=>{if($f(hn.mode))Rn("/abort","steer",{clearAfterSubmit:!1,includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,recordHistory:!1})}}
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
export{Te,q,wt,xt,St,kt,Ee,rr,Je,kn,or,Ie,y,z,V,Re,ue,K,At,Pe,ir,b,Me,sr,An,Cn,_n,$n,v,Tn,ar,cr,de,lr,ur,Ct,En,_t,dr,Z,pr,Qe,fr,$t,mr,De,Le,X,Tt,Ye,Et,gr,It,Ze,hr,S,pe,Xe};

//# debugId=B676F17C0C24963C64756E2164756E21
//# sourceMappingURL=app-8qgvxesa.js.map
