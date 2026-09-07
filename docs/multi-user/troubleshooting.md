# Family preview troubleshooting

Family and isolated startup are disabled. Outside an authorised preview test environment, use the supported single-user app. Do not change mode markers to bypass the restriction.

Use the [user guide](user-guide.md) for everyday actions, the [administrator guide](administrator-guide.md) for account management and the [operator recovery](operator-recovery.md) or [migration](migration-copy.md) runbook for offline state work.

## Sign-in and invitations

| Symptom | Likely condition | Safe next step |
|---|---|---|
| Sign-in options cannot be loaded | Network/server policy discovery failed | Use **Retry loading sign-in options** before entering credentials. Do not submit to another site. |
| No authenticator form or no passkey button | The site's factor policy disables that method | Use an enabled method or ask the administrator. Do not bypass the site's authentication policy. |
| Authenticator code rejected | Wrong account/code, clock skew, expired setup or an already-used timestep | Check the username and device clock; wait for a fresh code. Stop after repeated failures and follow the retry notice. |
| Too many attempts | Account/client rate limit | Wait before retrying; do not cycle usernames or keep submitting the same code. |
| Passkey unavailable or cancelled | Browser/secure-origin support, wrong site/credential, or device cancellation | Check the trusted HTTPS address and select the intended account's credential. Try an enabled alternative or contact the operator. |
| Invitation could not begin | Incomplete, expired, revoked, already-claimed or superseded link | Ask the administrator to revoke/reissue. A lost claim response may have consumed the grant. |
| Account shown on setup page is wrong | Invitation belongs to someone else | Stop without completing setup; contact the administrator privately. |
| Setup succeeded but code sign-in fails immediately | Confirmation consumed that code's timestep | Wait for the next authenticator code and sign in with the account username. |
| Passkey setup could not be verified | Native proof failed, setup expired/cancelled or restricted cookie changed | Do not replay the proof. Try ordinary sign-in only if setup may have completed; otherwise request a new invitation. |

Never include invitation links, QR codes, manual setup keys, bearer cookies or factor files in a support report. The administrator can issue new setup opportunities without reading an old seed.

## Account and session state

| Symptom | Meaning | Safe next step |
|---|---|---|
| This page is no longer bound to its original account | The login or account changed or was revoked | Sign in again or reload. Piclaw clears the old page's conversation and draft. |
| Another tab changed account | Tabs share the browser profile's cookie | Use separate browser profiles for concurrent account testing; sign out on shared devices. |
| Sensitive control is disabled | Recent authentication, policy, item eligibility or browser support is missing | Read the panel notice. Sign out/in if asked, then refresh the panel. |
| Save asks for refresh or reports a revision conflict | Another save changed the server revision, or the result is uncertain | Refresh and inspect the saved state before re-entering a change. Do not repeatedly click Save. |
| Avatar rejected | Unsupported/animated image, oversize file/pixels, bad decode or stale revision | Use a static PNG/JPEG/WebP within the displayed limits, then refresh and try explicitly. |
| Saved model unavailable | Catalogue/scope/auth availability changed | Choose another offered model or save **Use instance defaults**. This does not switch an existing conversation. |
| Conversation URL denied | Unknown, foreign, archived or otherwise inaccessible target | Choose **Go home**, or restore an eligible owned session. Piclaw will not select another conversation automatically. |
| Fork/rename/restore fails | Name collision, unstable turn boundary, inactive parent or stale state | Refresh the list, wait for idle/stable state and choose an available handle. Check for an already-created fork before retrying. |
| Archive is denied | Current home, active turn/disposal or unarchived descendants | Select another home if needed, wait for idle and archive descendants first. There is no cascading archive. |
| Last factor/admin cannot be removed | Removal would eliminate the configured recovery path | Add and verify an alternative or use another administrator's explicit reset. Never delete factor rows manually. |
| Transcript exceeds the limit | More than 2,000 messages or 8 MiB of formatted text | No partial file is prepared. Ask the operator about a complete backup; do not edit history to fit the download. |
| Prepared transcript disappeared or save was denied | Panel cleared, login changed or archive restored | Refresh **My sessions**, check the archive and prepare it again. Closing the panel does not delete stored history. |

Conversations and saved settings persist on the server. Profile, preference and security form edits clear when the tab loses focus or the panel closes. Unsent messages and unsaved forms are temporary browser state. Clearing a form does not undo a request already sent or delete saved data.

## Messages and recovery

