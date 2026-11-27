export const A2UI_RENDERER_TOOL = 'call_a2ui_renderer';
export const A2UI_METADATA_HEADING = 'A2UI renderer metadata:\n';
export const MAX_A2UI_METADATA_BYTES = 256 * 1024;

/** Remove reserved legacy transport envelopes, including inside serialized
 * compaction transcripts. Accepted history is immutable; arbitrary human
 * headings/JSON are not renderer transport envelopes. */
export function projectA2uiPromptInput(content: string): string {
  return content.replace(/(?:^|\n\n)A2UI renderer metadata:\n([^\r\n]*)/g, (block, encoded: string) => {
    if (Buffer.byteLength(encoded, "utf8") > MAX_A2UI_METADATA_BYTES) return block;
    try {
      const envelope = JSON.parse(encoded);
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return block;
      const keys = Object.keys(envelope);
      if (!keys.length || keys.some(key => !["a2uiRendererCapabilities", "a2uiRendererDataModel", "a2uiRendererMessage", "a2uiRendererErrors"].includes(key))) return block;
      return "";
    } catch { return block; }
  });
}
