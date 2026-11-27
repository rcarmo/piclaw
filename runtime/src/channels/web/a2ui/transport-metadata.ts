export const A2UI_RENDERER_TOOL = 'call_a2ui_renderer';
export const A2UI_METADATA_HEADING = 'A2UI renderer metadata:\n';
export const MAX_A2UI_METADATA_BYTES = 256 * 1024;

/** Exact bytes read from the metadata row for a verified source entry. */
export interface TrustedA2uiPromptProjection {
  readonly sourceContent: string;
  readonly metadata: string;
}

/** Project only an envelope proved from a trusted source row and its bound
 * metadata. Prompt messages alone carry no entry identity: a matching heading
 * and JSON are ordinary human bytes and must never be guessed away, including
 * when they occur in synthesized compaction text. */
export function projectA2uiPromptInput(content: string, trusted?: TrustedA2uiPromptProjection): string {
  if (!trusted || Buffer.byteLength(trusted.metadata, 'utf8') > MAX_A2UI_METADATA_BYTES) return content;
  const envelope = `${trusted.sourceContent}\n\n${A2UI_METADATA_HEADING}${trusted.metadata}`;
  return content === envelope ? trusted.sourceContent : content;
}
