import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import type { ConnectionStatus } from "../api/types";

/**
 * Listens for SSE connected/disconnected custom events and probes the backend.
 * Returns a signal representing the current connection status.
 */
export function useConnectionStatus(): Signal<ConnectionStatus> {
  const connectionStatus = useSignal<ConnectionStatus>("disconnected");

  useEffect(() => {
    const onConnected = () => { connectionStatus.value = "connected"; };
    const onDisconnected = () => { connectionStatus.value = "disconnected"; };
    window.addEventListener("piclaw:sse-connected", onConnected);
    window.addEventListener("piclaw:sse-disconnected", onDisconnected);
    // Probe: if SSE already open, the event already fired — check with a ping
    fetch("/agent/models", { credentials: "same-origin" })
      .then((r) => { if (r.ok) connectionStatus.value = "connected"; })
      .catch(() => {});
    return () => {
      window.removeEventListener("piclaw:sse-connected", onConnected);
      window.removeEventListener("piclaw:sse-disconnected", onDisconnected);
    };
  }, []);

  return connectionStatus;
}
