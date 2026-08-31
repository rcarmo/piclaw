/**
 * index.ts — Markdown live preview extension bundle.
 *
 * Imports all decorator modules (which self-register via registerDecorator())
 * and exports the combined CM6 extension array.
 *
 * Usage in editor-extension.ts:
 *   import { markdownLivePreview } from './markdown/index.js';
 *   // Add to extensions: markdownPreviewCompartment.of(markdownLivePreview)
 */

// Import decorators — each calls registerDecorator() as a side effect
import './heading.js';
import './emphasis.js';
import './inline-code.js';
import './code-block.js';
import './hr.js';
import './checkbox.js';
import './link.js';
import './list.js';
import './blockquote.js';
import './frontmatter.js';
import './footnote.js';
import './tag.js';

// Core engine + theme
import {
    livePreviewFrozenField,
    livePreviewPlugin,
    livePreviewPointerFreeze,
} from './live-preview.js';
import { markdownPreviewTheme } from './theme.js';
import { livePreviewCursorNav } from './cursor-nav.js';
import { autoCloseCodeFence, extendEmphasisPair, tightListEnterKeymap } from './edit-helpers.js';
import { imageBlocks } from './image-block.js';
import { editableTables } from './table-editor.js';
import { livePreviewTableKeymap } from './table-keymap.js';

// Parser extensions (for markdown() config)
import { frontmatterExtension } from './frontmatter.js';
import { footnoteExtension } from './footnote.js';
import { hashtagExtension } from './tag.js';

import type { Extension } from '#editor-vendor/codemirror';

/**
 * Custom lezer parser extensions for frontmatter, footnotes, and tags.
 * Pass to markdown({ extensions: markdownParserExtensions }).
 */
export const markdownParserExtensions = [
    frontmatterExtension,
    footnoteExtension,
    hashtagExtension,
];

/**
 * Combined extension for Markdown live preview.
 * Add to a Compartment for toggling:
 *
 *   const mdPreviewCompartment = new Compartment();
 *   extensions.push(mdPreviewCompartment.of(markdownLivePreview));
 *
 *   // Toggle off:
 *   view.dispatch({ effects: mdPreviewCompartment.reconfigure([]) });
 */
export function createMarkdownLivePreview(markdownPath = ''): Extension {
    return [
        livePreviewFrozenField,
        livePreviewPointerFreeze,
        imageBlocks(markdownPath),
        editableTables(),
        livePreviewPlugin,

        livePreviewCursorNav,
        livePreviewTableKeymap,
        extendEmphasisPair,
        autoCloseCodeFence,
        tightListEnterKeymap,
        markdownPreviewTheme,
    ];
}

export const markdownLivePreview: Extension = createMarkdownLivePreview();
