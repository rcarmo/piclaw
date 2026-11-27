import{expect,test}from'bun:test';import{existsSync,readFileSync}from'node:fs';import{resolve}from'node:path';import{createHash}from'node:crypto';
const root=resolve(import.meta.dir,'../../..');
const manifestBytes=readFileSync(resolve(root,'docs/development/receipts/expense-final-retention-1875.json'));
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
const modelDemand=JSON.parse(readFileSync(resolve(root,modelDemandPath),'utf8'));
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
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
 const layers=[overlay,removal,mcpAudit,a2ui,delegate,rss,output,correlation,context,scopedContext,modelDemand].map(layer=>{
  expect(layer.version).toBe(1);
  const rows=new Map<string,{beforeSha256:string;afterSha256:string;purpose:string}>(layer.rows.map((row:any)=>[row.path,row]));
  expect(rows.size).toBe(layer.rows.length);
  for(const path of rows.keys())expect(manifest.rows.some((prior:any)=>prior.repo==='core'&&prior.path===path&&prior.state!=='deleted')).toBe(true);
  return rows;
 });
 expect(manifest.baselineEntries).toBe(105);expect(manifest.rows).toHaveLength(105);expect(manifest.deletedPaths).toBe(37);
 expect(new Set(manifest.rows.map((r:{repo:string;path:string})=>r.repo+':'+r.path)).size).toBe(105);
 for(const row of manifest.rows){if(row.repo!=='core')continue;const path=resolve(root,row.path);
  if(row.state==='deleted'){
   expect(layers.some(layer=>layer.has(row.path))).toBe(false);expect(existsSync(path),row.path).toBe(false);
  }else{
   let expected=row.currentSha256;
   for(const layer of layers){const change=layer.get(row.path);if(!change)continue;expect(change.beforeSha256,row.path).toBe(expected);expect(change.purpose.length).toBeGreaterThan(20);expected=change.afterSha256;}
   expect(sha(readFileSync(path)),row.path).toBe(expected);expect(row.currentPurpose.length).toBeGreaterThan(20);
  }
 }
});
test('retirement accounting charges current additions and does not credit unrelated/generated/test changes',()=>{
 const r=manifest.reduction;expect(r.conservativeAttributedNet).toBe(r.accepted1881.physical+r.accepted1878.physical+r.currentCoreHandwrittenProduction.net+r.addon236Runtime.net);
 expect(r.currentCoreHandwrittenProduction.net).toBe(29);expect(r.addon236Runtime.net).toBe(20);
 expect(r.accounting).toContain('credited once');expect(r.accounting).toContain('no backend deletion credit');
 expect(manifest.scopeExclusion).toContain('Cheapskate explicitly deferred');
});
