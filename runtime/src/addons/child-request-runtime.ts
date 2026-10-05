import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Extension, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Database } from 'bun:sqlite';
import { getWorkspaceDir, getStoreDir, getDataDir, getConfigPath } from '../core/config-context.js';
import { readAccessConfig } from '../core/config-access.js';
import { getChatJid } from '../core/chat-context.js';
import { getExecutionIdentity } from '../core/execution-context.js';
import { getBudgetWorkContext } from '../budget/context.js';
import type { BudgetWorkContext } from '../budget/types.js';
import { getBudgetWork } from '../db/budget-limits.js';
import { getDb, getDatabaseBinding } from '../db/connection.js';
import { getCurrentAddonRegistrationOwner, deriveExternalAddonId } from './external-routes.js';
import { listInstalledAddonPackageDirs, readInstalledAddonPackage, resolveAddonPackageEntries } from './package-entries.js';
import { ChildRequestError } from './child-request-errors.js';
import type { ChildRequestsApiV1, ChildRequestScopeV1 } from './child-request-contracts.js';

/** Core-created authority supplied only to the qualified host, never to child IPC. */
export interface ChildRequestInvocation {
  readonly addonId: string;
  readonly toolCallId: string;
  readonly work: Readonly<BudgetWorkContext>;
  readonly signal: AbortSignal;
  readonly deadlineAt: number;
  readonly database: Database;
  authorise(): void;
}
export interface AddonChildRequestsHost {
  /** Capture policy/model/account authority synchronously before auth work. The
   * host must call invocation.authorise at preparation/dispatch boundaries. */
  createScope(input: Parameters<ReturnType<ChildRequestsApiV1['register']>['createScope']>[0], invocation: ChildRequestInvocation): ChildRequestScopeV1;
}
interface InvocationState { authority: ChildRequestInvocation; context: BudgetWorkContext; chatJid: string; active: boolean; scopes: Set<ChildRequestScopeV1>; }
const invocations = new AsyncLocalStorage<InvocationState | null>();
const originals = new WeakMap<object, ToolDefinition['execute']>();
const generations = new WeakMap<object, object>();
let installedHost: AddonChildRequestsHost | null = null;
let stopping = false;
let runtimeGeneration = 0;
const allScopes = new Set<ChildRequestScopeV1>();

/** No default provider adapter. Installing a qualified host is an explicit core
 * composition step; add-on code cannot supply one through the public API. */
export function setAddonChildRequestsHost(host: AddonChildRequestsHost): void {
  if (stopping || installedHost || allScopes.size) throw new ChildRequestError('unavailable');
  installedHost = host;
}
export async function shutdownAddonChildRequests(): Promise<void> {
  stopping = true;
  installedHost = null;
  const results = await Promise.allSettled([...allScopes].map(scope => scope.close()));
  if (results.some(result => result.status === 'rejected')) throw new ChildRequestError('settlement_failed');
}

export const addonChildRequestsApi: ChildRequestsApiV1 = Object.freeze({
  version: 1 as const,
  register() {
    const owner = getCurrentAddonRegistrationOwner();
    if (stopping || !owner) throw new ChildRequestError('unavailable');
    const addonId = owner.addonId;
    const generation = runtimeGeneration;
    return Object.freeze({
      createScope(input: Parameters<ReturnType<ChildRequestsApiV1['register']>['createScope']>[0]) {
        const state = invocations.getStore(), host = installedHost;
        if (stopping || generation !== runtimeGeneration || !state || !state.active || getBudgetWorkContext() !== state.context
          || getChatJid('') !== state.chatJid || getExecutionIdentity()?.mode === 'family-shared'
          || state.authority.addonId !== addonId || !host || state.scopes.size >= 16 || allScopes.size >= 256) throw new ChildRequestError('unavailable');
        state.authority.authorise();
        if (!input || Object.keys(input).some(key => !['model','signal','deadlineAt','requireMcp'].includes(key))
          || !(input.signal instanceof AbortSignal) || input.requireMcp !== undefined && input.requireMcp !== false
          || !Number.isSafeInteger(input.deadlineAt) || input.deadlineAt <= Date.now() || input.deadlineAt > state.authority.deadlineAt
          || !input.model || Object.keys(input.model).some(key => !['provider','id'].includes(key))
          || typeof input.model.provider !== 'string' || !input.model.provider || input.model.provider.length > 256
          || typeof input.model.id !== 'string' || !input.model.id || input.model.id.length > 256) throw new ChildRequestError('unavailable');
        input.signal.throwIfAborted();
        const captured = { deadlineAt: input.deadlineAt, model: { provider: input.model.provider, id: input.model.id }, signal: AbortSignal.any([input.signal, state.authority.signal]) };
        // Publish the close obligation before synchronous host code can reenter
        // shutdown. Its deferred close runs after this synchronous creation ends.
        let owned: ChildRequestScopeV1 | undefined;
        const plan = Object.freeze({ version: 1 as const, execution: 'parent-provider-proxy' as const, mcp: 'none' as const,
          model: Object.freeze({ ...captured.model }) });
        let closing: Promise<void> | undefined;
        const guarded: ChildRequestScopeV1 = {
          plan,
          stream(context, options, request) { state.authority.authorise(); if (closing || !owned || installedHost !== host) throw new ChildRequestError('unavailable'); return owned.stream(context, options, request); },
          close() {
            if (!closing) closing = Promise.resolve().then(() => owned?.close()).then(() => { allScopes.delete(scope); });
            return closing;
          },
        };
        const scope = Object.freeze(guarded);
        state.scopes.add(scope); allScopes.add(scope);
        try {
          owned = host.createScope(captured, state.authority);
          state.authority.authorise(); captured.signal.throwIfAborted();
          if (closing || installedHost !== host || owned.plan.version !== 1 || owned.plan.execution !== 'parent-provider-proxy' || owned.plan.mcp !== 'none'
            || owned.plan.model.provider !== captured.model.provider || owned.plan.model.id !== captured.model.id) throw new ChildRequestError('unavailable');
        } catch {
          // Track even a failed returned scope until raw close has settled. The
          // invocation/shutdown still awaits this same promise and its failure.
          void scope.close().catch(() => undefined);
          throw new ChildRequestError('unavailable');
        }
        return scope;
      },
    });
  },
});

