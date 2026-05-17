import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { addonHealthSignal } from "../components/model-context-bar/addonHealthSignal";

interface AddonSkill {
  name: string;
}

interface Addon {
  slug: string;
  name: string;
  version: string | null;
  type: string;
  description: string;
  tags: string[];
  skills: AddonSkill[];
  installed: boolean;
  installedVersion: string | null;
  hasUpdate: boolean;
  installKind: string;
}

interface AddonsResponse {
  addons: Addon[];
  source?: string;
  sources?: string[];
  failed_sources?: string[];
}

export function AddonsPanel() {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [source, setSource] = useState<string>("");
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [filter, setFilter] = useState<string>("");
  const [actionState, setActionState] = useState<Record<string, "installing" | "uninstalling">>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const addonHealthWarning = useComputed(() => {
    const s = addonHealthSignal.value;
    if (!s || s.healthy !== false) return null;
    const names = s.degraded_addons?.join(", ");
    return names ? `Some add-ons are experiencing issues: ${names}` : "Some add-ons are experiencing issues.";
  });

  const loadAddons = useCallback(async () => {
    const scrollTop = listRef.current?.scrollTop ?? 0;
    setStatus("loading");
    try {
      const res = await fetch("/agent/addons", { credentials: "same-origin" });
      if (res.status === 401) {
        setStatus("error");
        return;
      }
      if (!res.ok) throw new Error("Load failed");
      const data: AddonsResponse = await res.json();
      setAddons(Array.isArray(data.addons) ? data.addons : []);
      setSource(data.source ?? (data.sources ? data.sources.join(", ") : ""));
      setStatus("done");
      // Restore scroll position after re-render
      requestAnimationFrame(() => {
        if (listRef.current) listRef.current.scrollTop = scrollTop;
      });
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    loadAddons();
  }, [loadAddons]);

  const handleInstall = useCallback(async (slug: string) => {
    setActionState((prev) => ({ ...prev, [slug]: "installing" }));
    setActionError(null);
    try {
      const res = await fetch("/agent/addons/install", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        console.warn("[addons] install failed:", res.status);
        setActionError("Couldn't install add-on. Please try again.");
        return;
      }
      setNeedsRestart(true);
      await loadAddons();
    } catch (err) {
      console.warn("[addons] install failed:", err);
      setActionError("Install failed.");
    } finally {
      setActionState((prev) => {
        const next = { ...prev };
        delete next[slug];
        return next;
      });
    }
  }, [loadAddons]);

  const handleUninstall = useCallback(async (slug: string) => {
    setActionState((prev) => ({ ...prev, [slug]: "uninstalling" }));
    setActionError(null);
    try {
      const res = await fetch("/agent/addons/uninstall", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        console.warn("[addons] uninstall failed:", res.status);
        setActionError("Couldn't uninstall add-on. Please try again.");
        return;
      }
      setNeedsRestart(true);
      await loadAddons();
    } catch (err) {
      console.warn("[addons] uninstall failed:", err);
      setActionError("Uninstall failed.");
    } finally {
      setActionState((prev) => {
        const next = { ...prev };
        delete next[slug];
        return next;
      });
    }
  }, [loadAddons]);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    try {
      const res = await fetch("/agent/addons/restart", {
        method: "POST",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (data.error) {
        setActionError(data.error);
        setRestarting(false);
        return;
      }
      setNeedsRestart(false);
      // Poll until backend is back, then refresh addon list
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const probe = await fetch("/agent/addons", { credentials: "same-origin", signal: AbortSignal.timeout(3000) });
          if (probe.ok) {
            await loadAddons();
            setRestarting(false);
            return;
          }
        } catch { /* backend not ready yet */ }
      }
      // Backend didn't come back — reload page manually
      setRestarting(false);
      setActionError("Backend did not return in time. Reload the page manually.");
    } catch {
      setRestarting(false);
      setActionError("Restart failed.");
    }
  }, [loadAddons]);

  const filteredAddons = addons.filter((addon) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      addon.name.toLowerCase().includes(q) ||
      addon.description.toLowerCase().includes(q) ||
      addon.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  if (status === "loading" && addons.length === 0) {
    return (
      <div className="addons-panel">
        <div className="addons-panel__empty">Loading catalog…</div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="addons-panel">
        <div className="addons-panel__empty addons-panel__empty--error">
          Failed to load catalog.{" "}
          <button className="addons-panel__retry" onClick={loadAddons}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="addons-panel">
      <div className="addons-panel__filter">
        <input
          className="addons-panel__filter-input"
          type="text"
          placeholder="Filter add-ons…"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
      </div>
      {needsRestart && (
        <div className="addons-panel__restart-banner">
          <span>Restart required to apply changes.</span>
          <button
            className="addons-panel__restart-btn"
            onClick={handleRestart}
            disabled={restarting}
          >
            {restarting ? "Restarting…" : "Restart now"}
          </button>
        </div>
      )}
      {actionError && (
        <div className="addons-panel__error">{actionError}</div>
      )}
      {source && (
        <div className="addons-panel__source">Catalog from {source}</div>
      )}
      {addonHealthWarning.value && (
        <div className="addons-panel__degraded-warning">
          ⚠ {addonHealthWarning.value}
        </div>
      )}
      <div className="addons-panel__notice">
        Add-ons install via Bun package manager. A restart is required after install or uninstall.
      </div>
      <div className="addons-panel__list" ref={listRef}>
        {filteredAddons.length === 0 && filter ? (
          <div className="addons-panel__empty">No add-ons match &ldquo;{filter}&rdquo;</div>
        ) : filteredAddons.length === 0 ? (
          <div className="addons-panel__empty">No add-ons available</div>
        ) : (
          filteredAddons.map((addon) => (
            <AddonCard
              key={addon.slug}
              addon={addon}
              actionState={actionState[addon.slug]}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface AddonCardProps {
  addon: Addon;
  actionState?: "installing" | "uninstalling";
  onInstall: (slug: string) => void;
  onUninstall: (slug: string) => void;
}

function AddonCard({ addon, actionState, onInstall, onUninstall }: AddonCardProps) {
  const displayVersion = addon.installedVersion ?? addon.version;
  const isExtSkill = addon.type === "extension+skill";
  const busy = !!actionState;

  const skills: AddonSkill[] = Array.isArray(addon.skills)
    ? addon.skills.filter((s): s is AddonSkill => typeof s === "object" && s !== null && "name" in s)
    : [];

  return (
    <div className="addons-panel__card">
      <div className="addons-panel__card-header">
        <div className="addons-panel__card-info">
          <span className="addons-panel__card-name">{addon.name}</span>
          <span className={`addons-panel__card-type ${isExtSkill ? "addons-panel__card-type--skill" : "addons-panel__card-type--ext"}`}>
            {isExtSkill ? "EXTENSION + SKILL" : "EXTENSION"}
          </span>
          {displayVersion && (
            <span className="addons-panel__card-version">{displayVersion}</span>
          )}
          {addon.installKind && (
            <span className="addons-panel__card-kind">{addon.installKind}</span>
          )}
        </div>
        {addon.hasUpdate ? (
          <button
            className="addons-panel__card-action addons-panel__card-action--update"
            disabled={busy}
            onClick={() => onInstall(addon.slug)}
          >
            {actionState === "installing" ? "Updating…" : "Update"}
          </button>
        ) : addon.installed ? (
          <button
            className="addons-panel__card-action addons-panel__card-action--uninstall"
            disabled={busy}
            onClick={() => onUninstall(addon.slug)}
          >
            {actionState === "uninstalling" ? "Removing…" : "Uninstall"}
          </button>
        ) : (
          <button
            className="addons-panel__card-action addons-panel__card-action--install"
            disabled={busy}
            onClick={() => onInstall(addon.slug)}
          >
            {actionState === "installing" ? "Installing…" : "Install"}
          </button>
        )}
      </div>
      {addon.description && (
        <div className="addons-panel__card-desc">{addon.description}</div>
      )}
      {(addon.tags.length > 0 || skills.length > 0) && (
        <div className="addons-panel__card-tags">
          {addon.tags.map((tag) => (
            <span key={tag} className="addons-panel__tag">{tag}</span>
          ))}
          {skills.map((skill) => (
            <span key={skill.name} className="addons-panel__skill">📄 {skill.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}
