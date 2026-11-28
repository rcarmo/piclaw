import{expect,test}from'bun:test';import{existsSync,readFileSync}from'node:fs';import{resolve}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dir,'../../..');
const manifestPath='docs/development/receipts/expense-final-retention-1875.json';
const manifestBytes=readFileSync(resolve(root,manifestPath));
const manifest=JSON.parse(manifestBytes.toString('utf8'));
const overlayBytes=readFileSync(resolve(root,'docs/development/receipts/kintsugi-cutover-retention-overlay.json'));
const overlay=JSON.parse(overlayBytes.toString('utf8'));
const removalBytes=readFileSync(resolve(root,'docs/development/receipts/optimizer-removal-retention-overlay.json'));
const removal=JSON.parse(removalBytes.toString('utf8'));
const mcpAuditPath='docs/development/receipts/mcp-audit-retention-overlay.json';
const mcpAuditBytes=readFileSync(resolve(root,mcpAuditPath));
const mcpAudit=JSON.parse(mcpAuditBytes.toString('utf8'));
const a2uiBytes=readFileSync(resolve(root,'docs/development/receipts/a2ui-v1-retention-overlay.json'));
const a2ui=JSON.parse(a2uiBytes.toString('utf8'));
const delegatePath='docs/development/receipts/delegate-whitelist-retention-overlay.json';
const delegateBytes=readFileSync(resolve(root,delegatePath));
const delegate=JSON.parse(delegateBytes.toString('utf8'));
const rssPath='docs/development/receipts/native-turn-rss-retention-overlay.json';
const rssBytes=readFileSync(resolve(root,rssPath));
const rss=JSON.parse(rssBytes.toString('utf8'));
const outputPath='docs/development/receipts/native-output-rss-retention-overlay.json';
const outputBytes=readFileSync(resolve(root,outputPath));
const output=JSON.parse(outputBytes.toString('utf8'));
const correlationPath='docs/development/receipts/native-input-correlation-retention-overlay.json';
const correlationBytes=readFileSync(resolve(root,correlationPath));
const correlation=JSON.parse(correlationBytes.toString('utf8'));
const contextPath='docs/development/receipts/native-context-rss-retention-overlay.json';
const contextBytes=readFileSync(resolve(root,contextPath));
const context=JSON.parse(contextBytes.toString('utf8'));
const scopedContextPath='docs/development/receipts/scoped-context-rss-retention-overlay.json';
const scopedContextBytes=readFileSync(resolve(root,scopedContextPath));
const scopedContext=JSON.parse(scopedContextBytes.toString('utf8'));
const modelDemandPath='docs/development/receipts/model-demand-rss-retention-overlay.json';
const modelDemandBytes=readFileSync(resolve(root,modelDemandPath));
const modelDemand=JSON.parse(modelDemandBytes.toString('utf8'));
const transportPath='docs/development/receipts/a2ui-prompt-transport-removal-retention-overlay.json';
const transportBytes=readFileSync(resolve(root,transportPath));
const transport=JSON.parse(transportBytes.toString('utf8'));
const mergePath='docs/development/receipts/context-demand-a2ui-merge-overlay.json';
const mergeBytes=readFileSync(resolve(root,mergePath));
const merge=JSON.parse(mergeBytes.toString('utf8'));
const selectionPath='docs/development/receipts/delegate-selection-retention-overlay.json';
const selectionBytes=readFileSync(resolve(root,selectionPath));
const selection=JSON.parse(selectionBytes.toString('utf8'));
const guidancePath='docs/development/receipts/delegate-selection-guidance-retention-overlay.json';
const guidanceBytes=readFileSync(resolve(root,guidancePath));
const guidance=JSON.parse(guidanceBytes.toString('utf8'));
const delegateMergePath='docs/development/receipts/context-demand-delegate-merge-overlay.json';
const delegateMergeBytes=readFileSync(resolve(root,delegateMergePath));
const delegateMerge=JSON.parse(delegateMergeBytes.toString('utf8'));
const ownedPath='docs/development/receipts/codex-owned-response-retention-overlay.json';
const ownedBytes=readFileSync(resolve(root,ownedPath));
const owned=JSON.parse(ownedBytes.toString('utf8'));
const generationContextPath='docs/development/receipts/core-generation-context-retention-overlay.json';
const generationContextBytes=readFileSync(resolve(root,generationContextPath));
const generationContext=JSON.parse(generationContextBytes.toString('utf8'));
const startupDocument=JSON.parse(readFileSync(resolve(root,'docs/development/receipts/startup-document-iteration-retention-overlay.json'),'utf8'));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
type Change={path:string;beforeSha256:string;afterSha256:string;purpose:string};
test('removal/retention witness binds every original Core path through explicit later source transformations',()=>{
 expect(sha(manifestBytes)).toBe(overlay.baseManifestSha256);
 expect(sha(overlayBytes)).toBe(removal.previousOverlaySha256);
 expect(removal.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(removal.rows).toHaveLength(8);
 expect(sha(removalBytes)).toBe(mcpAudit.previousOverlaySha256);
 expect(mcpAudit.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(mcpAudit.rows.map((row:{path:string})=>row.path)).toEqual(['runtime/scripts/schema-ownership.json']);
 expect(a2ui.previousOverlay).toBe(mcpAuditPath);
 expect(a2ui.previousOverlaySha256).toBe(sha(mcpAuditBytes));
 expect(a2ui.baseManifestSha256).toBe(mcpAudit.baseManifestSha256);
 expect(delegate.previousOverlaySha256).toBe(sha(a2uiBytes));
 expect(delegate.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(rss.previousOverlay).toBe(delegatePath);
 expect(rss.previousOverlaySha256).toBe(sha(delegateBytes));
 expect(rss.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(rss.rows.map((row:{path:string})=>row.path)).toEqual([
  'runtime/durable-engine/src/host-models.ts', 'runtime/durable-engine/src/host-plan-context.ts',
 ]);
 expect(output.previousOverlay).toBe(rssPath);
 expect(output.previousOverlaySha256).toBe(sha(rssBytes));
 expect(output.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(output.rows.map((row:{path:string})=>row.path)).toEqual(['runtime/durable-engine/src/host-models.ts']);
 expect(correlation.previousOverlay).toBe(outputPath);
 expect(correlation.previousOverlaySha256).toBe(sha(outputBytes));
 expect(correlation.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(correlation.rows.map((row:{path:string})=>row.path)).toEqual([
  'runtime/durable-engine/src/application-bootstrap.ts','runtime/durable-engine/src/host-bindings.ts',
 ]);
 expect(context.previousOverlay).toBe(correlationPath);
 expect(context.previousOverlaySha256).toBe(sha(correlationBytes));
 expect(context.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(context.rows.map((row:{path:string})=>row.path)).toEqual([
  'runtime/durable-engine/src/host-models.ts','runtime/durable-engine/src/host-runtime.ts',
 ]);
 expect(scopedContext.previousOverlay).toBe(contextPath);
 expect(scopedContext.previousOverlaySha256).toBe(sha(contextBytes));
 expect(scopedContext.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(scopedContext.rows.map((row:{path:string})=>row.path)).toEqual([
  'runtime/durable-engine/src/host-runtime.ts',
  'runtime/src/agent-pool.ts',
  'runtime/src/agent-pool/runtime-facade.ts',
  'runtime/src/channels/web/agent/agent-status.ts',
  'runtime/src/channels/web/core/web-channel-contracts.ts',
  'runtime/src/channels/web/endpoints/channel-endpoint-context-factory.ts',
  'runtime/web/src/api.ts',
 ]);
 expect(modelDemand.sourceParent).toBe('9689ff533cfe6264580b7abf8b91eb7f507433e7');
 expect(modelDemand.baseManifest).toBe('docs/development/receipts/expense-final-retention-1875.json');
 expect(modelDemand.baseManifestSha256).toBe('9fb13a721eddd67160bb9e0df21265414f19fb936304c6c1cd9c3f1d47757aac');
 expect(modelDemand.previousOverlay).toBe(scopedContextPath);
 expect(modelDemand.previousOverlaySha256).toBe(sha(scopedContextBytes));
 expect(sha(scopedContextBytes)).toBe('aab3e25a6c5efaa7c52a86a0d995a23a990a18d6b236a54bd941a27eebb4ddc9');
 expect(modelDemand.rows).toEqual([
  {
   path:'runtime/durable-engine/src/host-runtime.ts',
   beforeSha256:'713e5f92c88100d88d5b761e33e55b94eafbe302c1ec70ef44e5bd69b13cc844',
   afterSha256:'addd0115b08378c5ae93a9d27ba837aed7311847fdea2a5f56771a1e0f56a490',
   purpose:'Read the persisted agent model reference with the committed tail so passive context usage and revision reads avoid composing the full agent loadout.',
  },
  {
   path:'runtime/web/src/api.ts',
   beforeSha256:'c53d0ce67648f2968d594db0a9cc739989ed9154ff5a83ba8aeff0fddcba6039',
   afterSha256:'f64dbcd712f6acb0535201e3f0c9ac9702e23d628ddf32f7f9572a110d6c59c1',
   purpose:'Fence periodic Classic context polling to its current visible scope and reuse a successful full snapshot when its context revision still matches.',
  },
 ]);
 expect(transport.previousOverlay).toBe(correlationPath);
 expect(transport.previousOverlaySha256).toBe(sha(correlationBytes));
 expect(transport.baseManifestSha256).toBe(overlay.baseManifestSha256);
 const bootstrapPath='runtime/durable-engine/src/application-bootstrap.ts';
 const mergedPaths=[bootstrapPath,'runtime/durable-engine/src/host-models.ts','runtime/durable-engine/src/host-runtime.ts'];
 expect(transport.rows.map((row:Change)=>row.path)).toEqual(mergedPaths);
 expect(merge.rows.map((row:Change)=>row.path)).toEqual(mergedPaths);
 expect(merge.baseManifest).toBe(manifestPath);
 expect(merge.baseManifestSha256).toBe(sha(manifestBytes));
 expect(merge.common).toEqual({
  commit:'fe5da86167ea7b066383ec6c3804a7a13a02fbc7',
  overlay:correlationPath,overlaySha256:sha(correlationBytes),
 });
 expect(context.sourceParent).toBe(merge.common.commit);
 expect(transport.sourceParent).toBe(merge.common.commit);
 expect(merge.parents).toEqual({
  rss:{commit:'ddebd90bb6ea6fc833d9c4c7ca3d32c79e43a60d',overlay:modelDemandPath,overlaySha256:sha(modelDemandBytes)},
  incoming:{commit:'d0a55b9e1abb880285f27ce1f2aeab4cd70859e1',overlay:transportPath,overlaySha256:sha(transportBytes)},
 });
 expect(selection.previousOverlay).toBe(transportPath);
 expect(selection.previousOverlaySha256).toBe(sha(transportBytes));
 expect(selection.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(selection.rows.map((row:{path:string})=>row.path)).toEqual([
  'runtime/durable-engine/src/default-application-runtime.ts','runtime/durable-engine/src/host-runtime.ts',
 ]);
 expect(guidance.previousOverlay).toBe(selectionPath);
 expect(guidance.previousOverlaySha256).toBe(sha(selectionBytes));
 expect(guidance.baseManifestSha256).toBe(overlay.baseManifestSha256);
 expect(guidance.rows.map((row:{path:string})=>row.path)).toEqual(['runtime/durable-engine/src/default-application-runtime.ts']);
 const defaultRuntimePath='runtime/durable-engine/src/default-application-runtime.ts';
 const hostRuntimePath='runtime/durable-engine/src/host-runtime.ts';
 expect(delegateMerge.rows.map((row:Change)=>row.path)).toEqual([defaultRuntimePath,hostRuntimePath]);
 expect(delegateMerge.baseManifest).toBe(manifestPath);
 expect(delegateMerge.baseManifestSha256).toBe(sha(manifestBytes));
 expect(delegateMerge.common).toEqual({
  commit:'d0a55b9e1abb880285f27ce1f2aeab4cd70859e1',
  overlay:transportPath,overlaySha256:sha(transportBytes),
 });
 expect(delegateMerge.parents).toEqual({
  rss:{commit:'7c82459a9c601d7aa6c5fc72c22e48a3a29b2e54',overlay:mergePath,overlaySha256:sha(mergeBytes)},
  incoming:{commit:'92e2cc0b4a1f23ce0f75f71c07d6707a687e7ed7',overlay:guidancePath,overlaySha256:sha(guidanceBytes)},
 });
 expect(owned.sourceParent).toBe('6552e82f438187dd9cdbc1df02e7e2a666e932b0');
 expect(owned.baseManifest).toBe(manifestPath);
 expect(owned.baseManifestSha256).toBe(sha(manifestBytes));
 expect(sha(manifestBytes)).toBe('9fb13a721eddd67160bb9e0df21265414f19fb936304c6c1cd9c3f1d47757aac');
 expect(owned.previousOverlay).toBe(delegateMergePath);
 expect(owned.previousOverlaySha256).toBe(sha(delegateMergeBytes));
 expect(sha(delegateMergeBytes)).toBe('9d497d6e167f93b4170ad65bd722bd12c6361130dd89a4f1d31fc3b233796bf0');
 expect(owned.rows).toEqual([
  {
   path:'runtime/durable-engine/src/default-application-runtime.ts',
   beforeSha256:'609f6fcacdb6fe41296011bc7578418b6806aac0b87f25662effe3b0ed919536',
   afterSha256:'48158f541586b4273f2300d2483e3e35a14907487abaa1bcff87ae10ce0216d0',
   purpose:'Capture Codex responses with the dedicated observer clone supplied by the host model service, retaining legacy capture as a fallback.',
  },
  {
   path:'runtime/durable-engine/src/host-extension-catalog.ts',
   beforeSha256:'708747e48e821f32e6b3db52a729c5e23e626b05a3ccde6c9daf8757bd35686b',
   afterSha256:'2a4241da41e5bddb18764b76bec6327b735d972de5016f77e07be061fe310b12',
   purpose:'Approve the 0.2.5 extension successor fingerprints for the package, native provider and owned Codex output observer.',
  },
 ]);
 expect(generationContext.sourceParent).toBe('f69ddce63271b3f75fd8ffa837f88af94c48b503');
 expect(generationContext.baseManifest).toBe(manifestPath);
 expect(generationContext.baseManifestSha256).toBe(sha(manifestBytes));
 expect(generationContext.previousOverlay).toBe(ownedPath);
 expect(generationContext.previousOverlaySha256).toBe(sha(ownedBytes));
 expect(sha(ownedBytes)).toBe('ed5489a0f56455ac79b21dd448c9eee2c0e8c086f01dd0becb8df4fd977608b8');
 expect(generationContext.rows).toEqual([{
  path:hostRuntimePath,
  beforeSha256:'6ded5d01217debcc5b6634d57e32fbc0f8ff4500a7cd2ccce86f0193b1f09c48',
  afterSha256:'7011a5ccfd9adff32833e655fabc38856035cbb47094f51a52d263282c6d87d7',
  purpose:'Warm the existing bounded scalar cache for observed conversations at a strictly newer exact raw generation tail without retaining a context view.',
 }]);
 expect(startupDocument.sourceParent).toBe('046a42df4994de33711ad7835d887c0415a33fcc');
 expect(startupDocument.baseManifest).toBe(manifestPath);
 expect(startupDocument.baseManifestSha256).toBe(sha(manifestBytes));
 expect(startupDocument.previousOverlay).toBe(generationContextPath);
 expect(startupDocument.previousOverlaySha256).toBe(sha(generationContextBytes));
 expect(sha(generationContextBytes)).toBe('3f18376729bd3ac5bbb2b06e0396944cd6d529eff8d5eb27f7c380b923d3f851');
 expect(startupDocument.rows).toEqual([
   {
     "path": "runtime/durable-engine/src/default-application-runtime.ts",
     "beforeSha256": "48158f541586b4273f2300d2483e3e35a14907487abaa1bcff87ae10ce0216d0",
     "afterSha256": "75bc4300e24725d8df9d6f06e29b193ac9760a6be45724b4ed3547358a8f0af5",
     "purpose": "Iterate startup document revisions in their existing SQL order, keeping every historical version and JSON check and current owner and recovery behaviour."
   }
 ]);
 const indexRows=<Row extends Change>(layer:{version:number;rows:Row[]})=>{
  expect(layer.version).toBe(1);
  const rows=new Map(layer.rows.map(row=>[row.path,row] as const));
  expect(rows.size).toBe(layer.rows.length);
  for(const path of rows.keys())expect(manifest.rows.some((prior:any)=>prior.repo==='core'&&prior.path===path&&prior.state!=='deleted')).toBe(true);
  return rows;
 };
 const commonLayers=[overlay,removal,mcpAudit,a2ui,delegate,rss,output,correlation].map(layer=>indexRows<Change>(layer));
 const rssLayers=[context,scopedContext,modelDemand].map(layer=>indexRows<Change>(layer));
 const a2uiLayers=[indexRows<Change>(transport)];
 const delegateLayers=[selection,guidance].map(layer=>indexRows<Change>(layer));
 const mergeRows=indexRows<Change&{incomingSha256:string}>(merge);
 const delegateMergeRows=indexRows<Change&{incomingSha256:string}>(delegateMerge);
 const ownedRows=indexRows<Change>(owned);
 const generationContextRows=indexRows<Change>(generationContext);
 const startupDocumentRows=indexRows<Change>(startupDocument);
 const advance=(path:string,expected:string,layers:ReadonlyMap<string,Change>[])=>{
  for(const layer of layers){
   const change=layer.get(path);
   if(!change)continue;
   expect(change.beforeSha256,path).toBe(expected);
   expect(change.purpose.length).toBeGreaterThan(20);
   expected=change.afterSha256;
  }
  return expected;
 };
 expect(manifest.baselineEntries).toBe(105);expect(manifest.rows).toHaveLength(105);expect(manifest.deletedPaths).toBe(37);
 expect(new Set(manifest.rows.map((r:{repo:string;path:string})=>r.repo+':'+r.path)).size).toBe(105);
 for(const row of manifest.rows){if(row.repo!=='core')continue;const path=resolve(root,row.path);
  if(row.state==='deleted'){
   expect([...commonLayers,...rssLayers,...a2uiLayers,...delegateLayers,mergeRows,delegateMergeRows,ownedRows,generationContextRows,startupDocumentRows].some(layer=>layer.has(row.path))).toBe(false);
   expect(existsSync(path),row.path).toBe(false);
  }else{
   // Both merge parents start at their stated common tip, not at each other's tip.
   const commonTip=advance(row.path,row.currentSha256,commonLayers);
   const rssTip=advance(row.path,commonTip,rssLayers);
   const a2uiIncomingTip=advance(row.path,commonTip,a2uiLayers);
   const incomingTip=advance(row.path,a2uiIncomingTip,delegateLayers);
   const resolution=mergeRows.get(row.path);
   if(resolution){
    expect(resolution.incomingSha256,row.path).toBe(a2uiIncomingTip);
    expect(a2uiIncomingTip,row.path).not.toBe(commonTip);
    expect(resolution.afterSha256,row.path).not.toBe(rssTip);
    if(row.path===bootstrapPath){
     expect(rssTip,row.path).toBe(commonTip);
     expect(resolution.afterSha256,row.path).toBe(a2uiIncomingTip);
    }else{
     expect(rssTip,row.path).not.toBe(commonTip);
     expect(resolution.afterSha256,row.path).not.toBe(a2uiIncomingTip);
    }
   }
   let mergedTip=advance(row.path,rssTip,[mergeRows]);
   const delegateResolution=delegateMergeRows.get(row.path);
   if(delegateResolution){
    expect(delegateResolution.incomingSha256,row.path).toBe(incomingTip);
    if(row.path===defaultRuntimePath){
     expect(mergedTip,row.path).toBe(commonTip);
     expect(delegateResolution.afterSha256,row.path).toBe(incomingTip);
    }else if(row.path===hostRuntimePath){
     expect(mergedTip,row.path).not.toBe(incomingTip);
     expect(delegateResolution.afterSha256,row.path).not.toBe(mergedTip);
     expect(delegateResolution.afterSha256,row.path).not.toBe(incomingTip);
    }
   }
   mergedTip=advance(row.path,mergedTip,[delegateMergeRows,ownedRows,generationContextRows,startupDocumentRows]);
   expect(sha(readFileSync(path)),row.path).toBe(mergedTip);
   expect(row.currentPurpose.length).toBeGreaterThan(20);
  }
 }
});
test('retirement accounting charges current additions and does not credit unrelated/generated/test changes',()=>{
 const r=manifest.reduction;expect(r.conservativeAttributedNet).toBe(r.accepted1881.physical+r.accepted1878.physical+r.currentCoreHandwrittenProduction.net+r.addon236Runtime.net);
 expect(r.currentCoreHandwrittenProduction.net).toBe(29);expect(r.addon236Runtime.net).toBe(20);
 expect(r.accounting).toContain('credited once');expect(r.accounting).toContain('no backend deletion credit');
 expect(manifest.scopeExclusion).toContain('Cheapskate explicitly deferred');
});