/** Wrap only public loaded tool definitions belonging to verified installed
 * add-on entry files. Re-run after resource reload to bind new definitions. */
export function bindAddonChildRequestTools(extensions: readonly Extension[], chatJid: string, owner: object = extensions): void {
  const generation = {};
  generations.set(owner, generation);
  const entries = new Map<string, string>();
  for (const packageDir of listInstalledAddonPackageDirs(resolve(getWorkspaceDir(), '.pi/extensions/node_modules'))) {
    const installed = readInstalledAddonPackage(packageDir);
    if (!installed || typeof installed.manifest.name !== 'string') continue;
    let addonId: string;
    try { addonId = deriveExternalAddonId(installed.manifest.name); } catch { continue; }
    for (const entry of resolveAddonPackageEntries(packageDir, installed.manifest.pi?.extensions)) entries.set(realpathSync(entry), addonId);
  }
  for (const extension of extensions) {
    const addonId = entries.get(extension.resolvedPath);
    if (!addonId) continue;
    for (const registered of extension.tools.values()) {
      const definition = registered.definition;
      const execute = originals.get(definition) ?? definition.execute;
      originals.set(definition, execute);
      definition.execute = async (toolCallId, params, signal, onUpdate, context) => {
        const current = getBudgetWorkContext();
        // Ordinary tool behavior is unchanged; without host-authorised work the
        // new API stays unavailable even though the tool can still execute.
        if (!installedHost || !current || current.chatJid !== chatJid || !signal) return invocations.run(null, () => execute.call(definition, toolCallId, params, signal, onUpdate, context));
        const database = getDb(), binding = getDatabaseBinding(), work = Object.freeze({ ...current });
        const lifetime = new AbortController();
        const invocationSignal = AbortSignal.any([signal, lifetime.signal]);
        const timer = setTimeout(() => lifetime.abort(), 300_000);
        const paths = JSON.stringify([getWorkspaceDir(), getStoreDir(), getDataDir(), getConfigPath()]);
        const identity = getExecutionIdentity();
        const state: InvocationState = { active: true, context: current, chatJid, scopes: new Set(), authority: {
          addonId, toolCallId, work, database, signal: invocationSignal, deadlineAt: Date.now() + 300_000,
          authorise() {
            // Pipe/event callbacks need this captured lease, never their ambient
            // chat/work identity. Only createScope admits through tool-local ALS.
            if (stopping || generations.get(owner) !== generation || !state.active || invocationSignal.aborted || Date.now() >= state.authority.deadlineAt || readAccessConfig().mode !== 'single-user'
              || identity?.mode === 'family-shared' || getDb() !== database
              || JSON.stringify(getDatabaseBinding()) !== JSON.stringify(binding)
              || JSON.stringify([getWorkspaceDir(), getStoreDir(), getDataDir(), getConfigPath()]) !== paths) throw new ChildRequestError('unavailable');
            if (binding) { const stat = statSync(binding.path); if (`${stat.dev}:${stat.ino}` !== binding.identity) throw new ChildRequestError('unavailable'); }
            const live = getBudgetWork(work.workId, database);
            if (!live || live.status !== 'active' || live.chat_jid !== work.chatJid || live.execution_kind !== work.kind) throw new ChildRequestError('unavailable');
          },
        } };
        Object.freeze(state.authority);
        return invocations.run(state, async () => {
          const outcome = await Promise.resolve().then(() => execute.call(definition, toolCallId, params, signal, onUpdate, context))
            .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
          state.active = false;
          lifetime.abort(); clearTimeout(timer);
          const results = await Promise.allSettled([...state.scopes].map(scope => scope.close()));
          if (results.some(result => result.status === 'rejected')) throw new ChildRequestError('settlement_failed');
          if (!outcome.ok) throw outcome.error;
          return outcome.value;
        });
      };
    }
  }
}

export function resetAddonChildRequestsForTests(discardFailedScopes = false): void {
  if (allScopes.size && !discardFailedScopes) throw new ChildRequestError('settlement_failed');
  if (discardFailedScopes) allScopes.clear();
  installedHost = null;
  stopping = false;
  runtimeGeneration++;
}
