import { isSingleUserAccess } from "../../../core/config-access.js";
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";
import { parseJsonObjectRequest } from "../json-body.js";

const log = createLogger("web");
const SIDE_PROMPT_STREAM_HEARTBEAT_MS = 30000;

type SidePromptResult = {
  status: "success" | "error";
  result: string | null;
  thinking: string | null;
  model: string | null;
  stopReason?: string;
  error?: string;
};

type SidePromptOptions = {
  systemPrompt?: string;
  signal?: AbortSignal;
  onThinkingDelta?: (delta: string) => void;
  onTextDelta?: (delta: string) => void;
};

export interface WebSidePromptServiceOptions {
  defaultChatJid: string;
  json(payload: unknown, status?: number): Response;
  agentPool: {
    runSidePrompt?: (chatJid: string, prompt: string, options?: SidePromptOptions) => Promise<SidePromptResult>;
  };
}

function failMissingDependency(name: string): never {
  throw Error(`Missing Web side-prompt dependency: ${name}`);
}

function formatSseEvent(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseSidePromptPayload(payload: { prompt?: string; system_prompt?: string; chat_jid?: string }, defaultChatJid: string): {
  prompt: string;
  systemPrompt: string;
  chatJid: string;
} {
  return {
    prompt: typeof payload.prompt === "string" ? payload.prompt.trim() : "",
    systemPrompt: typeof payload.system_prompt === "string" ? payload.system_prompt.trim() : "",
    chatJid: typeof payload.chat_jid === "string" && payload.chat_jid.trim() ? payload.chat_jid.trim() : defaultChatJid,
  };
}

export class WebSidePromptService {
  constructor(private readonly options: WebSidePromptServiceOptions) {}

  private denyUnscopedAction(): Response {
    return Response.json({ error: "Account-bound side prompts are not available yet." }, {
      status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }

  async handleAgentSidePrompt(req: Request): Promise<Response> {
    if (!isSingleUserAccess()) return this.denyUnscopedAction();
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { prompt?: string; system_prompt?: string; chat_jid?: string };
    const { prompt, systemPrompt, chatJid } = parseSidePromptPayload(payload, this.options.defaultChatJid);
    if (!prompt) {
      return this.options.json({ error: "Missing or invalid prompt" }, 400);
    }

    const result = await this.options.agentPool.runSidePrompt?.(chatJid, prompt, {
      ...(systemPrompt ? { systemPrompt } : {}),
    }) ?? failMissingDependency("agentPool.runSidePrompt");

    if (result.status === "error") {
      return this.options.json(result, 502);
    }

    return this.options.json(result, 200);
  }

  async handleAgentSidePromptStream(req: Request): Promise<Response> {
    if (!isSingleUserAccess()) return this.denyUnscopedAction();
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { prompt?: string; system_prompt?: string; chat_jid?: string };
    const { prompt, systemPrompt, chatJid } = parseSidePromptPayload(payload, this.options.defaultChatJid);
    if (!prompt) {
      return this.options.json({ error: "Missing or invalid prompt" }, 400);
    }

    const runSidePrompt = async (nextChatJid: string, nextPrompt: string, nextOptions?: SidePromptOptions) => {
      if (typeof this.options.agentPool.runSidePrompt !== "function") {
        return failMissingDependency("agentPool.runSidePrompt");
      }
      return await this.options.agentPool.runSidePrompt(nextChatJid, nextPrompt, nextOptions);
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let closed = false;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        const close = () => {
          if (closed) return;
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          try {
            controller.close();
          } catch (error) {
            debugSuppressedError(log, "Side-prompt stream controller was already closed during shutdown.", error, {
              chatJid,
            });
          }
        };
        const send = (eventType: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(formatSseEvent(eventType, data)));
          } catch (error) {
            debugSuppressedError(log, "Side-prompt stream enqueue raced a closed controller.", error, {
              chatJid,
              eventType,
            });
            close();
          }
        };
        const sendHeartbeat = () => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
            controller.enqueue(encoder.encode(formatSseEvent("heartbeat", { ts: Date.now(), chat_jid: chatJid })));
          } catch (error) {
            debugSuppressedError(log, "Side-prompt heartbeat enqueue raced a closed controller.", error, {
              chatJid,
            });
            close();
          }
        };

        req.signal.addEventListener("abort", close, { once: true });
        heartbeat = setInterval(sendHeartbeat, SIDE_PROMPT_STREAM_HEARTBEAT_MS);

        send("side_prompt_start", { chat_jid: chatJid });
        void runSidePrompt(chatJid, prompt, {
          ...(systemPrompt ? { systemPrompt } : {}),
          signal: req.signal,
          onThinkingDelta: (delta) => send("side_prompt_thinking_delta", { delta }),
          onTextDelta: (delta) => send("side_prompt_text_delta", { delta }),
        }).then((result) => {
          send(result.status === "success" ? "side_prompt_done" : "side_prompt_error", result);
          close();
        }).catch((error) => {
          send("side_prompt_error", {
            status: "error",
            result: null,
            thinking: null,
            error: error instanceof Error ? error.message : String(error),
            model: null,
          });
          close();
        });
      },
      cancel: () => {
        if (!req.signal.aborted) return;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
