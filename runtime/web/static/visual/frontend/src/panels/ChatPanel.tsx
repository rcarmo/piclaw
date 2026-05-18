import { AgentStatusPanel } from "../components/AgentStatusPanel";
import { QueueStack, type QueueItem } from "../components/QueueStack";
import { getMessageUrl } from "../api/chat-jid";
import { useRef, useEffect, useState } from "preact/hooks";
import { useSignal, signal } from "@preact/signals";
import { MessageList } from "../components/MessageList";
import { safeGetItem, safeSetItem } from "../utils/storage";

import { createLogger } from "../utils/logger";
const log = createLogger("ChatPanel");

// Module-level signal: persists draft text across ChatPanel mounts/unmounts
const draftText = signal("");



interface ChatPanelProps {
  onOpenPalette?: () => void;
}

interface Attachment {
  id?: number;
  name: string;
  type: string;
  size: number;
  file?: File;
  /** Workspace file reference (path-based, not uploaded) */
  isFileRef?: boolean;
  /** Workspace-relative path for file references */
  path?: string;
}

const HISTORY_KEY = "piclaw:compose-history";
const MAX_HISTORY = 50;

export function ChatPanel({ onOpenPalette }: ChatPanelProps = {}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus chat input on mount; restore any persisted draft
  useEffect(() => {
    const t = setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.value = draftText.value;
        hasText.value = draftText.value.trim().length > 0;
        textareaRef.current.focus();
      }
    }, 100);
    return () => clearTimeout(t);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSending = useSignal(false);
  const sendError = useSignal<string | null>(null);
  const isAgentRunning = useSignal(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  attachmentsRef.current = attachments;
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return safeGetItem("piclaw:notifications") === "on";
  });

  // Command history (ArrowUp/Down)
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef("");

  useEffect(() => {
    const raw = safeGetItem(HISTORY_KEY);
    if (raw) {
      try { historyRef.current = JSON.parse(raw); } catch {}
    }
  }, []);


  useEffect(() => {
    const agentStatusHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.type === "done" || detail?.type === "idle") {
        isAgentRunning.value = false;
      } else if (detail?.type === "thinking" || detail?.type === "running" || detail?.type === "tool_call" || detail?.type === "tool_status") {
        isAgentRunning.value = true;
      }
    };
    window.addEventListener("piclaw:agent-status", agentStatusHandler);


  // Handle widget submissions as user messages
  const widgetSubmissionHandler = (e: Event) => {
    const text = (e as CustomEvent).detail?.text;
    if (text) {
      fetch(getMessageUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ content: text }),
      }).catch((e) => log.error("unhandled", e));
    }
  };
  window.addEventListener("piclaw:widget-submission", widgetSubmissionHandler);
  return () => {
    window.removeEventListener("piclaw:agent-status", agentStatusHandler);
    window.removeEventListener("piclaw:widget-submission", widgetSubmissionHandler);
  };
  }, []);

  const hasText = useSignal(false);

  const handleInput = (e: Event) => {
    const el = e.target as HTMLTextAreaElement;
    draftText.value = el.value;
    hasText.value = el.value.trim().length > 0;
    if (el.value === "/") {
      onOpenPalette?.();
      el.value = "";
      el.style.height = "auto";
      return;
    }
    // No auto-resize — fixed height with internal scroll
  };

  const abortAgent = async () => {
    try {
      await fetch(getMessageUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ content: "/abort" }),
      });
      // Clear stale tool/thought/draft panels immediately
      window.dispatchEvent(new CustomEvent("piclaw:agent-turn-end"));
      window.dispatchEvent(
        new CustomEvent("piclaw:agent-status", { detail: { type: "done" } })
      );
    } catch {
      window.dispatchEvent(new CustomEvent("piclaw:agent-turn-end"));
      window.dispatchEvent(new CustomEvent("piclaw:agent-status", { detail: { type: "done" } }));
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Failed to abort", type: "error" } }));
    }
  };

  // Global Escape key to abort agent
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isAgentRunning.value) {
        abortAgent();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Listen for workspace file attach events from FileTree
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.path || !detail?.name) return;
      // Avoid duplicates
      setAttachments((prev) => {
        if (prev.some((a) => a.isFileRef && a.path === detail.path)) return prev;
        return [...prev, {
          name: detail.name,
          type: "workspace/file",
          size: detail.size || 0,
          isFileRef: true,
          path: detail.path,
        }];
      });
    };
    window.addEventListener("piclaw:file-attach", handler);
    return () => window.removeEventListener("piclaw:file-attach", handler);
  }, []);

  // Attachment handlers
  const handleClipClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setAttachments((prev) => [...prev, {
        name: file.name,
        type: file.type,
        size: file.size,
        file,
      }]);
    }
    input.value = "";
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items?.length) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile?.();
      if (file) files.push(file);
    }
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        setAttachments((prev) => [...prev, {
          name: file.name || `pasted-${Date.now()}.${file.type.split("/")[1] || "png"}`,
          type: file.type,
          size: file.size,
          file,
        }]);
      }
    }
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types?.includes("Files")) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      setAttachments((prev) => [...prev, {
        name: file.name,
        type: file.type,
        size: file.size,
        file,
      }]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Return queued item to compose for editing
  const handleQueueEdit = (item: QueueItem) => {
    const el = textareaRef.current;
    if (!el) return;
    el.value = item.content;
    hasText.value = item.content.trim().length > 0;
    el.focus();
  };

  // Speech-to-text
  const hasSpeechSupport = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";

    // Track the text before STT started so we can append cleanly
    const baseText = textareaRef.current?.value || "";

    recognition.onresult = (event: any) => {
      const el = textareaRef.current;
      if (!el) return;
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }
      // Show interim results live in textarea
      if (final) {
        const current = el.value;
        el.value = current.replace(/\u200B.*$/, "") + (current && !current.endsWith(" ") ? " " : "") + final;
        hasText.value = el.value.trim().length > 0;
      } else if (interim) {
        // Show interim with zero-width space marker (replaced on next update)
        const current = el.value.replace(/\u200B.*$/, "");
        el.value = current + (current && !current.endsWith(" ") ? " " : "") + "\u200B" + interim;
        hasText.value = el.value.trim().length > 0;
      }
    };
    recognition.onerror = (event: any) => {
      setIsListening(false);
      recognitionRef.current = null;
      const msg = event.error === "not-allowed"
        ? "Microphone permission denied"
        : event.error === "no-speech"
        ? "No speech detected"
        : `Speech error: ${event.error}`;
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: msg, type: "error" } }));
    };
    recognition.onend = () => {
      // Clean up interim markers
      const el = textareaRef.current;
      if (el) el.value = el.value.replace(/\u200B.*$/, "");
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  };

  // Browser notifications
  const toggleNotifications = async () => {
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      safeSetItem("piclaw:notifications", "off");
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Notifications disabled", type: "success" } }));
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotificationsEnabled(true);
      safeSetItem("piclaw:notifications", "on");
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Notifications enabled", type: "success" } }));
    } else {
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Notification permission denied", type: "error" } }));
    }
  };

  // Fire notification on new agent message when tab is not focused
  useEffect(() => {
    if (!notificationsEnabled) return;
    const handler = (e: Event) => {
      if (document.hasFocus()) return;
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const body = typeof detail.content === "string" ? detail.content.slice(0, 100) : "New message";
      try { new Notification("PiClaw", { body, icon: "/static/img/favicon.png" }); } catch {}
    };
    window.addEventListener("piclaw:new-message", handler);
    return () => window.removeEventListener("piclaw:new-message", handler);
  }, [notificationsEnabled]);

  const sendMessage = async () => {
    const el = textareaRef.current;
    if (!el || isSending.value) return;
    const content = el.value.trim();
    if (!content && attachmentsRef.current.length === 0) return;

    // Auto-queue when agent is busy (backend handles steer/queue logic)
    const mode = isAgentRunning.value ? "queue" : undefined;

    isSending.value = true;
    sendError.value = null;

    // Upload pending attachments (skip file refs — those are path-based)
    const mediaIds: number[] = [];
    for (const att of attachmentsRef.current) {
      if (att.isFileRef) continue;
      if (att.id) {
        mediaIds.push(att.id);
      } else if (att.file) {
        try {
          const form = new FormData();
          form.append("file", att.file);
          const res = await fetch("/media/upload", {
            method: "POST",
            credentials: "same-origin",
            body: form,
          });
          if (res.ok) {
            const data = await res.json();
            if (data.id) mediaIds.push(data.id);
          }
        } catch {
          // skip failed uploads
        }
      }
    }

    // Append attachment references to content (like upstream)
    let messageContent = content;
    if (mediaIds.length > 0) {
      const mediaBlock = mediaIds.map((id, i) => {
        const att = attachmentsRef.current[i];
        const label = att?.name || `attachment-${i + 1}`;
        return `- attachment:${id} (${label})`;
      }).join("\n");
      messageContent = [content, `Attachments:\n${mediaBlock}`].filter(Boolean).join("\n\n");
    }

    // Append workspace file references
    const fileRefs = attachmentsRef.current.filter((a) => a.isFileRef && a.path);
    if (fileRefs.length > 0) {
      const filesBlock = fileRefs.map((a) => `- ${a.path}`).join("\n");
      messageContent = [messageContent, `Files:\n${filesBlock}`].filter(Boolean).join("\n\n");
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(getMessageUrl(), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: messageContent,
          media_ids: mediaIds.length > 0 ? mediaIds : undefined,
          ...(mode ? { mode } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        sendError.value = `Send failed (HTTP ${res.status}). Try again.`;
        isSending.value = false;
        return;
      }


      // Only clear draft after confirmed success
      draftText.value = "";
      if (content) {
        const history = historyRef.current;
        if (history[history.length - 1] !== content) {
          history.push(content);
          if (history.length > MAX_HISTORY) history.shift();
          safeSetItem(HISTORY_KEY, JSON.stringify(history));
        }
        historyIndexRef.current = -1;
      }
      el.value = "";
      el.style.height = "auto";
      sendError.value = null;
      setAttachments([]);
      const data = await res.json();
      if (data?.user_message) {
        window.dispatchEvent(new CustomEvent("piclaw:new-message", { detail: data.user_message }));
      }
    } catch (err: any) {
      sendError.value = err?.name === "AbortError"
        ? "Send timed out. Try again."
        : "Failed to send. Check connection.";
    } finally {
      isSending.value = false;
    }
  };

  return (
    <section className="chat">
      {/* Chat content */}
      <div className="chat__messages">
            <MessageList />
          </div>

          <AgentStatusPanel />

          <QueueStack onEdit={handleQueueEdit} />

          <div className="chat__compose">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />
            <div
              className={`chat__compose-container${isDragOver ? " chat__compose-container--dragover" : ""}`}
              onDragEnter={handleDragEnter as any}
              onDragLeave={handleDragLeave as any}
              onDragOver={handleDragOver as any}
              onDrop={handleDrop as any}
            >
              <div className="chat__toolbar">
                <button
                  type="button"
                  className="chat__toolbar-btn"
                  onClick={handleClipClick}
                  aria-label="Attach file"
                  title="Attach file"
                >
                  <i className="codicon codicon-attach" />
                </button>
                {hasSpeechSupport && (
                  <button
                    type="button"
                    className={`chat__toolbar-btn${isListening ? " chat__toolbar-btn--active" : ""}`}
                    onClick={toggleListening}
                    aria-label={isListening ? "Stop listening" : "Speech to text"}
                    title={isListening ? "Stop listening" : "Speech to text"}
                  >
                    <i className={`codicon codicon-${isListening ? "debug-stop" : "mic"}`} />
                  </button>
                )}
                {"Notification" in window && (
                  <button
                    type="button"
                    className={`chat__toolbar-btn${notificationsEnabled ? " chat__toolbar-btn--notif-on" : ""}`}
                    onClick={toggleNotifications}
                    aria-label={notificationsEnabled ? "Disable notifications" : "Enable notifications"}
                    title={notificationsEnabled ? "Notifications on" : "Notifications off"}
                  >
                    <i className={`codicon codicon-${notificationsEnabled ? "bell" : "bell-slash"}`} />
                  </button>
                )}
              </div>
              {attachments.length > 0 && (
                <div className="chat__attachments">
                  {attachments.map((att, i) => (
                    <span key={att.path ?? att.id ?? i} className={`chat__attachment-pill${att.isFileRef ? " chat__attachment-pill--fileref" : ""}`}>
                      {att.isFileRef && <i className="codicon codicon-file" style="margin-right:4px;font-size:12px" />}
                      <span className="chat__attachment-name" title={att.path || att.name}>{att.name}</span>
                      <button
                        type="button"
                        className="chat__attachment-remove"
                        onClick={() => removeAttachment(i)}
                        aria-label={`Remove ${att.name}`}
                      >✕</button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="chat__attachment-clear"
                    onClick={() => setAttachments([])}
                    aria-label="Clear all attachments"
                  >Clear all</button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                className="chat__input"
                placeholder={isAgentRunning.value ? "Type to queue (sent after current turn)" : "Type a message..."}
                rows={3}
                autoFocus
                onInput={handleInput}
                onPaste={handlePaste as any}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                  if (e.key === "Escape" && isAgentRunning.value) {
                    abortAgent();
                  }
                  // Command history navigation
                  const el = e.target as HTMLTextAreaElement;
                  const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
                  const atEnd = el.selectionStart === el.value.length;
                  if (e.key === "ArrowUp" && atStart) {
                    const history = historyRef.current;
                    if (!history.length) return;
                    e.preventDefault();
                    let idx = historyIndexRef.current;
                    if (idx === -1) {
                      historyDraftRef.current = el.value;
                      idx = history.length - 1;
                    } else if (idx > 0) {
                      idx--;
                    }
                    historyIndexRef.current = idx;
                    el.value = history[idx] || "";
                    hasText.value = el.value.trim().length > 0;
                  }
                  if (e.key === "ArrowDown" && atEnd) {
                    const history = historyRef.current;
                    if (historyIndexRef.current === -1) return;
                    e.preventDefault();
                    let idx = historyIndexRef.current;
                    if (idx < history.length - 1) {
                      idx++;
                      historyIndexRef.current = idx;
                      el.value = history[idx] || "";
                    } else {
                      historyIndexRef.current = -1;
                      el.value = historyDraftRef.current || "";
                      historyDraftRef.current = "";
                    }
                    hasText.value = el.value.trim().length > 0;
                  }
                }}
              />
            </div>
            {isAgentRunning.value ? (
              <div className="chat__action-group">
                <button
                  type="button"
                  className="chat__send-btn chat__send-btn--queue"
                  onClick={() => sendMessage()}
                  disabled={isSending.value || (!hasText.value && attachments.length === 0)}
                  aria-label="Queue message"
                  title="Queue (sent after current turn)"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                  </svg>
                </button>
                <button
                  type="button"
                  className="chat__stop-btn"
                  onClick={abortAgent}
                  aria-label="Stop response"
                  title="Stop response (Escape)"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="chat__send-btn"
                onClick={sendMessage}
                disabled={isSending.value || (!hasText.value && attachments.length === 0)}
                aria-label={isSending.value ? "Sending..." : "Send message"}
                title="Send (Enter)"
              >
                <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                </svg>
              </button>
            )}
          </div>
      {sendError.value && (
        <div className="chat__send-error">
          {sendError.value}
          <button type="button" className="chat__send-error-dismiss" onClick={() => (sendError.value = null)}>✕</button>
        </div>
      )}
    </section>
  );
}
