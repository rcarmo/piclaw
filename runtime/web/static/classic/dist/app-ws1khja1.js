function oe(n,l,t={}){let i=t.document??document,r=t.window??window,e=0,s=!1,o=()=>{if(e)r.clearInterval(e);e=0},d=(v)=>{if(s||i.visibilityState==="hidden"||e)return;if(v)n();e=Number(r.setInterval(n,l))},a=()=>i.visibilityState==="hidden"?o():d(t.refreshOnVisible!==!1);return i.addEventListener("visibilitychange",a),d(!1),()=>{s=!0,o(),i.removeEventListener("visibilitychange",a)}}
export{oe};

//# debugId=7313CF8282CD40A964756E2164756E21
//# sourceMappingURL=app-ws1khja1.js.map
