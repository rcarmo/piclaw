# Offline administrator recovery

`piclaw account-recovery` prepares a restricted first-factor grant for an existing administrator whose factors are lost. It does not log in as that administrator, create an account, change ownership or enable a deployment.

**Normal family startup remains disabled.** These commands accept only a store whose configured access mode and activation state are both `family-shared`. They reject `single-user` and `isolated-containers` stores. Do not change activation markers to try them. `serve` starts a temporary recovery-only HTTPS listener for one named operator grant; it does not start Piclaw's normal runtime.

## Preconditions

- Use the correct host, workspace, store and installed version. Confirm the service manager for that host; do not copy service commands between container and host-native deployments.
- Stop the managed Piclaw service and every other process that writes database or authentication state, including CLI jobs, add-ons, schedulers and backup maintenance. Disable automatic restart while recovering. The runtime lock rejects an active Piclaw or maintenance process, and SQLite rejects a competing writer. You must still check for external processes that do not use Piclaw's lock.
- Keep a coordinated backup of the database, original bootstrap key, configuration and session files. The command makes and verifies an additional SQLite snapshot, including committed WAL data. It does not back up or rotate keys, configuration or session files. Losing the existing key may also make unrelated credentials unreadable.
- Have the exact immutable administrator ID and current username. The account must already own an active home root; repair missing ownership separately.
- Choose `totp` or `passkey` according to the configured authentication policy. TOTP needs the existing bootstrap key. Passkey recovery does not require TOTP. Use the exact externally trusted HTTPS origin without a trailing slash, path, query, credentials or fragment.
- Prepare a directory owned by the invoking OS user, mode `0700`, for the backup and secret grant. Use new filenames. The command refuses existing files/symlinks and never prints the grant URL.

## Preview and issue

Use the stopped service's workspace and profile configuration. Replace the example paths, account ID, username and hostname with those for that service.

```sh
piclaw --workspace /path/to/workspace account-recovery preview \
  --user-id user-EXAMPLE --username alice --method passkey \
  --origin https://family.example

mkdir -m 700 /path/to/private-recovery
piclaw --workspace /path/to/workspace account-recovery issue \
  --user-id user-EXAMPLE --username alice --method passkey \
  --origin https://family.example \
  --backup /path/to/private-recovery/before.sqlite \
  --output /path/to/private-recovery/grant.json \
  --writers-stopped --key-backup-confirmed --confirm 'RECOVER alice'
```

Preview returns the account identity and counts of factors and logins; it reads no factor secrets. Issue requires both acknowledgements and the exact confirmation string. It acquires the workspace runtime lock as a maintenance process, even if the environment disables ordinary runtime locking. It then verifies a SQLite backup and checks for intervening writes before committing. It opens the existing database without running migrations or creating missing tables.

One transaction appends an `operator_recovery_events` row, disables the target, removes its factors/logins/pending ceremonies, revokes invitations it owns or issued, and creates a 15-minute grant. Other accounts and all conversation ownership remain unchanged. This offline operation can replace the final administrator's lost factors; ordinary web/admin last-administrator protection is unchanged.

The grant is written and synced to an exclusively created `0600` file before commit. An output or SQL failure rolls back database changes and removes that output when possible; the verified backup is retained. Only the audit ID, target ID and output/backup paths reach stdout. No HTTP, tool, scheduled action or settings pane issues operator grants. Installed code and privileged filesystem/database access remain trusted.

## Redemption and failure handling

The protected JSON file contains a method-specific invitation URL and expiry. Deliver it privately to the intended administrator; do not paste it into chat transcripts, logs, shell arguments or screenshots. A grant is a bearer secret. Remove the file after confirmed use according to the host's data-retention policy.

With the normal service still stopped and automatic restart still disabled, start the recovery-only listener using the recovery ID printed by `issue` and the same exact origin:

```sh
piclaw --workspace /path/to/workspace --host 127.0.0.1 --port 8443 \
  --tls-cert /path/to/cert.pem --tls-key /path/to/key.pem \
  account-recovery serve --recovery-id operator-recovery-EXAMPLE \
  --origin https://family.example:8443 --writers-stopped \
  --confirm 'SERVE RECOVERY operator-recovery-EXAMPLE'
```

The listener acquires the same maintenance lock and opens the existing database without migrations. TLS certificate and key files are mandatory. It serves only the invitation page, its CSS/JavaScript, and the claim/check/confirm endpoints; login, chat, workspace, SSE, WebSocket, add-on, model, scheduler and ordinary authentication routes return not found. Requests and the grant must match the exact HTTPS origin and named recovery event. The listener stops after successful enrolment, grant expiry or SIGINT/SIGTERM.

The redemption flow uses the restricted invitation page. The operator audit reference, exact origin, target administrator role and owned home must match. The grant does not need a second enabled administrator. A normal administrator's reissue clears the operator grant's authority. Expiry, one-use browser binding, proof checks and revocation still apply. Passkey setup requires user verification; TOTP setup requires a valid code. Successful enrolment enables the same account but the recovery-only listener never creates a login; stop it if needed, restore normal service management, and sign in after a separately authorised normal startup. Existing seeds and private keys are never revealed.

Do not restart the normal family runtime or relax its startup guards to redeem a prepared grant. The commands never start, stop or restart a managed service. Physical-device testing and the wider family release gate remain required before deployment.

If the process is interrupted, inspect the protected output and database using the same release before retrying. A crash may leave an output file for an uncommitted grant or a committed grant whose success was not printed. Never assume missing stdout means rollback. Reissuing to new paths invalidates the previous grant. Expiry does not automatically restore old factors; issue a fresh grant offline or restore the coordinated backup.

To roll back, keep every writer stopped and restore the verified pre-recovery database together with the matching original key, configuration and session files. Follow the SQLite restore procedure for WAL and SHM files; do not delete the production database to clear an error. Verify integrity and account state before an authorised restart. Restoring a backup can also restore old factors and login tokens, making them valid again.

The command does not provide dual-key rotation, encrypted backup storage, audit pruning, automatic service management or a guarantee against a privileged concurrent writer. Use an encrypted/private backup destination where required.
