/**
 * channels/telegram.ts – Telegram channel adapter using grammY Api client.
 *
 * Uses long polling via Bot API getUpdates and stores inbound text/caption
 * messages in the shared DB pipeline.
 */

import { getIdentityConfig, getTelegramConfig } from "../core/config.js";
import type { OnChatMetadata, OnInboundMessage } from "../types.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { isRecoverableTelegramNetworkError } from "./telegram-network-errors.js";
import { resolveTelegramLongPollTimeoutSeconds } from "./telegram-request-timeouts.js";
import { buildTelegramChatJid, parseTelegramTarget } from "./telegram-targets.js";

const log = createLogger("telegram");

export interface TelegramChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  chatJids: () => Set<string>;
  botToken?: string;
  pollingTimeoutSeconds?: number;
}

type TelegramApiLike = {
  getMe(): Promise<{ id: number; username?: string }>;
  getUpdates(params: {
    offset?: number;
    timeout?: number;
    allowed_updates?: string[];
  }): Promise<Array<Record<string, unknown>>>;
  sendMessage(
    chatId: string | number,
    text: string,
    params?: { message_thread_id?: number }
  ): Promise<unknown>;
  sendChatAction(
    chatId: string | number,
    action: "typing",
    params?: { message_thread_id?: number }
  ): Promise<unknown>;
};

export class TelegramChannel {
  private api: TelegramApiLike | null = null;
  private connected = false;
  private pollingPromise: Promise<void> | null = null;
  private stopped = false;
  private reconnectAttempts = 0;
  private lastUpdateId = 0;
  private outgoingQueue: Array<{ jid: string; text: string }> = [];
  private flushing = false;
  private opts: TelegramChannelOpts;

  constructor(opts: TelegramChannelOpts) {
    const cfg = getTelegramConfig();
    this.opts = {
      ...opts,
      botToken: opts.botToken || cfg.botToken,
      pollingTimeoutSeconds: opts.pollingTimeoutSeconds ?? cfg.pollingTimeoutSeconds,
    };
  }

