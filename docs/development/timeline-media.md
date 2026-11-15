# Timeline media storage

All media shown in the timeline is stored in SQLite, in the `media` table, and is deleted together with the timeline entries that use it.

| Kind | Link to the entry | Created |
|---|---|---|
| Attachment (upload, generated file posted to the chat) | `message_media (message_rowid, media_id)` | When the message is stored |
| Link-preview image | `message_inline_media (message_rowid, 'link_preview', <page url>, media_id)` | When the post's previews are fetched |
| Tool image preview (320 px WebP of an image a tool returned to the model) | `message_inline_media (message_rowid, 'tool_image', '<call id>:<index>', media_id)` | On first view of the reply's activity log |

## Deletion

- A trigger on `messages` (`messages_inline_media_ad`) runs for every deletion path: deleting a post or thread, purging an archived session, and direct SQL. It removes the message's inline rows and deletes each linked media row unless another message or an attachment still uses it.
- The trigger deletes only media created as derived inline media (`metadata.cache_kind` of `link_preview_image` or `tool_image_thumbnail`). Uploads referenced from a preview are never deleted this way.
- `deleteUnreferencedMedia` treats `message_inline_media` as a reference, so expiry of the link-preview URL cache (`link_preview_image_cache`) no longer deletes images that existing posts still show. The cache row only deduplicates fetches.
- Replacing a post's link previews replaces its `link_preview` rows and deletes images that only the old previews used.

## Notes

- Posts stored before `message_inline_media` existed are linked once by the `link-preview-backfill-v1` migration, which parses `/media/<id>` image paths in `messages.link_previews`.
- The running turn has no reply row yet, so its tool image previews are rendered per request (`Cache-Control: no-store`) and not stored.
- The full-size images remain in the durable transcript, which has its own retention.
- Archived-session downloads include `message_inline_media` alongside `message_media`.
