/**
 * AgentRequestModal — Security-relevant approval modal for pending agent requests.
 *
 * ## Escape-to-Deny semantics
 * Pressing Escape triggers Deny (safe default). Background click is also blocked.
 *
 * ## Always Allow
 * "Always Allow" adds the tool to a server-side whitelist, then approves.
 */

import { useEffect, useRef } from "preact/hooks";
import { getChatJid } from "../api/chat-jid";
import { OverlayShell } from "./OverlayShell";

// Shield SVG — matches upstream status.ts:900–904
const SHIELD_SVG = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export interface AgentRequest {
  request_id: string;
  chat_jid?: string | null;
  tool_call?: {
    title?: string; kind?: string; description?: string;
    rawInput?: { command?: string; commands?: string[]; diff?: string; fileName?: string; path?: string; description?: string; explanation?: string; };
    locations?: Array<{ path?: string }>;
  };
  options?: Array<{ optionId?: string; id?: string; name?: string; label?: string; kind?: string; }>;
  title?: string; kind?: string;
}

interface AgentRequestModalProps { request: AgentRequest; onClose: () => void; }

async function callRespondToAgentRequest(requestId: string, outcome: string, chatJid: string | null): Promise<void> {
  const body: Record<string, unknown> = { request_id: requestId, outcome };
  if (chatJid) body.chat_jid = chatJid;
  const res = await fetch("/agent/respond", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  if (!res.ok) { const err = await res.json().catch(() => ({ error: "Request failed" })); throw new Error((err as { error?: string }).error || `HTTP ${res.status}`); }
}

async function callAddToWhitelist(pattern: string, description: string): Promise<void> {
  const res = await fetch("/agent/whitelist", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ pattern, description }) });
  if (!res.ok) { const err = await res.json().catch(() => ({ error: "Whitelist update failed" })); throw new Error((err as { error?: string }).error || `HTTP ${res.status}`); }
}

export function AgentRequestModal({ request, onClose }: AgentRequestModalProps) {
  const { request_id, chat_jid, tool_call, options, title: rawTitle } = request;
  const chatJid = chat_jid || getChatJid();

  const title = tool_call?.title || rawTitle || "Agent Request";
  const rawInput = tool_call?.rawInput || {};
  const command = rawInput.command || (rawInput.commands?.[0]) || null;
  const diff = rawInput.diff || null;
  const fileName = rawInput.fileName || rawInput.path || null;
  const explanation = tool_call?.description || rawInput.description || rawInput.explanation || null;
  const locations = Array.isArray(tool_call?.locations) ? tool_call!.locations : [];
  const locationPaths = locations.map(loc => loc?.path).filter(Boolean) as string[];
  const uniquePaths = Array.from(new Set([fileName, ...locationPaths].filter(Boolean))) as string[];
  const hasOptions = options && options.length > 0;

  const firstBtnRef = useRef<HTMLButtonElement>(null);

  // Focus first button on mount
  useEffect(() => { firstBtnRef.current?.focus(); }, []);

  const handleDeny = async () => {
    try { await callRespondToAgentRequest(request_id, "denied", chatJid); } catch (e) { console.error("[AgentRequestModal] Deny failed:", e); }
    onClose();
  };
  const handleAllow = async () => {
    try { await callRespondToAgentRequest(request_id, "approved", chatJid); } catch (e) { console.error("[AgentRequestModal] Allow failed:", e); }
    onClose();
  };
  const handleAlwaysAllow = async () => {
    try { await callAddToWhitelist(title, `Auto-approved: ${title}`); await callRespondToAgentRequest(request_id, "approved", chatJid); } catch (e) { console.error("[AgentRequestModal] Always Allow failed:", e); }
    onClose();
  };
  const handleOptionResponse = async (outcome: string) => {
    try { await callRespondToAgentRequest(request_id, outcome, chatJid); } catch (e) { console.error("[AgentRequestModal] Option response failed:", e); }
    onClose();
  };

  return (
    <OverlayShell open onClose={() => void handleDeny()} escape="deny" backdrop="ignore" tier="modal" className="modal-dialog__backdrop" ariaLabel="Agent approval request">
      <div className="modal-dialog" onMouseDown={e => e.stopPropagation()}>
        <h2 className="modal-dialog__title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ flexShrink: 0, color: 'var(--warning, #f9e2af)' }}>{SHIELD_SVG}</span>
          {title}
        </h2>
        {(explanation || command || diff || uniquePaths.length > 0) && (
          <div className="modal-dialog__description" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {explanation && <div>{explanation}</div>}
            {uniquePaths.length > 0 && (
              <div>
                <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: '3px' }}>Files</div>
                <ul style={{ margin: 0, paddingLeft: '1.5em', listStyle: 'disc' }}>
                  {uniquePaths.map((p, i) => <li key={i} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '12px', color: 'var(--accent)' }}>{p}</li>)}
                </ul>
              </div>
            )}
            {command && <pre style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '12px', background: 'var(--overlay-black-35, rgba(0,0,0,0.15))', border: '1px solid var(--border)', borderRadius: '6px', padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text)', margin: 0 }}>{command}</pre>}
            {diff && (
              <details>
                <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--accent)' }}>Proposed diff</summary>
                <pre style={{ fontSize: '11px', maxHeight: '160px', overflow: 'auto', background: 'var(--overlay-black-35, rgba(0,0,0,0.15))', borderRadius: '6px', padding: '6px', marginTop: '4px' }}>{diff}</pre>
              </details>
            )}
          </div>
        )}
        <div className="modal-dialog__actions">
          {hasOptions ? (
            options!.map((opt, i) => (
              <button key={opt.optionId || opt.id || String(i)} ref={i === 0 ? firstBtnRef : undefined} type="button"
                className={`modal-dialog__btn${opt.kind === "allow_once" || opt.kind === "allow_always" ? " modal-dialog__btn--primary" : ""}`}
                onClick={() => void handleOptionResponse(opt.optionId || opt.id || String(opt))}>
                {opt.name || opt.label || opt.optionId || opt.id || String(opt)}
              </button>
            ))
          ) : (
            <>
              <button type="button" className="modal-dialog__btn" style={{ color: 'var(--text-muted)' }} onClick={() => void handleAlwaysAllow()}>Always Allow</button>
              <button type="button" className="modal-dialog__btn modal-dialog__btn--destructive" onClick={() => void handleDeny()}>Deny</button>
              <button ref={firstBtnRef} type="button" className="modal-dialog__btn" style={{ borderColor: 'var(--success, #a6e3a1)', background: 'var(--success, #a6e3a1)', color: '#111', fontWeight: 600 }} onClick={() => void handleAllow()}>Allow</button>
            </>
          )}
        </div>
      </div>
    </OverlayShell>
  );
}
