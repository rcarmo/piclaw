import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearProviderUsageCache, getProviderUsage, peekProviderUsage, peekProviderUsageForRuntime, warmProviderUsage, readStoredProviderUsageAccountRef, resolveProviderUsageAccountRef } from "../../src/agent-pool/provider-usage.js";

const roots: string[] = [];
function createAuthStorage(credentials: Record<string, any>) {
  const root = mkdtempSync(join(tmpdir(), "piclaw-provider-usage-"));
  roots.push(root);
  const authPath = join(root, "auth.json");
  writeFileSync(authPath, JSON.stringify(credentials), { mode: 0o600 });
  return {
    authPath,
    getAuth: async (provider: string) => {
      const credential = credentials[provider];
      if (credential?.type === "oauth") return { auth: { apiKey: credential.access }, source: "OAuth" };
      if (credential?.type === "api_key" && credential.key) return { auth: { apiKey: credential.key }, source: "stored credential" };
      if (provider === "zai" && process.env.ZAI_API_KEY) return { auth: { apiKey: process.env.ZAI_API_KEY }, source: "ZAI_API_KEY" };
      return undefined;
    },
  } as any;
}

describe("provider usage", () => {
  let previousZaiApiKey: string | undefined;

  beforeEach(() => {
    clearProviderUsageCache();
    previousZaiApiKey = process.env.ZAI_API_KEY;
    delete process.env.ZAI_API_KEY;
  });

  afterEach(() => {
    if (previousZaiApiKey === undefined) delete process.env.ZAI_API_KEY;
    else process.env.ZAI_API_KEY = previousZaiApiKey;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("fetches Codex usage from ChatGPT usage API", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 38,
          reset_at: Math.floor(Date.now() / 1000) + 3600,
          limit_window_seconds: 18000,
        },
        secondary_window: {
          used_percent: 59,
          reset_at: Math.floor(Date.now() / 1000) + 86400,
          limit_window_seconds: 604800,
        },
      },
      credits: {
        balance: 123,
        unlimited: false,
      },
    })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(
        createAuthStorage({
          "openai-codex": {
            type: "oauth",
            access: "token",
            accountId: "acct_123",
            expires: Date.now() + 60_000,
          },
        }),
        "openai-codex"
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(usage?.provider).toBe("openai-codex");
      expect(usage?.plan).toBe("pro");
      expect(usage?.primary?.label).toBe("5h");
      expect(usage?.primary?.used_percent).toBe(38);
      expect(usage?.primary?.remaining_percent).toBe(62);
      expect(usage?.secondary?.label).toBe("week");
      expect(usage?.credits_remaining).toBe(123);
      expect(usage?.hint_short).toContain("5h 62%");
      expect(usage?.hint_short).toContain("wk 41%");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetches GitHub Copilot usage from internal usage API", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({
      copilot_plan: "individual",
      quota_reset_date: new Date(Date.now() + 86400_000).toISOString(),
      quota_snapshots: {
        premium_interactions: {
          entitlement: 100,
          remaining: 70,
          percent_remaining: 70,
          quota_id: "premium",
        },
        chat: {
          entitlement: 500,
          remaining: 400,
          percent_remaining: 80,
          quota_id: "chat",
        },
      },
    })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(
        createAuthStorage({
          "github-copilot": {
            type: "oauth",
            access: "copilot_access_token",
            refresh: "github_oauth_token",
            expires: Date.now() + 60_000,
          },
        }),
        "github-copilot"
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(usage?.provider).toBe("github-copilot");
      expect(usage?.plan).toBe("individual");
      expect(usage?.primary?.label).toBe("premium");
      expect(usage?.primary?.remaining_percent).toBe(70);
      expect(usage?.secondary?.label).toBe("chat");
      expect(usage?.secondary?.remaining_percent).toBe(80);
      expect(usage?.hint_short).toContain("premium 70%");
      // The chat counter stays in the snapshot but not in the short hint.
      expect(usage?.hint_short).toBe("premium 70%");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetches OpenRouter key spend and configured limit telemetry", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({
      data: {
        label: "piclaw",
        usage: 1.25,
        limit: 10,
        limit_remaining: 8.75,
        usage_daily: 0.25,
        usage_weekly: 0.75,
        usage_monthly: 1.25,
        is_free_tier: false,
        limit_reset: "2026-09-01T00:00:00Z",
        include_byok_in_limit: true,
        rate_limit: { requests: 100, interval: "10s" },
      },
    })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(
        createAuthStorage({ openrouter: { type: "api_key", key: "openrouter-secret" } }),
        "openrouter"
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock as any).mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/key");
      expect((fetchMock as any).mock.calls[0][1]).toMatchObject({
        headers: { Authorization: "Bearer openrouter-secret", Accept: "application/json", "User-Agent": "PiClaw" },
      });
      expect(usage).toMatchObject({
        provider: "openrouter",
        source: "openrouter-key-api",
        availability: "available",
        stale: false,
        plan: "paid",
        key_usage_usd: 1.25,
        key_limit_usd: 10,
        key_limit_remaining_usd: 8.75,
        key_limit_configured: true,
        key_limit_unlimited: false,
        key_usage_daily_usd: 0.25,
        key_usage_weekly_usd: 0.75,
        key_usage_monthly_usd: 1.25,
        is_free_tier: false,
        include_byok_in_limit: true,
      });
      expect(usage?.hint_short).toBe("$1.25 / $10.00 • $8.75 left");
      expect(JSON.stringify(usage)).not.toContain("openrouter-secret");
      expect(JSON.stringify(usage)).not.toContain("rate_limit");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("distinguishes an OpenRouter key without a configured spending limit", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({
      data: {
        usage: 0,
        limit: null,
        limit_remaining: null,
        is_free_tier: true,
        include_byok_in_limit: false,
      },
    })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(
        createAuthStorage({ openrouter: { type: "api_key", key: "token" } }),
        "openrouter"
      );

      expect(usage).toMatchObject({
        availability: "available",
        plan: "free",
        key_usage_usd: 0,
        key_limit_usd: null,
        key_limit_remaining_usd: null,
        key_limit_configured: false,
        key_limit_unlimited: true,
      });
      expect(usage?.hint_short).toBe("$0.0000 spent • no key limit");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("keeps missing OpenRouter limit fields unavailable instead of coercing them to zero", async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify({ data: { usage: 0.5 } })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(
        createAuthStorage({ openrouter: { type: "api_key", key: "token" } }),
        "openrouter"
      );
      expect(usage).toMatchObject({
        availability: "available",
        key_usage_usd: 0.5,
        key_limit_usd: null,
        key_limit_remaining_usd: null,
        key_limit_configured: null,
        key_limit_unlimited: false,
      });
      expect(usage?.hint_short).toBe("$0.50 spent");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("distinguishes OpenRouter authentication, malformed response, and temporary failures", async () => {
    const previousFetch = globalThis.fetch;
    try {
      const noAuthFetch = mock(async () => new Response("unexpected"));
      globalThis.fetch = noAuthFetch as any;
      const authRequired = await getProviderUsage(createAuthStorage({}), "openrouter");
      expect(authRequired?.availability).toBe("authentication_required");
      expect(noAuthFetch).not.toHaveBeenCalled();

      clearProviderUsageCache();
      globalThis.fetch = mock(async () => new Response("{}", { status: 401 })) as any;
      const authFailed = await getProviderUsage(
        createAuthStorage({ openrouter: { type: "api_key", key: "rejected" } }),
        "openrouter"
      );
      expect(authFailed?.availability).toBe("authentication_failed");

      clearProviderUsageCache();
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ data: { limit: 10 } }))) as any;
      const malformed = await getProviderUsage(
        createAuthStorage({ openrouter: { type: "api_key", key: "token" } }),
        "openrouter"
      );
      expect(malformed?.availability).toBe("malformed_response");

      clearProviderUsageCache();
      globalThis.fetch = mock(async () => new Response("busy", { status: 503 })) as any;
      const temporary = await getProviderUsage(
        createAuthStorage({ openrouter: { type: "api_key", key: "token" } }),
        "openrouter"
      );
      expect(temporary?.availability).toBe("temporary_failure");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("never reuses OpenRouter telemetry across credential changes", async () => {
    const credentials = { openrouter: { type: "api_key", key: "first-secret" } };
    const runtime = createAuthStorage(credentials);
    const previousFetch = globalThis.fetch;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      const usage = authorization === "Bearer first-secret" ? 1 : 2;
      return new Response(JSON.stringify({ data: { usage, limit: 10, limit_remaining: 10 - usage } }));
    });
    globalThis.fetch = fetchMock as any;

    try {
      const first = await getProviderUsage(runtime, "openrouter");
      expect(first?.key_usage_usd).toBe(1);

      credentials.openrouter.key = "second-secret";
      expect(await peekProviderUsageForRuntime(runtime, "openrouter", { allowStale: true })).toBeNull();
      const second = await getProviderUsage(runtime, "openrouter");
      expect(second?.key_usage_usd).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(second)).not.toContain("first-secret");
      expect(JSON.stringify(second)).not.toContain("second-secret");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("never reuses subscription telemetry across account changes", async () => {
    const firstRuntime = createAuthStorage({
      "openai-codex": { type: "oauth", access: "first-token", accountId: "acct_first", expires: Date.now() + 60_000 },
    });
    const secondRuntime = createAuthStorage({
      "openai-codex": { type: "oauth", access: "second-token", accountId: "acct_second", expires: Date.now() + 60_000 },
    });
    const previousFetch = globalThis.fetch;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      const usedPercent = authorization === "Bearer first-token" ? 10 : 20;
      return new Response(JSON.stringify({
        rate_limit: {
          primary_window: {
            used_percent: usedPercent,
            reset_at: Math.floor(Date.now() / 1000) + 3600,
            limit_window_seconds: 18000,
          },
        },
      }));
    });
    globalThis.fetch = fetchMock as any;

    try {
      expect((await getProviderUsage(firstRuntime, "openai-codex"))?.primary?.used_percent).toBe(10);
      expect(await peekProviderUsageForRuntime(secondRuntime, "openai-codex", { allowStale: true })).toBeNull();
      expect((await getProviderUsage(secondRuntime, "openai-codex"))?.primary?.used_percent).toBe(20);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("keeps stale OpenRouter key telemetry when refresh temporarily fails", async () => {
    const previousFetch = globalThis.fetch;
    const previousNow = Date.now;
    let now = 1_800_000_000_000;
    Date.now = () => now;
    const runtime = createAuthStorage({ openrouter: { type: "api_key", key: "token" } });
    try {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({
        data: { usage: 2, limit: 10, limit_remaining: 8 },
      }))) as any;
      const fresh = await getProviderUsage(runtime, "openrouter");
      expect(fresh?.stale).toBe(false);

      now += 61_000;
      globalThis.fetch = mock(async () => new Response("busy", { status: 503 })) as any;
      const stale = await getProviderUsage(runtime, "openrouter");
      expect(stale).toMatchObject({
        availability: "available",
        stale: true,
        refresh_failure: "temporary_failure",
        key_usage_usd: 2,
        key_limit_remaining_usd: 8,
      });
    } finally {
      Date.now = previousNow;
      globalThis.fetch = previousFetch;
    }
  });

  test("fetches Z.ai quota usage from monitor API", async () => {
    const tokensResetAtMs = Date.now() + 5 * 3600_000;
    const toolsResetAtMs = Date.now() + 9 * 86400_000;
    const fetchMock = mock(async () => new Response(JSON.stringify({
      code: 200,
      msg: "Operation successful",
      success: true,
      data: {
        level: "lite",
        limits: [
          {
            type: "TIME_LIMIT",
            unit: 5,
            number: 1,
            usage: 100,
            currentValue: 0,
            remaining: 100,
            percentage: 0,
            nextResetTime: toolsResetAtMs,
            usageDetails: [
              { modelCode: "search-prime", usage: 0 },
              { modelCode: "web-reader", usage: 0 },
              { modelCode: "zread", usage: 0 },
            ],
          },
          {
            type: "TOKENS_LIMIT",
            unit: 3,
            number: 5,
            percentage: 1,
            nextResetTime: tokensResetAtMs,
          },
        ],
      },
    })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(
        createAuthStorage({
          zai: {
            type: "api_key",
            key: "zai-token",
          },
        }),
        "zai"
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock as any).mock.calls[0][0]).toBe("https://api.z.ai/api/monitor/usage/quota/limit");
      expect((fetchMock as any).mock.calls[0][1]).toMatchObject({
        headers: {
          Authorization: "Bearer zai-token",
          Accept: "application/json",
          "User-Agent": "PiClaw",
        },
      });
      expect(usage?.provider).toBe("zai");
      expect(usage?.plan).toBe("lite");
      expect(usage?.primary?.label).toBe("5h");
      expect(usage?.primary?.used_percent).toBe(1);
      expect(usage?.primary?.remaining_percent).toBe(99);
      expect(usage?.primary?.window_minutes).toBe(300);
      expect(usage?.secondary?.label).toBe("tools");
      expect(usage?.secondary?.used_percent).toBe(0);
      expect(usage?.secondary?.remaining_percent).toBe(100);
      expect(usage?.secondary?.window_minutes).toBeNull();
      expect(usage?.hint_short).toContain("5h 99%");
      expect(usage?.hint_short).toContain("tools 100%");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("fetches Z.ai quota usage from ZAI_API_KEY when no login credential is saved", async () => {
    process.env.ZAI_API_KEY = "env-zai-token";
    const fetchMock = mock(async () => new Response(JSON.stringify({
      data: {
        level: "lite",
        limits: [
          { type: "TOKENS_LIMIT", percentage: 25, nextResetTime: Date.now() + 3600_000 },
        ],
      },
    })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(createAuthStorage({}), "zai");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock as any).mock.calls[0][1]).toMatchObject({
        headers: {
          Authorization: "Bearer env-zai-token",
        },
      });
      expect(usage?.provider).toBe("zai");
      expect(usage?.primary?.remaining_percent).toBe(75);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("formats long reset windows with a day tier", async () => {
    const originalDateNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    const secondaryResetAt = Math.floor((Date.now() + ((6 * 24 + 14) * 3600_000)) / 1000);
    const fetchMock = mock(async () => new Response(JSON.stringify({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 38,
          reset_at: Math.floor(Date.now() / 1000) + 3600,
          limit_window_seconds: 18000,
        },
        secondary_window: {
          used_percent: 59,
          reset_at: secondaryResetAt,
          limit_window_seconds: 604800,
        },
      },
      credits: {
        balance: 123,
        unlimited: false,
      },
    })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(
        createAuthStorage({
          "openai-codex": {
            type: "oauth",
            access: "token",
            accountId: "acct_123",
            expires: Date.now() + 60_000,
          },
        }),
        "openai-codex"
      );

      expect(usage?.secondary?.reset_description).toBe("resets in ~6d 14h");
    } finally {
      Date.now = originalDateNow;
      globalThis.fetch = previousFetch;
    }
  });

  test("formats exact long reset windows with zero hours", async () => {
    const originalDateNow = Date.now;
    Date.now = () => 1_700_000_000_000;
    const secondaryResetAt = Math.floor((Date.now() + (7 * 24 * 3600_000)) / 1000);
    const fetchMock = mock(async () => new Response(JSON.stringify({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 38,
          reset_at: Math.floor(Date.now() / 1000) + 3600,
          limit_window_seconds: 18000,
        },
        secondary_window: {
          used_percent: 59,
          reset_at: secondaryResetAt,
          limit_window_seconds: 604800,
        },
      },
      credits: {
        balance: 123,
        unlimited: false,
      },
    })));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const usage = await getProviderUsage(
        createAuthStorage({
          "openai-codex": {
            type: "oauth",
            access: "token",
            accountId: "acct_123",
            expires: Date.now() + 60_000,
          },
        }),
        "openai-codex"
      );

      expect(usage?.secondary?.reset_description).toBe("resets in ~7d 0h");
    } finally {
      Date.now = originalDateNow;
      globalThis.fetch = previousFetch;
    }
  });

  test("warms provider usage in the background and reuses the same in-flight refresh", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = mock(async () => {
      await gate;
      return new Response(JSON.stringify({
        plan_type: "pro",
        rate_limit: {
          primary_window: {
            used_percent: 10,
            reset_at: Math.floor(Date.now() / 1000) + 3600,
            limit_window_seconds: 18000,
          },
        },
        credits: {
          balance: 50,
          unlimited: false,
        },
      }));
    });
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as any;

    try {
      const first = warmProviderUsage(
        createAuthStorage({
          "openai-codex": {
            type: "oauth",
            access: "token",
            accountId: "acct_123",
            expires: Date.now() + 60_000,
          },
        }),
        "openai-codex"
      );
      const second = warmProviderUsage(
        createAuthStorage({
          "openai-codex": {
            type: "oauth",
            access: "token",
            accountId: "acct_123",
            expires: Date.now() + 60_000,
          },
        }),
        "openai-codex"
      );

      expect(peekProviderUsage("openai-codex", { allowStale: true })).toBeNull();
      await Bun.sleep(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      release();
      const usage = await first;
      expect(await second).toEqual(usage);
      expect(peekProviderUsage("openai-codex", { allowStale: true })?.provider).toBe("openai-codex");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("returns null for unsupported providers", async () => {
    const usage = await getProviderUsage(createAuthStorage({}), "openai");
    expect(usage).toBeNull();
  });
});

test('Codex labels follow reported duration independently of window position', async () => {
 const storage=createAuthStorage({'openai-codex':{type:'oauth',access:'synthetic',accountId:'fixture'}});
 const original=globalThis.fetch;
 try{
  for(const [seconds,label,hint] of [[604800,'week','wk'],[18000,'5h','5h'],[86400,'1d','1d'],[5400,'90m','90m'],[undefined,'window','window'],[0,'window','window'],[-1,'window','window'],['604800','window','window']] as const){
   clearProviderUsageCache();globalThis.fetch=async()=>Response.json({rate_limit:{primary_window:{used_percent:33,limit_window_seconds:seconds,reset_at:2000000000}},credits:{balance:12}});
   const usage=await getProviderUsage(storage,'openai-codex');
   expect(usage?.primary?.label).toBe(label);expect(usage?.hint_short).toBe(`${hint} 67% • credits 12`);expect(usage?.secondary).toBeNull();expect(usage?.primary?.resets_at).toBeTruthy();
   if(label==='window')expect(usage?.primary?.window_minutes).toBeNull();
  }
 }finally{globalThis.fetch=original;clearProviderUsageCache();}
});

for (const provider of ['openai-codex', 'github-copilot'] as const) test(`stored account fingerprint for ${provider} needs no auth resolution`, async () => {
  const storage = createAuthStorage({ [provider]: { type: 'oauth', access: 'synthetic-access-secret', refresh: 'synthetic-refresh-secret', accountId: 'synthetic-account', expires: Date.now() + 60000 } });
  let authCalls = 0;
  const runtime = { async getAuth() { authCalls++; throw Error('Auth forbidden'); } };
  const stored = readStoredProviderUsageAccountRef(provider, storage.authPath);
  expect(stored).toMatch(new RegExp(`^${provider}:sha256:[a-f0-9]{64}$`));
  expect(stored).not.toContain('synthetic');
  expect(await resolveProviderUsageAccountRef(runtime, provider, storage.authPath)).toBe(stored);
  expect(authCalls).toBe(0);
});

test('stored fingerprint denies unsupported or absent identity without auth fallback', () => {
  const storage = createAuthStorage({ zai: { type: 'api_key', key: 'synthetic-key' }, 'openai-codex': { type: 'oauth', access: 'synthetic-access', refresh: 'synthetic-refresh', expires: Date.now() + 60000 } });
  expect(readStoredProviderUsageAccountRef('zai', storage.authPath)).toBeNull();
  expect(readStoredProviderUsageAccountRef('openai-codex', storage.authPath)).toBeNull();
  expect(readStoredProviderUsageAccountRef('github-copilot', storage.authPath)).toBeNull();
  expect(readStoredProviderUsageAccountRef('openai-codex', join(storage.authPath, 'absent'))).toBeNull();
});

for (const provider of ['openai-codex', 'github-copilot'] as const) test(`empty stored ${provider} identity cannot fall back to asynchronous auth`, async () => {
  const storage = createAuthStorage({ [provider]: { type: 'oauth', access: 'synthetic-access', refresh: '', accountId: '', expires: Date.now() + 60000 } });
  let calls = 0;
  const runtime = { async getAuth() { calls++; return { auth: { apiKey: 'synthetic-fallback' } }; } };
  expect(readStoredProviderUsageAccountRef(provider, storage.authPath)).toBeNull();
  expect(await resolveProviderUsageAccountRef(runtime, provider, storage.authPath)).toBeNull();
  expect(calls).toBe(0);
});

test('absent stored identity retains existing asynchronous auth fallback', async () => {
  const storage = createAuthStorage({});
  let calls = 0;
  const runtime = { async getAuth() { calls++; return { auth: { apiKey: 'synthetic-fallback' } }; } };
  expect(await resolveProviderUsageAccountRef(runtime, 'openai-codex', storage.authPath + '/not-a-file')).toMatch(/^openai-codex:sha256:/);
  expect(calls).toBe(1);
});
