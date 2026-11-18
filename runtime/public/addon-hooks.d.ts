/** Self-contained add-on hook contracts. No imports from private Piclaw source. */
/** Pure display text owned by a tool. Arguments may be partial; never execute,
 * read configuration/credentials, start async work or mutate the readonly input.
 * Core adds the tool-name prefix and applies generic text/length validation. */
export type ToolCallSummary = (args: unknown) => string | null | undefined;
export interface ToolCallSummaryMetadata { readonly callSummary: ToolCallSummary }
export type DictationState = 'idle' | 'loading' | 'recording' | 'finishing' | 'error';
export type DictationFinish = {status:'finished'} | {status:'cancelled'};
export interface DictationSession { finish():Promise<DictationFinish>; cancel():Promise<void> }
export interface ComposerDictationProvider {
 id:string; label:string; availability():{available:boolean;reason?:string};
 start(context:{signal:AbortSignal;chatJid:string;setState(state:DictationState,message?:string):void;updateSegment(update:{segmentId:string;text:string;final:boolean}):{applied:boolean}}):Promise<DictationSession>;
}
export interface ComposerDictationAddonApi {
 composerDictationVersion:1;
 registerComposerDictationProvider(provider:ComposerDictationProvider):()=>void;
 selectComposerDictationProvider(id:string|null):void;
}
export interface AuthenticatedPrincipal {
 readonly kind:'user'|'local';readonly userId:string;readonly username:string;readonly displayName:string;readonly role:'admin'|'user';
 readonly mode:'single-user'|'family-shared'|'isolated-containers';readonly homeChatJid:string;
 readonly authentication:Readonly<{method:string;sessionId:string|null;expiresAt:string|null}>;
}
export interface AuthenticatedAddonSocketRegistration {
 path:string;maxMessageBytes:number;maxQueuedBytes:number;maxSessionMs:number;maxConnections:number;
 authorize(context:{principal:Readonly<AuthenticatedPrincipal>;request:Request;signal:AbortSignal}):Promise<Readonly<{chatJid:string;workspaceId?:string}>>;
 open(context:{principal:Readonly<AuthenticatedPrincipal>;scope:Readonly<{chatJid:string;workspaceId?:string}>;signal:AbortSignal;send(message:string|Uint8Array):Promise<void>;close(code?:number,reason?:string):void}):Promise<{message(message:string|Uint8Array):Promise<void>;dispose():Promise<void>}>;
}
export interface AuthenticatedSocketAddonApi { version:1;register(registration:AuthenticatedAddonSocketRegistration):()=>void }
