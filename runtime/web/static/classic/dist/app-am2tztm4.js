import{f,t,o,u,r,i,n,e}from"./app-c7xgjke0.js";import{vr,wr,xr,tt,Cr,P,ie}from"./app-p5k2h1w4.js";import{ge,j,v,he,et,Fe,B,re,ye,mr,gr}from"./app-vf1bgthg.js";import{p}from"./app-8f7dkwd2.js";import{g,l,T,s}from"./app-dr786pqe.js";var Te="piclaw:session-picker-preferences-changed";function Ps(){return{pinnedChatJids:[]}}function ma(a){return typeof a==="string"?a.trim():""}function ga(a){if(!a||typeof a!=="object")return Ps();let m=a;return{pinnedChatJids:Array.from(new Set((Array.isArray(m.pinnedChatJids)?m.pinnedChatJids:[]).map(ma).filter(Boolean)))}}function ha(a){try{return a?.localStorage??null}catch{return null}}function V(a=typeof window<"u"?window:null){try{let m=ha(a)?.getItem("piclaw:session-picker-preferences:v1");return m?ga(JSON.parse(m)):Ps()}catch{return Ps()}}function wt(a,m=typeof window<"u"?window:null){let c=ga(a);try{ha(m)?.setItem("piclaw:session-picker-preferences:v1",JSON.stringify(c))}catch(h){console.debug("[session-picker-preferences] Storage unavailable; keeping the in-memory preference result.",h)}try{m?.dispatchEvent?.(new CustomEvent("piclaw:session-picker-preferences-changed",{detail:c}))}catch(h){console.debug("[session-picker-preferences] Preference event delivery unavailable.",h)}return c}function xt(a,m=typeof window<"u"?window:null){let c=ma(a),h=V(m);if(!c)return h;let b=new Set(h.pinnedChatJids);if(b.has(c))b.delete(c);else b.add(c);let y=wt({pinnedChatJids:Array.from(b)},m);return m?.dispatchEvent?.(new CustomEvent("piclaw:picker-pin-write",{detail:{kind:"session",key:c,pinned:b.has(c)}})),y}import{classHighlighter as yu,HighlightStyle as wu,tags as ao}from"#editor-vendor/codemirror";var vu=wu.define([{tag:[ao.function(ao.variableName),ao.function(ao.propertyName)],class:"tok-function"}]),Ls={style(a){let m=yu.style(a),c=vu.style(a);return[m,c].filter(Boolean).join(" ")||null}};import{highlightTree as Ga,StreamLanguage as z,cssLanguage as Su,cppLanguage as $u,goLanguage as ku,htmlLanguage as xu,javascriptLanguage as _u,jsxLanguage as Eu,tsxLanguage as Cu,typescriptLanguage as Au,jsonLanguage as Ru,markdownLanguage as Pu,pythonLanguage as Lu,rustLanguage as Tu,StandardSQL as Mu,xmlLanguage as Du,yamlLanguage as ju,dockerFile as Iu,powerShell as Nu,ruby as Fu,shell as Bu,swift as Ou,toml as Hu,clojure as zu,cmake as qu,coffeeScript as Gu,crystal as Ku,cypher as Wu,d as Uu,diff as Yu,eiffel as Vu,elm as Ju,erlang as Qu,factor as Xu,forth as Zu,fortran as ed,gas as td,gherkin as nd,groovy as rd,haskell as od,haxe as sd,http as id,jinja2 as ad,julia as cd,liveScript as ld,lua as ud,mathematica as dd,fSharp as pd,nginx as fd,octave as md,oz as gd,pascal as hd,perl as bd,properties as yd,protobuf as wd,pug as vd,puppet as Sd,r as $d,sas as kd,sass as xd,scheme as _d,smalltalk as Ed,solr as Cd,sparql as Ad,stex as Rd,stylus as Pd,tcl as Ld,textile as Td,turtle as Md,vb as Dd,verilog as jd,vhdl as Id,wast as Nd,webIDL as Fd,xQuery as Bd}from"#editor-vendor/codemirror";var Ka=98304;function Ge(a){return a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}var Od={js:"JavaScript",javascript:"JavaScript",ts:"TypeScript",typescript:"TypeScript",jsx:"JSX",tsx:"TSX",py:"Python",python:"Python",sh:"Shell",shell:"Shell",bash:"Bash",zsh:"Zsh",ps1:"PowerShell",powershell:"PowerShell",md:"Markdown",markdown:"Markdown",yml:"YAML",yaml:"YAML",json:"JSON",html:"HTML",css:"CSS",sql:"SQL",go:"Go",c:"C",cc:"C++",cpp:"C++","c++":"C++",cxx:"C++",h:"C/C++",hh:"C++",hpp:"C++",hxx:"C++",rust:"Rust",rs:"Rust",ruby:"Ruby",swift:"Swift",toml:"TOML",dockerfile:"Dockerfile",asm:"Gas",clj:"Clojure",clojure:"Clojure",cmake:"CMake",coffee:"CoffeeScript",coffeescript:"CoffeeScript",conf:"nginx",cr:"Crystal",crystal:"Crystal",cypher:"Cypher",d:"D",diff:"Diff",eiffel:"Eiffel",elm:"Elm",erl:"Erlang",erlang:"Erlang",f90:"Fortran",f95:"Fortran",factor:"Factor",feature:"Gherkin",forth:"Forth",fortran:"Fortran",fsharp:"ML",gas:"Gas",gherkin:"Gherkin",groovy:"Groovy",haskell:"Haskell",haxe:"Haxe",hs:"Haskell",http:"HTTP",hx:"Haxe",ini:"Properties",jade:"Pug",jinja:"Jinja2",jinja2:"Jinja2",jl:"Julia",julia:"Julia",latex:"LaTeX",livescript:"LiveScript",ls:"LiveScript",lua:"Lua",mathematica:"Mathematica",matlab:"Octave",ml:"ML",nginx:"nginx",ocaml:"ML",octave:"Octave",oz:"Oz",pas:"Pascal",pascal:"Pascal",patch:"Diff",perl:"Perl",pl:"Perl",pm:"Perl",pp:"Puppet",properties:"Properties",proto:"Protobuf",protobuf:"Protobuf",pug:"Pug",puppet:"Puppet",r:"R",rq:"SPARQL",s:"Gas",sas:"SAS",sass:"Sass",scheme:"Scheme",scm:"Scheme",scss:"Sass",smalltalk:"Smalltalk",sml:"ML",sparql:"SPARQL",st:"Smalltalk",styl:"Stylus",stylus:"Stylus",sv:"Verilog",tcl:"Tcl",tex:"LaTeX",textile:"Textile",ttl:"Turtle",turtle:"Turtle",vb:"VB",verilog:"Verilog",vhdl:"VHDL",wasm:"WebAssembly",wast:"WebAssembly",webidl:"WebIDL",wl:"Mathematica",xq:"XQuery",xquery:"XQuery"},Hd=z.define(Bu).parser,zd=z.define(Nu).parser,qd=z.define(Iu).parser,Gd=z.define(Fu).parser,Kd=z.define(Ou).parser,Wd=z.define(Hu).parser,ba=z.define(zu).parser,Ud=z.define(qu).parser,ya=z.define(Gu).parser,wa=z.define(Ku).parser,Yd=z.define(Wu).parser,Vd=z.define(Uu).parser,va=z.define(Yu).parser,Jd=z.define(Vu).parser,Qd=z.define(Ju).parser,Sa=z.define(Qu).parser,Xd=z.define(Xu).parser,Zd=z.define(Zu).parser,Ts=z.define(ed).parser,Ms=z.define(td).parser,$a=z.define(nd).parser,ep=z.define(rd).parser,ka=z.define(od).parser,xa=z.define(sd).parser,tp=z.define(id).parser,_a=z.define(ad).parser,Ea=z.define(cd).parser,Ca=z.define(ld).parser,np=z.define(ud).parser,Aa=z.define(dd).parser,Rr=z.define(pd).parser,rp=z.define(fd).parser,Ra=z.define(md).parser,op=z.define(gd).parser,Pa=z.define(hd).parser,Ds=z.define(bd).parser,La=z.define(yd).parser,Ta=z.define(wd).parser,Ma=z.define(vd).parser,Da=z.define(Sd).parser,sp=z.define($d).parser,ip=z.define(kd).parser,ja=z.define(xd).parser,Ia=z.define(_d).parser,Na=z.define(Ed).parser,ap=z.define(Cd).parser,Fa=z.define(Ad).parser,js=z.define(Rd).parser,Ba=z.define(Pd).parser,cp=z.define(Ld).parser,lp=z.define(Td).parser,Oa=z.define(Md).parser,up=z.define(Dd).parser,Ha=z.define(jd).parser,dp=z.define(Id).parser,za=z.define(Nd).parser,pp=z.define(Fd).parser,qa=z.define(Bd).parser;function St(a){let m=String(a||"").trim().toLowerCase();if(!m)return"text";return Od[m]||String(a||"").trim()}function kt(a){switch(String(a||"").trim().toLowerCase()){case"js":case"javascript":return _u.parser;case"ts":case"typescript":return Au.parser;case"jsx":return Eu.parser;case"tsx":return Cu.parser;case"py":case"python":return Lu.parser;case"json":return Ru.parser;case"css":return Su.parser;case"html":return xu.parser;case"xml":return Du.parser;case"yaml":case"yml":return ju.parser;case"md":case"markdown":return Pu.parser;case"sql":return Mu.language.parser;case"go":return ku.parser;case"c":case"cc":case"cpp":case"cxx":case"c++":case"h":case"hh":case"hpp":case"hxx":return $u.parser;case"sh":case"bash":case"shell":case"zsh":return Hd;case"ps1":case"powershell":return zd;case"dockerfile":return qd;case"rb":case"ruby":return Gd;case"rs":case"rust":return Tu.parser;case"swift":return Kd;case"toml":return Wd;case"asm":return Ms;case"clj":return ba;case"clojure":return ba;case"cmake":return Ud;case"coffee":return ya;case"coffeescript":return ya;case"cr":return wa;case"crystal":return wa;case"cypher":return Yd;case"d":return Vd;case"diff":return va;case"eiffel":return Jd;case"elm":return Qd;case"erl":return Sa;case"erlang":return Sa;case"f90":return Ts;case"f95":return Ts;case"factor":return Xd;case"feature":return $a;case"forth":return Zd;case"fortran":return Ts;case"fsharp":return Rr;case"gas":return Ms;case"gherkin":return $a;case"groovy":return ep;case"haskell":return ka;case"haxe":return xa;case"hs":return ka;case"http":return tp;case"hx":return xa;case"ini":return La;case"jade":return Ma;case"jinja":return _a;case"jinja2":return _a;case"jl":return Ea;case"julia":return Ea;case"latex":return js;case"livescript":return Ca;case"ls":return Ca;case"lua":return np;case"mathematica":return Aa;case"matlab":return Ra;case"ml":return Rr;case"mllike":return Rr;case"nginx":return rp;case"ocaml":return Rr;case"octave":return Ra;case"oz":return op;case"pas":return Pa;case"pascal":return Pa;case"patch":return va;case"perl":return Ds;case"pl":return Ds;case"pm":return Ds;case"pp":return Da;case"properties":return La;case"proto":return Ta;case"protobuf":return Ta;case"pug":return Ma;case"puppet":return Da;case"r":return sp;case"rq":return Fa;case"s":return Ms;case"sas":return ip;case"sass":return ja;case"scheme":return Ia;case"scm":return Ia;case"scss":return ja;case"smalltalk":return Na;case"sml":return Rr;case"solr":return ap;case"sparql":return Fa;case"st":return Na;case"stex":return js;case"styl":return Ba;case"stylus":return Ba;case"sv":return Ha;case"tcl":return cp;case"tex":return js;case"textile":return lp;case"ttl":return Oa;case"turtle":return Oa;case"vb":return up;case"verilog":return Ha;case"vhdl":return dp;case"wasm":return za;case"wast":return za;case"webidl":return pp;case"wl":return Aa;case"xq":return qa;case"xquery":return qa;default:return null}}function Ee(a,m){if(String(a||"").length>Ka)return Ge(a);let c=kt(m);if(!c)return Ge(a);let h=[];try{let x=c.parse(a);Ga(x,Ls,(C,L,R)=>{if(!R||C>=L)return;h.push({from:C,to:L,cls:R})})}catch{return Ge(a)}if(!h.length)return Ge(a);h.sort((x,C)=>x.from-C.from||x.to-C.to);let b=0,y="";for(let x of h){if(x.from>b)y+=Ge(a.slice(b,x.from));y+=`<span class="${Ge(x.cls)}">${Ge(a.slice(x.from,x.to))}</span>`,b=Math.max(b,x.to)}if(b<a.length)y+=Ge(a.slice(b));return y}function Xn(a,m){let c=String(a||"").split(`
`);if(!a)return c;if(String(a||"").length>Ka)return c.map((R)=>Ge(R)||"&nbsp;");let h=kt(m);if(!h)return c.map((R)=>Ge(R));let b=[];try{let R=h.parse(a);Ga(R,Ls,(I,N,F)=>{if(!F||I>=N)return;b.push({from:I,to:N,cls:F})})}catch{return c.map((R)=>Ge(R))}if(!b.length)return c.map((R)=>Ge(R));b.sort((R,I)=>R.from-I.from||R.to-I.to);let y=[],x=0;for(let R of c)y.push(x),x+=R.length+1;let C=[],L=0;for(let R=0;R<c.length;R+=1){let I=y[R],N=I+c[R].length,F="",U=I;while(L<b.length&&b[L].to<=I)L+=1;for(let q=L;q<b.length;q+=1){let Q=b[q];if(Q.from>=N)break;let Y=Math.max(I,Q.from),W=Math.min(N,Q.to);if(Y>U)F+=Ge(a.slice(U,Y));if(W>Y)F+=`<span class="${Ge(Q.cls)}">${Ge(a.slice(Y,W))}</span>`;U=Math.max(U,W)}if(U<N)F+=Ge(a.slice(U,N));C.push(F||"&nbsp;")}return C}function Je(a){let m=(a.match(/\.([^.]+)$/)||[])[1]?.toLowerCase()||"",c={ts:"typescript",tsx:"tsx",js:"javascript",jsx:"jsx",mjs:"javascript",cjs:"javascript",py:"python",rb:"ruby",rs:"rust",go:"go",java:"java",c:"c",h:"c",cc:"cpp",cpp:"cpp",cxx:"cpp",hpp:"cpp",hxx:"cpp",cs:"csharp",swift:"swift",kt:"kotlin",sh:"shell",bash:"bash",zsh:"zsh",fish:"shell",ps1:"powershell",psm1:"powershell",json:"json",yaml:"yaml",yml:"yaml",toml:"toml",xml:"xml",html:"html",htm:"html",css:"css",scss:"sass",sass:"sass",sql:"sql",graphql:"graphql",gql:"graphql",dockerfile:"dockerfile",makefile:"makefile",lua:"lua",perl:"perl",pl:"perl",pm:"perl",r:"r",jl:"julia",hs:"haskell",erl:"erlang",clj:"clojure",scm:"scheme",elm:"elm",ex:"elixir",exs:"elixir",proto:"protobuf",tf:"hcl",diff:"diff",patch:"diff",ini:"properties",conf:"nginx",cfg:"properties",v:"verilog",sv:"verilog",vhd:"vhdl",vhdl:"vhdl",pas:"pascal",f90:"fortran",f95:"fortran",cmake:"cmake",groovy:"groovy",gradle:"groovy",tex:"stex",latex:"stex",bib:"stex",d:"d",nim:"nim",zig:"zig",pug:"pug",jade:"pug",styl:"stylus",coffee:"coffeescript",tcl:"tcl",ml:"mllike",sml:"mllike",fs:"mllike",wasm:"wast",wat:"wast",pp:"puppet",feature:"gherkin",ttl:"turtle",rq:"sparql",xq:"xquery"},h=a.split("/").pop()?.toLowerCase()||"";if(h==="dockerfile"||h.startsWith("dockerfile."))return"dockerfile";if(h==="makefile"||h==="gnumakefile")return"cmake";if(h===".env"||h.endsWith(".env"))return"properties";if(h==="cmakelists.txt")return"cmake";if(h==="vagrantfile"||h==="rakefile"||h==="gemfile")return"ruby";return c[m]||""}var Pr=null,Is=new WeakSet;function fp(){if(window.piclawDiagrams)return Promise.resolve();if(Pr)return Pr;let a=document.createElement("script");return a.src="/static/common/js/vendor/pele.js",Pr=new Promise((m,c)=>{a.onload=()=>window.piclawDiagrams?m():c(Error("Mermaid library failed to load")),a.onerror=()=>c(Error("Mermaid library failed to load")),document.head.append(a)}).catch((m)=>{throw a.remove(),Pr=null,m}),Pr}function Wa(a){if(/(?:https?:\/\/|data:|blob:|\/\/)/i.test(a))return!1;return Array.from(a.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(c)=>c[2]?.trim()||"").every((c)=>/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(c))}function mp(a){let m=Uint8Array.from(atob(a),(h)=>h.charCodeAt(0)),c=new TextDecoder().decode(m);for(let h=0;h<2;h++){let b=c.replace(/</g,"&lt;").replace(/>/g,"&gt;"),y=new DOMParser().parseFromString(b,"text/html").documentElement.textContent||"";if(c===y)break;c=y}return c}async function Ua(a,m={}){let h=Array.from(a.querySelectorAll(".mermaid-container[data-mermaid]")).filter((y)=>!Is.has(y));for(let y of h)Is.add(y);if(!h.length)return;try{await fp();for(let y of h){let x=y.dataset.mermaid;if(!a.contains(y)||x===void 0)continue;try{let C=mp(x);if(m.scoped&&!Wa(C))throw Error("External Mermaid resources are unavailable in this view.");let L=window.piclawDiagrams.render(C),R=window.piclawDiagrams.sanitize;if(typeof R!=="function")throw Error("Diagram sanitizer is unavailable");y.innerHTML=R(L),y.removeAttribute("data-mermaid")}catch(C){b(y,C)}}}catch(y){for(let x of h)if(a.contains(x)&&x.hasAttribute("data-mermaid"))b(x,y)}finally{for(let y of h)Is.delete(y)}function b(y,x){m.reportError?.(x);let C=document.createElement("pre");C.className="mermaid-error",C.textContent="Diagram error: "+(x instanceof Error?x.message:String(x)),y.replaceChildren(C),y.removeAttribute("data-mermaid")}}var Ns={background:"#ffffff",foreground:"#18212b",muted:"#536171",accent:"#0969da",border:"#b6bec8",surface:"#f3f5f7",success:"#1a7f37",warning:"#9a6700",danger:"#cf222e"},Ya={background:"#171b22",foreground:"#e6edf3",muted:"#a2afbf",accent:"#79c0ff",border:"#586577",surface:"#242b36",success:"#7ee787",warning:"#e3b341",danger:"#ff7b72"};function Va(a="theme"){if(a==="light")return{...Ns};if(a==="dark")return{...Ya};if(typeof document>"u")return{...Ns};let m=document.documentElement,h=(m.dataset.theme||(m.classList.contains("dark")?"dark":m.classList.contains("light")?"light":typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"))==="dark"?Ya:Ns;if(!document.body)return{...h};let b=document.createElement("span");b.style.display="none",document.body.append(b);try{return Object.fromEntries(Object.entries({background:"--bg-primary",foreground:"--text-primary",muted:"--text-secondary",accent:"--accent-color",border:"--border-color",surface:"--bg-secondary",success:"--success-color",warning:"--warning-color",danger:"--danger-color"}).map(([x,C])=>(b.style.color=`var(${C}, ${h[x]})`,[x,getComputedStyle(b).color])))}finally{b.remove()}}var Vf=Object.freeze({bg:"var(--bg-primary, #ffffff)",fg:"var(--text-primary, #18212b)",line:"var(--text-secondary, #536171)",accent:"var(--accent-color, #0969da)",muted:"var(--text-secondary, #536171)",surface:"var(--bg-secondary, #f3f5f7)",border:"var(--border-color, #b6bec8)"});var Tn=Object.freeze({bytes:262144,nodes:2048,depth:32,dimension:2048}),co="http://www.w3.org/2000/svg",Ja=new Set(["svg","g","defs","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","title","desc","linearGradient","radialGradient","stop","clipPath"]),gp=new Set(["x","y","x1","x2","y1","y2","cx","cy","r","rx","ry","width","height","dx","dy","stroke-width","stroke-dashoffset","font-size"]),hp=new Set(["opacity","fill-opacity","stroke-opacity","stop-opacity","stroke-miterlimit","offset"]),Qa={"fill-rule":["nonzero","evenodd"],"clip-rule":["nonzero","evenodd"],"stroke-linecap":["butt","round","square"],"stroke-linejoin":["miter","round","bevel"],"text-anchor":["start","middle","end"],"dominant-baseline":["auto","middle","central","hanging","text-before-edge","text-after-edge","alphabetic"],"font-family":["sans-serif","serif","monospace"],"font-weight":["normal","bold","100","200","300","400","500","600","700","800","900"],"font-style":["normal","italic","oblique"],gradientUnits:["objectBoundingBox","userSpaceOnUse"],clipPathUnits:["userSpaceOnUse","objectBoundingBox"],spreadMethod:["pad","reflect","repeat"]},bp=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/,Bs=/^url\(#([A-Za-z_][A-Za-z0-9_.-]{0,63})\)$/;function Os(a){let m="";for(let c of new TextEncoder().encode(a))m+=String.fromCharCode(c);return btoa(m)}function xn(a){return new TextDecoder().decode(Uint8Array.from(atob(a),(m)=>m.charCodeAt(0)))}function Hs(a){return a.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function uo(a){return bp.test(a)&&Number.isFinite(Number(a))&&Math.abs(Number(a))<=1e6}function lo(a){let m=a.trim().split(/[\s,]+/);return m.length&&m.every(uo)?m.map(Number):null}function yp(a,m){if(a==="id")return/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(m);if(gp.has(a))return uo(m.replace(/(?:px|%)$/,""));if(hp.has(a))return uo(m.replace(/%$/,""));if(Object.hasOwn(Qa,a))return Qa[a].includes(m);if(["fill","stroke","color","stop-color"].includes(a))return/^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d.%+,\s/-]+\))$/i.test(m)||Bs.test(m);if(a==="clip-path")return m==="none"||Bs.test(m);if(a==="viewBox"){let c=lo(m);return!!c&&c.length===4&&c[2]>0&&c[3]>0}if(a==="points"||a==="stroke-dasharray")return m==="none"||lo(m)!==null;if(a==="d")return/^[MmZzLlHhVvCcSsQqTtAa\dEe+.,\s-]*$/.test(m);if(a==="transform"||a==="gradientTransform")return m.replace(/(?:matrix|translate|scale|rotate|skewX|skewY)\(([^()]*)\)/g,(h,b)=>lo(b)?"":h).trim()==="";return!1}var sn=new Map,wp=8,Xa=2097152,Fs=0;function Za(a,m="theme"){if(a.length>Tn.bytes)return null;let c=Va(m),h=JSON.stringify(c)+a,b=sn.get(h);if(b)return sn.delete(h),sn.set(h,b),b.image;let y=vp(a,c),x=2*(h.length+(y?.src.length||0)+(y?.label.length||0));if(x<=Xa){while(sn.size>=wp||Fs+x>Xa){let C=sn.keys().next().value;Fs-=sn.get(C).size,sn.delete(C)}sn.set(h,{image:y,size:x}),Fs+=x}return y}function vp(a,m){if(a.length>Tn.bytes||new TextEncoder().encode(a).byteLength>Tn.bytes)return null;if(/<!\s*(?:DOCTYPE|ENTITY)|<\?/i.test(a))return null;let c=new DOMParser().parseFromString(a,"image/svg+xml"),h=c.documentElement;if(!h||h.localName!=="svg"||c.querySelector("parsererror")||c.doctype)return null;let b=[{node:h,depth:1}],y=0;while(b.length){let{node:W,depth:X}=b.pop();if(++y>Tn.nodes||X>Tn.depth)return null;for(let H=W.lastChild;H;H=H.previousSibling){if(y+b.length>=Tn.nodes)return null;b.push({node:H,depth:X+(H.nodeType===1?1:0)})}}let x=document.implementation.createDocument(co,"svg",null),C=new Map,L=[];function R(W,X,H){if(W.hasAttribute("xmlns")&&W.getAttribute("xmlns")!==co)return!1;if(W.namespaceURI!==h.namespaceURI||W.namespaceURI&&W.namespaceURI!==co||W.prefix||!Ja.has(W.localName))return!1;if(W!==h&&W.localName==="svg")return!1;let ce=H||["defs","clipPath","linearGradient","radialGradient"].includes(W.localName);for(let xe of Array.from(W.attributes)){if(xe.namespaceURI||xe.prefix)continue;let de=xe.name,He=xe.value.trim();if(["fill","stroke","color","stop-color"].includes(de)){let cn=He.match(/^var\(--svg-(background|foreground|muted|accent|border|surface|success|warning|danger)\)$/);if(cn)He=m[cn[1]]}if(!yp(de,He))continue;let Kt=He.match(Bs);if(Kt){if(ce||!["fill","stroke","clip-path"].includes(de))continue;L.push({element:X,name:de,id:Kt[1]})}if(de==="id"){if(C.has(He))return!1;C.set(He,X)}X.setAttribute(de,He)}for(let xe of Array.from(W.childNodes))if(xe.nodeType===1){let de=xe;if(!Ja.has(de.localName))return!1;let He=x.createElementNS(co,de.localName);if(!R(de,He,ce))return!1;X.appendChild(He)}else if(xe.nodeType===3||xe.nodeType===4)X.appendChild(x.createTextNode(xe.nodeValue||""));else if(xe.nodeType!==8)return!1;return!0}if(!R(h,x.documentElement,!1))return null;for(let W of L){let X=C.get(W.id)?.localName;if(!(W.name==="clip-path"?X==="clipPath":X==="linearGradient"||X==="radialGradient"))W.element.removeAttribute(W.name)}let I=x.documentElement;if(!I.hasAttribute("color"))I.setAttribute("color",m.foreground);if(!I.hasAttribute("fill"))I.setAttribute("fill","currentColor");let N=lo(I.getAttribute("viewBox")||""),F=(W,X)=>{let H=I.getAttribute(W)?.replace(/px$/,"")||"";return uo(H)&&Number(H)>0?Number(H):X},U=F("width",N?.[2]||300),q=F("height",N?.[3]||150),Q=Math.min(1,Tn.dimension/Math.max(U,q));if(I.setAttribute("width",String(U*Q)),I.setAttribute("height",String(q*Q)),!N)I.setAttribute("viewBox",`0 0 ${U} ${q}`);I.setAttribute("preserveAspectRatio","xMidYMid meet");let Y=(I.querySelector("title")?.textContent?.trim()||I.querySelector("desc")?.textContent?.trim()||"Model-generated SVG").replace(/\s+/g," ").slice(0,256);return Object.freeze({src:`data:image/svg+xml;base64,${Os(new XMLSerializer().serializeToString(I))}`,label:Y})}function ec(a,m,c,h={}){if(!/^ {0,3}(?:`{3,}|~{3,})svg\s*$/im.test(a))return m(a);let b=a.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean)||[],y=null,x=/^(?:\uFEFF)?---(?:\r?\n|\r)/.test(a),C=0,L=[],R=[],I=`PICLAWSVG${Array.from(crypto.getRandomValues(new Uint32Array(4)),(F)=>F.toString(16)).join("")}BLOCK`;for(let F=0;F<b.length;F++){let U=b[F].replace(/[\r\n]+$/,"");if(x){if(F>0&&/^(---|\.\.\.)\s*$/.test(U))x=!1;continue}if(y){if(new RegExp(`^ {0,3}${y.char}{${y.length},}\\s*$`).test(U))y=null;continue}let q=U.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(!q)continue;if(y={char:q[1][0],length:q[1].length},!/^svg\s*$/i.test(q[2]))continue;let Q=new RegExp(`^ {0,3}${y.char}{${y.length},}\\s*$`),Y=F+1;while(Y<b.length&&!Q.test(b[Y].replace(/[\r\n]+$/,"")))Y++;if(F>C)L.push(b.slice(C,F).join(""));let W=b.slice(F+1,Y).join(""),X=h.sanitize===!1?null:Y<b.length?Za(W):null,H=c(W);L.push(`

${I}${R.length}END

`),R.push(h.sanitize===!1&&Y<b.length?W:X?`<div class="model-svg-block" data-svg-surface="theme"><div class="model-svg-controls"><label>SVG background <select class="model-svg-surface" aria-label="SVG background"><option value="theme">Theme</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div><img class="model-svg-image" src="${X.src}" alt="${Hs(X.label)}"><details class="model-svg-source"><summary>SVG source</summary>${H}</details></div>`:H),F=Y,C=Y+1,y=null}if(!R.length)return m(a);if(C<b.length)L.push(b.slice(C).join(""));return m(L.join("")).replace(new RegExp(`(?:<p>)?${I}(\\d+)END(?:<\\/p>)?`,"g"),(F,U)=>R[Number(U)])}function er(a){let m=Array.from(a.querySelectorAll(".model-svg-block"));if(!m.length)return()=>{};let c=(y)=>{let x=y.dataset.svgSurface,C=y.querySelector(".model-svg-image"),L=y.querySelector("[data-svg-source], .code-block__copy[data-code]");if(!C||!L)return;let R=Za(xn(L.dataset.svgSource||L.dataset.code||""),x);if(R&&C.getAttribute("src")!==R.src)C.src=R.src},h=()=>m.forEach((y)=>{if(y.dataset.svgSurface==="theme")c(y)}),b=(y)=>{let x=y.target;if(!x?.matches(".model-svg-surface"))return;let C=x.closest(".model-svg-block");if(!C||!["theme","light","dark"].includes(x.value))return;C.dataset.svgSurface=x.value,c(C)};return a.addEventListener("change",b),window.addEventListener("piclaw-theme-change",h),h(),()=>{a.removeEventListener("change",b),window.removeEventListener("piclaw-theme-change",h)}}function tc(a){if(typeof a!=="string"||!a.trim()||a.length>2048)throw Error("Provide a GitHub/Gitea repository web URL.");let m=a.trim();if(!/^https?:\/\//i.test(m)||/[\\\s]/.test(m))throw Error("Repository URL must use HTTP or HTTPS.");let c=new URL(m);if(!["http:","https:"].includes(c.protocol)||c.username||c.password||c.search||c.hash)throw Error("Repository URL cannot contain credentials, a query or a fragment.");let h=c.pathname.replace(/\/+$/,"").split("/").slice(1);if(h.length<2||h.some((C)=>!/^[a-zA-Z0-9_.-]+$/.test(C)||C==="."||C===".."))throw Error("Use a repository URL ending in owner/repository (an installation subpath is allowed).");if(m.slice(m.indexOf("://")+3).split("/").slice(1).some((C)=>C==="."||C===".."))throw Error("Repository URL cannot contain traversal segments.");if(h.at(-1).endsWith(".git"))h[h.length-1]=h.at(-1).slice(0,-4);if(!h.at(-1))throw Error("Repository name is required.");if(c.hostname.toLowerCase()==="github.com"&&h.length!==2)throw Error("GitHub repository URLs must end at github.com/owner/repository.");if(c.hostname.toLowerCase()!=="github.com"&&h.length!==2&&h.length!==3)throw Error("Gitea repository URLs must be owner/repository or installation-base/owner/repository.");let y=new Set(["issues","issue","pulls","pull","explore","src","commits","commit","actions","releases","projects","settings","wiki","compare","branches","tags","milestones"]),x=h.at(-1).toLowerCase();if(h.some((C)=>y.has(C.toLowerCase()))||/^\d+$/.test(x))throw Error("Repository URL must identify a repository root, not an issue, pull request or explorer page.");return`${c.origin}/${h.join("/")}`}function nc(a,m=null,c=!0){if(typeof DOMParser>"u")return a;let h=null;if(m)try{h=tc(m)}catch{h=null}let b=new DOMParser().parseFromString(a,"text/html"),y=b.createTreeWalker(b.body,NodeFilter.SHOW_TEXT),x=[];while(y.nextNode())x.push(y.currentNode);for(let C of x){if(C.parentElement?.closest("a, code, pre, script, style, svg, math, .katex"))continue;let L=C.nodeValue||"",R=[...L.matchAll(/#(\w+)/g)];if(!R.length)continue;let I=b.createDocumentFragment(),N=0;for(let F of R){let U=F.index,q=U+F[0].length,Q=F[1];if(I.append(b.createTextNode(L.slice(N,U))),N=q,/^\d+$/.test(Q)){let Y=L[U-1]||"",W=L[q]||"",X=!Y||/[\s([{>,;:!?]/.test(Y);if(!h||!/^[1-9]\d*$/.test(Q)||!X||/[\p{L}\p{N}_/\-]/u.test(W)){I.append(b.createTextNode(F[0]));continue}let H=b.createElement("a");H.href=`${h}/issues/${Q}`,H.className="project-reference",H.target="_blank",H.rel="noopener noreferrer",H.title=`${h} #${Q}`,H.textContent=F[0],I.append(H)}else{if(!c){I.append(b.createTextNode(F[0]));continue}let Y=b.createElement("a");Y.href="#",Y.className="hashtag",Y.setAttribute("data-hashtag",Q),Y.textContent=F[0],I.append(Y)}}I.append(b.createTextNode(L.slice(N))),C.replaceWith(I)}return b.body.innerHTML}var Sp=new Set(["code","pre","strong","em","b","i","u","s","del","ins","sub","sup","mark","small","br","p","ul","ol","li","blockquote","ruby","rt","rp","span","input"]),$p=new Set(["a","abbr","blockquote","br","code","del","div","em","hr","h1","h2","h3","h4","h5","h6","i","img","input","ins","kbd","li","mark","ol","p","pre","ruby","rt","rp","s","small","span","strong","sub","sup","table","tbody","td","th","thead","tr","u","ul","math","semantics","mrow","mi","mn","mo","mtext","mspace","msup","msub","msubsup","mfrac","msqrt","mroot","mtable","mtr","mtd","annotation","svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]),kp=new Set(["class","title","role","aria-hidden","aria-label","aria-expanded","aria-live","data-mermaid","data-hashtag"]),xp={a:new Set(["href","target","rel"]),img:new Set(["src","alt","title"]),input:new Set(["type","checked","disabled"])},_p=new Set(["http:","https:","mailto:",""]),zs=new Set(["svg","g","defs","symbol","use","path","rect","circle","ellipse","line","polyline","polygon","text","tspan","image","clippath","mask","pattern","lineargradient","radialgradient","stop","filter","fegaussianblur","feoffset","feblend","fecolormatrix","fecomposite","feflood","fedropshadow","title","desc","marker","foreignobject"]);function Ep(a,m){let c=String(a||"").toLowerCase(),h=String(m||"").toLowerCase();if(!h||h.startsWith("on"))return!1;if(h.startsWith("data-")||h.startsWith("aria-"))return!0;if(zs.has(c))return!0;return(xp[c]||new Set).has(h)||kp.has(h)}function qn(a){return String(a||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/'/g,"&#39;")}function Ie(a,m={}){if(!a)return null;let c=String(a).trim();if(!c)return null;if(c.startsWith("#")||c.startsWith("/"))return c;if(c.startsWith("data:")){if(m.allowDataImage&&/^data:image\//i.test(c))return c;return null}if(c.startsWith("blob:"))return c;try{let h=new URL(c,typeof window<"u"?window.location.origin:"http://localhost");if(!_p.has(h.protocol))return null;return h.href}catch{return null}}function rc(a,m={}){if(!a)return"";if(m?.sanitize===!1)return a;let c=new DOMParser().parseFromString(a,"text/html"),h=[],b=c.createTreeWalker(c.body,NodeFilter.SHOW_ELEMENT),y;while(y=b.nextNode())h.push(y);for(let x of h){let C=x.tagName.toLowerCase();if(!$p.has(C)){let L=x.parentNode;if(!L)continue;while(x.firstChild)L.insertBefore(x.firstChild,x);L.removeChild(x);continue}for(let L of Array.from(x.attributes)){let R=L.name.toLowerCase(),I=L.value;if(R.startsWith("on")){x.removeAttribute(L.name);continue}if(Ep(C,R)){if(zs.has(C)&&typeof m.rewriteImageSrc==="function"){let N=Array.from(I.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi),(U)=>U[2]?.trim()||"");if(/(?:https?:|data:|blob:|\/\/)/i.test(I)||N.some((U)=>!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(U))){x.removeAttribute(L.name);continue}}if(R==="href"||R==="xlink:href"){let N=typeof m.rewriteImageSrc==="function"&&zs.has(C)?/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(I.trim())?I.trim():m.rewriteImageSrc(I):I,F=Ie(N);if(!F)x.removeAttribute(L.name);else if(x.setAttribute(L.name,F),C==="a"){if(!x.getAttribute("rel"))x.setAttribute("rel","noopener noreferrer");if(/^https?:\/\//i.test(F))x.setAttribute("target","_blank")}}else if(R==="src"){let N=typeof m.rewriteImageSrc==="function"&&(C==="img"||C==="image")?m.rewriteImageSrc(I):I,F=Ie(N,{allowDataImage:C==="img"&&typeof m.rewriteImageSrc!=="function"});if(!F)x.removeAttribute(L.name);else x.setAttribute(L.name,F)}continue}x.removeAttribute(L.name)}}return c.body.innerHTML}function qs(a){if(!a)return a;let m=a.replace(/</g,"&lt;").replace(/>/g,"&gt;");return new DOMParser().parseFromString(m,"text/html").documentElement.textContent}function Cp(a,m=2){if(!a)return a;let c=a;for(let h=0;h<m;h+=1){let b=qs(c);if(b===c)break;c=b}return c}function Ap(a){if(!a)return{text:"",frontmatter:null};let m=a.replace(/^\uFEFF/,"").replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!m.startsWith(`---
`))return{text:m,frontmatter:null};let c=m.split(`
`),h=-1;for(let x=1;x<c.length;x+=1)if(/^(---|\.\.\.)\s*$/.test(c[x])){h=x;break}if(h<=0)return{text:m,frontmatter:null};let b=c.slice(1,h).join(`
`);return{text:c.slice(h+1).join(`
`).replace(/^\n+/,""),frontmatter:b}}function Rp(a){let{text:m,frontmatter:c}=Ap(a);if(c===null)return m;return["<!--frontmatter-block-start-->","```yaml",c,"```","<!--frontmatter-block-end-->",m].filter(Boolean).join(`

`)}function Pp(a){if(!a)return a;return Cp(a,5)}function Lp(a){let m=new TextEncoder().encode(String(a||"")),c="";for(let h of m)c+=String.fromCharCode(h);return btoa(c)}function Tp(a){if(!a)return a;return a.replace(/<pre><code(?:\s+class="language-([A-Za-z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/g,(c,h,b)=>{let y=String(h||"").trim().toLowerCase(),x=qs(b),C=y||"plaintext",L=Ee(x,y);return`<pre><code class="hljs language-${qn(C)}">${L}</code></pre>`}).replace(/<!--frontmatter-block-start-->\s*<pre>/g,'<pre class="frontmatter-block">').replace(/<\/pre>\s*<!--frontmatter-block-end-->/g,"</pre>")}var Mp={span:new Set(["title","class","lang","dir"]),input:new Set(["type","checked","disabled"])};function Dp(a,m){let c=Mp[a];if(!c||!m)return"";let h=[],b=/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g,y;while(y=b.exec(m)){let x=(y[1]||"").toLowerCase();if(!x||x.startsWith("on")||!c.has(x))continue;let C=y[2]??y[3]??y[4]??"";h.push(` ${x}="${qn(C)}"`)}return h.join("")}function jp(a){if(!a)return a;return a.replace(/&lt;((?:[^"'<>]|"[^"]*"|'[^']*')*?)(?:&gt;|>)/g,(m,c)=>{let h=c.trim(),b=h.startsWith("/"),y=b?h.slice(1).trim():h,C=y.endsWith("/")?y.slice(0,-1).trim():y,[L=""]=C.split(/\s+/,1),R=L.toLowerCase();if(!R||!Sp.has(R))return m;if(R==="br")return b?"":"<br>";if(b)return`</${R}>`;let I=C.slice(L.length).trim(),N=Dp(R,I);return`<${R}${N}>`})}function oc(a,m=!0){if(typeof a.text!=="string")return;if(a.type==="code"&&m){let c=a.lang?.trim().toLowerCase();if(c==="mermaid"){a.type="html",a.text=`<div class="mermaid-container" data-mermaid="${Lp(Pp(a.text))}"><div class="mermaid-loading">Loading diagram...</div></div>`;return}if(c&&["math","katex","latex"].includes(c)){a.type="html",a.text=`<p>$$
${qn(a.text)}
$$</p>
`;return}}if(a.type!=="html")return;if(/^<!--frontmatter-block-(?:start|end)-->\s*$/.test(a.text))return;a.text=jp(a.text.replace(/</g,"&lt;"))}function Ip(a){if(!window.katex)return a;let m=(x)=>qs(x).replace(/&gt;/g,">").replace(/&lt;/g,"<").replace(/&amp;/g,"&").replace(/<br\s*\/?\s*>/gi,`
`),c=(x)=>{let C=[],L=x.replace(/<pre\b[^>]*>\s*<code\b[^>]*>[\s\S]*?<\/code>\s*<\/pre>/gi,(R)=>{let I=C.length;return C.push(R),`@@CODE_BLOCK_${I}@@`});return L=L.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi,(R)=>{let I=C.length;return C.push(R),`@@CODE_INLINE_${I}@@`}),{html:L,blocks:C}},h=(x,C)=>{if(!C.length)return x;return x.replace(/@@CODE_(?:BLOCK|INLINE)_(\d+)@@/g,(L,R)=>{let I=Number(R);return C[I]??""})},b=c(a),y=b.html;return y=y.replace(/(^|\n|<br\s*\/?\s*>|<p>|<\/p>)\s*\$\$([\s\S]+?)\$\$\s*(?=\n|<br\s*\/?\s*>|<\/p>|$)/gi,(x,C,L)=>{try{let R=katex.renderToString(m(L.trim()),{displayMode:!0,throwOnError:!1});return`${C}${R}`}catch(R){let I=R instanceof Error?R.message:String(R);return`<span class="math-error" title="${qn(I)}">${x}</span>`}}),h(y,b.blocks)}function Np(a,m=null){return nc(a,m)}function Fp(a){return{safeHtml:Rp(a||"")}}var Bp=new Set(["NOTE","TIP","IMPORTANT","WARNING","CAUTION"]),Op={NOTE:"Note",TIP:"Tip",IMPORTANT:"Important",WARNING:"Warning",CAUTION:"Caution"};function Hp(a){return a.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>\s*)?(\n)?/gi,(m,c,h)=>{let b=c.toUpperCase();if(!Bp.has(b))return m;let y=Op[b]||b;return`<div class="admonition admonition-${b.toLowerCase()}"><p class="admonition-title">${y}</p><p>`}).replace(/(<div class="admonition admonition-[a-z]+">(?:(?!<\/div>)[\s\S])*?)<\/blockquote>/g,(m,c)=>`${c}</div>`)}function S(a,m,c={}){if(!a)return"";return ec(a,(h)=>zp(h,c),(h)=>`<pre><code class="language-svg" data-svg-source="${Os(h)}">${Hs(h)}</code></pre>`,{sanitize:typeof window>"u"||window.__PICLAW_SANITIZE_SVG_FENCES__!==!1})}function zp(a,m){let{safeHtml:c}=Fp(a),h=window.marked?marked.parse(c,{headerIds:!1,mangle:!1,walkTokens:oc}):qn(c).replace(/\n/g,"<br>");return h=Tp(h),h=Ip(h),h=Np(h,m.projectRepository),h=Hp(h),h=rc(h,m),h}function K(a){if(!a)return"";let m=a.replace(/\r\n/g,`
`).replace(/\r/g,`
`),c=window.marked?marked.parse(m,{walkTokens:(h)=>oc(h,!1)}):qn(m).replace(/\n/g,"<br>");return c=rc(c),c}async function G(a,m={}){await Ua(a,{scoped:typeof m.rewriteImageSrc==="function",reportError:(c)=>console.error("Mermaid render error:",c)})}function Re(a){if(!a||typeof a!=="object")return null;let m=a.started_at??a.startedAt;if(typeof m!=="string"||!m)return null;let c=Date.parse(m);return Number.isFinite(c)?c:null}function qp(a){if(!a||typeof a!=="object")return null;let m=a.retry_at??a.retryAt;if(typeof m!=="string"||!m)return null;let c=Date.parse(m);return Number.isFinite(c)?c:null}function pe(a){if(!a||typeof a!=="object")return null;let m=a.last_event_at??a.lastEventAt??a.started_at??a.startedAt;if(typeof m!=="string"||!m)return null;let c=Date.parse(m);return Number.isFinite(c)?c:null}function J(a){if(!a||typeof a!=="object")return!1;let m=a.intent_key??a.intentKey;return a.type==="intent"&&m==="compaction"}function At(a){if(!a||typeof a!=="object")return"";let m=a.title;if(typeof m==="string"&&m.trim())return m.trim();let c=a.tool_name??a.toolName;if(typeof c==="string"&&c.trim())return c.trim();let h=a.status;if(typeof h==="string"&&h.trim())return h.trim();return J(a)?"Compacting context":"Thinking..."}function sc(a){let m=Math.max(0,Math.floor(a/1000)),c=m%60,h=Math.floor(m/60)%60,b=Math.floor(m/3600);if(b>0)return`${b}:${String(h).padStart(2,"0")}:${String(c).padStart(2,"0")}`;return`${h}:${String(c).padStart(2,"0")}`}function Pe(a,m=Date.now()){let c=Re(a);if(c===null)return null;return sc(Math.max(0,m-c))}function tr(a,m=Date.now()){let c=qp(a);if(c===null)return null;let h=c-m;if(h<=0)return"retrying now";return`retry in ${sc(h)}`}function k(a={}){let m=a.window??(typeof window<"u"?window:null),c=a.navigator??(typeof navigator<"u"?navigator:null);if(c&&c.standalone===!0)return!0;if(!m||typeof m.matchMedia!=="function")return!1;return["(display-mode: standalone)","(display-mode: minimal-ui)","(display-mode: fullscreen)"].some((b)=>{try{return Boolean(m.matchMedia(b)?.matches)}catch{return!1}})}function Me(a={}){let m=a.window??(typeof window<"u"?window:null),c=a.navigator??(typeof navigator<"u"?navigator:null);if(!m&&!c)return!1;let h=String(c?.userAgent||""),b=Number(c?.maxTouchPoints||0),y=/Android|webOS|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(h),x=(()=>{if(!m||typeof m.matchMedia!=="function")return!1;try{return Boolean(m.matchMedia("(pointer: coarse)")?.matches||m.matchMedia("(any-pointer: coarse)")?.matches)}catch{return!1}})();return Boolean(y||b>1||x)}function nr(a,m={}){if(k(m))return null;if(Me(m))return{target:"_blank",features:void 0,mode:"tab"};return{target:Gp(a),features:"popup=yes,width=900,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function Sn(a,m={}){let c=m.window??(typeof window<"u"?window:null);if(!c||!a)return null;try{return a.features?c.open("about:blank",a.target,a.features):c.open("about:blank",a.target)}catch{return null}}function kn(a,m={}){if(!a||!a.document)return;try{let c=String(m.title||"Opening branch…"),h=String(m.message||"Preparing a new branch window…");a.document.title=c;let b=a.document.body;if(!b)return;if(typeof a.document.createElement!=="function"){b.textContent=`${c}
${h}`;return}let y=a.document.createElement("div");y.setAttribute("style","font-family: system-ui, sans-serif; padding: 24px; color: #222;");let x=a.document.createElement("h1");x.setAttribute("style","font-size: 18px; margin: 0 0 12px;"),x.textContent=c;let C=a.document.createElement("p");if(C.setAttribute("style","margin: 0; line-height: 1.5;"),C.textContent=h,y.appendChild(x),y.appendChild(C),typeof b.replaceChildren==="function")b.replaceChildren(y);else b.innerHTML="",b.appendChild(y)}catch{return}}function An(a,m){if(!a||!m)return;try{if(a.location&&typeof a.location.replace==="function"){a.location.replace(String(m));return}a.location=String(m)}catch{return}}function Cn(a){if(!a||typeof a.close!=="function")return;try{a.close()}catch{return}}function A(a,m,c={}){let h=new URL(String(a||"http://localhost/")),b=String(m||"").trim()||"web:default";if(h.searchParams.set("chat_jid",b),h.searchParams.delete("branch_loader"),h.searchParams.delete("branch_source_chat_jid"),h.searchParams.delete("pane_popout"),h.searchParams.delete("pane_path"),h.searchParams.delete("pane_label"),c.chatOnly===!0)h.searchParams.set("chat_only","1");return h.toString()}function _n(a,m,c={}){let h=new URL(String(a||"http://localhost/")),b=String(m||"").trim()||"web:default";if(h.searchParams.set("branch_loader","1"),h.searchParams.set("branch_source_chat_jid",b),h.searchParams.delete("chat_jid"),h.searchParams.delete("pane_popout"),h.searchParams.delete("pane_path"),h.searchParams.delete("pane_label"),c.chatOnly===!0)h.searchParams.set("chat_only","1");return h.toString()}function rr(a,m,c={}){let h=new URL(String(a||"http://localhost/")),b=String(m||"").trim();if(!b)return h.toString();if(h.searchParams.set("pane_popout","1"),h.searchParams.set("pane_path",b),c?.label)h.searchParams.set("pane_label",String(c.label));else h.searchParams.delete("pane_label");if(c?.chatJid)h.searchParams.set("chat_jid",String(c.chatJid));let y=c?.params&&typeof c.params==="object"?c.params:null;if(y)for(let[x,C]of Object.entries(y)){let L=String(x||"").trim();if(!L)continue;if(C===null||C===void 0||C==="")h.searchParams.delete(L);else h.searchParams.set(L,String(C))}return h.searchParams.delete("chat_only"),h.searchParams.delete("branch_loader"),h.searchParams.delete("branch_source_chat_jid"),h.toString()}function Gp(a){return`piclaw-chat-${String(a||"web:default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function Kp(a){return`piclaw-pane-${String(a||"pane").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-")||"default"}`}function or(a,m={}){if(k(m))return null;if(Me(m))return{target:"_blank",features:void 0,mode:"tab"};return{target:Kp(a),features:"popup=yes,width=1200,height=960,resizable=yes,scrollbars=yes",mode:"popup"}}function fe(a){let m=a instanceof Error?a.message:String(a||"").trim(),c=String(m||"").trim();if(!c)return"PiClaw could not open a new branch window.";let h=c.toLowerCase();if(h.includes("no stable turn boundary"))return"This chat is still in flight and does not yet have a stable turn boundary to fork from.";if(h.includes("cannot fork a branch while the source chat is still active"))return"This chat is still active. Please wait for the current turn to settle, then try again.";if(h.includes("cancelled"))return"Branch creation was cancelled before a new chat window could be opened.";if(h.includes("did not return a chat id"))return"PiClaw created no usable branch id for the new window. Please try again.";if(h.includes("failed to fork branch")||h.includes("failed to fork chat branch"))return"PiClaw could not create the new branch. Please try again.";return c}var po=new Map,Gs=new Set,an,Ks=()=>{for(let a of Gs)a()};function ir(a,m){if(!a||!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(m.id)||!m.label||typeof m.start!=="function"||typeof m.availability!=="function")throw Error("Invalid dictation provider registration.");if(po.has(m.id))throw Error("Duplicate dictation provider.");let c=Object.freeze({owner:a,provider:Object.freeze({...m})});po.set(m.id,c);let h=!1;return()=>{if(h)return;if(h=!0,an===c)an=void 0;po.delete(m.id),Ks()}}function sr(a,m){if(m===null){if(an?.owner===a)an=void 0,Ks();return}let c=po.get(m);if(!c||c.owner!==a)throw Error("Dictation provider belongs to another add-on or is unregistered.");if(an&&an!==c)throw Error("Another enabled dictation provider owns the composer.");an=c,Ks()}function Mn(){return an}function fo(a){return Gs.add(a),()=>{Gs.delete(a)}}var Wp=[[`Continue working toward the active thread goal.
`,"Continue goal","objective"],[`The active thread goal objective was edited by the user.
`,"Goal updated","untrusted_objective"],[`The active thread goal has reached its token budget.
`,"Goal budget reached","objective"],[`The current Plan Sidebar checklist has no pending or in-progress items.
`,"Finalize goal","objective"]];function Ct(a){let m=/^🎯 (?:Continue goal|Goal updated|Goal budget reached|Finalize goal): /.test(a),c=Wp.find(([b])=>a.startsWith(b));if(!m&&!c)return a;let h=/\n\n<piclaw_goal_input>([^\n]*)<\/piclaw_goal_input>$/.exec(a);if(!h)return a;try{let b=JSON.parse(h[1]);if(!b||Object.keys(b).sort().join(",")!=="generation,goalId"||typeof b.goalId!=="string"||!b.goalId.trim()||b.goalId!==b.goalId.trim()||b.goalId.length>256||!Number.isSafeInteger(b.generation)||b.generation<1)return a;let y=a.slice(0,h.index);if(m)return y;let[,x,C]=c,L=new RegExp(`<${C}>
([\\s\\S]*?)
</${C}>`).exec(y)?.[1];if(L===void 0)return a;let R={lt:"<",gt:">",amp:"&",quot:'"',"#39":"'",apos:"'"};return`\uD83C\uDFAF ${x}: ${L.replace(/&(lt|gt|amp|quot|#39|apos);/g,(I,N)=>R[N])}`}catch{return a}}class Ws{host;timeoutMs;current;pendingSubmit;constructor(a,m=15000){this.host=a;this.timeoutMs=m;if(!Number.isSafeInteger(m)||m<=0)throw Error("Invalid dictation deadline.")}get active(){return!!this.current}async start(a){if(this.current)throw Error("A dictation session already owns this composer.");if(!a.availability().available){this.host.state("error","Selected dictation provider is unavailable.");return}let m=this.host.readDraft(),c=new AbortController,h,b,y=new Promise((L,R)=>{h=L,b=R}),x={controller:c,provider:a,chatJid:m.chatJid,revision:m.revision,start:Math.min(m.selectionStart,m.selectionEnd),end:Math.max(m.selectionStart,m.selectionEnd),text:m.text,segments:[],starting:y};this.current=x,this.host.state("loading"),Promise.resolve().then(()=>a.start({signal:c.signal,chatJid:m.chatJid,setState:(L)=>{if(this.current!==x||c.signal.aborted)return;if(L==="error")x.error="Dictation provider failed. Draft preserved.",this.cancel(),this.host.state("error",x.error);else if(!x.finishing||L!=="loading"&&L!=="recording")this.host.state(L)},updateSegment:(L)=>this.updateSegment(x,L)})).then(h,b);try{if(await this.bounded(y,c.signal),this.current===x&&!c.signal.aborted&&!x.finishing)this.host.state("recording")}catch{let L=c.signal.aborted;if(c.abort(),!L)x.error="Dictation could not start. Draft preserved.";if(this.cancel(),x.error&&this.current===x)this.host.state("error",x.error)}}updateSegment(a,m){if(this.current!==a||a.controller.signal.aborted||!m.segmentId||m.segmentId.length>128||typeof m.text!=="string"||m.text.length>65536||typeof m.final!=="boolean")return{applied:!1};let c=this.host.readDraft();if(c.chatJid!==a.chatJid||c.revision!==a.revision||c.text!==a.text)return{applied:!1};let h=a.segments.find((I)=>I.id===m.segmentId);if(h?.final)return{applied:h.text===m.text&&m.final};let b=a.segments.map((I)=>({...I})),y=b.findIndex((I)=>I.id===m.segmentId),x={id:m.segmentId,text:m.text,final:m.final};if(y<0){if(b.length>=256)return{applied:!1};b.push(x)}else b[y]=x;let C=b.map((I)=>I.text).join("");if(C.length>131072)return{applied:!1};let L=c.text.slice(0,a.start)+C+c.text.slice(a.end);if(!this.host.writeDraft(L,c.revision))return{applied:!1};let R=this.host.readDraft();if(R.chatJid!==a.chatJid||R.text!==L)return{applied:!1};return a.segments=b,a.end=a.start+C.length,a.text=L,a.revision=R.revision,{applied:!0}}draftChanged(a,m){let c=this.current;if(!c||c.controller.signal.aborted)return;if(a.chatJid!==c.chatJid||m.chatJid!==c.chatJid||a.revision!==c.revision||a.text!==c.text){this.cancel();return}let h=0;while(h<a.text.length&&h<m.text.length&&a.text[h]===m.text[h])h++;let b=0;while(b<a.text.length-h&&b<m.text.length-h&&a.text.at(-1-b)===m.text.at(-1-b))b++;let y=a.text.length-b,x=m.text.length-a.text.length;if(y<=c.start&&h<c.start)c.start+=x,c.end+=x;else if(h<c.end||c.start===c.end&&h===c.start){this.cancel();return}c.text=m.text,c.revision=m.revision}finish(){let a=this.current;if(!a)return Promise.resolve({status:"cancelled"});if(!a.finishing)this.host.state("finishing"),a.finishing=(async()=>{try{let m=await this.bounded(a.starting,a.controller.signal),c=await this.bounded(Promise.resolve().then(()=>m.finish()),a.controller.signal);if(a.error)throw Error("Dictation provider failed.");if(this.current!==a||a.controller.signal.aborted)return{status:"cancelled"};if(c.status!=="finished")return this.cancel(),{status:"cancelled"};return a.controller.abort(),this.current=void 0,this.host.state("idle"),c}catch{if(a.controller.signal.aborted&&!a.error)return{status:"cancelled"};if(this.current===a)a.error="Dictation could not finish. Draft preserved; send again explicitly.",this.cancel(),this.host.state("error",a.error);throw Error("Dictation finish failed.")}})();return a.finishing}cancel(){let a=this.current;if(!a)return Promise.resolve();if(a.controller.abort(),!a.cancelling)a.cancelling=(async()=>{try{await(await a.starting).cancel()}catch{a.error??="Dictation cleanup failed."}finally{if(this.current===a)if(this.current=void 0,a.error)this.host.state("error",a.error);else this.host.state("idle")}})();return a.cancelling}submit(a){if(this.pendingSubmit)return this.pendingSubmit;let m=this.current;return this.pendingSubmit=(async()=>{if(m){if((await this.finish()).status!=="finished")return!1}return await a(),!0})().finally(()=>{this.pendingSubmit=void 0}),this.pendingSubmit}bounded(a,m){return new Promise((c,h)=>{let b,y=()=>{clearTimeout(b),h(Error("Dictation cancelled."))};if(m.aborted){h(Error("Dictation cancelled."));return}m.addEventListener("abort",y,{once:!0}),b=setTimeout(()=>{m.removeEventListener("abort",y),h(Error("Dictation deadline exceeded."))},this.timeoutMs),a.then((x)=>{clearTimeout(b),m.removeEventListener("abort",y),c(x)},(x)=>{clearTimeout(b),m.removeEventListener("abort",y),h(x)})})}}function ic(a){let m=0,c=a.read(),h=!1,b=0,x=new Ws({readDraft:()=>(C(),{...a.read(),revision:m}),writeDraft:(I,N)=>{if(C(),h||m!==N)return!1;return a.write(I),m++,c={...a.read(),text:I},!0},state:a.state});function C(){let I=a.read();if(I.text!==c.text||I.chatJid!==c.chatJid){b++;let N={...c,revision:m};m++,c=I,x.draftChanged(N,{...I,revision:m})}}let L=Mn()?.provider,R=fo(()=>{let I=Mn()?.provider;if(I!==L){if(b++,x.active)x.cancel();if(I)a.providerSelected?.()}L=I});return{get selected(){return Mn()?.provider},get active(){return x.active},draftChanged:C,async toggle(){C();let I=Mn()?.provider;if(!I)return!1;if(x.active)await x.finish();else await x.start(I);return!0},submit(I){C();let N=b,F=a.read().chatJid,U=Mn()?.provider;return x.submit(async()=>{if(C(),h||b!==N||a.read().chatJid!==F||Mn()?.provider!==U)return;await I()})},async dispose(){h=!0,R(),await x.cancel()},cancel:()=>(b++,x.cancel())}}var Us="piclaw:statusbar-compose-slot";function Ys(){if(typeof document>"u")return null;return document.querySelector(".workbench-statusbar-compose")}function $n(){if(typeof window>"u")return;window.dispatchEvent(new CustomEvent("piclaw:statusbar-compose-slot"))}function mo(a){return String(a||"").toLowerCase().replace(/^@/,"").replace(/\s+/g," ").trim()}function Up(a,m){let c=mo(a),h=mo(m);if(!h)return!1;return c.startsWith(h)||c.includes(h)}function _t(a){if(!a)return!1;if(a.defaultPrevented||a.repeat)return!1;if(a.isComposing)return!1;if(a.ctrlKey||a.metaKey||a.altKey)return!1;return typeof a.key==="string"&&a.key.length===1&&/\S/.test(a.key)}function ac(a,m,c=Date.now(),h=700){let b=a&&typeof a==="object"?a:{value:"",updatedAt:0},y=String(m||"").trim().toLowerCase();if(!y)return{value:"",updatedAt:c};return{value:!b.value||!Number.isFinite(b.updatedAt)||c-b.updatedAt>h?y:`${b.value}${y}`,updatedAt:c}}function Yp(a,m){let c=Math.max(0,Number(a)||0);if(c<=0)return[];let b=((Number.isInteger(m)?m:0)%c+c)%c,y=[];for(let x=0;x<c;x+=1)y.push((b+x)%c);return y}function Vp(a,m,c=0,h=(b)=>b){let b=mo(m);if(!b)return-1;let y=Array.isArray(a)?a:[],x=Yp(y.length,c),C=y.map((L)=>mo(h(L)));for(let L of x)if(C[L].startsWith(b))return L;for(let L of x)if(C[L].includes(b))return L;return-1}function cc(a,m,c=-1,h=(b)=>b){let b=Array.isArray(a)?a:[];if(c>=0&&c<b.length){let y=h(b[c]);if(Up(y,m))return c}return Vp(b,m,0,h)}class Vs{publish;generation=0;constructor(a){this.publish=a}begin(a){let m=++this.generation;return this.publish("sending"),m}acknowledged(a){this.finished(a)}finished(a){if(a===this.generation)this.publish(null)}failed(a){this.finished(a)}reset(){this.generation++,this.publish(null)}}function go(a){return String(a||"").trim().toLowerCase()}function Js(a){let m=String(a||"").match(/^@([a-zA-Z0-9_-]*)$/);if(!m)return null;return go(m[1]||"")}function Jp(a){let m=new Set,c=[];for(let h of Array.isArray(a)?a:[]){let b=go(h?.agent_name);if(!b||m.has(b))continue;m.add(b),c.push(h)}return c}function lc(a,m,c={}){let h=Js(m);if(h==null)return[];let b=typeof c?.currentChatJid==="string"?c.currentChatJid:null;return Jp(a).filter((y)=>{if(b&&y?.chat_jid===b)return!1;return go(y?.agent_name).startsWith(h)})}function Qs(a){let m=go(a);return m?`@${m} `:""}var Qp={streaming:"Streaming",working:"Working",compacting:"Compacting",retrying:"Retrying",bash_running:"Running shell"};function ar(a){if(!a?.is_active)return"";let m=String(a.activity_status||"").trim();return Qp[m]||"Working"}function te(a,m=220){let c=String(a??"").replace(/\r\n?/g,`
`).replace(/!\[[^\]]*\]\([^)]*\)/g,"").replace(/\[([^\]]+)\]\([^)]*\)/g,"$1").replace(/```+/g,"").replace(/`([^`]+)`/g,"$1").replace(/^#{1,6}\s+/gm,"").replace(/^>\s?/gm,"").replace(/^\s*[-*+]\s+/gm,"").replace(/[*_~]{1,3}/g,"").replace(/\s+/g," ").trim();if(c.length<=m)return c;return`${c.slice(0,Math.max(0,m-1)).trimEnd()}…`}function dc(a){if(!a)return null;if(typeof a==="string")try{return dc(JSON.parse(a))}catch{return null}if(typeof a!=="object"||Array.isArray(a))return null;let m=a,c=m.arguments??m.input??m.params??m.parameters??m.args??m.payload;return c&&typeof c==="object"&&!Array.isArray(c)?c:m}function Xp(a){let m=te(a?.title,220);if(m)return m;let c=te(a?.tool_name??a?.toolName,220);if(!c)return"";let h=dc(a?.tool_args??a?.toolArgs);if(!h)return c;let y=[h.command,Array.isArray(h.commands)?h.commands.filter((x)=>typeof x==="string").join(" && "):"",h.path??h.filePath??h.target,Array.isArray(h.paths)?h.paths.filter((x)=>typeof x==="string").join(", "):"",h.fileName??h.filename??h.file,h.url,h.query].map((x)=>typeof x==="string"?te(x,120):"").filter(Boolean).sort((x,C)=>C.length-x.length)[0];return y?`${c}: ${y}`:c}function Zp(a){let m=typeof a?.type==="string"?a.type.trim():"";if(m!=="tool_call"&&m!=="tool_status")return null;let c=te(a.status??a.tool_status??a.toolStatus,220);if(m==="tool_status"&&/^(done|failed|cancelled|canceled|aborted)$/i.test(c))return null;let h=c&&!/^working(?:\.{3}|…)?$/i.test(c)?c:"",b=[Xp(a),h].filter(Boolean).join(" — ");return b?{kind:"tool",label:"Tool",text:te(b)}:null}function uc(a,m){let c=te(typeof m==="string"?m:m?.text);return c?{kind:a,label:a==="thinking"?"Thinking":"Draft",text:c}:null}function cr(a,m=null){if(!a||a.status!=="active")return{preview:null,retained:null};let c=a.data?.turn_id??a.data?.turnId,h=typeof c==="string"?c.trim():"",b=h&&m?.turnId===h?m:null,y=uc("draft",a.draft)||uc("thinking",a.thought),x=y&&h?{...y,turnId:h}:b;return{preview:y||Zp(a.data)||x,retained:x}}function ho(a){let m=typeof a==="string"?Date.parse(a):NaN;return Number.isFinite(m)?m:-1/0}function Qe(a,m){let c=ho(a.last_activity_at),h=ho(m.last_activity_at);if(c!==h)return h-c;let b=ho(a.archived_at),y=ho(m.archived_at);return b===y?0:y-b}function lr(a,m=Date.now()){let c=Date.parse(String(a??""));if(!Number.isFinite(c))return"";let h=Math.max(0,Math.round((m-c)/1000));if(h<60)return"now";let b=Math.round(h/60);if(b<60)return`${b}m`;let y=Math.round(b/60);if(y<24)return`${y}h`;let x=Math.round(y/24);if(x<7)return`${x}d`;return new Date(c).toLocaleDateString(void 0,{month:"short",day:"numeric"})}function $t(a){let m=Number(a?.context_percent??a?.contextPercent??a?.context_usage?.percent);if(Number.isFinite(m)&&m>=0)return Math.min(100,m);let c=Number(a?.context_tokens),h=Number(a?.context_window);if(Number.isFinite(c)&&Number.isFinite(h)&&h>0&&c>=0)return Math.min(100,c/h*100);return null}function ur(a){return Boolean(a?.ctrlKey||a?.metaKey||a?.button===1)}var ef={current:"Current",pinned:"Pinned",active:"Active",tree:"This session tree",other:"Other sessions",archived:"Archived"};function ue(a){return typeof a==="string"?a.trim():""}function Xs(a){if(a==null)return null;let m=Number(a);return Number.isFinite(m)&&m>=0?m:null}function pc(a){if(a>=1e6){let m=a/1e6;return`${Number.isInteger(m)?m.toFixed(0):m.toFixed(1)}M`}if(a>=1000)return`${Math.round(a/1000)}K`;return String(Math.round(a))}function fc(a){let m=ue(a?.model)||ue(a?.model_label),c=Xs(a?.context_tokens??a?.contextTokens??a?.context_usage?.tokens),h=Xs(a?.context_window??a?.contextWindow??a?.context_usage?.contextWindow),b=Xs(a?.context_percent??a?.contextPercent??a?.context_usage?.percent),y=b==null?null:Math.min(100,b),x=c!=null&&h!=null&&h>0?`${pc(c)} / ${pc(h)}${y==null?"":` (${Math.round(y)}% context)`}`:y==null?"":`${Math.round(y)}% context`;return[m,x].filter(Boolean).join(" · ")}function tf(a){let m=Boolean(a?.archived_at),c=Boolean(a?.is_active)&&!m;return[ue(a?.agent_name)?`@${ue(a.agent_name)}`:"",ue(a?.agent_name),ue(a?.chat_jid),ue(a?.root_chat_jid),ue(a?.model),ue(a?.model_label),ue(a?.provider),m?"archived":c?"active":"idle",ue(a?.parent_branch_id),ue(a?.branch_id)].filter(Boolean).join(" ").toLocaleLowerCase()}function mc(a,m){let c=ue(m).toLocaleLowerCase().split(/\s+/).filter(Boolean);if(c.length===0)return!0;let h=tf(a);return c.every((b)=>h.includes(b))}function nf(a,m){if(!mc(a,m))return 4;let c=ue(a?.agent_name).toLocaleLowerCase(),h=ue(m).toLocaleLowerCase().split(/\s+/).map((b)=>b.replace(/^@/,"")).filter(Boolean);if(!c||h.length===0)return 3;if(h.some((b)=>c===b))return 0;if(h.some((b)=>c.startsWith(b)))return 1;if(h.some((b)=>c.includes(b)))return 2;return 3}function gc(a,m){let c=0,h=Number.POSITIVE_INFINITY;for(let b=0;b<a.length;b+=1){let y=nf(a[b],m);if(y>=h)continue;if(c=b,h=y,y===0)break}return c}function hc(a,m){let c=ue(m);if(!c)return-1;return a.findIndex((h)=>ue(h?.chat_jid)===c)}function De(a,m){let c=ue(m).toLocaleLowerCase();if(!c)return a;let h=new Set(a.filter((y)=>mc(y,c)).map((y)=>ue(y.chat_jid))),b=new Map(a.map((y)=>[ue(y.branch_id),y]).filter(([y])=>Boolean(y)));for(let y of a){if(!h.has(ue(y.chat_jid)))continue;let x=ue(y.parent_branch_id);while(x){let C=b.get(x);if(!C)break;h.add(ue(C.chat_jid)),x=ue(C.parent_branch_id)}}return a.filter((y)=>h.has(ue(y.chat_jid)))}function Le(a,m,c=[]){let h=ue(m),b=a.find((L)=>ue(L.chat_jid)===h),y=ue(b?.root_chat_jid)||h,x=new Set(Array.from(c,ue).filter(Boolean)),C=new Map([["current",[]],["pinned",[]],["active",[]],["tree",[]],["other",[]],["archived",[]]]);for(let L of a){let R=ue(L.chat_jid),N=Boolean(L.archived_at)?"archived":R===h?"current":Boolean(L.is_active)?"active":x.has(R)?"pinned":(ue(L.root_chat_jid)||R)===y?"tree":"other";C.get(N).push(L)}return["current","active","pinned","tree","other","archived"].map((L)=>({key:L,label:ef[L],items:C.get(L).sort(Qe)})).filter((L)=>L.items.length>0)}function bc(a,m,c,h=8){if(m<=0)return 0;let b=Math.max(0,Math.min(a,m-1));if(c==="Home")return 0;if(c==="End")return m-1;if(c==="ArrowDown")return(b+1)%m;if(c==="ArrowUp")return(b-1+m)%m;if(c==="PageDown")return Math.min(m-1,b+h);if(c==="PageUp")return Math.max(0,b-h);return b}function yc(a={}){if(a.searchMode)return!1;return Boolean(a.showSessionSwitcherButton)}function wc(a,m,c={}){if(!a||a.isComposing)return!1;if(!yc(c))return!1;if(a.ctrlKey||a.metaKey||a.altKey)return!1;if(a.key!=="@")return!1;return String(m||"")===""}function Zs(a,m={}){if(!yc(m))return!1;return String(a||"")==="@"}function ne(a){let m=ei(a);return m?`@${m}`:""}function ei(a){return String(a||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").replace(/-{2,}/g,"-")}function Tt(a,m=""){let c=String(a||""),h=ei(c),b=ei(m);if(!c.trim())return{normalized:h,handle:"",canSubmit:!1,kind:"error",message:"Enter a branch handle."};if(!h)return{normalized:h,handle:"",canSubmit:!1,kind:"error",message:"Handle must contain at least one letter or number."};let y=`@${h}`;if(h===b)return{normalized:h,handle:y,canSubmit:!1,kind:"info",message:`Already using ${y}.`};if(h!==c.trim())return{normalized:h,handle:y,canSubmit:!0,kind:"info",message:`Will save as ${y}. Letters, numbers, - and _ are allowed; leading @ is optional.`};return{normalized:h,handle:y,canSubmit:!0,kind:"success",message:`Saving as ${y}.`}}function Ye(a,m={}){let c=[],h=typeof m.currentChatJid==="string"?m.currentChatJid.trim():"",b=typeof a?.chat_jid==="string"?a.chat_jid.trim():"";if(h&&b===h)c.push("current");if(a?.archived_at)c.push("archived");else{if(a?.is_compacting||a?.activity_status==="compacting")c.push("compacting");if(a?.is_active)c.push("active")}return c}function vc(a){let m=ne(a?.agent_name)||String(a?.chat_jid||"").trim(),c=typeof a?.chat_jid==="string"&&a.chat_jid.trim()?a.chat_jid.trim():"unknown-chat";return`${m} — ${c}`}function Et(a,m={}){let c=Ye(a,m);return c.length>0?`${vc(a)} • ${c.join(" • ")}`:vc(a)}function dr(a,m,c){let h=ne(a),b=ne(m),y=String(c||"").trim();if(h&&b&&h!==b)return`Restored archived ${h} as ${b} because ${h} is already in use.`;if(b)return`Restored ${b}.`;if(h)return`Restored ${h}.`;return`Restored ${y||"branch"}.`}function It({steerQueued:a=!1,pulsing:m=!1}={}){let c=["turn-dot"];if(a)c.push("turn-dot-queued");if(m)c.push("turn-dot-pulsing");return c.join(" ")}function ti({pulsing:a=!1}={}){let m=["compose-inline-status-dot"];if(a)m.push("compose-inline-status-dot-pulsing");return m.join(" ")}function Ze(a,{isLastActivity:m=!1,pendingRequest:c=!1}={}){if(c)return"dot";if(m)return"none";if(a?.type==="error")return"none";let h=typeof a?.type==="string"?a.type:"";if(Boolean(typeof a?.tool_name==="string"&&a.tool_name.trim()||a?.tool_args))return"spinner";if(a?.type==="intent")return"dot";if(h==="tool_call"||h==="tool_status"||h==="thinking"||h==="waiting")return"spinner";return"dot"}function pr(a,m={}){return Ze(a,m)==="dot"}var Sc=350;function rf(a){return String(a||"Connecting").replace(/[-_]+/g," ").replace(/^./,(m)=>m.toUpperCase())}function of(a,m={}){let c=typeof a==="string"&&a.trim()?a.trim():"connecting";if(c==="connected")return{show:!1,statusClass:"connected",label:"Connected",title:"Connection: Connected"};if(c!=="disconnected"){let C=rf(c);return{show:!0,statusClass:c,label:C,title:`Connection: ${C}`}}let h=Number.isFinite(Number(m?.delayMs))?Math.max(0,Number(m.delayMs)):Sc,b=Number.isFinite(Number(m?.nowMs))?Number(m.nowMs):Date.now(),y=Number.isFinite(Number(m?.disconnectedAtMs))?Number(m.disconnectedAtMs):b;return b-y>=h?{show:!0,statusClass:"disconnected",label:"Reconnecting",title:"Reconnecting"}:{show:!1,statusClass:"connecting",label:"Connecting",title:"Connecting"}}function $c(a,m={}){let c=Number.isFinite(Number(m?.delayMs))?Math.max(0,Number(m.delayMs)):Sc,[h,b]=t(null),[y,x]=t(()=>Date.now());return o(()=>{if(a==="disconnected"){let C=Date.now();b((L)=>L??C),x(C);return}b(null),x(Date.now())},[a]),o(()=>{if(a!=="disconnected"||h===null)return;let C=c-(Date.now()-h);if(C<=0)return;let L=0,R=0,I=setTimeout(()=>{if(typeof requestAnimationFrame!=="function"){x(Date.now());return}L=requestAnimationFrame(()=>{R=requestAnimationFrame(()=>{x(Date.now())})})},C);return()=>{if(clearTimeout(I),L)cancelAnimationFrame(L);if(R)cancelAnimationFrame(R)}},[a,h,c]),i(()=>of(a,{delayMs:c,disconnectedAtMs:h,nowMs:y}),[a,c,h,y])}function _({prefix:a="file",label:m,title:c,onRemove:h,onClick:b,removeTitle:y="Remove",icon:x="file"}){let C=`${a}-file-pill`,L=`${a}-file-name`,R=`${a}-file-remove`,I=x==="message"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>`:x==="folder"?e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>`:e`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>`;return e`
    <span class=${C} title=${c||m} onClick=${b}>
      ${I}
      <span class=${L}>${m}</span>
      ${h&&e`
        <button
          class=${R}
          onClick=${(N)=>{N.preventDefault(),N.stopPropagation(),h()}}
          title=${y}
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `}
    </span>
  `}async function ni(a,m,c,h){if(typeof a!=="function")return!1;try{let b=await a(m);if(!b)return!1;return c(b),h?.(b),!0}catch(b){return!1}}var sf=0;function kc(a,m){return`compose-model-option-${a}-${encodeURIComponent(m)}`}function af(a){let m=[],c=re(a.contextWindow);if(c)m.push(c);if(a.reasoning)m.push("reasoning");return m.push(...a.variants.filter((h)=>h!=="stable").slice(0,2)),m}function xc({anchor:a=null,entries:m,loading:c=!1,switching:h=!1,onSelect:b,onTogglePin:y,onClose:x,onCompact:C,onOpenSettings:L,thinkingLevel:R=null,thinkingLevels:I=[],onSelectThinking:N,rootRef:F}){let[U,q]=t(""),[Q,Y]=t(null),W=r(null),X=r(new Map),H=r(null);if(H.current==null)H.current=++sf;let ce=`compose-model-search-${H.current}`,xe=`compose-model-results-${H.current}`,de=i(()=>mr(m,{query:U}),[m,U]),He=i(()=>de.renderedEntries,[de]);o(()=>{W.current?.focus()},[]),o(()=>{if(He.some((Ne)=>Ne.key===Q))return;let O=He.find((Ne)=>Ne.current);Y(O?.key??He[0]?.key??null)},[Q,He]),o(()=>{X.current.get(Q)?.scrollIntoView?.({block:"nearest"})},[Q]);let Kt=n((O)=>{if(!O||h)return;b(O)},[b,h]),cn=n((O)=>{if(O.isComposing)return;let Ne={ArrowDown:"next",ArrowUp:"previous",Home:"first",End:"last",PageDown:"page-next",PageUp:"page-previous"};if(O.key==="Escape"){O.preventDefault(),x();return}if(O.target!==W.current)return;if(O.key==="Enter"){let jt=de.renderedEntries.find((qe)=>qe.key===Q);if(jt)if(O.preventDefault(),O.altKey)y?.(jt);else Kt(jt);return}let Wt=Ne[O.key];if(!Wt||(O.key==="Home"||O.key==="End")&&!O.ctrlKey&&!O.metaKey)return;O.preventDefault(),Y(gr(de.renderedEntries,Q,Wt))},[Q,Kt,x,y,de.renderedEntries]),Lr=(O)=>{let Ne=O.current,Wt=O.key===Q,jt=af(O);return e`
            <button
                id=${kc(H.current,O.key)}
                key=${O.key}
                type="button"
                role="option"
                aria-label=${`${O.displayName}, ${O.pinned?"pinned":"not pinned"}. Alt+Enter to ${O.pinned?"unpin":"pin"}.`}
                aria-keyshortcuts="Alt+Enter"
                aria-selected=${Ne?"true":"false"}
                tabIndex=${-1}
                class=${`compose-model-catalogue-option${Ne?" selected":""}${Wt?" focused":""}`}
                ref=${(qe)=>qe?X.current.set(O.key,qe):X.current.delete(O.key)}
                onMouseDown=${(qe)=>qe.preventDefault()}
                onMouseEnter=${()=>Y(O.key)}
                onClick=${()=>Kt(O)}
            >
                <span
                    class=${`compose-model-catalogue-pin${O.pinned?" pinned":""}`}
                    aria-hidden="true"
                    title=${O.pinned?"Unpin model":"Pin model"}
                    onClick=${(qe)=>{qe.preventDefault(),qe.stopPropagation(),Y(O.key),y?.(O)}}
                >${O.pinned?"★":"☆"}</span>
                <span class="compose-model-catalogue-option-content">
                    <span class="compose-model-catalogue-option-primary">
                        <span class="compose-model-catalogue-option-name">${O.displayName}</span>
                        ${ye(O.pricing)&&e`<span class="compose-model-catalogue-option-price">${ye(O.pricing)}</span>`}
                    </span>
                    ${O.displayName!==O.key&&e`<span class="compose-model-catalogue-option-key">${O.key}</span>`}
                    ${jt.length>0&&e`
                        <span class="compose-model-catalogue-option-badges">
                            ${jt.map((qe)=>e`<span class="compose-model-catalogue-badge" key=${qe}>${qe}</span>`)}
                        </span>
                    `}

                </span>
            </button>
        `};return e`
        <div
            class=${`compose-model-popup compose-model-catalogue${a?" is-statusbar-anchored":""}`}
            style=${a?`--model-popup-left: ${a.left}px; --model-popup-bottom: ${a.bottom}px`:void 0}
            data-compose-model-catalogue="true"
            ref=${F}
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
                    ${c&&e`<span>Refreshing…</span>`}
                </div>
            </div>
            <div id=${xe} class="compose-model-popup-menu compose-model-catalogue-results" role="listbox" aria-label="Models">
                ${de.sections.map((O)=>e`
                    <section class=${`compose-model-catalogue-section ${`compose-model-catalogue-section--${O.key}`}`} key=${O.key} role="presentation">
                        <div class="compose-model-catalogue-section-heading" role="presentation">
                            <span>${O.label}</span><span>${O.totalCount}</span>
                        </div>
                        ${O.entries.map(Lr)}
                        ${O.groups.map((Ne)=>e`
                            <div class="compose-model-catalogue-group" key=${Ne.key} role="group" aria-label=${Ne.label}>
                                <div class="compose-model-catalogue-group-heading" role="presentation">
                                    <span>${Ne.label}</span><span>${Ne.totalCount}</span>
                                </div>
                                ${Ne.entries.map(Lr)}
                            </div>
                        `)}
                    </section>
                `)}
                ${de.totalMatches===0&&e`
                    <div class="compose-model-popup-empty">
                        ${c?"Loading models…":U?`No models match “${U}”.`:"No models available."}
                    </div>
                `}
                ${de.hiddenCount>0&&e`<div class="compose-model-catalogue-limit-note">Showing ${de.renderedEntries.length} of ${de.totalMatches}; refine your search to see more.</div>`}
            </div>
            <div class="compose-model-catalogue-footer">
                <div class="compose-model-catalogue-footer-start">
                    ${I.length>0&&e`
                        <label class="compose-model-catalogue-thinking">
                            <span>Thinking</span>
                            <select
                                aria-label="Thinking level"
                                value=${R||I[0]?.id||""}
                                disabled=${h||typeof N!=="function"}
                                onChange=${(O)=>N?.(O.currentTarget.value)}
                            >
                                ${I.map((O)=>e`<option key=${O.id} value=${O.id}>${O.label}</option>`)}
                            </select>
                        </label>
                    `}
                    ${C&&e`<button type="button" class="compose-model-popup-btn" onClick=${C}>Compact context</button>`}
                </div>
                ${L&&e`<button type="button" class="compose-model-popup-btn primary" onClick=${L}>Open Models settings</button>`}
            </div>
        </div>
    `}function cf(a={}){let m=a.navigator??(typeof navigator<"u"?navigator:null);if(!m)return!1;let c=String(m.userAgent||"");if(/iPad|iPhone/.test(c))return!0;return m.platform==="MacIntel"&&Number(m.maxTouchPoints||0)>1}function lf(a={}){let m=a.window??(typeof window<"u"?window:null);if(!m)return null;return m.SpeechRecognition||m.webkitSpeechRecognition||null}function ri(a={}){let m=a.window??(typeof window<"u"?window:null),c=typeof a.secureContext==="boolean"?a.secureContext:Boolean(m?.isSecureContext),h=k(a),b=cf(a),y=lf(a);if(!c)return{mode:"unavailable",showButton:!1,canStart:!1,reason:"secure-context-required",title:"Voice input requires HTTPS",detail:"Native browser speech input needs a secure context (HTTPS or localhost).",recognitionCtor:null,ios:b,standalone:h,secureContext:c};if(b&&h)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-standalone-fallback",title:"Use keyboard dictation",detail:"Speech input is intentionally downgraded in iPhone/iPad standalone web apps because browser-native recognition is not reliable there. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:y,ios:b,standalone:h,secureContext:c};if(!y){if(b)return{mode:"fallback",showButton:!0,canStart:!1,reason:"ios-keyboard-dictation",title:"Use keyboard dictation",detail:"This browser does not expose native in-page speech recognition here. Focus the compose box and use the keyboard dictation mic instead.",recognitionCtor:null,ios:b,standalone:h,secureContext:c};return{mode:"unavailable",showButton:!1,canStart:!1,reason:"unsupported",title:"Voice input unavailable",detail:"This browser does not expose native speech recognition in this context.",recognitionCtor:null,ios:b,standalone:h,secureContext:c}}return{mode:"native",showButton:!0,canStart:!0,reason:"supported",title:"Start voice input",detail:b?"Browser-native speech input is available here, but Safari/WebKit reliability may still vary.":"Browser-native speech input is available.",recognitionCtor:y,ios:b,standalone:h,secureContext:c}}function _c(a,m="",c=""){let h=String(a||""),b=String(m||"").trim(),y=String(c||"").trim(),x=[b,y].filter(Boolean).join(" ").trim();if(!x)return h;if(!h)return x;let C=/[\s\n]$/.test(h)?"":" ";return`${h}${C}${x}`}function Ec(a,m=0){let c="",h="",b=a&&typeof a.length==="number"?a:[];for(let y=Math.max(0,m);y<b.length;y+=1){let x=b[y];if(!x||!x[0])continue;let C=String(x[0].transcript||"").trim();if(!C)continue;if(x.isFinal)c=`${c} ${C}`.trim();else h=`${h} ${C}`.trim()}return{finalText:c,interimText:h}}function oi(a,m=null){let c=String(a||"").trim().toLowerCase();switch(c){case"not-allowed":case"service-not-allowed":return m?.ios?"Microphone or speech-recognition permission was denied. On iPhone/iPad, using keyboard dictation may be more reliable.":"Microphone or speech-recognition permission was denied by the browser.";case"no-speech":return"No speech was detected. Try again and speak after the listening indicator appears.";case"audio-capture":return"The browser could not access a microphone for speech recognition.";case"network":return"The browser speech-recognition service reported a network or service failure.";case"aborted":return"Voice input was stopped.";default:return c?`Voice input failed (${c}).`:"Voice input failed."}}var uf=[{name:"/model",description:"Select model or list available models"},{name:"/cycle-model",description:"Cycle to the next available model"},{name:"/thinking",description:"Show or set thinking/effort level"},{name:"/effort",description:"Show or set thinking/effort level (alias for /thinking)"},{name:"/cycle-thinking",description:"Cycle thinking level"},{name:"/theme",description:"Set UI theme (no name to show available themes)"},{name:"/tint",description:"Tint default light/dark UI (usage: /tint #hex or /tint off)"},{name:"/btw",description:"Open a side conversation panel without interrupting the main chat"},{name:"/state",description:"Show current session state"},{name:"/stats",description:"Show session token and cost stats"},{name:"/context",description:"Show context window usage"},{name:"/quota",description:"Show cached provider quota / rate-limit usage"},{name:"/last",description:"Show last assistant response"},{name:"/compact",description:"Manually compact the session"},{name:"/auto-compact",description:"Toggle auto-compaction"},{name:"/auto-retry",description:"Toggle auto-retry"},{name:"/abort",description:"Abort the current response"},{name:"/abort-retry",description:"Abort retry backoff"},{name:"/abort-bash",description:"Abort running bash command"},{name:"/shell",description:"Run a shell command and return output"},{name:"/bash",description:"Run a shell command and add output to context"},{name:"/queue",description:"Queue a follow-up message (one-at-a-time)"},{name:"/queue-all",description:"Queue a follow-up message (batch all)"},{name:"/steer",description:"Steer the current response"},{name:"/steering-mode",description:"Set steering mode (all|one)"},{name:"/followup-mode",description:"Set follow-up mode (all|one)"},{name:"/session-name",description:"Set or show the session name"},{name:"/new-session",description:"Start a new session"},{name:"/switch-session",description:"Switch to a session file"},{name:"/session-rotate",description:"Rotate the current persisted session into an archived file"},{name:"/rollup",description:"Merge the current branch chat back into its parent chat"},{name:"/clone",description:"Duplicate the current active branch into a new session"},{name:"/fork",description:"Fork from a previous message"},{name:"/forks",description:"List forkable messages"},{name:"/tree",description:"List the session tree"},{name:"/label",description:"Set or clear a label on a tree entry"},{name:"/labels",description:"List labeled entries"},{name:"/agent-name",description:"Set or show the agent display name"},{name:"/agent-avatar",description:"Set or show the agent avatar URL"},{name:"/user-name",description:"Set or show your display name"},{name:"/user-avatar",description:"Set or show your avatar URL"},{name:"/user-github",description:"Set name/avatar from GitHub profile"},{name:"/export-html",description:"Export session to HTML"},{name:"/passkey",description:"Manage passkeys (enrol/list/delete)"},{name:"/totp",description:"Show a TOTP enrolment QR code"},{name:"/qr",description:"Generate a QR code for text or URL"},{name:"/search",description:"Search notes and skills in the workspace"},{name:"/dream",description:"Run Dream memory maintenance over recent days (default 7)"},{name:"/tasks",description:"List scheduled tasks"},{name:"/scheduled",description:"List scheduled tasks"},{name:"/pair",description:"Manage remote peer connections (/pair request <url> | /pair list)"},{name:"/ask",description:"Send a prompt to a paired remote instance (/ask <instance_id|fingerprint> <prompt>)"},{name:"/restart",description:"Restart the agent and stop subprocesses"},{name:"/exit",description:"Exit the current piclaw process immediately (Supervisor will restart it)"},{name:"/login",description:"Login to an AI model provider (OAuth or API key)"},{name:"/logout",description:"Logout from an AI model provider"},{name:"/settings",description:"Open the settings pane"},{name:"/help",description:"Open keyboard shortcuts help"},{name:"/commands",description:"List available commands"},{name:"/skill:",description:"Run a workspace skill (e.g. /skill:visual-artifact-generator, /skill:web-search)"}],Cc="piclaw_compose_history",si="piclaw_compose_height",df=50,Ac=70,Rc=300,Pc=520;function Dc(){if(typeof window>"u")return Ac;return window.innerWidth>=1024?Ac:df}function pf(){if(typeof window>"u")return Rc;return Math.min(Math.floor(window.innerHeight*0.4),Rc)}function ff(){if(typeof window>"u")return Pc;return Math.min(Math.floor(window.innerHeight*0.5),Pc)}function ii(a){let m=Dc(),c=Math.max(m,ff());return Math.min(Math.max(Math.round(Number(a)||m),m),c)}function mf(a=null,m=si){let c=a?.getItem?.(m)??g(m);if(!c)return null;let h=parseInt(c,10);return Number.isFinite(h)?ii(h):null}function gf(a,m,c=!1){if(c)return{shouldApply:!1,nextToken:m,text:""};if(!a||typeof a!=="object")return{shouldApply:!1,nextToken:m,text:""};let h=typeof a.token==="string"?a.token:"",b=typeof a.text==="string"?a.text:"";if(!h||h===m||!b.trim())return{shouldApply:!1,nextToken:m,text:""};return{shouldApply:!0,nextToken:h,text:b}}function hf(a="web:default"){let m=typeof a==="string"&&a.trim()?a.trim():"web:default";if(m==="web:default")return Cc;return`${Cc}:${encodeURIComponent(m)}`}function me(a,m=null,c=null){let h=new Set,b=c instanceof Set?c:new Set(Array.isArray(c)?c:[]),y=[];for(let x of Array.isArray(a)?a:[]){let C=typeof x?.chat_jid==="string"?x.chat_jid.trim():"";if(!C||h.has(C)||b.has(C))continue;if(!(typeof x?.agent_name==="string"?x.agent_name.trim():""))continue;h.add(C),y.push(x)}return y.sort((x,C)=>{let L=Boolean(x?.archived_at),R=Boolean(C?.archived_at);if(L!==R)return L?1:-1;let I=String(x?.agent_name||"").trim(),N=String(C?.agent_name||"").trim(),F=I.localeCompare(N,void 0,{sensitivity:"base"});if(F!==0)return F;let U=String(x?.chat_jid||"").trim(),q=String(C?.chat_jid||"").trim();return U.localeCompare(q,void 0,{sensitivity:"base"})}),y}function bf(a){return Boolean(a?.is_active&&!a?.archived_at)}function yf(a,m=null){let c=Array.isArray(a)?a:[],h=typeof m==="string"?m.trim():"";if(h){let y=c.findIndex((x)=>{if(x?.disabled)return!1;if(x?.type!=="session")return!1;return(typeof x?.chat?.chat_jid==="string"?x.chat.chat_jid.trim():"")===h});if(y>=0)return y}let b=c.findIndex((y)=>!y?.disabled);return b>=0?b:0}function Lc(a,m){let c=typeof m?.command?.message==="string"?m.command.message.trim():"";if(!m?.ui_only||!c)return null;let h=typeof a==="string"?a.trim():"";if(!h.startsWith("/"))return null;let b=h.split(/\s+/).filter(Boolean),y=b[0]?.toLowerCase()||"";if(!(b.length>1)&&(y==="/thinking"||y==="/effort"))return c;return null}function wf(a,m,c=!1){if(a)return{mode:"queue",className:"icon-btn send-btn queue-mode",title:"Queue follow-up (Enter)",ariaLabel:"Queue follow-up message",disabled:!m};return{mode:"send",className:"icon-btn send-btn",title:"Send (Enter)",ariaLabel:"Send message",disabled:!m}}function Tc(a,m,c={}){if(!a||c.searchMode)return!1;if(!(a.key===" "||a.key==="Spacebar"||a.code==="Space"))return!1;if(a.ctrlKey||a.metaKey||a.altKey||a.repeat)return!1;if(!c.speechButtonVisible||c.speechButtonActive)return!1;if(!c.canStartSpeech)return!1;return String(m||"").trim().length===0}function vf(a,m){if(!m||!a)return!1;return a.key===" "||a.key==="Spacebar"||a.code==="Space"}function Sf(a,m=!1){if(!a)return null;if(m)return{mode:"compacting",className:"icon-btn send-btn abort-mode compacting-mode",title:"Compacting context — Stop response",ariaLabel:"Compacting context — Stop response",disabled:!1};return{mode:"abort",className:"icon-btn send-btn abort-mode",title:"Stop response",ariaLabel:"Stop response",disabled:!1}}function $f(a){return a==="abort"||a==="compacting"}function kf(a,m=0){if(a?.visible===!1)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};let c=typeof a?.message==="string"&&a.message.trim()?a.message.trim():null,h=a?.indicator&&typeof a.indicator==="object"?a.indicator:null;if(!c&&!h)return{visible:!1,title:"",indicatorText:null,animateDot:!1,animateSpinner:!1};if(h?.mode==="hidden")return{visible:Boolean(c),title:c||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!1};if(h?.mode==="custom"&&Array.isArray(h.frames)&&h.frames.length>0){let b=h.frames,y=Number.isFinite(m)&&m>=0?Math.floor(m)%b.length:0;return{visible:!0,title:c||"Thinking…",indicatorText:b[y],animateDot:!1,animateSpinner:!1}}return{visible:!0,title:c||"Thinking…",indicatorText:null,animateDot:!1,animateSpinner:!0}}function xf({usage:a,onCompact:m,compactionLabel:c="",compactionTitle:h=""}){let b=Number.isFinite(a.percent)?Math.min(100,Math.max(0,a.percent)):null,y=Number.isFinite(a.tokens)&&a.tokens>=0?a.tokens:null,x=Number.isFinite(a.contextWindow)&&a.contextWindow>0?a.contextWindow:null,C=typeof m==="function",L=C?"Compact context":"Context usage",R=b==null?"unavailable":`${b.toFixed(0)}%`,I=`Context: ${vo(y)} / ${vo(x)} tokens (${R})`,N=typeof c==="string"?c.trim():"",F=typeof h==="string"?h.trim():"",U=N?`${I}
${F||"Smart compaction"} · ${N}`:`${I}
${L}`,q=9,Q=2*Math.PI*9,Y=(b??0)/100*Q,W=b==null?"var(--text-secondary)":b>90?"var(--context-red, #ef4444)":b>75?"var(--context-amber, #f59e0b)":"var(--context-green, #22c55e)";return e`
        <button
            class=${`compose-context-pie icon-btn${N?" is-compacting":""}`}
            type="button"
            title=${U}
            aria-label=${U}
            disabled=${!C}
            onClick=${(X)=>{if(X.preventDefault(),X.stopPropagation(),C)m()}}
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
    `}function vo(a){if(a==null)return"?";if(a>=1e6)return(a/1e6).toFixed(1)+"M";if(a>=1000)return(a/1000).toFixed(0)+"K";return String(a)}function Dt(a){if(a==null)return null;let m=Number(a);return Number.isFinite(m)?m:null}function _f(a){if(!a||typeof a!=="object")return null;let m=Dt(a.cacheHitRate);if(m!=null)return m;let c=Dt(a.inputTokens)??0,h=Dt(a.cacheReadTokens)??0,b=Dt(a.cacheWriteTokens)??0,y=c+h+b;if(a.cacheReadReported===!1||y<=0)return null;if(h<=0&&a.cacheReadReported!==!0)return null;return h/y*100}function Ef(a){let m=Dt(a);if(m==null)return null;return`${Math.max(0,Math.min(100,m)).toFixed(1)}%`}function Gn(a,m){let c=Dt(m);return c!=null?`${a} ${vo(c)}`:null}function yo(a,m="USD"){let c=Dt(a);if(c==null||c<0)return null;let h=c.toFixed(c>=0.01?2:4);return m==="USD"?`$${h}`:m?`${m} ${h}`:`${h} (currency unknown)`}function Cf(a){if(a?.provider!=="openrouter"||a?.availability!=="available")return null;return[`Key spend: ${yo(a.key_usage_usd)||"unavailable"}`,`Key limit: ${a.key_limit_configured===!0?yo(a.key_limit_usd)||"unavailable":a.key_limit_unlimited?"not configured (unlimited)":"unavailable"}`,`Key remaining: ${yo(a.key_limit_remaining_usd)||"unavailable"}`].join(" • ")}function Af(a,m=null){let c=a&&typeof a==="object"?a.cacheUsage:null;if(!c||typeof c!=="object")return null;let h=c.latest&&typeof c.latest==="object"?c.latest:null;if(!h)return null;let b=typeof h.provider==="string"&&h.provider.trim()?h.provider.trim():null,y=typeof h.model==="string"&&h.model.trim()?h.model.trim():null,x=y?!b||y.startsWith(`${b}/`)?y:`${b}/${y}`:b,C=typeof h.responseModel==="string"&&h.responseModel.trim()?h.responseModel.trim():null,L=ai(m,x),R=Boolean(m&&x&&!L),I=_f(h),N=Ef(I),F=N?`CH${N}`:"CH—",U=Dt(h.totalTokens),q=yo(h.costTotal,h.costProvenance==="provider_reported"?h.providerCostCurrency??null:"USD"),Q=typeof h.costProvenance==="string"?h.costProvenance:null,Y=Q==="provider_reported"?q:Q==="catalogue_estimate"&&q?`~${q}`:null,W=R?"Prev":"Last",X=[Gn("in",h.inputTokens),Gn("out",h.outputTokens),Gn("reason",h.reasoningTokens),Gn("cache-r",h.cacheReadTokens),Gn("cache-w",h.cacheWriteTokens),Gn("total",h.totalTokens)].filter(Boolean).join(", "),H=Q==="provider_reported"&&q?`Provider-reported cost: ${q}`:Q==="catalogue_estimate"&&q?`Catalogue cost estimate: ~${q}`:"Cost unavailable",ce=N?`Prompt cache hit: ${N}`:h.cacheReadReported===!1?"Prompt cache telemetry unavailable":"Prompt cache hit unavailable",xe=[`${R?"Previous":"Latest"} run${x?`: ${x}`:""}`,C&&C!==h.model?`Response model: ${C}`:null,X||null,ce,H].filter(Boolean);return{label:[R?W:null,U==null?null:vo(U),F,Y].filter(Boolean).join(" • "),title:xe.join(" • "),cacheHitRate:I,costTotal:Dt(h.costTotal),costProvenance:Q,requestedModel:x,responseModel:C,isPreviousModel:R}}function Rf(a){if(!a||typeof a!=="object")return"Price unknown";let m=[["in",a.input_per_million??a.inputPerMillion],["out",a.output_per_million??a.outputPerMillion],["cache-r",a.cache_read_per_million??a.cacheReadPerMillion],["cache-w",a.cache_write_per_million??a.cacheWritePerMillion]].map(([c,h])=>{let b=Dt(h);if(b==null||b<0)return null;return`${c} $${b.toFixed(b>=1?2:4).replace(/0+$/,"").replace(/\.$/,"")}`}).filter(Boolean);return m.length>0?`${m.join(" / ")} per 1M`:"Price unknown"}function bo(a,m){let c=v(m);return B(a,{...he(c)})}function Pf(a){let m=Array.isArray(a?.model_options)&&a.model_options.length>0;return B(a).map((c)=>({label:c.key,provider:c.provider,id:c.id,name:c.displayName===c.key?null:c.displayName,contextWindow:c.contextWindow,pricing:c.pricing,reasoning:m?c.reasoning:null,...c.current?{current:!0}:{}}))}function Lf(a,m){let c=typeof a==="string"?a.trim():"";if(c)return{showPicker:!0,label:c,hasAvailableModels:!0};let h=Pf(m).length>0||Number(m?.available_model_count)>0;return{showPicker:h,label:h?"Select model":"",hasAvailableModels:h}}function wo(a){return(typeof a==="string"?a.trim():"")||null}function So(a){return wo(a)?.toLowerCase()??null}function jc(a,m){let c=So(a),h=So(m);if(!c||!h)return!1;return c===h||c.endsWith(`/${h}`)||h.endsWith(`/${c}`)}function ai(a,m){let c=So(a),h=So(m);if(!c||!h)return!1;return c.includes("/")&&h.includes("/")?c===h:jc(c,h)}function Tf(a,m){let c=m&&typeof m==="object"?m:{},h=wo(c.latest_response_model??c.response_model??c.responseModel??c.routed_model??c.routedModel);if(!h)return null;let b=wo(c.latest_requested_model??c.requested_model??c.requestedModel??c.current??c.model??a);if(b&&jc(h,b))return null;let y=wo(a??c.current??c.model);if(y&&b&&!ai(y,b))return null;return{label:`Routed: ${h}`,title:b?`Requested model: ${b} • Routed model: ${h}`:`Routed model: ${h}`,requestedModel:b,responseModel:h}}function Mf(a){if(!a)return a;let m=a.replace(/\r\n/g,`
`).replace(/\r/g,`
`);if(!m.includes(" @ ")||!m.includes(`:
`))return a;let c=m.split(`
`),h=[],b=0,y=!1;while(b<c.length){let C=c[b].trim();if(!C){b+=1;continue}if(C==="Messages:"||C.startsWith("Channel:")||C.startsWith("Chat:")){y=!0,b+=1;continue}if(/^[^\n]+\s@\s[^\n]+:$/.test(C)){y=!0,b+=1;let L=[];while(b<c.length){let R=c[b],I=R.trim();if(/^[^\n]+\s@\s[^\n]+:$/.test(I))break;if(I.startsWith("Channel:")||I.startsWith("Chat:")||I==="Messages:")break;L.push(R.startsWith("  ")?R.slice(2):R),b+=1}if(L.length>0)h.push(L.join(`
`).trim());continue}return a}return y&&h.length>0?h.filter(Boolean).join(`

`):a}function Ic(a){let m=String(a||"").trim(),c=m.match(/^`([^`]+)`$/);return(c?c[1]:m).trim()}function Df(a){if(!a)return{content:a,fileRefs:[]};let c=a.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),h=-1;for(let R=0;R<c.length;R+=1)if(c[R].trim()==="Files:"&&c[R+1]&&/^\s*-\s+/.test(c[R+1])){h=R;break}if(h===-1)return{content:a,fileRefs:[]};let b=[],y=h+1;for(;y<c.length;y+=1){let R=c[y];if(/^\s*-\s+/.test(R)){let I=Ic(R.replace(/^\s*-\s+/,"").trim());if(I)b.push(I)}else if(!R.trim())break;else break}if(b.length===0)return{content:a,fileRefs:[]};let x=c.slice(0,h),C=c.slice(y);return{content:[...x,...C].join(`
`).replace(/\n{3,}/g,`

`).trim(),fileRefs:b}}function jf(a){if(!a)return{content:a,folderRefs:[]};let c=a.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),h=-1;for(let R=0;R<c.length;R+=1)if(c[R].trim()==="Folders:"&&c[R+1]&&/^\s*-\s+/.test(c[R+1])){h=R;break}if(h===-1)return{content:a,folderRefs:[]};let b=[],y=h+1;for(;y<c.length;y+=1){let R=c[y];if(/^\s*-\s+/.test(R)){let I=Ic(R.replace(/^\s*-\s+/,"").trim());if(I)b.push(I)}else if(!R.trim())break;else break}if(b.length===0)return{content:a,folderRefs:[]};let x=c.slice(0,h),C=c.slice(y);return{content:[...x,...C].join(`
`).replace(/\n{3,}/g,`

`).trim(),folderRefs:b}}function If(a){if(!a)return{content:a,messageRefs:[]};let c=a.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),h=-1;for(let R=0;R<c.length;R+=1)if(c[R].trim()==="Referenced messages:"&&c[R+1]&&/^\s*-\s+/.test(c[R+1])){h=R;break}if(h===-1)return{content:a,messageRefs:[]};let b=[],y=h+1;for(;y<c.length;y+=1){let R=c[y];if(/^\s*-\s+/.test(R)){let I=R.replace(/^\s*-\s+/,"").trim().match(/^message:(\S+)$/i);if(I)b.push(I[1])}else if(!R.trim())break;else break}if(b.length===0)return{content:a,messageRefs:[]};let x=c.slice(0,h),C=c.slice(y);return{content:[...x,...C].join(`
`).replace(/\n{3,}/g,`

`).trim(),messageRefs:b}}function Nf(a){if(!a)return{content:a,attachmentRefs:[]};let c=a.replace(/\r\n/g,`
`).replace(/\r/g,`
`).split(`
`),h=-1;for(let R=0;R<c.length;R+=1)if(c[R].trim()==="Attachments:"&&c[R+1]&&/^\s*-\s+/.test(c[R+1])){h=R;break}if(h===-1)return{content:a,attachmentRefs:[]};let b=[],y=h+1;for(;y<c.length;y+=1){let R=c[y];if(/^\s*-\s+/.test(R)){let I=R.replace(/^\s*-\s+/,"").trim(),N=I.match(/^attachment:(\d+)(?:\s*\((.+)\))?$/i);if(N)b.push({id:N[1],label:(N[2]||"").trim()||`attachment:${N[1]}`,raw:I})}else if(!R.trim())break;else break}if(b.length===0)return{content:a,attachmentRefs:[]};let x=c.slice(0,h),C=c.slice(y);return{content:[...x,...C].join(`
`).replace(/\n{3,}/g,`

`).trim(),attachmentRefs:b}}function Nc(a){let m=Mf(a||""),c=Df(m||""),h=jf(c.content||""),b=If(h.content||""),y=Nf(b.content||"");return{text:y.content||"",fileRefs:c.fileRefs,folderRefs:h.folderRefs,messageRefs:b.messageRefs,attachmentRefs:y.attachmentRefs}}function Ff(a){let m=Nc(a),c=m.attachmentRefs.length>0?`Attachments:
${m.attachmentRefs.map((b)=>`- ${b.raw}`).join(`
`)}`:"";return{content:[String(m.text||"").trim(),c].filter(Boolean).join(`

`).trim(),fileRefs:[...m.fileRefs],folderRefs:[...m.folderRefs],messageRefs:[...m.messageRefs],attachmentRefs:[...m.attachmentRefs]}}async function Bf(a){let{queuedItem:m,buildDraft:c=Ff,onRemoveQueuedFollowup:h,setSubmitError:b,setSubmitNotice:y,setMediaFiles:x,onSetFileRefs:C,onSetFolderRefs:L,onSetMessageRefs:R,setContent:I,textareaRef:N,resizeTextarea:F=()=>{},scheduleRaf:U=(H)=>requestAnimationFrame(H),isCurrent:q=()=>!0,canRestoreDraft:Q=()=>!0,logger:Y=console}=a||{};if(!m||!q()||typeof h!=="function")return!1;let W=c(m?.content||"");try{if(await h(m)!==!0)return!1}catch(H){return Y?.warn?.("[compose-box] Failed to remove returned queued follow-up.",H),!1}if(!q())return!1;if(!Q())return y?.("Queued message removed; existing draft preserved."),!1;let X=W.content;return Y?.info?.("[compose-box] Returning queued item to editor",{text:X?.slice(0,80),fileRefs:W.fileRefs?.length,folderRefs:W.folderRefs?.length,messageRefs:W.messageRefs?.length}),b?.(null),y?.(null),x?.([]),C?.(W.fileRefs),L?.(W.folderRefs),R?.(W.messageRefs),I?.(X),U(()=>{let H=N?.current;if(!q()||!H)return;if(H.value=X,typeof H.dispatchEvent==="function")H.dispatchEvent(new Event("input",{bubbles:!0}));F();let ce=X.length;H.selectionStart=ce,H.selectionEnd=ce,H.focus()}),!0}function Of({items:a=[],onInjectQueuedFollowup:m,onRemoveQueuedFollowup:c,onMoveQueuedFollowup:h,onReturnQueuedFollowup:b,onOpenFilePill:y}){let{t:x}=s(),C=r(new Set),[L,R]=t(()=>new Set),I=async(N)=>{let F=N.row_id;if(C.current.has(F)||!m)return;C.current.add(F),R(new Set(C.current));try{await m(N)}finally{C.current.delete(F),R(new Set(C.current))}};if(!Array.isArray(a)||a.length===0)return null;return e`
        <div class="compose-queue-stack">
            ${a.map((N,F)=>{let U=typeof N?.content==="string"?Ct(N.content):"",q=Nc(U);if(!q.text.trim()&&q.fileRefs.length===0&&q.folderRefs.length===0&&q.messageRefs.length===0&&q.attachmentRefs.length===0)return null;let Q=N?.mode==="steer",Y=L.has(N.row_id),W=!Y&&F>0&&a[F-1]?.mode==="steer"===Q,X=!Y&&F<a.length-1&&a[F+1]?.mode==="steer"===Q,H=!0;return e`
                    <div class=${`compose-queue-stack-item${Q?" is-steering":""}`} data-testid="queue-item" data-queue-mode=${Q?"steer":"followUp"} role="listitem">
                        <div class="compose-queue-stack-content" title=${U}>
                            ${Q&&e`<div class="compose-queue-stack-mode">${x("compose.queueSteering")}</div>`}
                            ${q.text.trim()&&e`<div class="compose-queue-stack-text">${q.text}</div>`}
                            ${(q.messageRefs.length>0||q.fileRefs.length>0||q.folderRefs.length>0||q.attachmentRefs.length>0)&&e`
                                <div class="compose-queue-stack-refs">
                                    ${q.messageRefs.map((ce)=>e`
                                        <${_}
                                            key=${"queue-msg-"+ce}
                                            prefix="compose"
                                            label=${"msg:"+ce}
                                            title=${"Message reference: "+ce}
                                            icon="message"
                                        />
                                    `)}
                                    ${q.fileRefs.map((ce)=>{let xe=ce.split("/").pop()||ce;return e`
                                            <${_}
                                                key=${"queue-file-"+ce}
                                                prefix="compose"
                                                label=${xe}
                                                title=${ce}
                                                onClick=${()=>y?.(ce)}
                                            />
                                        `})}
                                    ${q.folderRefs.map((ce)=>{let xe=ce.split("/").pop()||ce;return e`
                                            <${_}
                                                key=${"queue-folder-"+ce}
                                                prefix="compose"
                                                label=${xe}
                                                title=${ce}
                                                icon="folder"
                                                onClick=${()=>y?.(ce)}
                                            />
                                        `})}
                                    ${q.attachmentRefs.map((ce)=>e`
                                        <${_}
                                            key=${"queue-attachment-"+ce.id}
                                            prefix="compose"
                                            label=${ce.label}
                                            title=${ce.raw}
                                        />
                                    `)}
                                </div>
                            `}
                        </div>
                        <div class="compose-queue-stack-actions" role="group" aria-label=${x("compose.queueControls")}>
                            ${a.length>1&&e`
                                <button
                                    class="compose-queue-stack-move-btn"
                                    data-action="move-up"
                                    type="button"
                                    title=${x("compose.moveUp")}
                                    aria-label=${x("compose.moveUpQueue")}
                                    disabled=${!W}
                                    onClick=${()=>W&&h?.(F,F-1)}
                                >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="18 15 12 9 6 15"></polyline>
                                    </svg>
                                </button>
                                <button
                                    class="compose-queue-stack-move-btn"
                                    data-action="move-down"
                                    type="button"
                                    title=${x("compose.moveDown")}
                                    aria-label=${x("compose.moveDownQueue")}
                                    disabled=${!X}
                                    onClick=${()=>X&&h?.(F,F+1)}
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
                                    title=${x("compose.editInCompose")}
                                    aria-label=${x("compose.returnToEditor")}
                                    disabled=${Y}
                                    onClick=${(ce)=>{ce.stopPropagation(),b?.(N)}}
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
                                title=${x("compose.injectSteer")}
                                aria-label=${x("compose.injectSteer")}
                                aria-busy=${Y?"true":void 0}
                                disabled=${Y}
                                onClick=${()=>void I(N)}
                            >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M4 20h12a2 2 0 0 0 2-2V8" />
                                    <polyline points="14 12 18 8 22 12" />
                                </svg>
                                <span>${x(Y?"compose.requestingSteer":"compose.steer")}</span>
                            </button>`}
                            <button
                                class="compose-queue-stack-close-btn queue-remove"
                                data-action="remove"
                                type="button"
                                title=${x("compose.cancelQueued")}
                                aria-label=${x("compose.cancelQueued")}
                                disabled=${Y}
                                onClick=${()=>c?.(N)}
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
    `}var Mc=Object.freeze([]);function Xe({onPost:a,onFocus:m,searchMode:c,searchScope:h="current",onSearch:b,onSearchScopeChange:y,onEnterSearch:x,onExitSearch:C,fileRefs:L=[],onRemoveFileRef:R,onClearFileRefs:I,folderRefs:N=[],onRemoveFolderRef:F,onClearFolderRefs:U,messageRefs:q=[],onRemoveMessageRef:Q,onClearMessageRefs:Y,activeModel:W=null,agentModelsPayload:X=null,modelUsage:H=null,thinkingLevel:ce=null,supportsThinking:xe=!1,contextUsage:de=null,onContextCompact:He,notificationsEnabled:Kt=!1,notificationPermission:cn="default",onToggleNotifications:Lr,onModelChange:O,onModelStateChange:Ne,activeEditorPath:Wt=null,onAttachEditorFile:jt,onOpenFilePill:qe,followupQueueItems:Fc=[],onInjectQueuedFollowup:Bc,onRemoveQueuedFollowup:$o,onMoveQueuedFollowup:Oc,onSubmitIntercept:Hc,onMessageResponse:ci,isAgentActive:Kn=!1,activeChatAgents:pt=Mc,currentChatJid:oe="web:default",connectionStatus:zc="connected",stateAccessFailed:qc=!1,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,onSubmitError:Eo,onSwitchChat:Co,onRenameSession:Ao,isRenameSessionInProgress:li=!1,onCreateSession:Ro,onCreateRootSession:Po,onDeleteSession:ln,onPurgeArchivedSession:Lo,onRestoreSession:To,showQueueStack:Gc=!0,statusNotice:Nt=null,extensionWorkingState:Tr=null,prefillRequest:ui=null,draftValue:Dn=void 0,services:Mo=null,capabilities:Do=null,storageNamespace:Mr="",preferenceRuntime:di=void 0,onContentChange:Kc,onSubmissionStateChange:pi,disabled:jo=!1,onJumpToLatest:Io,timelineAway:Wc=!1,timelineHasNew:fi=!1,inputId:Uc,sendButtonId:Yc}){let[we,ft]=t(()=>typeof Dn==="string"?Dn:""),{t:le}=s(),un=Mo&&typeof Mo==="object"?Mo:{},at=Do&&typeof Do==="object"?Do:{},No=un.sendAgentMessage??P,Fo=un.getAgentModels??ie,Vc=un.uploadMedia??Cr,Jc=un.fetchCommands??((d)=>fetch(`/agent/commands?chat_jid=${encodeURIComponent(d)}`).then((w)=>w.ok?w.json():null)),Wn=un.browserStorage&&typeof un.browserStorage==="object"?un.browserStorage:{getItem:g,setItem:l},jn=at.persistBrowserState!==!1,Ke=di===void 0?typeof window<"u"?window:null:di,Ut=Ke,Bo=at.commands!==!1,Oo=at.mentions!==!1,dn=at.media!==!1,Qc=at.search!==!1,Xc=at.location!==!1,Dr=at.speech!==!1,Zc=at.notifications!==!1,el=at.modelPicker!==!1,Ho=at.modelSettings!==!1,mi=at.modelCompaction!==!1,tl=at.sessionRollup!==!1,[pn,gi]=t(""),[zo,nl]=t(!1),[qo,rl]=t(!1),[jr,Go]=t("or"),[fn,mn]=t([]),[Ft,Ko]=t(null),[hi,bi]=t(!1),[ol,sl]=t(null),Yt=r(null);if(!Yt.current)Yt.current=new Vs(sl);o(()=>{let d=Yt.current;return d.reset(),()=>d.reset()},[oe]);let[il,Ir]=t(!1),[Bt,nt]=t([]),[Nr,Fr]=t(0),[Un,rt]=t(!1),Wo=r(null),[Vt,ct]=t([]),[Uo,Br]=t(0),[Yn,lt]=t(!1),[Jt,Yo]=t(!1),[We,gn]=t(!1),[$e,Ce]=t(!1),[mt,Or]=t(""),[Vn,yi]=t(()=>V(Ut).pinnedChatJids),[al,Vo]=t(null),[cl,Jo]=t(null),[wi,vi]=t(()=>new Set),Qo=r(new Set),gt=r(oe),Xo=r(X),Rt=r(0),Jn=r(0);gt.current=oe,Xo.current=X;let[ll,In]=t([]);o(()=>{let d=()=>{let w=v(Ke),E=new Set(w.pinnedKeys);In((M)=>M.map((D)=>({...D,pinned:E.has(D.key),lastUsedAt:w.recentByKey[D.key]??null})))};if(Ke?.addEventListener?.(ge,d),typeof window<"u"&&Ke===window)window.addEventListener("storage",d);return()=>{if(Ke?.removeEventListener?.(ge,d),typeof window<"u"&&Ke===window)window.removeEventListener("storage",d)}},[X,Ke]),o(()=>{let d=()=>{yi(V(Ut).pinnedChatJids)};if(Ut?.addEventListener?.(Te,d),typeof window<"u"&&Ut===window)window.addEventListener("storage",d);return()=>{if(Ut?.removeEventListener?.(Te,d),typeof window<"u"&&Ut===window)window.removeEventListener("storage",d)}},[Ut]),o(()=>{let d=(w)=>{let E=w?.detail;if(E?.source==="compose")return;if(E?.chatJid&&E.chatJid!==oe)return;let M=E?.payload;if(!M||typeof M!=="object")return;let D=M.model??M.current;if(In(bo(M,Ke)),Ne?.({...M,model:D??null}),D)O?.(D)};return window.addEventListener("piclaw:model-state-changed",d),()=>window.removeEventListener("piclaw:model-state-changed",d)},[oe,Ke,O,Ne]),o(()=>{Rt.current+=1,Jn.current+=1,Yo(!1)},[oe]);let[ul,dl]=t(null),Si=r(null),Nn=r([]),Qt=n((d)=>{let w=d?.key??null;Si.current=w,dl(w)},[]),[pl,$i]=t(!1),[ki,xi]=t(!1),[,fl]=t(0),_i=r(oe);_i.current=oe;let[Ei,ze]=t(null),[Ci,Xt]=t(null),[Be,ml]=t(()=>Dr?ri():{showButton:!1,canStart:!1}),[ht,Pt]=t({kind:"idle",title:"",detail:""}),[gl,Ai]=t(()=>Date.now()),[hl,Ri]=t(0),ae=r(null),Zo=Mr?`${Mr}:${si}`:si,Qn=r(jn?mf(Wn,Zo):null),es=r(null),ts=r(null),Pi=r(null),Zn=r(null),Hr=r(null),Li=r([]),zr=r(null),ns=r(null),Zt=r({value:"",updatedAt:0}),[,bl]=t(0);o(()=>fo(()=>bl((d)=>d+1)),[]);let qr=r(null);qr.current={read:()=>({text:ae.current?.value??we,chatJid:oe,selectionStart:ae.current?.selectionStart??we.length,selectionEnd:ae.current?.selectionEnd??we.length}),write:(d)=>{if(ae.current)ae.current.value=d;ft(d)},state:(d)=>Pt({kind:d==="recording"||d==="finishing"?"listening":d==="loading"?"requesting_permission":d==="error"?"error":"idle",title:d==="error"?"Dictation failed; draft preserved":d==="finishing"?"Finishing dictation":"",detail:""})};let Oe=r(null);if(!Oe.current)Oe.current=ic({read:()=>qr.current.read(),write:(d)=>qr.current.write(d),state:(d,w)=>qr.current.state(d,w),providerSelected:()=>{let d=_e.current;if(d)_e.current=null,d.abort?.(),yt()}});o(()=>{Oe.current?.draftChanged()},[we,oe]),o(()=>()=>{Oe.current?.dispose()},[]);let _e=r(null),Ti=r(""),en=r(""),tn=r(""),Gr=r(""),Kr=r(!1),Fn=r(!1),rs=r(!1),os=r(!1),ss=r(fn);ss.current=fn;let Wr=r(L),Ur=r(N),Yr=r(q);Wr.current=L,Ur.current=N,Yr.current=q;let fr=r(0),Vr=r(!1),Mi=200,hr=jn?`${Mr?`${Mr}:`:""}${hf(oe)}`:"",Di=(d)=>{let w=new Set,E=[];for(let M of d||[]){if(typeof M!=="string")continue;let D=M.trim();if(!D||w.has(D))continue;w.add(D),E.push(D)}return E},ji=(d=hr)=>{if(!jn||!d)return[];let w=Wn.getItem?.(d)??null;if(!w)return[];try{let E=JSON.parse(w);if(!Array.isArray(E))return[];return Di(E)}catch{return[]}},yl=(d,w=hr)=>{if(!jn||!w)return;Wn.setItem?.(w,JSON.stringify(d))},Jr=r(ji(hr)),Bn=r(-1),br=r(""),Ii=r("");o(()=>{Jr.current=ji(hr),Bn.current=-1,br.current=""},[hr]),o(()=>{if(typeof Dn!=="string"||Dn===we)return;ft(Dn),requestAnimationFrame(()=>bt())},[Dn]),o(()=>{Kc?.(we)},[we]),o(()=>{if(!c)return;fetch("/agent/settings-data").then((d)=>d.json()).then((d)=>{if(d?.searchMatchMode)Go(d.searchMatchMode)}).catch(()=>{Go((d)=>d||"or")})},[c]),o(()=>{let d=!1;if(!Bo)return Wo.current=[],()=>{d=!0};return Promise.resolve(Jc(oe||"web:default")).then((E)=>{if(d||!E?.commands)return;Wo.current=E.commands.map((M)=>({name:M.name,description:M.description||""}))}).catch((E)=>{console.debug("[compose] failed to fetch dynamic commands",E)}),()=>{d=!0}},[oe,Bo]),o(()=>{let d=gf(ui,Ii.current,c);if(!d.shouldApply)return;Ii.current=d.nextToken,ze(null),ft(d.text),ys(d.text),ws(d.text),requestAnimationFrame(()=>{bt();let w=ae.current;if(!w)return;try{w.focus({preventScroll:!0})}catch{w.focus()}let E=d.text.length;w.setSelectionRange?.(E,E)})},[ui,c]),o(()=>{ml(Dr?ri():{showButton:!1,canStart:!1})},[Dr]);let wl=!jo&&(Oe.current?.active||we.trim()||fn.length>0||L.length>0||N.length>0||q.length>0),vl=ht.kind!=="idle",Sl=ht.kind==="requesting_permission"||ht.kind==="listening",Qr=Oe.current?.selected,is=Dr&&!c&&Boolean(Qr||Be?.showButton),Xr=ht.kind==="requesting_permission"||ht.kind==="listening",Ni=Xr?"Stop voice input":Qr?"Voice input":Be?.title||"Voice input",$l=Xc&&typeof window<"u"&&typeof navigator<"u"&&Boolean(navigator.geolocation)&&Boolean(window.isSecureContext),kl=typeof window<"u"&&typeof Notification<"u",xl=typeof window<"u"?Boolean(window.isSecureContext):!1,_l=Zc&&kl&&xl&&cn!=="denied",Fi=cn==="granted"&&Kt,nn=J(Nt),Bi=At(Nt),as=typeof Nt?.detail==="string"&&Nt.detail.trim()?Nt.detail.trim():"",cs=nn?Pe(Nt,gl):null,On=kf(Tr,hl),Ot=Tr?.indicator&&typeof Tr.indicator==="object"?Tr.indicator:null,El=Fi?"Disable notifications":"Enable notifications",Cl=fn.length>0||L.length>0||N.length>0||q.length>0,Zr=$c(qc?zc:"connected"),{label:Al,title:Rl}=Zr,Oi=wf(Kn,wl,nn),eo=hi?{...Oi,disabled:!0,title:Ft?"Uploading attachments…":"Sending…",ariaLabel:Ft?"Uploading attachments":"Sending message"}:Oi,hn=Sf(Kn,nn),Hi=i(()=>(Array.isArray(pt)?pt:Mc).filter((d)=>!d?.archived_at),[pt]),je=(()=>{for(let d of Array.isArray(pt)?pt:[]){let w=typeof d?.chat_jid==="string"?d.chat_jid.trim():"";if(w&&w===oe)return d}return null})(),Pl=Boolean(je&&je.chat_jid===(je.root_chat_jid||je.chat_jid)),Ll=Boolean(Pl&&(je?.chat_jid||oe)==="web:default"),Ht=(()=>{let d=typeof je?.parent_branch_id==="string"?je.parent_branch_id.trim():"",w=typeof je?.branch_id==="string"?je.branch_id.trim():"";if(!je||!d||!w||je.archived_at)return null;if((Array.isArray(pt)?pt:[]).filter((D)=>{let Z=typeof D?.parent_branch_id==="string"?D.parent_branch_id.trim():"";return Z&&Z===w}).length>0)return null;return(Array.isArray(pt)?pt:[]).find((D)=>{let Z=typeof D?.branch_id==="string"?D.branch_id.trim():"";return Z&&Z===d&&!D?.archived_at})||null})(),yr=i(()=>me(pt,oe,wi),[pt,oe,wi]),Tl=i(()=>new Set(Vn),[Vn]),ls=i(()=>De(yr,mt),[yr,mt]),us=i(()=>Le(ls,oe,Vn),[ls,oe,Vn]),ds=i(()=>us.flatMap((d)=>d.items),[us]);Li.current=yr;let to=yr.length>0,bn=to&&typeof Co==="function",yn=to&&typeof To==="function",no=Boolean(li||Vr.current),wn=!c&&typeof Ao==="function"&&je?.capabilities?.rename!==!1&&!no,vn=!c&&typeof Ro==="function"&&je?.capabilities?.fork!==!1,Sr=!c&&typeof Po==="function",$r=tl&&!c&&!Kn&&!ki&&Boolean(Ht?.chat_jid),En=!c&&typeof ln==="function"&&je?.capabilities?.archive!==!1&&!Ll,zi=!c&&typeof Lo==="function",Rn=!c&&(bn||yn||wn||vn||Sr||$r||En||zi),qi=el?Lf(W,X):{showPicker:!1,label:"",hasAvailableModels:!1},{showPicker:ro,label:Hn}=qi,ps=xe&&ce?` (${ce})`:"",Gi=ps.trim()?`${ce}`:"",fs=Tf(W,X),kr=Af(de,W),ms=typeof H?.hint_short==="string"?H.hint_short.trim():"",Ki=B(X).find((d)=>ai(d.key,W)),Wi=Rf(Ki?.pricing),Ml=Cf(H),Ui=[Gi?{key:"thinking",text:Gi}:null,fs?.label?{key:"routed",text:fs.label}:null,ms?{key:"quota",text:ms}:null,kr?.label?{key:"run",text:kr.label}:null].filter(Boolean),Dl=Ui.map((d)=>d.text).join(" • "),gs=Hn.indexOf("/"),hs=gs>0?Hn.slice(0,gs+1):"",jl=hs?Hn.slice(gs+1):Hn,Il=[W?`Current model: ${Hn}${ps}`:null,fs?.title||null,H?.plan?`Plan: ${H.plan}`:null,ms||null,H?.availability&&H.availability!=="available"?`Usage telemetry: ${H.availability.replaceAll("_"," ")}`:null,H?.stale?`Usage telemetry stale after ${String(H.refresh_failure||"refresh failure").replaceAll("_"," ")}`:null,Ml,Wi?`Catalogue pricing: ${Wi}`:null,kr?.title||null,H?.primary?.reset_description||null,H?.secondary?.reset_description||null].filter(Boolean),Yi=Jt?"Switching model…":Il.join(" • ")||(ro?"Select a model (tap to open model picker)":`Current model: ${Hn}${ps} (tap to open model picker)`),Vi=!c&&(ro||kr||de),[zt,Nl]=t(()=>Ys());o(()=>{if(typeof window>"u")return;let d=()=>Nl(Ys());return window.addEventListener(Us,d),d(),()=>window.removeEventListener(Us,d)},[]);let bs=(d)=>{if(!d||typeof d!=="object")return;let w=d.model??d.current;if(typeof Ne==="function")Ne({...d,model:w??null,thinking_level:d.thinking_level??null,thinking_level_label:d.thinking_level_label??null,supports_thinking:d.supports_thinking,provider_usage:d.provider_usage??null});if(w&&typeof O==="function")O(w);window.dispatchEvent?.(new CustomEvent("piclaw:model-state-changed",{detail:{chatJid:oe,payload:d,source:"compose"}}))},Ji=(d,w)=>{let E=ii(w);return d.style.minHeight=`${E}px`,d.style.height=`${E}px`,d.style.overflowY=d.scrollHeight>E?"auto":"hidden",E},bt=(d)=>{let w=d||ae.current;if(!w)return;let E=Qn.current;if(E!=null){Ji(w,E);return}w.style.minHeight="",w.style.height="auto";let M=Math.max(Dc(),Math.min(w.scrollHeight,pf()));w.style.height=`${M}px`,w.style.overflowY=w.scrollHeight>M?"auto":"hidden"},ys=(d)=>{if(!d.startsWith("/")||d.includes(`
`)){rt(!1),nt([]);return}let w=d.toLowerCase().split(" ")[0];if(w.length<1){rt(!1),nt([]);return}let M=(Wo.current||uf).filter((D)=>D.name.startsWith(w)||D.name.replace(/-/g,"").startsWith(w.replace(/-/g,"")));if(M.length>0&&!(M.length===1&&M[0].name===w))lt(!1),ct([]),nt(M),Fr(0),rt(!0);else rt(!1),nt([])},Qi=(d)=>{let w=we,E=w.indexOf(" "),M=E>=0?w.slice(E):"",D=d.name+M;ft(D),rt(!1),nt([]),requestAnimationFrame(()=>{let Z=ae.current;if(!Z)return;let ee=D.length;Z.selectionStart=ee,Z.selectionEnd=ee,Z.focus()})},ws=(d)=>{if(Zs(d,{searchMode:c,showSessionSwitcherButton:Rn})){lt(!1),ct([]);return}if(Js(d)==null){lt(!1),ct([]);return}let w=lc(Hi,d,{currentChatJid:oe});if(w.length>0&&!(w.length===1&&Qs(w[0].agent_name).trim().toLowerCase()===String(d||"").trim().toLowerCase()))rt(!1),nt([]),ct(w),Br(0),lt(!0);else lt(!1),ct([])},Xi=(d)=>{let w=Qs(d?.agent_name);if(!w)return;ft(w),lt(!1),ct([]),requestAnimationFrame(()=>{let E=ae.current;if(!E)return;let M=w.length;E.selectionStart=M,E.selectionEnd=M,E.focus()})},vs=()=>{if(c||!bn&&!yn&&!wn&&!vn&&!En)return!1;return Zt.current={value:"",updatedAt:0},gn(!1),rt(!1),nt([]),lt(!1),ct([]),Or(""),Ce(!0),!0},Fl=(d)=>{if(d?.preventDefault?.(),d?.stopPropagation?.(),c||!bn&&!yn&&!wn&&!vn&&!En)return;if($e){Zt.current={value:"",updatedAt:0},Ce(!1);return}vs()},Zi=(d)=>{let w=typeof d==="string"?d.trim():"";if(Ce(!1),!w||w===oe){requestAnimationFrame(()=>ae.current?.focus());return}Co?.(w)},ea=async(d)=>{let w=typeof d==="string"?d.trim():"";if(Ce(!1),!w||typeof To!=="function"){requestAnimationFrame(()=>ae.current?.focus());return}try{await To(w)}catch(E){console.warn("Failed to restore session:",E),requestAnimationFrame(()=>ae.current?.focus())}},Ss=n((d)=>{let w=typeof d==="string"?d.trim():"";if(!w||Qo.current.has(w))return!1;return Qo.current.add(w),vi((E)=>{let M=new Set(E instanceof Set?E:[]);return M.add(w),M}),!0},[]),$s=n((d,w)=>{let E=typeof d==="string"?d.trim():"";if(!E)return;if(Qo.current.delete(E),w)return;vi((M)=>{let D=new Set(M instanceof Set?M:[]);return D.delete(E),D})},[]),oo=n(async(d,w={})=>{let E=typeof d?.chat_jid==="string"?d.chat_jid.trim():"";if(!E)return;if(w.canPurgeArchived){if(!Ss(E))return;Vo(null);let M=!1;try{M=await Lo?.(E,{confirmed:!0})!==!1}catch(D){console.warn("Failed to purge archived session:",D)}if($s(E,M),M)Ce(!1);return}if(w.canPrune){if(!Ss(E))return;Jo(null);let M=!1;try{M=await ln(E,{confirmed:!0})!==!1}catch(D){console.warn("Failed to delete session:",D)}if($s(E,M),M)Ce(!1)}},[$s,Ss,ln,Lo]);o(()=>{if(!$e)return;let d=(w)=>{let E=Hr.current;if(!E)return;let D=w.target?.closest?.("button.compose-model-popup-item-delete.confirming[data-chat-jid]");if(!D||!E.contains(D))return;w.preventDefault?.(),w.stopPropagation?.(),w.stopImmediatePropagation?.();let Z=typeof D.dataset?.chatJid==="string"?D.dataset.chatJid.trim():"";if(!Z)return;let ee=Li.current.find((se)=>se?.chat_jid===Z)||{chat_jid:Z};oo(ee,{canPurgeArchived:D.dataset?.deleteKind==="purge",canPrune:D.dataset?.deleteKind==="prune"})};return document.addEventListener("pointerdown",d,!0),document.addEventListener("mousedown",d,!0),document.addEventListener("touchstart",d,!0),()=>{document.removeEventListener("pointerdown",d,!0),document.removeEventListener("mousedown",d,!0),document.removeEventListener("touchstart",d,!0)}},[oo,$e]);let ut=i(()=>{let d=[];for(let w of ds){let E=Boolean(w?.archived_at),M=typeof w?.agent_name==="string"?w.agent_name.trim():"",D=typeof w?.chat_jid==="string"?w.chat_jid.trim():"";if(!M||!D)continue;d.push({type:"session",key:`session:${D}`,label:`@${M} — ${D}${w?.is_active?" active":""}${E?" archived":""}`,chat:w,disabled:E?!yn||w?.capabilities?.restore===!1:!bn||w?.capabilities?.open===!1})}if(!mt&&vn)d.push({type:"action",key:"action:new",label:"New branch",action:"new",disabled:!1});if(!mt&&Sr)d.push({type:"action",key:"action:new-root",label:"New root session…",action:"new-root",disabled:!1});if(!mt&&Ht?.chat_jid)d.push({type:"action",key:"action:rollup",label:"Merge current w/ parent",action:"rollup",disabled:!$r});if(!mt&&wn)d.push({type:"action",key:"action:rename",label:"Rename current session",action:"rename",disabled:no});if(!mt&&En)d.push({type:"action",key:"action:delete",label:"Delete current session",action:"delete",disabled:!1});return d},[ds,mt,yn,bn,vn,Sr,Ht,$r,wn,En,no]);Nn.current=ut;let Lt=Math.max(0,ut.findIndex((d)=>d.key===ul)),ks=n((d)=>{let w=xt(d,Ut);yi(w.pinnedChatJids);let E=Nn.current,M=E.filter((ve)=>ve?.type==="session").map((ve)=>ve.chat),D=Le(M,oe,w.pinnedChatJids).flatMap((ve)=>ve.items),Z=E.filter((ve)=>ve?.type==="session"),ee=E.filter((ve)=>ve?.type!=="session"),se=new Map(Z.map((ve)=>[ve.chat.chat_jid,ve])),be=D.map((ve)=>se.get(ve.chat_jid)).filter(Boolean);Nn.current=[...be,...ee];let ot=hc(D,d);if(ot>=0)Qt(be[ot])},[oe,Qt]),ta=async(d)=>{if(d?.preventDefault)d.preventDefault();if(d?.stopPropagation)d.stopPropagation();if(typeof Ao!=="function"||li||Vr.current)return;Vr.current=!0,Ce(!1);try{await Ao()}catch(w){console.warn("Failed to rename session:",w)}finally{Vr.current=!1}requestAnimationFrame(()=>ae.current?.focus())},na=async()=>{if(typeof Ro!=="function")return;Ce(!1);try{await Ro()}catch(d){console.warn("Failed to create session:",d)}requestAnimationFrame(()=>ae.current?.focus())},ra=async()=>{if(typeof Po!=="function")return;Ce(!1);let d=typeof window<"u"?window.prompt("New root session handle (for example: ops)"):"",w=String(d||"").trim();if(!w){requestAnimationFrame(()=>ae.current?.focus());return}try{await Po(w)}catch(E){console.warn("Failed to create root session:",E)}requestAnimationFrame(()=>ae.current?.focus())},oa=async()=>{let d=typeof Ht?.chat_jid==="string"?Ht.chat_jid.trim():"";if(!d||ki||Kn)return;Ce(!1),ze(null),Xt(null),xi(!0);try{let w=await No("default","/rollup",null,[],null,oe);ci?.(w),a?.(w);let E=w?.command;if(E?.status==="error"){let D=E?.message||"Failed to merge current session with parent.";ze(D),Eo?.(D);return}let M=typeof E?.rolled_up_to==="string"&&E.rolled_up_to.trim()?E.rolled_up_to.trim():d;Co?.(M)}catch(w){let E=w?.message||"Failed to merge current session with parent.";ze(E),Eo?.(E),console.warn("Failed to merge session with parent:",w)}finally{xi(!1)}requestAnimationFrame(()=>ae.current?.focus())},sa=async()=>{if(typeof ln!=="function")return;Ce(!1);try{await ln(oe)}catch(d){console.warn("Failed to delete session:",d)}requestAnimationFrame(()=>ae.current?.focus())},ia=(d,w,E)=>{let M=ae.current;if(!M||!E)return;let D=d,Z=!1,ee=oe;E.classList.add("dragging"),document.body.style.cursor="row-resize",document.body.style.userSelect="none";let se=(Ve)=>{if(Math.abs(Ve-w)>4)Z=!0;D=Ji(M,d+(w-Ve)),Qn.current=D},be=(Ve)=>{se(Ve.clientY)},ot=(Ve)=>{let qt=Ve.touches[0];if(!qt)return;Ve.preventDefault(),se(qt.clientY)},ve=(Ve)=>{if(E.classList.remove("dragging"),document.body.style.cursor="",document.body.style.userSelect="",jn)Wn.setItem?.(Zo,String(Math.round(D)));if(document.removeEventListener("mousemove",be),document.removeEventListener("mouseup",ve),document.removeEventListener("touchmove",ot),document.removeEventListener("touchend",ve),document.removeEventListener("touchcancel",ve),!Z&&Ve?.type!=="touchcancel"&&M.isConnected&&_i.current===ee)Io?.()};document.addEventListener("mousemove",be),document.addEventListener("mouseup",ve),document.addEventListener("touchmove",ot,{passive:!1}),document.addEventListener("touchend",ve),document.addEventListener("touchcancel",ve)},Bl=(d)=>{let w=ae.current;if(!w)return;d.preventDefault(),ia(w.getBoundingClientRect().height,d.clientY,d.currentTarget)},Ol=(d)=>{let w=ae.current,E=d.touches?.[0];if(!w||!E)return;d.preventDefault(),ia(w.getBoundingClientRect().height,E.clientY,d.currentTarget)},rn=(d)=>{if(c)gi(d);else{if(ft(d),Bo)ys(d);else rt(!1),nt([]);if(Oo)ws(d);else lt(!1),ct([])}requestAnimationFrame(()=>bt())},Hl=(d)=>{let w=c?pn:we,E=w&&!w.endsWith(`
`)?`
`:"",M=`${w}${E}${d}`.trimStart();rn(M)},xs=n(()=>{requestAnimationFrame(()=>{let d=ae.current;if(!d)return;try{d.focus({preventScroll:!0})}catch{d.focus()}})},[]),yt=n(()=>{Pt({kind:"idle",title:"",detail:""})},[]),_s=n((d=en.current,w=tn.current)=>{if(c)return;rn(_c(Ti.current,d,w))},[c]),Mt=n(()=>{Kr.current=!0;let d=_e.current;if(!d){yt();return}try{d.stop()}catch{_e.current=null,yt()}},[yt]),Es=n(()=>{if(Oe.current?.selected){Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));return}if(ze(null),Xt(null),_e.current){Mt();return}if(!Be?.showButton)return;if(Be.mode==="fallback"){xs(),Pt({kind:"guidance",title:Be.title||"Use keyboard dictation",detail:Be.detail||"Use your keyboard dictation mic for voice input here."});return}if(!Be?.canStart||!Be?.recognitionCtor){Pt({kind:"error",title:Be?.title||"Voice input unavailable",detail:Be?.detail||"This browser does not expose native speech recognition in this context."});return}try{let d=new Be.recognitionCtor;if(_e.current=d,Ti.current=String(we||""),en.current="",tn.current="",Gr.current="",Kr.current=!1,d.lang=typeof navigator<"u"&&navigator.language?navigator.language:"en-US",d.interimResults=!0,d.continuous=!1,"maxAlternatives"in d)d.maxAlternatives=1;d.onstart=()=>{if(_e.current!==d||Oe.current?.selected)return;Pt({kind:"listening",title:"Listening…",detail:"Speak now. Tap the mic again to stop."})},d.onresult=(w)=>{if(_e.current!==d||Oe.current?.selected)return;let{finalText:E,interimText:M}=Ec(w?.results,w?.resultIndex||0);if(E)en.current=`${en.current} ${E}`.trim();tn.current=M,_s(),Pt({kind:"listening",title:"Listening…",detail:M?`Heard: ${M}`:"Speak now. Tap the mic again to stop."})},d.onerror=(w)=>{if(_e.current!==d||Oe.current?.selected)return;let E=String(w?.error||"").trim();if(Gr.current=E,_e.current=null,tn.current="",E==="aborted"){yt();return}Pt({kind:"error",title:"Voice input failed",detail:oi(E,Be)})},d.onend=()=>{if(_e.current!==d||Oe.current?.selected)return;let w=Gr.current,E=Kr.current,M=Boolean(en.current.trim()||tn.current.trim());if(_e.current=null,Kr.current=!1,Gr.current="",tn.current.trim())en.current=`${en.current} ${tn.current}`.trim(),tn.current="";if(M)_s(en.current,"");if(w&&w!=="aborted")return;if(!M&&!E){Pt({kind:"error",title:"No speech detected",detail:oi("no-speech",Be)});return}yt()},Pt({kind:"requesting_permission",title:"Starting voice input…",detail:"Allow microphone access if the browser asks."}),xs(),d.start()}catch(d){_e.current=null,Pt({kind:"error",title:"Voice input failed",detail:d?.message||"Could not start native browser speech recognition."})}},[_s,yt,we,xs,Be,Mt]),aa=async(d,w=null)=>{if(c||Jt)return;let E=oe,M=++Rt.current;ze(null),Xt(null),Yo(!0);try{let D=await No("default",d,null,[],null,E);if(M!==Rt.current||E!==gt.current)return!1;if(D?.error||D?.command===!1||D?.command?.status==="error")throw Error(D?.error||D?.command?.message||"Model switch failed.");let Z=null,ee=await ni(Fo,E,(se)=>{if(M===Rt.current&&E===gt.current)bs(se)},(se)=>{if(M!==Rt.current||E!==gt.current)return;Z=B(se).find((be)=>be.current)?.key??j(se?.current??se?.model)??null,In(bo(se,Ke))});if(M!==Rt.current||E!==gt.current)return!1;if(!ee||w&&Z!==w)throw Error("The server did not confirm the model switch.");if(w)Fe(w,new Date().toISOString(),Ke);return Xt(Lc(d,D)),a?.(D),!0}catch(D){return console.error("Failed to switch model:",D),alert("Failed to switch model: "+D.message),!1}finally{if(M===Rt.current)Yo(!1)}},zl=(d)=>{if(d.pointerType==="mouse")return;let w=ae.current?.value??(c?pn:we);if(!Tc({key:" ",code:"Space",ctrlKey:d.ctrlKey,metaKey:d.metaKey,altKey:d.altKey},w,{searchMode:c,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||Be?.canStart&&Be?.recognitionCtor)}))return;d.preventDefault(),Fn.current=!0,rs.current=!0,Es()},Cs=(d)=>{if(!Fn.current)return;if(d?.preventDefault?.(),Fn.current=!1,Oe.current?.selected)Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));else if(_e.current)Mt()},ql=(d)=>{if(rs.current){rs.current=!1,d.preventDefault();return}Es()},Gl=async(d)=>{let w=typeof d==="string"?d.trim():"";if(!w||Jt)return;await aa(`/thinking ${w}`)},Kl=async(d)=>{let w=typeof d==="string"?d:typeof d?.key==="string"?d.key:typeof d?.label==="string"?d.label:"";if(!w||Jt)return;if(await aa(`/model ${w}`,w))gn(!1),requestAnimationFrame(()=>Zn.current?.focus?.())},Wl=(d)=>{if(!d||d.disabled)return;if(d.type==="session"){let w=d.chat;if(w?.archived_at)ea(w.chat_jid);else Zi(w.chat_jid);return}if(d.type==="action"){if(d.action==="new"){na();return}if(d.action==="new-root"){ra();return}if(d.action==="rollup"){oa();return}if(d.action==="rename"){ta();return}if(d.action==="delete")sa()}},so=n(()=>{gn(!1),requestAnimationFrame(()=>Zn.current?.focus?.())},[]),Ul=(d)=>{d.preventDefault(),d.stopPropagation(),Zt.current={value:"",updatedAt:0},Ce(!1),gn((w)=>{if(!w)In(bo(X,Ke));return!w})},ca=async()=>{if(c)return;He?.(),await Pn("/compact",null,{includeMedia:!1,includeFileRefs:!1,includeFolderRefs:!1,includeMessageRefs:!1,clearAfterSubmit:!1,recordHistory:!1})},Yl=(d)=>{if(d==="queue"||d==="steer"||d==="auto")return d;return Kn?"queue":void 0},Pn=async(d,w,E={})=>{if(!E.dictationFinished&&Oe.current?.active&&!/^\/abort\s*$/i.test(String(d||""))){let it=d==null||d===(ae.current?.value??we);try{await Oe.current.submit(async()=>{await Pn(it?ae.current?.value??we:d,w,{...E,dictationFinished:!0})})}catch{ze("Dictation could not finish. Draft preserved; send again explicitly.")}return}let M=typeof d==="string"?d:we;if(Ho&&/^\/settings\s*$/i.test(M.trim())){ft(""),requestAnimationFrame(()=>bt()),T();return}if(Ho&&/^\/help\s*$/i.test(M.trim())){ft(""),requestAnimationFrame(()=>bt()),T({section:"keyboard"});return}let D=/^\/abort\s*$/i.test(M.trim());if(os.current&&!D)return;let{includeMedia:Z=!0,includeFileRefs:ee=!0,includeFolderRefs:se=!0,includeMessageRefs:be=!0,clearAfterSubmit:ot=!0,recordHistory:ve=!0}=E||{},Ve=typeof d==="string"?d:d&&typeof d?.target?.value==="string"?d.target.value:we,qt=typeof Ve==="string"?Ve:"";if(!qt.trim()&&(Z?fn.length===0:!0)&&(ee?L.length===0:!0)&&(se?N.length===0:!0)&&(be?q.length===0:!0))return;let Er=!D;if(Er)os.current=!0,bi(!0),pi?.(!0);if(_e.current)Mt();yt(),rt(!1),nt([]),lt(!1),ct([]),Ce(!1),ze(null),Xt(null);let dt=Er?Yt.current.begin(oe):null,Ar=Z?[...fn]:[],zn=ee?[...L]:[],Ln=se?[...N]:[],Se=be?[...q]:[],Ue=qt.trim(),st=oe,da=Rt.current;if(ve&&Ue){let it=Jr.current,ke=Di(it.filter((Gt)=>Gt!==Ue));if(ke.push(Ue),ke.length>Mi)ke.splice(0,ke.length-Mi);Jr.current=ke,yl(ke),Bn.current=-1,br.current=""}let uu=()=>{let it=(ke,Gt)=>[...new Set([...ke||[],...Gt||[]])];if(Z)mn((ke)=>[...Ar.filter((Gt)=>!ke.includes(Gt)),...ke]);if(ee)ko?.(it(zn,Wr.current));if(se)xo?.(it(Ln,Ur.current));if(be)_o?.(it(Se,Yr.current));ft((ke)=>{if(!Ue)return ke;if(!ke.trim())return Ue;if(ke.trim()===Ue)return ke;return`${Ue}

${ke}`}),requestAnimationFrame(()=>bt())};if(ot)ft(""),mn([]),I?.(),U?.(),Y?.();(async()=>{try{let it=await Hc?.({content:Ue,submitMode:w,fileRefs:zn,folderRefs:Ln,messageRefs:Se,mediaFiles:Ar});if(it){a?.(it);return}let ke=await tt(dn?Ar:[],(Ae,vt)=>Vc(Ae,{onProgress:vt}),{onProgress:Ko}),Gt=ke.filter(({result:Ae})=>Ae.id).map(({name:Ae,result:vt})=>({name:Ae,id:vt.id})),du=ke.filter(({result:Ae})=>Ae.storage==="workspace").map(({result:Ae})=>Ae.path),pu=Gt.map(({id:Ae})=>Ae),pa=[...zn,...du],fu=pa.length?`Files:
${pa.map((Ae)=>`- ${Ae}`).join(`
`)}`:"",mu=Ln.length?`Folders:
${Ln.map((Ae)=>`- ${Ae}`).join(`
`)}`:"",gu=Se.length?`Referenced messages:
${Se.map((Ae)=>`- message:${Ae}`).join(`
`)}`:"",hu=Gt.length?`Attachments:
${Gt.map(({id:Ae,name:vt},io)=>{let Rs=vt||`attachment-${io+1}`;return`- attachment:${Ae} (${Rs})`}).join(`
`)}`:"",bu=[Ue,fu,mu,gu,hu].filter(Boolean).join(`

`);Ko(null);let on=await No("default",bu,null,pu,Yl(w),st);xr(on);let fa=wr(on);if(fa&&gt.current===st)ze(fa);if(ci?.(on),dt!==null)if(on?.command?.status==="error")Yt.current.failed(dt);else Yt.current.acknowledged(dt);if(on?.command&&on.command.status!=="error"){let Ae=/^\/(?:model\s+\S+|cycle-model)\s*$/i.test(Ue.trim());await ni(Fo,st,(vt)=>{if(da===Rt.current&&st===gt.current)bs(vt)},(vt)=>{if(da!==Rt.current||st!==gt.current)return;let io=B(vt).find((Rs)=>Rs.current)?.key??j(vt?.current??vt?.model)??null;if(Ae&&io)Fe(io,new Date().toISOString(),Ke)})}Xt(Lc(Ue,on)),a?.(on)}catch(it){if(ot)uu();let ke=it?.message||"Failed to send message.";if(dt!==null)Yt.current.failed(dt);ze(ke),Eo?.(ke),console.error("Failed to post:",it)}finally{if(Er){if(dt!==null)Yt.current.finished(dt);Ko(null),bi(!1),os.current=!1,pi?.(!1)}}})()},Vl=(d)=>Bc?.(d),Jl=n((d)=>{let w=oe,E=ae.current,M=E?.value??we,D=Wr.current,Z=Ur.current,ee=Yr.current,se=ss.current;return Bf({queuedItem:d,onRemoveQueuedFollowup:$o,isCurrent:()=>gt.current===w&&ae.current===E,canRestoreDraft:()=>(ae.current?.value??we)===M&&Wr.current===D&&Ur.current===Z&&Yr.current===ee&&ss.current===se,setSubmitError:ze,setSubmitNotice:Xt,setMediaFiles:mn,onSetFileRefs:ko,onSetFolderRefs:xo,onSetMessageRefs:_o,setContent:ft,textareaRef:ae,resizeTextarea:bt})},[oe,we,$o,ko,xo,_o,bt]),_r=n((d)=>{if(c||!We&&!$e||d?.isComposing)return!1;let w=()=>{d.preventDefault?.(),d.stopPropagation?.()},E=()=>{Zt.current={value:"",updatedAt:0}};if(We&&d.target?.closest?.("[data-compose-model-catalogue]"))return!1;if(d.key==="Escape"){if(w(),E(),We)so();if($e)Ce(!1),Or(""),requestAnimationFrame(()=>zr.current?.querySelector?.("button")?.focus?.());return!0}if(We)return!1;if($e){let M=Nn.current,D=Math.max(0,M.findIndex((ee)=>ee.key===Si.current)),Z=Boolean(d.target?.classList?.contains?.("compose-session-search"));if(["ArrowDown","ArrowUp","Home","End","PageDown","PageUp"].includes(d.key)){if(w(),E(),M.length>0){let ee=bc(D,M.length,d.key);Qt(M[ee])}return!0}if(d.key==="Enter"&&d.altKey&&M.length>0){w(),E();let ee=M[D];if(ee?.type==="session"&&!ee.chat?.archived_at)ks(ee.chat.chat_jid);return!0}if((d.key==="Enter"||d.key==="Tab")&&M.length>0)return w(),E(),Wl(M[D]),!0;if(!Z&&_t(d)&&M.length>0){w();let ee=ac(Zt.current,d.key);Zt.current=ee;let se=cc(M,ee.value,D,(be)=>be.label);if(se>=0)Qt(M[se]);return!0}}return!1},[c,We,$e,Qt,so,ks]),Ql=(d)=>{if(d.isComposing||d.defaultPrevented)return;if(d.key==="Enter"&&(d.ctrlKey||d.metaKey)&&!d.shiftKey&&!d.altKey&&!c){let E=vr(d);if(d.preventDefault(),E)Pn(ae.current?.value??we,"steer");return}if(c&&d.key==="Escape"){d.preventDefault(),gi(""),C?.();return}if(_r(d))return;let w=ae.current?.value??(c?pn:we);if(Tc(d,w,{searchMode:c,speechButtonVisible:is,speechButtonActive:Xr,canStartSpeech:Boolean(Qr||Be?.canStart&&Be?.recognitionCtor)})){d.preventDefault(),Fn.current=!0,Es();return}if(wc(d,w,{searchMode:c,showSessionSwitcherButton:Rn})){d.preventDefault(),vs();return}if(Yn&&Vt.length>0){let E=ae.current?.value??(c?pn:we);if(!String(E||"").match(/^@([a-zA-Z0-9_-]*)$/))lt(!1),ct([]);else{if(d.key==="ArrowDown"){d.preventDefault(),Br((M)=>(M+1)%Vt.length);return}if(d.key==="ArrowUp"){d.preventDefault(),Br((M)=>(M-1+Vt.length)%Vt.length);return}if(d.key==="Tab"||d.key==="Enter"){d.preventDefault(),Xi(Vt[Uo]);return}if(d.key==="Escape"){d.preventDefault(),lt(!1),ct([]);return}}}if(Un&&Bt.length>0){let E=ae.current?.value??(c?pn:we);if(!String(E||"").startsWith("/"))rt(!1),nt([]);else{if(d.key==="ArrowDown"){d.preventDefault(),Fr((M)=>(M+1)%Bt.length);return}if(d.key==="ArrowUp"){d.preventDefault(),Fr((M)=>(M-1+Bt.length)%Bt.length);return}if(d.key==="Tab"){d.preventDefault(),Qi(Bt[Nr]);return}if(d.key==="Enter"&&!d.shiftKey){if(!w.includes(" ")){d.preventDefault();let D=Bt[Nr];rt(!1),nt([]),Pn(D.name);return}}if(d.key==="Escape"){d.preventDefault(),rt(!1),nt([]);return}}}if(!c&&(d.key==="ArrowUp"||d.key==="ArrowDown")&&!d.metaKey&&!d.ctrlKey&&!d.altKey&&!d.shiftKey){let E=ae.current;if(!E)return;let M=E.value||"",D=E.selectionStart===0&&E.selectionEnd===0,Z=E.selectionStart===M.length&&E.selectionEnd===M.length;if(d.key==="ArrowUp"&&D||d.key==="ArrowDown"&&Z){let ee=Jr.current;if(!ee.length)return;d.preventDefault();let se=Bn.current;if(d.key==="ArrowUp"){if(se===-1)br.current=M,se=ee.length-1;else if(se>0)se-=1;Bn.current=se,rn(ee[se]||"")}else{if(se===-1)return;if(se<ee.length-1)se+=1,Bn.current=se,rn(ee[se]||"");else Bn.current=-1,rn(br.current||""),br.current=""}requestAnimationFrame(()=>{let be=ae.current;if(!be)return;let ot=be.value.length;be.selectionStart=ot,be.selectionEnd=ot});return}}if(d.key==="Enter"&&!d.shiftKey&&(d.ctrlKey||d.metaKey)){if(d.preventDefault(),c){if(w.trim())b?.(w.trim(),h,{images:zo,attachments:qo})}return}if(d.key==="Enter"&&!d.shiftKey&&!d.ctrlKey&&!d.metaKey&&!d.altKey&&!d.repeat){if(d.preventDefault(),c){if(w.trim())b?.(w.trim(),h,{images:zo,attachments:qo})}else Pn(w);return}if(d.key==="Escape"){if(We||$e||Un||Yn)return;d.preventDefault(),ae.current?.blur()}},Xl=(d)=>{if(vf(d,Fn.current)){if(d.preventDefault(),Fn.current=!1,Oe.current?.selected)Oe.current.toggle().catch(()=>ze("Dictation could not finish. Draft preserved."));else if(_e.current)Mt()}},As=(d)=>{if(!dn)return;let w=Array.from(d||[]).filter((E)=>E instanceof File&&!String(E.name||"").startsWith(".DS_Store"));if(!w.length)return;mn((E)=>[...E,...w]),ze(null)};o(()=>{let d=async(w)=>{let E=w?.detail?.mediaId;if(!E)return;try{let{getMediaBlob:M}=await (p("ve7jvgxg"),import("./api-ve7jvgxg.js")),D=await M(E),Z=new File([D],`annotated-${E}.png`,{type:D.type||"image/png"});mn((ee)=>[...ee,Z]),ae.current?.focus()}catch(M){console.warn("[compose-box] Failed to attach annotated image:",M)}};return window.addEventListener("piclaw:compose-media-attach",d),()=>window.removeEventListener("piclaw:compose-media-attach",d)},[]);let Zl=(d)=>{As(d.target.files),d.target.value=""},eu=(d)=>{if(c||!dn)return;d.preventDefault(),d.stopPropagation(),fr.current+=1,Ir(!0)},tu=(d)=>{if(c)return;if(d.preventDefault(),d.stopPropagation(),fr.current=Math.max(0,fr.current-1),fr.current===0)Ir(!1)},nu=(d)=>{if(c||!dn)return;if(d.preventDefault(),d.stopPropagation(),d.dataTransfer)d.dataTransfer.dropEffect="copy";Ir(!0)},ru=(d)=>{if(c||!dn)return;d.preventDefault(),d.stopPropagation(),fr.current=0,Ir(!1),As(d.dataTransfer?.files||[])},ou=(d)=>{if(c||!dn)return;let w=d.clipboardData?.items;if(!w||!w.length)return;let E=[];for(let M of w){if(M.kind!=="file")continue;let D=M.getAsFile?.();if(D)E.push(D)}if(E.length>0)d.preventDefault(),As(E)},su=(d)=>{mn((w)=>w.filter((E,M)=>M!==d))},iu=()=>{ze(null),mn([]),I?.(),U?.(),Y?.()},au=()=>{if(!navigator.geolocation){alert("Geolocation is not available in this browser.");return}navigator.geolocation.getCurrentPosition((d)=>{let{latitude:w,longitude:E,accuracy:M}=d.coords,D=`${w.toFixed(5)}, ${E.toFixed(5)}`,Z=Number.isFinite(M)?` ±${Math.round(M)}m`:"",ee=`https://maps.google.com/?q=${w},${E}`,se=`Location: ${D}${Z} ${ee}`;Hl(se)},(d)=>{let w=d?.message||"Unable to retrieve location.";alert(`Location error: ${w}`)},{enableHighAccuracy:!0,timeout:1e4,maximumAge:0})};o(()=>{if(!We)return;let d=oe,w=++Jn.current,E=Xo.current;Zt.current={value:"",updatedAt:0},$i(!0),Promise.resolve(Fo(d)).then((M)=>{if(w!==Jn.current||d!==gt.current)return;if(Xo.current!==E)return;In(bo(M,Ke)),bs(M)}).catch((M)=>{if(w!==Jn.current||d!==gt.current)return;console.warn("Failed to load model list:",M),In([])}).finally(()=>{if(w===Jn.current)$i(!1)})},[We,oe]),o(()=>{if(c)gn(!1),Ce(!1),rt(!1),nt([]),lt(!1),ct([])},[c]),o(()=>{if($e&&!Rn)Ce(!1)},[$e,Rn]),o(()=>{if(!$e)Vo(null),Jo(null),Or("")},[$e]),o(()=>{if(!$e)return;let d=yf(ut,oe);Qt(ut[d]),Zt.current={value:"",updatedAt:0}},[$e,oe,Qt]),o(()=>{if(!We)return;let d=(w)=>{let E=Pi.current,M=Zn.current,D=w.target;if(E&&E.contains(D))return;if(M&&M.contains(D))return;gn(!1)};return document.addEventListener("pointerdown",d),()=>document.removeEventListener("pointerdown",d)},[We]),o(()=>{if(!$e)return;let d=(w)=>{let E=Hr.current,M=zr.current,D=w.target;if(E&&E.contains(D))return;if(M&&M.contains(D))return;Ce(!1)};return document.addEventListener("pointerdown",d),()=>document.removeEventListener("pointerdown",d)},[$e]),o(()=>{if(c||!We&&!$e)return;let d=(w)=>{_r(w)};return document.addEventListener("keydown",d,!0),()=>document.removeEventListener("keydown",d,!0)},[c,We,$e,_r]),o(()=>{if(!$e)return;let d=Hr.current,w=d?.querySelector?.(".compose-session-search");if(document.activeElement!==w)w?.focus?.();d?.querySelector?.(".compose-model-popup-item.active")?.scrollIntoView?.({block:"nearest"})},[$e,Lt,ut.length]),o(()=>{if(!Yn||!ts.current)return;ts.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Yn,Uo,Vt.length]),o(()=>{if(!Un||!es.current)return;es.current.querySelector?.(".slash-item.active")?.scrollIntoView?.({block:"nearest"})},[Un,Nr,Bt.length]),o(()=>{let d=(E)=>{if(!E||typeof E!=="object")return!1;if(E.isContentEditable)return!0;if(typeof E.closest!=="function")return!1;return Boolean(E.closest('input, textarea, select, [contenteditable="true"], .compose-box, .compose-model-popup, .compose-session-popup, .settings-dialog, .workspace-sidebar, .editor-pane-container, .dock-panel, .timeline-menu-dropdown, .rename-branch-overlay, .agent-request-modal, .attachment-preview-modal, .vnc-pane-shell, .kanban-plugin, .timeline-quick-actions'))},w=(E)=>{if(E.defaultPrevented||E.ctrlKey||E.metaKey||E.altKey)return;let M=ae.current;if(!M)return;let D=document.activeElement===M;if(E.key==="Escape"&&!D&&!d(E.target)){E.preventDefault(),M.focus();return}if(E.key==="/"&&!D&&!d(E.target))E.preventDefault(),rn("/"),requestAnimationFrame(()=>{M.focus(),M.selectionStart=1,M.selectionEnd=1,ys("/")})};return window.addEventListener("keydown",w),()=>window.removeEventListener("keydown",w)},[]),o(()=>{let d=()=>{let Z=ns.current?.clientWidth||0;fl((ee)=>ee===Z?ee:Z)};d();let w=ns.current,E=0,M=()=>{if(E)cancelAnimationFrame(E);E=requestAnimationFrame(()=>{E=0,d()})},D=null;if(w&&typeof ResizeObserver<"u")D=new ResizeObserver(()=>M()),D.observe(w);if(typeof window<"u")window.addEventListener("resize",M);return()=>{if(E)cancelAnimationFrame(E);if(D?.disconnect?.(),typeof window<"u")window.removeEventListener("resize",M)}},[c,W,je?.agent_name,Rn,de?.percent]);let cu=(d)=>{let w=d.target.value;if(_e.current&&d?.isTrusted)Mt();if(ze(null),Xt(null),ht.kind==="guidance"||ht.kind==="error")yt();if($e)Ce(!1);if(bt(d.target),Zs(w,{searchMode:c,showSessionSwitcherButton:Rn})){rn(""),requestAnimationFrame(()=>{let E=ae.current;if(!E)return;E.value="",E.selectionStart=0,E.selectionEnd=0,E.focus()}),vs();return}rn(w)};o(()=>{requestAnimationFrame(()=>bt())},[we,pn,c]),o(()=>{if(typeof window>"u")return;let d=()=>{if(Qn.current!=null){let w=ii(Qn.current);if(Qn.current=w,jn)Wn.setItem?.(Zo,String(w))}requestAnimationFrame(()=>bt())};return window.addEventListener("resize",d),()=>window.removeEventListener("resize",d)},[]),o(()=>{if(!c)return;if(Oe.current?.cancel(),_e.current)Mt();return},[c,Mt]),o(()=>{if(_e.current)Mt();yt()},[oe,yt,Mt]),o(()=>()=>{if(!_e.current)return;try{_e.current.stop()}catch(d){console.debug("[compose] failed to stop speech recognition during cleanup",d)}_e.current=null},[]),o(()=>{if(!nn)return;Ai(Date.now());let d=setInterval(()=>Ai(Date.now()),1000);return()=>clearInterval(d)},[nn,Nt?.started_at,Nt?.startedAt]),o(()=>{if(Ri(0),Ot?.mode!=="custom"||!Array.isArray(Ot.frames)||Ot.frames.length<=1)return;let d=typeof Ot.intervalMs==="number"&&Number.isFinite(Ot.intervalMs)&&Ot.intervalMs>0?Ot.intervalMs:120,w=setInterval(()=>{Ri((E)=>(E+1)%Ot.frames.length)},d);return()=>clearInterval(w)},[Ot]),o(()=>{if(c||!Oo)return;ws(we)},[Oo,Hi,oe,we,c]);let la=Vi?e`
                    <div class="compose-meta-row">
                        ${(ro||kr)&&e`
                            <div class="compose-model-meta">
                                ${ro&&e`
                                    <button
                                        ref=${Zn}
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
                                        <span class="compose-model-usage-hint" title=${Yi}>${Ui.map((d)=>e`<span key=${d.key} class=${`compose-model-usage-part is-${d.key}`}>${d.text}</span>`)}</span>
                                    `}
                                </div>
                            </div>
                        `}
                        ${!c&&de&&e`
                            <${xf}
                                usage=${de}
                                onCompact=${mi?ca:void 0}
                                compactionLabel=${nn?cs||"0:00":""}
                                compactionTitle=${nn?Bi||"Smart compaction":""}
                            />
                        `}
                    </div>
    `:null;u(()=>{if(!zt)return;f(la,zt)});let[lu,ua]=t(null);return u(()=>{if(!We||!zt){ua(null);return}let d=()=>{let w=Zn.current?.getBoundingClientRect?.(),E=zt.closest?.(".workbench-statusbar")?.getBoundingClientRect?.();if(!w||!E)return;ua({left:Math.round(w.left),bottom:Math.round(window.innerHeight-E.top+6)})};return d(),window.addEventListener("resize",d),()=>window.removeEventListener("resize",d)},[We,zt]),o(()=>()=>{if(zt)f(null,zt)},[zt]),e`
        <div class="compose-box" data-testid="compose-box" aria-disabled=${jo?"true":"false"}>
            <div
                class=${`compose-resize-handle ${Wc?"away-from-latest":""} ${fi?"has-new-messages":""}`}
                role="separator"
                aria-orientation="horizontal"
                aria-label=${le("compose.resizeInput")}
                title=${le("compose.resizeInputHint")}
                onMouseDown=${Bl}
                onTouchStart=${Ol}
            >${Io&&e`<button type="button" class="compose-latest-handle" aria-label=${fi?"New messages — jump to latest":"Jump to latest message"} title="Jump to latest message" onClick=${(d)=>{if(d.detail===0)Io()}}><span class="compose-latest-chevron compose-latest-chevron-left" aria-hidden="true"></span><span class="compose-latest-chevron compose-latest-chevron-right" aria-hidden="true"></span></button>`}</div>
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
            ${Gc&&!c&&e`
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
                    <div class="compose-inline-status-detail compose-command-notice-text" dangerouslySetInnerHTML=${{__html:S(Ci)}}></div>
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
                            class=${`compose-session-trigger compose-session-trigger-pill${$e?" active":""}`}
                            data-testid="session-switcher"
                            onClick=${Fl}
                            title=${je?.chat_jid||oe}
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
                            ${q.map((d)=>e`
                                    <${_}
                                        key=${"msg-"+d}
                                        prefix="compose"
                                        label=${"msg:"+d}
                                        title=${"Message reference: "+d}
                                        removeTitle="Remove reference"
                                        icon="message"
                                        onRemove=${()=>Q?.(d)}
                                    />
                                `)}
                            ${L.map((d)=>{let w=d.split("/").pop()||d;return e`
                                    <${_}
                                        prefix="compose"
                                        label=${w}
                                        title=${d}
                                        onClick=${()=>qe?.(d)}
                                        removeTitle="Remove file"
                                        onRemove=${()=>R?.(d)}
                                    />
                                `})}
                            ${N.map((d)=>{let w=d.split("/").pop()||d;return e`
                                    <${_}
                                        prefix="compose"
                                        label=${w}
                                        title=${d}
                                        icon="folder"
                                        onClick=${()=>qe?.(d)}
                                        removeTitle="Remove folder hint"
                                        onRemove=${()=>F?.(d)}
                                    />
                                `})}
                            ${fn.map((d,w)=>{let E=d?.name||`attachment-${w+1}`;return e`
                                    <${_}
                                        key=${E+w}
                                        prefix="compose"
                                        label=${E}
                                        title=${E}
                                        removeTitle="Remove attachment"
                                        onRemove=${()=>su(w)}
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
                        placeholder=${c?le("compose.searchPlaceholder"):le("compose.placeholder")}
                        value=${c?pn:we}
                        onInput=${cu}
                        onKeyDown=${Ql}
                        onKeyUp=${Xl}
                        onPaste=${ou}
                        onFocus=${m}
                        onClick=${m}
                        rows="1"
                        disabled=${jo}
                    />
                    ${Yn&&Vt.length>0&&e`
                        <div class="slash-autocomplete" ref=${ts}>
                            ${Vt.map((d,w)=>e`
                                <div
                                    key=${d.chat_jid||d.agent_name}
                                    class=${`slash-item${w===Uo?" active":""}`}
                                    onMouseDown=${(E)=>{E.preventDefault(),Xi(d)}}
                                    onMouseEnter=${()=>Br(w)}
                                >
                                    <span class="slash-name">@${d.agent_name}</span>
                                    <span class="slash-desc">${d.chat_jid||"Active agent"}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${Un&&Bt.length>0&&e`
                        <div class="slash-autocomplete" ref=${es}>
                            ${Bt.map((d,w)=>e`
                                <div
                                    key=${d.name}
                                    class=${`slash-item${w===Nr?" active":""}`}
                                    onMouseDown=${(E)=>{E.preventDefault(),Qi(d)}}
                                    onMouseEnter=${()=>Fr(w)}
                                >
                                    <span class="slash-name">${d.name}</span>
                                    <span class="slash-desc">${d.description}</span>
                                </div>
                            `)}
                        </div>
                    `}
                    ${We&&!c&&e`
                        <${xc}
                            anchor=${lu}
                            entries=${ll}
                            loading=${pl}
                            switching=${Jt}
                            onSelect=${(d)=>{Kl(d)}}
                            onTogglePin=${(d)=>et(d.key,Ke)}
                            onClose=${so}
                            onCompact=${mi?()=>{so(),ca()}:void 0}
                            onOpenSettings=${Ho?()=>{gn(!1),T({section:"models"})}:void 0}
                            thinkingLevel=${ce}
                            thinkingLevels=${Ki?.thinkingLevels??[]}
                            onSelectThinking=${(d)=>{Gl(d)}}
                            rootRef=${Pi}
                        />
                    `}
                    ${$e&&!c&&e`
                        <div class="compose-model-popup compose-session-popup" data-testid="session-popup" ref=${Hr} tabIndex="-1" onKeyDown=${_r}>
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
                                onInput=${(d)=>{let w=d.currentTarget.value,E=Le(De(yr,w),oe,Vn).flatMap((D)=>D.items);Nn.current=E.map((D)=>({type:"session",key:`session:${D.chat_jid}`,label:`@${D.agent_name} — ${D.chat_jid}${D.is_active?" active":""}${D.archived_at?" archived":""}`,chat:D,disabled:D.archived_at?!yn||D?.capabilities?.restore===!1:!bn||D?.capabilities?.open===!1}));let M=gc(E,w);Qt(Nn.current[M]),Or(w)}}
                                onKeyDown=${_r}
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
                                ${ds.map((d,w)=>{let E=us.find((Se)=>Se.items.includes(d)),M=E?.items[0]===d,D=Boolean(d.archived_at),Z=!D&&Tl.has(d.chat_jid),ee=d.chat_jid===(d.root_chat_jid||d.chat_jid),se=!ee&&!d.is_active&&!D&&typeof ln==="function"&&d?.capabilities?.archive!==!1,be=D&&zi,ot=be&&al===d.chat_jid,ve=se&&cl===d.chat_jid,Ve=ot||ve,qt=Et(d,{currentChatJid:oe}),Er=ne(d.agent_name),dt=Ye(d,{currentChatJid:oe}),Ar=d.root_chat_jid||d.chat_jid,zn=d.model||d.model_label||"",Ln=fc(d);return e`
                                        ${M&&e`<div class="compose-session-section-heading" role="presentation">${E.label}</div>`}
                                        <div key=${d.chat_jid} class=${`compose-model-popup-item-row${D?" archived":""}`}>
                                            ${D?e`<span class="compose-session-row-pin-spacer" aria-hidden="true"></span>`:e`<button
                                                    type="button"
                                                    class=${`compose-session-row-pin${Z?" pinned":""}`}
                                                    title=${Z?`Unpin @${d.agent_name}`:`Pin @${d.agent_name}`}
                                                    aria-label=${Z?`Unpin @${d.agent_name}`:`Pin @${d.agent_name}`}
                                                    aria-pressed=${Z?"true":"false"}
                                                    aria-keyshortcuts="Alt+Enter"
                                                    onClick=${(Se)=>{Se.preventDefault(),Se.stopPropagation(),ks(d.chat_jid)}}
                                                >${Z?"★":"☆"}</button>`}
                                            <button
                                                id=${`compose-session-option-${encodeURIComponent(d.chat_jid)}`}
                                                type="button"
                                                role="option"
                                                aria-selected=${Lt===w?"true":"false"}
                                                aria-label=${`${qt}; chat ${d.chat_jid}; root ${Ar}; ${zn?`model ${zn}; `:""}${dt.join(", ")||"idle"}`}
                                                class=${`compose-model-popup-item session-item${D?" archived":""}${Lt===w?" active":""}`}
                                                data-testid="session-item"
                                                onClick=${()=>{if(D){ea(d.chat_jid);return}Zi(d.chat_jid)}}
                                                disabled=${D?!yn||d?.capabilities?.restore===!1:!bn||d?.capabilities?.open===!1}
                                                title=${D?`Restore archived ${qt}`:`Switch to ${qt}`}
                                            >
                                                <span class="compose-session-row-content" style=${bf(d)?"font-weight:700":""}>
                                                    <span class="compose-session-row-main">
                                                        <span class="compose-session-row-label">${Er}</span>
                                                        <span class="compose-session-row-meta">
                                                            <span class="compose-session-row-jid">${d.chat_jid}</span>
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
                                                title=${`Open @${d.agent_name} in new window`}
                                                aria-label=${`Open @${d.agent_name} in new window`}
                                                onClick=${(Se)=>{Se.stopPropagation(),Ce(!1);let Ue=new URL(window.location.href);Ue.searchParams.set("chat_jid",d.chat_jid),Ue.searchParams.set("chat_only","1");let st=document.createElement("a");st.href=Ue.toString(),st.target="_blank",st.rel="noopener",st.style.display="none",document.body.appendChild(st),st.click(),st.remove()}}
                                            >
                                                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                                    <path d="M6 2h8v8"/>
                                                    <path d="M14 2 7 9"/>
                                                    <path d="M12 9v5H2V4h5"/>
                                                </svg>
                                            </button>
                                            ${(se||be)&&e`
                                                ${Ve?e`<button
                                                        key=${`${d.chat_jid}:delete-confirm`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete confirming"
                                                        data-chat-jid=${d.chat_jid}
                                                        data-delete-kind=${be?"purge":"prune"}
                                                        title=${be?"Confirm permanent deletion":"Confirm branch deletion"}
                                                        aria-label=${be?ee?`Confirm permanent deletion of archived session @${d.agent_name}`:`Confirm permanent deletion of archived branch @${d.agent_name}`:`Confirm delete @${d.agent_name}`}
                                                        onPointerDown=${(Se)=>{Se.preventDefault(),Se.stopPropagation(),oo(d,{canPurgeArchived:be,canPrune:se})}}
                                                        onKeyDown=${(Se)=>{if(Se.key!=="Enter"&&Se.key!==" ")return;Se.preventDefault(),Se.stopPropagation(),oo(d,{canPurgeArchived:be,canPrune:se})}}
                                                    >
                                                        <span class="compose-model-popup-item-delete-confirm">OK</span>
                                                    </button>`:e`<button
                                                        key=${`${d.chat_jid}:delete-request`}
                                                        type="button"
                                                        class="compose-model-popup-item-delete"
                                                        title=${be?ee?"Permanently delete this archived session":"Permanently delete this archived branch":"Delete this branch"}
                                                        aria-label=${be?ee?`Permanently delete archived session @${d.agent_name}`:`Permanently delete archived branch @${d.agent_name}`:`Delete @${d.agent_name}`}
                                                        onClick=${(Se)=>{if(Se.stopPropagation(),be){Vo(d.chat_jid);return}if(se){Jo(d.chat_jid);return}Ce(!1),ln(d.chat_jid)}}
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
                            ${!mt&&(vn||Sr||wn||En)&&e`
                                <div class="compose-model-popup-actions">
                                    ${vn&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn primary${ut.findIndex((d)=>d.key==="action:new")===Lt?" active":""}`}
                                            onClick=${()=>{na()}}
                                            title=${le("compose.newBranchTitle")}
                                        >
                                            ${le("compose.newBranch")}
                                        </button>
                                    `}
                                    ${Sr&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((d)=>d.key==="action:new-root")===Lt?" active":""}`}
                                            onClick=${()=>{ra()}}
                                            title=${le("compose.newRootTitle")}
                                        >
                                            ${le("compose.newRoot")}
                                        </button>
                                    `}
                                    ${Ht?.chat_jid&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((d)=>d.key==="action:rollup")===Lt?" active":""}`}
                                            onClick=${()=>{oa()}}
                                            title=${$r?le("compose.mergeInto",{target:Ht.agent_name?`@${Ht.agent_name}`:Ht.chat_jid}):le("compose.mergeBlocked")}
                                            disabled=${!$r}
                                        >
                                            ${le("compose.mergeCurrent")}
                                        </button>
                                    `}
                                    ${wn&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn${ut.findIndex((d)=>d.key==="action:rename")===Lt?" active":""}`}
                                            onClick=${(d)=>{ta(d)}}
                                            title=${le("compose.renameSessionTitle")}
                                            disabled=${no}
                                        >
                                            ${le("compose.renameCurrent")}
                                        </button>
                                    `}
                                    ${En&&e`
                                        <button
                                            type="button"
                                            class=${`compose-model-popup-btn danger${ut.findIndex((d)=>d.key==="action:delete")===Lt?" active":""}`}
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
                    <div class="compose-actions ${c?"search-mode":""}">
                    ${c&&e`
                        <label class="compose-search-scope-wrap" title=${le("compose.searchScope")}>
                            <span class="compose-search-scope-label">${le("compose.scope")}</span>
                            <select
                                class="compose-search-scope-select"
                                value=${h}
                                onChange=${(d)=>y?.(d.currentTarget.value)}
                            >
                                <option value="current">${le("compose.scopeCurrent")}</option>
                                <option value="root">${le("compose.scopeBranchFamily")}</option>
                                <option value="all">${le("compose.scopeAll")}</option>
                            </select>
                        </label>
                        <label class="compose-search-filter-wrap" title=${le("compose.filterImagesTitle")}>
                            <input type="checkbox" checked=${zo} onChange=${()=>nl((d)=>!d)} />
                            <span class="compose-search-filter-label">${le("compose.filterImages")}</span>
                        </label>
                        <label class="compose-search-filter-wrap" title=${le("compose.filterAttachmentsTitle")}>
                            <input type="checkbox" checked=${qo} onChange=${()=>rl((d)=>!d)} />
                            <span class="compose-search-filter-label">${le("compose.filterAttachments")}</span>
                        </label>
                        <button
                            class=${`compose-search-match-toggle ${jr==="and"?"active":""}`}
                            onClick=${()=>{let d=jr==="or"?"and":"or";Go(d),fetch("/agent/settings/general",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({searchMatchMode:d})}).catch((w)=>{})}}
                            title=${jr==="or"?"Any keyword (OR) — click for all keywords (AND)":"All keywords (AND) — click for any keyword (OR)"}
                            type="button"
                        >
                            ${jr==="or"?"OR":"AND"}
                        </button>
                    `}
                    ${Qc&&e`
                    <button
                        class="icon-btn search-toggle"
                        onClick=${c?C:x}
                        title=${c?le("compose.closeSearch"):le("compose.search")}
                        disabled=${c?typeof C!=="function":typeof x!=="function"}
                    >
                        ${c?e`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`:e`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`}
                    </button>
                    `}
                    ${$l&&!c&&e`
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
                    ${_l&&!c&&e`
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
                    ${!c&&e`
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
                    ${!c&&e`
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
export{Te,V,wt,xt,St,kt,Ee,Xn,Je,xn,er,Ie,S,K,G,Re,pe,J,At,Pe,tr,k,Me,nr,Sn,kn,An,Cn,A,_n,rr,or,fe,ir,sr,Ct,$n,_t,ar,te,cr,Qe,lr,$t,ur,De,Le,ne,Tt,Ye,Et,dr,It,Ze,pr,_,me,Xe};

//# debugId=5ACE4320136E15DC64756E2164756E21
//# sourceMappingURL=app-am2tztm4.js.map
