import { buildAdaptiveCardSubmissionFallbackText } from '../ui/adaptive-card-submission.js';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function joinSections(sections: string[]): string {
  return sections
    .map((section) => String(section || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildStructuredBlocksMarkdown(blocks: any[], mediaIds: Array<string | number>): string {
  const sections: string[] = [];
  const attachmentLines: string[] = [];
  const imageLines: string[] = [];

  blocks.forEach((block, index) => {
    if (!block || typeof block !== 'object') return;
    const type = cleanString((block as any).type);

    if (type === 'text') {
      const text = cleanString((block as any).text) || cleanString((block as any).content);
      if (text) sections.push(text);
      return;
    }

    if (type === 'resource_link') {
      const uri = cleanString((block as any).uri);
      const title = cleanString((block as any).title) || cleanString((block as any).name) || uri;
      if (uri && title) {
        sections.push(title === uri ? uri : `[${title}](${uri})`);
      }
      return;
    }

    if (type === 'resource') {
      const title = cleanString((block as any).title) || cleanString((block as any).name) || cleanString((block as any).uri) || 'Embedded resource';
      const text = cleanString((block as any).text);
      if (text) {
        sections.push(`### ${title}\n\n\
\`\`\`\n${text}\n\`\`\``);
      } else {
        sections.push(`### ${title}`);
      }
      return;
    }

    if (type === 'generated_widget') {
      const title = cleanString((block as any).title) || cleanString((block as any).name) || 'Generated widget';
      const description = cleanString((block as any).description) || cleanString((block as any).subtitle);
      sections.push(joinSections([`### ${title}`, description]));
      return;
    }

    if ((type === 'adaptive_card' || type === 'a2ui_surface') && cleanString((block as any).fallback_text)) {
      sections.push(cleanString((block as any).fallback_text));
      return;
    }

    if (type === 'adaptive_card_submission') {
      const fallback = buildAdaptiveCardSubmissionFallbackText(block as any);
      if (cleanString(fallback)) sections.push(cleanString(fallback));
      return;
    }

    if (type === 'file') {
      const label = cleanString((block as any).name) || cleanString((block as any).filename) || cleanString((block as any).title) || `attachment:${mediaIds[index] ?? index + 1}`;
      attachmentLines.push(`- ${label}`);
      return;
    }

    if (type === 'image' || !type) {
      const label = cleanString((block as any).name) || cleanString((block as any).filename) || cleanString((block as any).title) || `attachment:${mediaIds[index] ?? index + 1}`;
      imageLines.push(`- ${label}`);
    }
  });

  if (imageLines.length > 0) sections.push(`Images:\n${imageLines.join('\n')}`);
  if (attachmentLines.length > 0) sections.push(`Attachments:\n${attachmentLines.join('\n')}`);

  return joinSections(sections);
}

export function buildPostMarkdownCopyPayload(post: any): string {
  const data = post?.data || {};
  const rawContent = typeof data.content === 'string' ? data.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd() : '';
  if (rawContent.trim()) return rawContent;

  const blocks = Array.isArray(data.content_blocks) ? data.content_blocks : [];
  const mediaIds = Array.isArray(data.media_ids) ? data.media_ids : [];
  return buildStructuredBlocksMarkdown(blocks, mediaIds);
}
