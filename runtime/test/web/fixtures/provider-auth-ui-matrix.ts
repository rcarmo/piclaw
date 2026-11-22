import { html, render } from "../../../web/src/vendor/preact-htm.js";
import { A2uiSurface } from "../../../web/src/components/a2ui-surface.js";
import type { A2uiSurfaceBlock } from "../../../src/channels/web/a2ui/surface.js";
import type { A2uiActionRequest } from "../../../src/channels/web/a2ui/action.js";

type FixtureState = { blocks: A2uiSurfaceBlock[]; message: string; model: string; postId: number; chatJid: string };
const card = document.querySelector<HTMLElement>("#card")!;
const status = document.querySelector<HTMLElement>("#status")!;
const model = document.querySelector<HTMLElement>("#model");
const start = document.querySelector<HTMLButtonElement>("#start");

async function request(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error("Request failed. Please try again.");
  return response.json();
}

async function submitAction(payload: A2uiActionRequest, options: { signal?: AbortSignal } = {}): Promise<any> {
  const response = await request("/agent/a2ui-action", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: options.signal,
  });
  await refreshState();
  return response;
}

function showState(state: FixtureState): void {
  status.textContent = state.blocks[0]?.fallback_text || state.message;
  if (model) model.textContent = state.model;
  const source = { post_id: state.postId, thread_id: state.postId, chat_jid: state.chatJid };
  render(state.blocks.map(block => html`<${A2uiSurface} key=${block.revision} block=${block} source=${source} onSubmit=${submitAction} />`), card);
}

async function refreshState(): Promise<void> { showState(await request("/fixture/state")); }
(window as any).fixtureReload = refreshState;
start?.addEventListener("click", async () => { await request("/fixture/start", { method: "POST" }); await refreshState(); });
void refreshState();
