# Offline session history import

`piclaw session-import` imports explicitly selected, self-contained v3 JSONL
session history into a **fresh, separate native v4 SQLite destination**. It never
converts a resident store or performs a live cutover.

```sh
mkdir -p /new-workspace/.piclaw/store
piclaw session-import \
  --source /offline/export/session.jsonl \
  --destination /new-workspace/.piclaw/store/messages.db \
  --leaf source-leaf-a --leaf source-leaf-b
```

The destination file must not exist. Its parent directory must already exist.
There is no default source, directory discovery, forced overwrite, in-place
schema cleanup, account/config migration or import during startup. Source and
destination aliases, including hardlinks/symlinks to existing files, are refused.

## Supported source

- One UTF-8 JSONL file with a v3 session header, complete records and explicit
  source parent IDs. External `parentSession` references require a self-contained
  export; the importer does not follow other files.
- User, assistant, historical tool-result and system messages. Historical system
  messages are retained as data and never installed as current instructions.
- Model/thinking changes, compaction and branch summaries, labels and session names
  remain inert historical records. Supported recorded thinking levels are `off`,
  `minimal`, `low`, `medium`, `high`, `xhigh` and `max`. They never configure a
  current actor or invoke the old compaction algorithm.
- Text and declared inline PNG/JPEG/GIF/WebP/BMP message payloads are preserved.
  No image resampling, external file dereference, download or PDF/archive/media
  conversion occurs. Relative text references remain text references; their files
  are not imported implicitly.
- Extension/custom state, unknown entry/message/block formats, unsupported versions,
  malformed parents/IDs and selected unfinished or mismatched tool-call/result chains
  are refused. No unsupported record is silently dropped.

Bounds are 8 MiB, 1,000 source entries and 16 leaves. Whole-input shape and resource
checks precede selection or destination creation. A single-leaf source can omit
`--leaf`; multiple leaves require explicit selection. Selected paths share their
actual ancestors. Counts report total, imported and excluded entries.

## Native data and identity

The public SDK Session kernel appends `app.imported-history` entries and creates
ownerless conversations/forks. Native parent references preserve shared ancestry.
The completion document records source session/entry IDs, exact source SHA-256 and
source-to-native conversation/entry mappings. No native execution receipt is invented.

No Harness, model registry, provider request, tool, task, submission, lease, queue,
credential, add-on state or runtime configuration is imported or dispatched by this
operation. The source is opened read-only and checked again before completion.
The source must be genuinely offline/quiescent: these checks are not a filesystem
lock against an adversarial external writer.

After a successful import, ordinary v4 startup can bind the **already-native**
conversations to new Core session identities using current target defaults. It never
reopens the v3 source or runs the importer. Imported content is retained in native
context/history and available through the established session-tree/history surface.
The command does not fabricate Root timeline message rows or accepted-input records.
Only a later explicit user input may start new model/tool work.

## Completion and interruption

Each bounded branch is committed before another forks its committed ancestry.
The final SDK commit alone writes the completion document. A cancelled/failed
operation retains its destination, including any partial native history; it does
not delete, reset or automatically roll back that file. Absence of completion
metadata means the import is incomplete. Ordinary startup refuses that incomplete
store before schema/execution work.

Repeating the command against any existing destination is refused, even after
success. It never resumes a partial import or silently duplicates entries. Choose
another fresh destination only after reviewing the prior result. Successful command
output contains counts/provenance/IDs, not message contents or credentials.

## Store boundary

Normal Core startup attempts exclusive file creation without a prior existence
check. If a file already exists or another creator wins, startup validates it
read-only before root WAL/schema work. An unstamped empty winner is refused intact;
a recognised native winner can reopen through the normal SQLite ownership and
transaction checks. There is no creation retry, automatic adoption or reset.
Other filesystem errors propagate unchanged. The PIC4 header also preserves a
native creator's format intent after a failed first schema transaction; it grants
no execution authority.
An unsupported v3 store is refused intact and points to the explicit one-shot command.
Fresh native stores carry the PIC4 SQLite application ID; supported pre-existing
native application metadata remains valid. This format discriminator grants no
execution/configuration rights and does not replace native ownership/recovery checks.
Ordinary supported native/public SDK schema evolution is separate from v3 conversion.

## Retired constructor and test disposition

The shipped `agent-pool/session.ts` constructor and `benchmark-cold-session.ts`
CLI are removed. They had no production caller after resident manager retirement.
Their automatic recent-file discovery, source sanitisation/rewrites, destructive
pre-compaction trimming, implicit resume and generic extension/MCP execution are
outside the one-shot import boundary.

| Removed constructor scenarios | Retained supported checks |
| --- | --- |
| JSONL rewrite, trim, cold hydration and future append sanitisation | Import source bytes stay unchanged; supported payload/history/lineage checks; partial/native reopen refusal |
| Generic MCP proxy reload, resources/prompts/slash commands, anonymous Parallel preset and lazy discovery | `factory-mcp-maintenance` and `host-mcp-http`: actual native public client, invocation-local abort/revocation, sibling survival, unsupported-profile refusal and uncertain close retaining credential leases |
| Legacy automatic-compaction disable flag and same-turn `activate_tools` mutation | Native factory compaction/settings and native registry/loadout qualification; SDK owns current execution |
| Arbitrary installed extension execution, legacy command-context trust and channel/platform bootstrap gating | `installed-tool-catalog`: unknown packages refuse before top-level I/O; `host-addon-resources`: qualified static viewer routes remain |
| Legacy thinking policy in status | Existing SDK-only policy tests remain; native status reads native metadata and ignores legacy session policy |

Native tests cover their named supported profiles. Generic adapter features and
arbitrary v3 extension command contexts have no native parity certification.
Path-only callers use `session-paths.ts`. Existing ownership, branch restore,
filesystem non-mutation and public SDK-constructor fences remain tested.

The four protected #1875 preparation metadata files remain unchanged. Their exact
rows, protected selectors, strict unknown/missing registration checks and original
retention classifications remain. A frozen JSON fixture retains only the original
optional-extension/MCP composition excerpts from `00700001a`, with source and
fixture hashes. Test-only AST oracles combine those historical declarations with
the retained registry; current native composition is qualified separately. The
fixture is not executable, is outside package inputs, and moved declarations earn
no production deletion credit. Historical `currentSource` fields retain their
as-of references, including the removed constructor.

## Delivery checkpoint

This procedure describes the implemented import and refusal boundaries under #2017.
The wider removal/schema census, exact-source full/package qualification and
acceptance reconciliation must finish before #2017 or #1650 closes. No live import, installation, restart, backup/restore,
provider call or source-store mutation has been performed by this source work.
