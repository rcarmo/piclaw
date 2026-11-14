

import{html,render as renderClassic}from'../../../web/src/vendor/preact-htm.js';
import{KeychainSection as ClassicKeychain}from'../../../web/src/components/settings/keychain';
window.fetch=async()=>{if(new URL(location.href).searchParams.has('delay'))await new Promise(resolve=>setTimeout(resolve,500));return Response.json({ok:true,entries:[],status:{enabled:false,reason:'not_configured'}});};
renderClassic(html`<${ClassicKeychain} />`,document.getElementById('root'));
