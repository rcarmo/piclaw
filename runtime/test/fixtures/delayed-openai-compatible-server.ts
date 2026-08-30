export type DelayedOpenAIScenario = {
  headerDelayMs?: number;
  onRequestReceived?: () => void;
  firstTokenDelayMs?: number;
  betweenTokenDelayMs?: number;
  chunks?: string[];
  terminateEarly?: boolean;
  ignoreCancel?: boolean;
};

export type DelayedOpenAIServer = {
  baseUrl: string;
  requests: Array<{ path: string; body: unknown; startedAt: number }>;
  enqueue(scenario: DelayedOpenAIScenario): void;
  stop(): void;
};

const encoder = new TextEncoder();
const sleep = (ms = 0) => ms > 0 ? Bun.sleep(ms) : Promise.resolve();

function completionChunk(content: string, finishReason: string | null = null) {
  return {
    id: "chatcmpl-delayed-fixture",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "delayed-fixture",
    choices: [{ index: 0, delta: content ? { content } : {}, finish_reason: finishReason }],
  };
}

export function startDelayedOpenAICompatibleServer(): DelayedOpenAIServer {
  const scenarios: DelayedOpenAIScenario[] = [];
  const requests: DelayedOpenAIServer["requests"] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
      const scenario = scenarios.shift() ?? {};
      requests.push({ path: url.pathname, body: await request.clone().json(), startedAt: Date.now() });
      scenario.onRequestReceived?.();
      await sleep(scenario.headerDelayMs);
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            await sleep(scenario.firstTokenDelayMs);
            for (const chunk of scenario.chunks ?? ["summary complete"]) {
              if (cancelled && !scenario.ignoreCancel) return;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionChunk(chunk))}\n\n`));
              await sleep(scenario.betweenTokenDelayMs);
            }
            if (scenario.terminateEarly || (cancelled && !scenario.ignoreCancel)) {
              controller.close();
              return;
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionChunk("", "stop"))}\n\n`));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          } catch (error) {
            try { controller.error(error); } catch { /* client already closed */ }
          }
        },
        cancel() { cancelled = true; },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    enqueue: (scenario) => scenarios.push(scenario),
    stop: () => server.stop(true),
  };
}
