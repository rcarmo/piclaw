var r=Object.defineProperty;var s=(b)=>b;function t(b,a){this[b]=s.bind(null,a)}var wo=(b,a)=>{for(var c in a)r(b,c,{get:a[c],enumerable:!0,configurable:!0,set:t.bind(a,c)})};var q,m,k,p=(b,a)=>{for(var[c,l,h]of q||[])for(var d=[b],n=globalThis,i=n.document,o,g,j,e,f;g=d.pop();)if(!m[g]&&(j=l[g])){m[g]=1;for(e=1;e<j.length;e++)d.push(h[j[e]]);if(!a&&g!==b&&(o=i&&i.head)){if(k===void 0)k=(e=i.querySelector("meta[property=csp-nonce]"))&&(e.nonce||e.getAttribute("nonce"))||"";if(f=i.createElement("link"),f.rel="modulepreload",f.crossOrigin="",k)f.nonce=k;f.href=new n.URL(j[0],c),o.appendChild(f)}}},at=(b,a,c,l)=>{for(var h={},d=0;d<a.length;d++)h[a[d]]=c[d];(q||=[]).push([b,h,a]),m||={},p(a[l],1)};
export{wo,p,at};

//# debugId=3386A08FFFADE99364756E2164756E21
//# sourceMappingURL=app-8f7dkwd2.js.map
