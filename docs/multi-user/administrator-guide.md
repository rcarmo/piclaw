# Family preview administrator guide

Piclaw supports **single-user deployments only**; family startup is disabled. These instructions are for controlled preview testing. Do not activate a deployment or promote a migration copy to follow them.

For ordinary account use, read the [user guide](user-guide.md). For service, filesystem and backup work, use the [migration runbook](migration-copy.md) and [offline recovery runbook](operator-recovery.md). See [troubleshooting](troubleshooting.md) when an operation fails.

## Authority and access

**Family administration** appears only when the server permits account management. Sensitive actions, security details and home assignment need an administrator sign-in within the last five minutes. Refreshing does not renew that window. Permissions can change while the panel is open, so the server checks them again before applying an operation.

Administrators manage account labels, enabled state, roles, sign-in items, future home assignment and tool restrictions. The role does not grant conversation or avatar access, let you select a foreign session as your own, or authorise running a model as another person.

Administrators can replace another account's authentication through reset. Grant the role only to trusted people. The host operator can access the machine, database and shared secrets regardless of account permissions. Workspace files are shared in family mode, and installed code runs with the instance's privileges.

## Add an account

1. Open **Family administration** after a recent sign-in.
2. Under **Create disabled account**, enter **Account username**, **Account display name** and **Role**.
3. Choose **Create account** and wait for the saved list.
4. Verify the account's name and role before issuing an invitation.

Creation makes a disabled account with its own home root and no browser login. Enabling it requires an active owned home and at least one sign-in factor permitted by the current authentication policy. Usernames are unique and follow the same rules as personal profile names. Choose Member for ordinary conversation access.

If the response is lost, choose **Refresh accounts** and look for the account before repeating creation. Piclaw does not deliver invitations; you must share the link privately with the recipient.

## Choose an invitation method

For an account that is disabled, has an active owned home and has no confirmed factors:

- **Issue invitation** starts first-factor authenticator/TOTP setup. It is unavailable under passkey-only policy.
- **Issue passkey invitation** starts first-factor passkey setup. It is unavailable under authenticator-only policy.

Select the action on the correct account, read the warning, type its exact current username and check the confirmation. Choose **Confirm account change**. The link appears once and expires after up to 15 minutes. The recipient then has at most five minutes to complete setup after claiming it.

Copy the link privately to the intended recipient. Do not paste it into a PiClaw conversation, ticket, shell command or screenshot. The page does not copy it to the clipboard or open it for you. TOTP and passkey links select different flows; do not edit a link to change its method.

Issuing again replaces the previous grant and pending setup. **Revoke invitation** revokes either method. **Clear link display**, blur or panel close only erases your displayed copy; it does not revoke the server grant. After a lost issuance response, explicitly revoke/reissue rather than assuming the grant was never created.