  async connect(): Promise<void> {
    if (!this.opts.botToken) throw new Error("Telegram bot token is not configured.");
    if (this.connected) return;

    const mod = await import("grammy");
    const api = new mod.Api(this.opts.botToken);
    this.api = api as unknown as TelegramApiLike;
    const me = await this.api.getMe();

    this.connected = true;
    this.stopped = false;
    this.reconnectAttempts = 0;
    log.info("Telegram channel connected", {
      operation: "telegram.connect",
      botId: me.id,
      username: me.username || null,
    });
    this.scheduleQueueFlush("telegram.connect.flush");
    this.pollingPromise = this.pollLoop();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    const pending = this.pollingPromise;
    this.pollingPromise = null;
    await pending?.catch((error) => {
      debugSuppressedError(log, "Ignoring Telegram poll-loop error during disconnect.", error);
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.connected || !this.api) {
      this.outgoingQueue.push({ jid, text });
      return;
    }
    try {
      const target = parseTelegramTarget(jid);
      const messageText = `${getIdentityConfig().assistantName}: ${text}`;
      await this.api.sendMessage(target.chatId, messageText, {
        ...(typeof target.messageThreadId === "number" ? { message_thread_id: target.messageThreadId } : {}),
      });
    } catch (error) {
      log.warn("Telegram send failed; re-queued outbound message", {
        operation: "telegram.send_message",
        jid,
        err: error,
      });
      this.outgoingQueue.push({ jid, text });
    }
  }

  async setTyping(jid: string, isTyping: boolean): Promise<void> {
    if (!isTyping || !this.api || !this.connected) return;
    const target = parseTelegramTarget(jid);
    try {
      await this.api.sendChatAction(target.chatId, "typing", {
        ...(typeof target.messageThreadId === "number" ? { message_thread_id: target.messageThreadId } : {}),
      });
    } catch (error) {
      debugSuppressedError(log, "Transient Telegram typing update failed; message delivery will continue.", error, {
        jid,
      });
    }
  }

  private async pollLoop(): Promise<void> {
    while (!this.stopped && this.connected && this.api) {
      try {
        const updates = await this.api.getUpdates({
          offset: this.lastUpdateId > 0 ? this.lastUpdateId + 1 : undefined,
          timeout: resolveTelegramLongPollTimeoutSeconds(this.opts.pollingTimeoutSeconds),
          allowed_updates: ["message", "edited_message"],
        });

        for (const update of updates) {
          const updateId = Number((update as { update_id?: unknown }).update_id);
          if (Number.isFinite(updateId)) this.lastUpdateId = Math.max(this.lastUpdateId, updateId);

          const message = ((update as { message?: unknown; edited_message?: unknown }).message ||
            (update as { message?: unknown; edited_message?: unknown }).edited_message) as
            | Record<string, unknown>
            | undefined;
          if (!message) continue;

          const chat = message.chat as { id?: unknown } | undefined;
          const chatIdRaw = chat?.id;
          if (chatIdRaw === undefined || chatIdRaw === null) continue;

          const messageId = Number(message.message_id);
          const date = Number(message.date);
          const messageThreadId = Number(message.message_thread_id);
          const text = typeof message.text === "string"
            ? message.text
            : typeof message.caption === "string"
              ? message.caption
              : "";
          const from = message.from as { id?: unknown; username?: unknown; first_name?: unknown } | undefined;
          const sender = from?.id != null ? String(from.id) : "";
          const senderName = typeof from?.username === "string" && from.username.trim()
            ? from.username
            : typeof from?.first_name === "string" && from.first_name.trim()
              ? from.first_name
              : sender;

          const chatJid = buildTelegramChatJid(
            String(chatIdRaw),
            Number.isFinite(messageThreadId) ? messageThreadId : undefined,
          );
          const timestamp = new Date((Number.isFinite(date) ? date : Math.floor(Date.now() / 1000)) * 1000).toISOString();

          this.opts.onChatMetadata(chatJid, timestamp);
          if (!text.trim()) continue;

          this.opts.onMessage(chatJid, {
            id: Number.isFinite(messageId) ? `telegram:${chatIdRaw}:${Math.trunc(messageId)}` : `telegram:${chatIdRaw}:${Date.now()}`,
            chat_jid: chatJid,
            sender,
            sender_name: senderName,
            content: text,
            timestamp,
            is_from_me: false,
            is_bot_message: false,
          });
        }
      } catch (error) {
        if (this.stopped || !this.connected) return;
        if (!isRecoverableTelegramNetworkError(error)) {
          log.error("Telegram polling failed", {
            operation: "telegram.polling",
            err: error,
          });
          throw error;
        }

        this.reconnectAttempts += 1;
        const delay = Math.min(30_000, 1_000 * Math.pow(2, Math.min(this.reconnectAttempts, 5)));
        log.warn("Telegram polling transient failure; retrying", {
          operation: "telegram.polling.retry",
          reconnectAttempts: this.reconnectAttempts,
          delayMs: delay,
          err: error,
        });
        await Bun.sleep(delay);
      }
    }
  }

  private scheduleQueueFlush(operation: string): void {
    queueMicrotask(() => {
      void this.flushOutgoingQueue().catch((err) => {
        log.error("Failed to flush queued Telegram outbound messages", {
          operation,
          err,
        });
      });
    });
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (this.flushing || this.outgoingQueue.length === 0) return;
    if (!this.connected || !this.api) return;
    this.flushing = true;
    try {
      while (this.outgoingQueue.length > 0 && this.connected && this.api) {
        const item = this.outgoingQueue.shift()!;
        await this.sendMessage(item.jid, item.text);
      }
    } finally {
      this.flushing = false;
      if (this.connected && this.outgoingQueue.length > 0) {
        this.scheduleQueueFlush("telegram.flush_outgoing_queue.retry_after_race");
      }
    }
  }
}
