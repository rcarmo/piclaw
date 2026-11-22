# Web notification delivery policy

PiClaw uses a per-**device**, per-**chat** delivery coordinator to choose between a local in-page notification and server-side Web Push for a finished agent reply.

## Access-mode scope

This policy applies to single-user notification delivery. Device/chat keys are routing metadata.

## Rule

For a given **device + chat_jid** pair:

- **Visible live client** → **no notification** on that device for that chat
- **Hidden non-iPhone/iPad live client(s)** → **local notification only** on that device for that chat
- **Hidden iPhone/iPad PWA live client(s) only** → **Web Push allowed** on that device for that chat
- **No live client** → **Web Push only** on that device for that chat

## Why routing uses `chat_jid`

PiClaw can have multiple chats running at once. A user may be actively viewing one thread while other threads continue working in the background.

Notification routing keys off the specific `chat_jid` that produced the reply:

- If you are actively viewing chat **A**, replies in chat **A** should stay quiet on that device.
- If chat **B** finishes while no live client for **B** exists on that device, PiClaw should still notify you for **B** even if chat **A** is currently visible.

Replies from non-active threads still notify on that device.

## Local notification election

Multiple hidden tabs or windows on the same device can still be live for the same chat. To avoid duplicate local notifications, the client elects exactly one hidden tab/window per **device + chat** to show the local notification.

If any tab/window for that same chat is visible, hidden tabs stay silent.

## Web Push suppression

Each Web Push subscription is associated with a stable device id. Before sending a reply notification, the server checks whether that device has a recent live client for the same `chat_jid`.

- visible same-chat client present → suppress Web Push for that device
- only hidden iPhone/iPad WebKit same-chat clients remain → allow Web Push for that device
- hidden non-iPhone/iPad same-chat client present → suppress Web Push for that device
- no live same-chat client → allow Web Push for that device

This avoids local/push duplicates on the same device while still letting a swiped-away iPhone PWA fall back to Web Push.

In family mode, subscription and presence records also carry the immutable account ID and current login ID. Presence for one account cannot suppress another account's delivery. Before provider dispatch, the server resolves the reply chat's root owner and rechecks the account, login, mode and root ownership. Invalid recipients are removed in one serialised store update. Family payloads contain only a generic reply notice and the root app URL; conversation text and identifiers remain behind normal browser authentication.

## Scheduled results

A scheduled shell or agent result can send Web Push after PiClaw stores its timeline message. **Notify on complete** controls that push for the scheduled occurrence. Muting leaves the timeline result intact. Each result has its own notification tag and uses the same device and chat presence rules as replies. Scheduled Web Push is single-user only. A push failure cannot change the saved outcome or repeat the task.

## Presence model

The client publishes lightweight presence updates containing:

- `device_id`
- `client_id`
- `chat_jid`
- `visibility_state`
- `has_focus`

Presence is refreshed periodically and expires quickly if the page disappears without clean shutdown.

## Notification title debug labels

By default, PiClaw does **not** append source markers like `[Local]` or `[Web Push]` to notification titles.

If you want those markers while debugging delivery behavior, set:

- `PICLAW_WEB_NOTIFICATION_DEBUG_LABELS=1`

When enabled, local browser notifications and service-worker Web Push notifications both append the source label to the notification title.

## Practical examples

### Phone visible on chat A, chat B finishes

- chat A is visible on the phone
- no live phone client exists for chat B
- result: **Web Push may still fire for chat B**

### Hidden laptop tab on chat A, phone swiped away, chat A finishes

- laptop has a hidden live client for chat A
- phone may still have a hidden iPhone PWA presence record for chat A
- result:
  - **laptop:** local notification only
  - **phone:** Web Push only

### Hidden iPhone PWA on chat A, no other live clients, chat A finishes

- the only recent same-chat presence is an iPhone/iPad WebKit client
- result: **Web Push only**

### Two hidden tabs for chat A on the same laptop

- both are live, neither is visible
- result: exactly **one** hidden tab shows the local notification
