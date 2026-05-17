import { useState, useRef, useCallback } from "preact/hooks";
import { useDismissableLayer } from "../hooks/useDismissableLayer";
import { userAvatarUrl, assistantAvatarUrl } from "../api/identity";

interface AvatarPopoverProps {
  type: "user" | "agent";
  x: number;
  y: number;
  onDismiss: () => void;
}


function bustAvatarCache(type: "user" | "agent", url: string) {
  const buster = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  if (type === "user") userAvatarUrl.value = buster;
  else assistantAvatarUrl.value = buster;
}

export function AvatarPopover({ type, x, y, onDismiss }: AvatarPopoverProps) {
  const [githubHandle, setGithubHandle] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useDismissableLayer({ ref: popoverRef, open: true, onDismiss });

  const handleGithubSync = useCallback(async () => {
    if (!githubHandle.trim()) return;
    setStatus("Syncing…");
    try {
      const handle = githubHandle.trim().replace(/^@/, "");
      const avatarUrl = `https://github.com/${encodeURIComponent(handle)}.png?size=128`;
      const valid = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = avatarUrl;
      });
      if (!valid) { setStatus("Avatar not found for that handle"); return; }
      await fetch("/agent/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userAvatar: avatarUrl }),
      });
      bustAvatarCache("user", `/avatar/user`);
      setStatus("Done!");
      setTimeout(onDismiss, 800);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed");
    }
  }, [githubHandle, onDismiss]);

  const handleFileUpload = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const handleReset = useCallback(async () => {
    setStatus("Resetting…");
    try {
      const field = type === "user" ? "userAvatar" : "assistantAvatar";
      await fetch("/agent/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ [field]: null }),
      });
      bustAvatarCache(type, `/avatar/${type === "user" ? "user" : "agent"}`);
      setStatus("Done!");
      setTimeout(onDismiss, 800);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed");
    }
  }, [type, onDismiss]);

  const handleFileChange = useCallback(async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setStatus("Uploading…");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/media/upload", { method: "POST", credentials: "same-origin", body: formData });
      if (!res.ok) throw new Error(`Upload HTTP ${res.status}`);
      const data = await res.json() as { url?: string; id?: number };
      const url = data.url || (data.id ? `/media/${data.id}` : null);
      if (!url) throw new Error("No URL returned");
      const field = type === "user" ? "userAvatar" : "assistantAvatar";
      const saveRes = await fetch("/agent/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ [field]: url }),
      });
      if (!saveRes.ok) throw new Error(`Save HTTP ${saveRes.status}`);
      bustAvatarCache(type, `/avatar/${type === "user" ? "user" : "agent"}`);
      setStatus("Done!");
      setTimeout(onDismiss, 800);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Upload failed");
    }
  }, [type, onDismiss]);

  // Position: ensure on screen
  const left = Math.max(8, Math.min(x, window.innerWidth - 220));
  const top = Math.max(8, Math.min(y + 8, window.innerHeight - 180));

  return (
    <div ref={popoverRef} className="avatar-popover" style={{ left: `${left}px`, top: `${top}px` }}>
      <div className="avatar-popover__title">
        {type === "user" ? "Your avatar" : "Agent avatar"}
      </div>
      <button type="button" className="avatar-popover__btn" onClick={handleFileUpload}>
        <i className="codicon codicon-cloud-upload" /> Upload image
      </button>
      <button type="button" className="avatar-popover__btn" onClick={handleReset}>
        <i className="codicon codicon-discard" /> Reset to default
      </button>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
      {type === "user" && (
        <div className="avatar-popover__github">
          <input
            className="avatar-popover__input"
            type="text"
            placeholder="GitHub handle"
            value={githubHandle}
            onInput={(e) => setGithubHandle((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleGithubSync(); }}
          />
          <button type="button" className="avatar-popover__btn avatar-popover__btn--small" onClick={handleGithubSync}>
            Sync
          </button>
        </div>
      )}
      {status && <div className="avatar-popover__status">{status}</div>}
    </div>
  );
}
