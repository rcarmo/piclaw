import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

export function AvatarSection() {
  const githubHandle = useSignal("");
  const syncing = useSignal(false);
  const uploadingUser = useSignal(false);
  const uploadingAgent = useSignal(false);
  const statusMsg = useSignal<string | null>(null);
  const userCacheBust = useSignal(Date.now());
  const agentCacheBust = useSignal(Date.now());
  const userFileRef = useRef<HTMLInputElement>(null);
  const agentFileRef = useRef<HTMLInputElement>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showStatus(msg: string, duration = 2500) {
    statusMsg.value = msg;
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => (statusMsg.value = null), duration);
  }

  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current); }, []);

  async function saveAvatar(field: "userAvatar" | "assistantAvatar", url: string | null) {
    const res = await fetch("/agent/settings/general", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ [field]: url }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async function handleFileUpload(type: "user" | "agent", file: File) {
    const loading = type === "user" ? uploadingUser : uploadingAgent;
    loading.value = true;
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/media/upload", { method: "POST", credentials: "same-origin", body: formData });
      if (!res.ok) throw new Error(`Upload failed`);
      const data = await res.json() as { id?: number };
      if (!data.id) throw new Error("No media ID");
      await saveAvatar(type === "user" ? "userAvatar" : "assistantAvatar", `/media/${data.id}`);
      if (type === "user") userCacheBust.value = Date.now();
      else agentCacheBust.value = Date.now();
      showStatus("Avatar updated ✓");
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Upload failed");
    } finally {
      loading.value = false;
    }
  }

  async function handleGithubSync() {
    const handle = githubHandle.value.trim().replace(/^@/, "");
    if (!handle) return;
    syncing.value = true;
    try {
      // Validate by loading the image
      const avatarUrl = `https://github.com/${encodeURIComponent(handle)}.png?size=128`;
      const valid = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = avatarUrl;
      });
      if (!valid) { showStatus("Avatar not found for that handle"); return; }
      await saveAvatar("userAvatar", avatarUrl);
      userCacheBust.value = Date.now();
      showStatus("GitHub avatar synced ✓");
    } catch {
      showStatus("Sync failed");
    } finally {
      syncing.value = false;
    }
  }

  async function handleReset(type: "user" | "agent") {
    try {
      await saveAvatar(type === "user" ? "userAvatar" : "assistantAvatar", null);
      if (type === "user") userCacheBust.value = Date.now();
      else agentCacheBust.value = Date.now();
      showStatus("Reset to default ✓");
    } catch {
      showStatus("Reset failed");
    }
  }

  return (
    <section className="settings-panel__section">
      <h3 className="settings-panel__subsection-title">Avatars</h3>

      <div className="avatar-section">
        <div className="avatar-section__group">
          <div className="avatar-section__preview-wrap">
            <img
              className="avatar-section__preview"
              src={`/avatar/user?t=${userCacheBust.value}`}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              onLoad={(e) => { (e.target as HTMLImageElement).style.display = ""; }}
            />
            <div className="avatar-section__fallback">Y</div>
          </div>
          <span className="avatar-section__label">You</span>
          <div className="avatar-section__actions">
            <button className="avatar-section__btn" disabled={uploadingUser.value} onClick={() => userFileRef.current?.click()}>
              <i className="codicon codicon-cloud-upload" />
            </button>
            <button className="avatar-section__btn" onClick={() => void handleReset("user")} title="Reset">
              <i className="codicon codicon-discard" />
            </button>
          </div>
        </div>

        <div className="avatar-section__group">
          <div className="avatar-section__preview-wrap">
            <img
              className="avatar-section__preview"
              src={`/avatar/agent?t=${agentCacheBust.value}`}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).src = "/static/icon-192.png"; }}
            />
          </div>
          <span className="avatar-section__label">Agent</span>
          <div className="avatar-section__actions">
            <button className="avatar-section__btn" disabled={uploadingAgent.value} onClick={() => agentFileRef.current?.click()}>
              <i className="codicon codicon-cloud-upload" />
            </button>
            <button className="avatar-section__btn" onClick={() => void handleReset("agent")} title="Reset">
              <i className="codicon codicon-discard" />
            </button>
          </div>
        </div>
      </div>

      <div className="avatar-section__github">
        <input
          className="avatar-section__github-input"
          type="text"
          placeholder="GitHub handle"
          value={githubHandle.value}
          onInput={(e) => (githubHandle.value = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter") void handleGithubSync(); }}
        />
        <button className="avatar-section__btn" disabled={syncing.value || !githubHandle.value.trim()} onClick={() => void handleGithubSync()}>
          {syncing.value ? "…" : "Sync"}
        </button>
      </div>

      {statusMsg.value && <div className="avatar-section__status">{statusMsg.value}</div>}

      <input ref={userFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void handleFileUpload("user", f); (e.target as HTMLInputElement).value = ""; }} />
      <input ref={agentFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void handleFileUpload("agent", f); (e.target as HTMLInputElement).value = ""; }} />
    </section>
  );
}
