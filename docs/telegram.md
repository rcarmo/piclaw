# Telegram integration

Telegram is an **optional secondary channel** for mobile-first chat access.
The web UI remains the primary interface.

## Enable

Set both enable flag and bot token:

```bash
PICLAW_TELEGRAM_ENABLED=1
PICLAW_TELEGRAM_BOT_TOKEN=123456789:your_botfather_token
```

Or in `/workspace/.piclaw/config.json`:

```json
{
  "telegram": {
    "enabled": true,
    "botToken": "123456789:your_botfather_token"
  }
}
```

If disabled (or missing token), piclaw uses a no-op Telegram boundary and continues normally.

## Chat IDs and topics

Piclaw stores Telegram chats as `chat_jid` values like:

- `telegram:123456789` (DM)
- `telegram:-1001234567890` (group/supergroup)
- `telegram:-1001234567890:topic:42` (forum topic)

## Notes

- Telegram uses long polling by default.
- Messages are prefixed with assistant name, same as WhatsApp behavior.
- Telegram formatting guidance is applied in channel-specific prompt hints.
- This channel is opt-in and lazy-loaded, so default web-first setups pay no Telegram startup cost.

## Disable

Unset `PICLAW_TELEGRAM_ENABLED` (or set to `0` / `false`).
