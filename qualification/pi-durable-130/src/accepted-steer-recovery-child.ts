import './test-guard.js';
import { prepareNativeMessageRecovery } from './native-message-recovery-fixture.js';
if(process.argv.length!==3||!['before-submit','committed-ack-lost'].includes(process.argv[2]!))throw Error('Owned native recovery boundary required');
const {f,checkpoint}=await prepareNativeMessageRecovery(process.argv[2] as 'before-submit'|'committed-ack-lost');
f.options.owner.assert();
console.log(JSON.stringify({event:'native-message-checkpoint',...checkpoint}));
// Keep the real owner/Root/SDK alive until the parent proves exclusive ownership
// and SIGKILLs this disposable child. No provider completion is released.
await new Promise(()=>{setInterval(()=>{},1000);});
