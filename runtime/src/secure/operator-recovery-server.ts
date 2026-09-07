import Database from 'bun:sqlite';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { readAccessConfig } from '../core/config-access.js';
import { getStoreDir } from '../core/config-context.js';
import { getWebRuntimeConfig, getWebServerConfig } from '../core/config-web.js';
import { readKeychainBootstrapKeyMaterial } from '../core/config-secrets.js';
import { readAccessState } from '../db/access-state.js';
import { handleFamilyInvitationRoutes } from '../channels/web/http/family-invitations.js';
import { ResponseService } from '../channels/web/http/response-service.js';
import { withSecurityHeaders } from '../channels/web/http/security.js';
import { acquireRuntimeLock } from '../runtime/single-instance.js';

export interface OperatorRecoveryServerOptions { recoveryId:string; origin:string }
interface RecoveryGrant {expires_at:number;method:'totp'|'passkey';created_at:string}
interface OperatorRecoveryServerDeps {
  serverConfig?: Readonly<{host:string;port:number;idleTimeout:number;tlsCert:string;tlsKey:string}>;
  serve?:typeof Bun.serve;
  database?:Database;
}

function inspect(database:Database,options:OperatorRecoveryServerOptions,now=Date.now(),requireNoFactor=true):RecoveryGrant {
  if(readAccessConfig().mode!=='family-shared'||readAccessState(database).activatedMode!=='family-shared')throw new Error('Recovery-only startup requires a configured, already-migrated family store.');
  const origin=new URL(options.origin);if(origin.protocol!=='https:'||origin.origin!==options.origin||origin.username||origin.password)throw new Error('Recovery-only startup requires an exact HTTPS origin.');
  if(!/^operator-recovery-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(options.recoveryId))throw new Error('Exact operator recovery ID required.');
  const row=database.query(`SELECT i.expires_at,i.method,e.created_at FROM user_auth_invitations i JOIN operator_recovery_events e ON e.id=i.recovery_event_id
    JOIN users u ON u.id=i.user_id JOIN chat_branches b ON b.chat_jid=u.home_chat_jid JOIN session_roots r ON r.root_branch_id=b.branch_id
    WHERE e.id=? AND e.target_user_id=i.user_id AND e.method=i.method AND e.origin=? AND i.expected_origin=e.origin
      AND i.issuer_user_id=i.user_id AND i.state IN ('issued','claimed') AND i.expires_at>? AND u.role='admin' AND u.enabled=0
      AND u.home_chat_jid=b.chat_jid AND b.root_chat_jid=b.chat_jid AND b.parent_branch_id IS NULL AND b.archived_at IS NULL AND r.owner_user_id=u.id
      AND (?=0 OR (NOT EXISTS(SELECT 1 FROM user_totp_factors WHERE user_id=u.id) AND NOT EXISTS(SELECT 1 FROM webauthn_credentials WHERE user_id=u.id)))`)
    .get(options.recoveryId,options.origin,now,requireNoFactor?1:0) as RecoveryGrant|null;
  const created=Date.parse(row?.created_at??'');
  if(!row||!Number.isSafeInteger(row.expires_at)||!Number.isFinite(created)||created>now||row.expires_at<=created||row.expires_at>created+15*60_000||!['totp','passkey'].includes(row.method))throw new Error('Operator recovery grant is missing, expired, consumed or inconsistent.');
  const policy=getWebRuntimeConfig().passkeyMode;if((row.method==='passkey'&&policy==='totp-only')||(row.method==='totp'&&policy==='passkey-only'))throw new Error('Operator recovery method is disabled by configured authentication policy.');
  if(row.method==='totp'&&!readKeychainBootstrapKeyMaterial())throw new Error('TOTP recovery requires the existing factor-encryption bootstrap key.');
  return row;
}

