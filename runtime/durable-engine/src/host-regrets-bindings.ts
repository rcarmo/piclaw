import type { SyncSqliteOperation } from "../../src/db/sqlite-async-admission.js";
import type { Database } from "bun:sqlite";
import type { Api, Model, AssistantMessage } from "../../src/durable-legacy-sdk.js";
import type { Context, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";

type DecisionPort = {
  getAvailable(): Model<Api>[];
  complete(model: Model<Api>, context: Context, options: ModelsSimpleStreamOptions): Promise<AssistantMessage>;
};
type Window = { start: string; end: string; chat_jid: string };
type Config = { enabled: boolean; cron_schedule: string; confidence_threshold: number; reflections_path: string; exports_dir: string; recent_hours_for_reflection: number; review_budget_tokens: number; decision_model: string; review_scope: "current" | "all" };
/** Root is application-owned and must already have the canonical extension_kv schema.
 * Admission is the application's accepted normal-input path, not sendUserMessage.
 * accountedDecision is deliberately explicit: the parent owns controller reservation,
 * dispatch and terminal settlement (host-request-accounting), including revoked calls.
 * Absence means no nested model requests, not an unaccounted fallback.
 */
export interface HostRegretsBindingOptions<E> {
  root: Database;
  historyDatabase: Database;
  cwd: string;
  chat: string;
  assertCurrent(): void;
  /** Awaited Root write admission; checks and SQL mutation roll back together. */
  transactionalWrite<T>(body: SyncSqliteOperation<T>): T | Promise<T>;
  accessMode(): string;
  allowAllChats(): boolean;
  readExchanges(db: Database, window: Window): { exchanges: E[]; excluded: Record<string, number> };
  readFile(path: string): Promise<string | undefined>;
  admitConversationInput(text: string): Promise<unknown>;
  accountedDecision?: DecisionPort;
}
export function createHostRegretsBindings<E>(options: HostRegretsBindingOptions<E>) {
  const check = () => { options.assertCurrent(); if (!options.chat) throw Error("Current chat required"); };
  const single = () => { check(); if (options.accessMode() !== "single-user") throw Error("Regrets requires single-user mode"); check(); };
  const decision = options.accountedDecision;
  return {
    chat: options.chat, cwd: options.cwd, assertCurrent: check, assertSingleUser: single,
    config: {
      get(): Partial<Config> {
        check();
        const row = options.root.query("SELECT value FROM extension_kv WHERE extension_id='late-night-regrets' AND scope='global' AND scope_key='' AND key='config'").get() as { value: string } | null;
        check(); return row ? JSON.parse(row.value) : {};
      },
      async set(value: Config) {
        value = structuredClone(value);
        await options.transactionalWrite(() => {
        check();
        options.root.query(`INSERT INTO extension_kv(extension_id,scope,scope_key,key,value) VALUES('late-night-regrets','global','','config',?)
          ON CONFLICT(extension_id,scope,scope_key,key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')`).run(JSON.stringify(value));
        check();
        });
      },
    },
    async history(window: Window) {
      single();
      if (window.chat_jid !== options.chat && (window.chat_jid !== "*" || !options.allowAllChats())) throw Error("Regrets history scope denied");
      check(); const result = options.readExchanges(options.historyDatabase, window); check(); return result;
    },
    async readFile(path: string) { check(); const result = await options.readFile(path); check(); return result; },
    async admitConversationInput(text: string) { check(); const result = await options.admitConversationInput(text); check(); return result; },
    accountedDecision: {
      getAvailable() { check(); const models = decision?.getAvailable() ?? []; check(); return models; },
      async complete(...args: Parameters<DecisionPort["complete"]>) {
        single(); if (!decision) throw Error("Accounted Regrets model callback required");
        const result = await decision.complete(...args); check(); return result;
      },
    },
  };
}
