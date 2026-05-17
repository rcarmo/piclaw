/** Validate that an extension URL is a safe relative same-origin path. */
export function isSafeExtensionUrl(url: string): boolean {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.includes("://");
}