- **Queued or working:** wait or refresh. A second click with changed text may create a second request.
- **Held admitted input:** inspect the earlier attempt's result/possible side effects before Retry. Skip retains history without running it. Both need recent sign-in and apply only to the oldest eligible input.
- **Legacy input held by migration:** Retry is unavailable. Confirm **Dismiss legacy input without running** to release later entries. Review and submit a new plain-text prompt separately if execution is wanted.
- **Recovery blocked:** contact the operator. Changed message content, mismatched authority, an incompatible hold or other inconsistent state must not be repaired by guessing IDs or advancing a cursor.
- **Uncertain send/recovery response:** refresh first. An unchanged manual retry in the same page/action keeps its request ID; reloading or changing the action may not. No automatic retry is performed.
- **Missing rich content:** the family shell displays recent plain text only. Classic/visual add-on, attachment, terminal and rich-rendering instructions do not apply to this preview.

## Prepared tasks

- **Uncertain execution cancellation:** use **Refresh results**, inspect the same execution and confirm again only if it is still unsettled. `cancelled` revokes remaining authority; it cannot undo effects or prove provider/tool termination. A held send does not block cancellation after the page rechecks your login.

- **Uncertain preparation:** while the original draft stays open, confirm **Retry same preparation** to reuse the exact request ID. No automatic retry occurs. After discard, refresh, close, focus loss or navigation, inspect the saved list before recreating it; the original write may have committed.
- **Prompt accepted but encoded request too large:** JSON escaping counts towards 128 KiB independently of the 100 KiB prompt limit. Shorten the prompt before confirming again.
- **Preparation or revocation denied:** check recent sign-in, active target, live tool restrictions and the 100-unrevoked-grant allowance. Wait when rate-limited. Refresh and inspect before another change.
- **No Run control:** expected. Tasks remain paused; this preview cannot activate or execute them. Revocation removes authority without deleting history or undoing prior work.

## Old browser caches and private UI

If an old service worker still controls the page, the shell stops before fetching family data and asks you to close other PiClaw tabs and reload. Follow that notice. If it persists, ask the operator to inspect the old installation/PWA and origin migration; do not disable checks or assume a reload cleared every cache.

Backgrounding masks private UI while the cookie is revalidated. This cannot recall screenshots, downloaded files or already delivered data. Sign out when leaving a shared browser/device.

## Migration and offline recovery

Only the host operator should run these commands on an offline, backed-up workspace. Ordinary family users should not edit SQLite, keychain files, session JSONL or activation markers.

| Operator error | Required action |
|---|---|
| Prepared migration copy cannot start | Expected safeguard. Keep the copy for review; do not remove its marker or point an older binary at it. Promotion is not implemented. |
| Access mode mismatch, missing marker or unsupported schema | Stop. Restore matching configuration and a compatible coordinated backup; never silently downgrade. |
| Runtime lock exists or SQLite is busy | Stop all cooperating writers and confirm the correct workspace/host. Never delete an active lock to force progress. |
| Migration inventory changed | Generate and review a fresh preview. Do not replace only the hash in an old plan without review. |
| Quarantined topology or media | Use the runbook to identify the ambiguity. There is no general unquarantine/ownership-transfer button. Preserve source data. |
| Child snapshot hash/path/tree rejected | Check the explicitly selected original file and its complete v3 history/parent. Do not fabricate fork provenance or silently repair unsupported histories. |
| Factor input rejected | Check owner-only permissions, method, current proof and existing bootstrap key. Never paste the seed/code into command arguments. |
| Unresolved durable work blocks preparation | Resolve it through the relevant supported queue/outbox workflow before another preview. Stopped processes do not prove work is safe to discard. |
| Recovery command returned no success | Inspect private output and database before retrying; a crash/lost output can leave commit status uncertain. Use fresh paths and the runbook. |

Copy preparation leaves the live source unchanged and cannot activate a mode. Offline administrator recovery can prepare a restricted grant and run a separate TLS-only invitation listener for that grant while normal Piclaw stays stopped. Back up the database, configuration, original key and session files together. Neither command rotates keys or installs or activates a deployment.

## Report a problem safely

Provide the installed version, browser and operating system, trusted site hostname if appropriate, the control used, approximate time, visible error text and whether the operation may already have completed. State whether this is a preview fixture or a supported single-user deployment. Include the shortest redacted reproduction you can; do not send a full conversation or database export.

Do not include seeds, invitation URLs, cookies, key material, private transcripts, unredacted logs/screenshots or the protected recovery/factor input files. Ask the operator to collect narrowly scoped diagnostics when a message ID or audit reference is needed.