Ask the recipient to check the displayed account name, finish setup and sign in separately. Opening a link or displaying a TOTP key alone does not enable the account. A passkey proof must meet device user-verification requirements. Share the [invitation steps](user-guide.md#accept-an-invitation) with the recipient, without including a real link in shared documentation.

## Disable, reactivate or change a role

Choose the action on the account, type the exact username and confirm the checkbox:

- **Disable** prevents new account use and revokes its logins and pending enrolments. It preserves history, ownership and confirmed factors. Already delivered data cannot be recalled.
- **Reactivate** uses the account's existing usable factors and active owned home. It does not issue a login. If no factor is usable under current site policy, resolve that condition rather than forcing enablement.
- **Change role** changes Member to Administrator or the reverse and signs out that account's devices. Review the target role carefully.

The last enabled administrator cannot be disabled or demoted through normal administration. Keep a tested recovery path before removing administrators or factors. If you change your own role to Member, you lose access to this panel.

## Inspect or revoke another account's security items

Choose **Security** for another account after recent administrator authentication. The panel shows factor/device metadata and exact IDs. It does not reveal TOTP seeds, private keys, bearer cookies or conversation content. Use **My account** for your own sign-in items.

For a lost device login, choose **Revoke device login**, verify its ID, type the account username and confirm. This revokes that login and its pending registrations.

For a factor, choose **Remove factor** and confirm the exact item. Factor removal signs out every device for that account. The last usable factor cannot be removed through this operation; use a confirmed replacement or the explicit reset procedure below. A display label is user-authored and may be duplicated, so identify the item by its immutable ID as well.

The operation may be rejected if the target's security items or your administrator permissions change while the panel is open. Refresh and check the list before submitting an item ID again.

## Reset a lost-factor account

Reset removes **all** of another account's current factors, signs out every device, disables the account and issues a replacement first-factor invitation. It preserves the user ID, role, home, history and ownership. It cannot recover or display an old seed.

1. Confirm the intended account and verify the request through your normal trusted process.
2. Choose **Reset account** for a replacement authenticator, or **Reset to passkey** for a replacement passkey.
3. Read the destructive warning, type the exact current username and check the confirmation.
4. Choose **Confirm account change** and privately deliver the new invitation.
5. Have the recipient complete enrolment and sign in again. Old credentials no longer work.

Each reset action requires its corresponding sign-in method to be enabled. Reset to passkey works under passkey-only policy without TOTP. Self-reset is denied, and normal reset cannot remove the last enabled administrator. If no other administrator can help, contact the host operator. The [offline recovery flow](operator-recovery.md) can prepare a grant and run a separate TLS-only invitation listener while the normal service remains stopped. Do not disable ordinary startup guards.

If the server cannot write the replacement invitation or audit record, it rolls back the reset. If the response is lost, the browser cannot tell whether the reset committed. Refresh the account and inspect its security items before retrying. Revoke and reissue any invitation whose status is uncertain.

## Assign another account's home

Choose **Home** to list another account's eligible active owned roots. You cannot select a root owned by somebody else, an archive or a child fork. Choose **Assign home**, read the target root's handle and ID, type the account username and confirm.

This changes future landing and targetless requests only. It does not open the conversation for you, transfer ownership, move an active turn, redirect another tab's explicit session selection or change a container destination. No eligible roots means ownership must be provisioned or repaired through a separate operator workflow. Use **My sessions** to choose your own home.

## Restrict tools for new runs

Choose **Tool restrictions** on the target account. A checked tool is denied. The preview ceiling is `read`, `ls`, `find`, `grep`, `messages`, `session_status`, `session_control` and `chat`; some actions within these tools remain read-only or unavailable.

Check the tools to deny, type the account username, check the confirmation and choose **Save tool restrictions**. Clearing a denial restores only a tool within that fixed ceiling. It cannot grant shell, raw SQL, keychain, remote execution or unknown add-on tools.

Changes affect new model runs. A running turn keeps its original restrictions, including any replacement attempt made to recover that turn. Editing this list cannot cancel it. Account disablement, logout, role changes and loss of ownership are checked separately. If another administrator saved a newer revision, your save is rejected. Refresh and review before retrying.

Tool restrictions do not revoke account management, isolate shared files or replace provider/budget policy. Inspect **Workspace and security** for the effective allowed/denied set and sharing notice.

## Review results and uncertain changes

Every existing-account change uses explicit target confirmation. The panel clears forms, security metadata and invitation links on blur, close, session switch, navigation or account replacement. A request already admitted by the server may still finish afterward.

Use **Refresh accounts** before repeating an uncertain change. There is no automatic browser retry. For invitations, revoke/reissue explicitly. For factor/device removal, inspect the remaining items. For home/tool settings, inspect the effective state. Do not treat an error message or closed panel as proof that nothing changed.

The database records security revocations, home changes, tool restrictions and resets in the same transaction as each change. This preview has no complete audit-log viewer or retention controls. Ask the operator to review the relevant audit records; conversation content is not needed for that check.

## Operator handoff

Account administration does not expose access-mode activation, container destination assignment, backup promotion, key rotation, arbitrary provider credentials, filesystem permissions, notification recipient migration or general add-on configuration.

Before deployment, the operator must complete the [migration procedure](migration-copy.md), back up the state and keys together, and verify that every runtime and transport rejects unauthorised access to another account's conversations. Physical devices, browser caches and recovery-only startup also need testing. The [release gates](README.md#activation-and-recovery) track this work. Prepared copies cannot start. Do not edit markers, transfer credential user IDs or use single-user controls to bypass family checks.
