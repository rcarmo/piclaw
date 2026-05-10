export function setIframeNameBestEffort(
  iframe: { name?: string } | null | undefined,
  hostName: string,
): boolean {
  try {
    if (iframe) {
      iframe.name = hostName;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

export function postIframeMessageBestEffort(
  iframe: { contentWindow?: { postMessage?: (message: unknown, targetOrigin: string) => void } | null } | null | undefined,
  message: unknown,
): boolean {
  try {
    iframe?.contentWindow?.postMessage?.(message, window.location.origin);
    return true;
  } catch (_error) {
    return false;
  }
}
