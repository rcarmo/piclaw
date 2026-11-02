/** Native workspace-file requests over the existing browser SSE/ACK protocol. */
import { createLogger, debugSuppressedError } from "../../../utils/logger.js";

const log = createLogger("web.ui-bridge");

export interface UiBridgeChannel {
  broadcastEvent(eventType: string, data: unknown): void;
}

interface PendingUiRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  kind: string;
  chatJid: string;
}

/** Own only pending browser requests; completed chats retain no adapter state. */
export class UiBridge {
  pendingUiRequests = new Map<string, PendingUiRequest>();
  uiRequestCounter = 0;

  constructor(private channel: UiBridgeChannel) {}

  async openWorkspaceFile(chatJid: string, path: string, label: string): Promise<unknown> {
    const requestId = `ui-${Date.now()}-${++this.uiRequestCounter}`;
    const kind = "custom";
    const result = await new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingUiRequests.delete(requestId);
        this.channel.broadcastEvent("extension_ui_timeout", { request_id: requestId, kind, chat_jid: chatJid });
        resolve(undefined);
      }, 15000);
      this.pendingUiRequests.set(requestId, { resolve, reject, timeoutId, kind, chatJid });
      this.channel.broadcastEvent("extension_ui_request", {
        request_id: requestId,
        kind,
        chat_jid: chatJid,
        title: "Custom UI",
        options: { timeout: 15000, action: "open_workspace_file", path, label, target: "tab" },
      });
    });
    if (result && typeof result === "object") {
      const outcome = result as { ok?: unknown; opened?: unknown };
      if ((outcome.ok === true || outcome.opened === true) && outcome.ok !== false && outcome.opened !== false) return result;
      if (outcome.ok === false || outcome.opened === false) return result;
    }
    return {
      ok: false, opened: false,
      reason: result === undefined ? "ui_timeout" : "ui_not_opened",
      detail: "The browser did not confirm opening the workspace file.",
    };
  }

  handleUiResponse(requestId: string, outcome: unknown, chatJid?: string | null): { status: "ok" | "unknown_request" } {
    const pending = this.pendingUiRequests.get(requestId);
    if (!pending) return { status: "unknown_request" };
    const normalizedChatJid = typeof chatJid === "string" && chatJid.trim() ? chatJid.trim() : null;
    if (normalizedChatJid && pending.chatJid !== normalizedChatJid) return { status: "unknown_request" };
    clearTimeout(pending.timeoutId);
    this.pendingUiRequests.delete(requestId);
    pending.resolve(outcome);
    return { status: "ok" };
  }

  stop(): void {
    for (const pending of this.pendingUiRequests.values()) {
      clearTimeout(pending.timeoutId);
      try {
        pending.reject(new Error("Web channel stopped"));
      } catch (error) {
        debugSuppressedError(log, "Failed to reject a pending web UI request during shutdown.", error, {
          chatJid: pending.chatJid,
          kind: pending.kind,
        });
      }
    }
    this.pendingUiRequests.clear();
  }
}
