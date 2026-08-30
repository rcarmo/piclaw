import { html, render, useState } from "../vendor/preact-htm.js";
import { ComposeBox } from "../components/compose-box.js";

const sessions = Array.from({ length: 30 }, (_, index) => {
  const rootIndex = Math.floor(index / 5);
  const isRoot = index % 5 === 0;
  const rootJid = `web:root-${rootIndex}`;
  const chatJid = isRoot ? rootJid : `${rootJid}:branch:${index}`;
  return {
    chat_jid: chatJid,
    root_chat_jid: rootJid,
    branch_id: isRoot ? `root-${rootIndex}` : `branch-${index}`,
    parent_branch_id: isRoot ? null : `root-${rootIndex}`,
    agent_name: index === 1 || index === 2 ? "duplicate" : `session-${String(index).padStart(2, "0")}`,
    model: ["openai/gpt-5.4", "local/qwen", "anthropic/claude"][index % 3],
    context_tokens: index === 8 ? 42_000 : null,
    context_window: index === 8 ? 128_000 : null,
    context_percent: index === 8 ? 32.8125 : null,
    is_active: index === 1 || index === 8,
    archived_at: index >= 25 ? "2026-08-30T00:00:00Z" : null,
  };
});

function Fixture() {
  const [currentChatJid, setCurrentChatJid] = useState("web:root-0");
  const [lastAction, setLastAction] = useState("none");
  const act = (name: string, chatJid?: string) => {
    setLastAction(`${name}:${chatJid || currentChatJid}`);
    if (chatJid) setCurrentChatJid(chatJid);
    return true;
  };
  return html`
    <main class="session-picker-fixture">
      <output id="session-picker-action">${lastAction}</output>
      <${ComposeBox}
        currentChatJid=${currentChatJid}
        activeChatAgents=${sessions}
        activeModel="openai/gpt-5.4"
        onSwitchChat=${(jid) => act("switch", jid)}
        onRestoreSession=${async (jid) => act("restore", jid)}
        onRenameSession=${async () => act("rename")}
        onCreateSession=${async () => act("new")}
        onCreateRootSession=${async () => act("new-root")}
        onDeleteSession=${async (jid) => act("delete", jid)}
        onPurgeArchivedSession=${async (jid) => act("purge", jid)}
        onPost=${() => {}}
        onFocus=${() => {}}
      />
    </main>
  `;
}

const style = document.createElement("style");
style.textContent = `html,body,#session-picker-fixture-root{margin:0;width:100%;height:100%;overflow:hidden}.session-picker-fixture{position:relative;width:100%;height:100%;display:flex;align-items:flex-end;background:var(--bg-primary,#111827)}.session-picker-fixture>.compose-box{width:100%}#session-picker-action{position:fixed;top:4px;left:4px;z-index:2;font:12px monospace;color:var(--text-primary,#fff)}`;
document.head.appendChild(style);
const root = document.getElementById("session-picker-fixture-root") || document.body.appendChild(document.createElement("div"));
root.id = "session-picker-fixture-root";
render(html`<${Fixture} />`, root);