export function createOperatorRecoveryRequestHandler(database:Database,options:OperatorRecoveryServerOptions,onEnrolled:()=>void=()=>{}):(req:Request)=>Promise<Response>{
  const responses=new ResponseService(),runtime=getWebRuntimeConfig();
  const channel={json:(value:unknown,status=200)=>responses.json(value,status),serveStatic:(path:string,req?:Request)=>responses.serveStatic(path,req),authGateway:{
    createTotpContext:()=>({isTotpEnabled:()=>runtime.passkeyMode!=='passkey-only'}),createWebauthnContext:()=>({isPasskeyEnabled:()=>runtime.passkeyMode!=='totp-only'}),
  }} as any;
  return async(req:Request)=>{let response:Response;try{inspect(database,options);const url=new URL(req.url),asset=req.method.match(/^(GET|HEAD)$/)&&!url.search&&({
      '/static/common/dist/login.bundle.css':'common/dist/login.bundle.css','/static/common/dist/invitation.bundle.js':'common/dist/invitation.bundle.js',
    } as Record<string,string>)[url.pathname];
    if(url.origin!==options.origin||url.search)response=responses.json({error:'Not found'},404);
    else if(asset)response=await responses.serveStatic(asset,req);
    else response=await handleFamilyInvitationRoutes(channel,req,{database,expectedRecoveryId:options.recoveryId,expectedOrigin:options.origin,validateScope:()=>{inspect(database,options,Date.now(),false);},onEnrolled})??responses.json({error:'Not found'},404);
  }catch{response=responses.json({error:'Not found'},404);}response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');return withSecurityHeaders(response,true);};
}

export async function serveOperatorRecovery(options:OperatorRecoveryServerOptions,deps:OperatorRecoveryServerDeps={}):Promise<void>{
  let source:string|undefined;if(!deps.database){const requested=join(getStoreDir(),'messages.db'),requestedStat=lstatSync(requested);if(!requestedStat.isFile()||requestedStat.isSymbolicLink())throw new Error('Existing regular, non-symlink database required.');source=realpathSync(requested);if(source!==requested)throw new Error('Existing regular, non-symlink database required.');}
  const lock=acquireRuntimeLock({lockPath:join(getStoreDir(),'runtime.lock'),disabled:false,maintenance:true});let database:Database|undefined,server:ReturnType<typeof Bun.serve>|undefined,timer:ReturnType<typeof setTimeout>|undefined,watchdog:ReturnType<typeof setInterval>|undefined;
  let stop:()=>void=()=>{},active=0,stopping=false,finish:()=>void=()=>{};
  try{database=deps.database??new Database(source!,{readwrite:true,create:false,strict:true});database.exec('PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON');const grant=inspect(database,options),web=deps.serverConfig??getWebServerConfig();
    if(!web.tlsCert||!web.tlsKey)throw new Error('Recovery-only startup requires configured TLS certificate and key files.');
    const cert=readFileSync(realpathSync(web.tlsCert),'utf8'),key=readFileSync(realpathSync(web.tlsKey),'utf8');const done=new Promise<void>(resolve=>{finish=resolve;});
    stop=()=>{if(stopping)return;stopping=true;server?.stop(false);if(active===0)finish();};const handle=createOperatorRecoveryRequestHandler(database,options,()=>setTimeout(stop,250));
    server=(deps.serve??Bun.serve)({hostname:web.host,port:web.port,idleTimeout:web.idleTimeout,maxRequestBodySize:64*1024,tls:{cert,key},fetch:async req=>{if(stopping)return new Response(JSON.stringify({error:'Not found'}),{status:404,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store'}});active++;try{return await handle(req);}finally{active--;if(stopping&&active===0)finish();}}});
    timer=setTimeout(stop,Math.max(1,grant.expires_at-Date.now()));watchdog=setInterval(()=>{try{inspect(database!,options);}catch{stop();}},1000);watchdog.unref();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    console.log(JSON.stringify({recovery_id:options.recoveryId,origin:options.origin,expires_at:grant.expires_at,warning:'Recovery-only listener exposes invitation setup only; normal Piclaw remains unavailable.'}));await done;
  }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);if(timer)clearTimeout(timer);if(watchdog)clearInterval(watchdog);server?.stop(true);if(!deps.database)database?.close();lock.release();}
}
