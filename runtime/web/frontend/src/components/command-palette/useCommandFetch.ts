import { useEffect, useMemo, useState } from "preact/hooks";
import { commandRegistry } from "../../services";
import type { BackendCommand, MergedCommand } from "./types";

/**
 * Fetches backend commands when the palette opens and merges them with the
 * local command registry. Returns the merged list.
 */
export function useCommandFetch(visible: boolean): MergedCommand[] {
  const [backendCommands, setBackendCommands] = useState<BackendCommand[]>([]);

  useEffect(() => {
    if (!visible) return;

    const controller = new AbortController();

    fetch("/agent/commands", { credentials: "same-origin", signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ commands: BackendCommand[] }>;
      })
      .then((data) => {
        setBackendCommands(data.commands ?? []);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        console.warn("[CommandPalette] Failed to fetch backend commands:", err);
        setBackendCommands([]);
      });

    return () => {
      controller.abort();
    };
  }, [visible]);

  // Reset on close
  useEffect(() => {
    if (!visible) {
      setBackendCommands([]);
    }
  }, [visible]);

  return useMemo((): MergedCommand[] => {
    const localCmds: MergedCommand[] = commandRegistry.getAll().map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      category: cmd.category,
      keybinding: cmd.keybinding,
      handler: cmd.handler,
      isBackend: false,
    }));

    const backendCmds: MergedCommand[] = backendCommands
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((cmd) => ({
        id: `backend:${cmd.name}`,
        label: cmd.name,
        description: cmd.description,
        category: cmd.source ?? "core",
        isBackend: true,
      }));

    return [...localCmds, ...backendCmds];
  }, [backendCommands]);
}
