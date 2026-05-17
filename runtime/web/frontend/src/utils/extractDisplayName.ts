/**
 * Extracts and formats a display name from an extension path.
 * @example "piclaw-fleet" → "Fleet", "piclaw-board" → "Board"
 */
export function extractDisplayName(extensionPath: string): string {
  const withoutPrefix = extensionPath.replace(/^piclaw-/, "");
  // Capitalize first letter of each word
  return withoutPrefix
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
