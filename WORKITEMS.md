# Workitems

Work items for piclaw are tracked in **[GitHub Issues](https://github.com/rcarmo/piclaw/issues)**
on the **[piclaw-core project board](https://github.com/users/rcarmo/projects/13)**.

## Creating a new issue

Use one of the [issue templates](https://github.com/rcarmo/piclaw/issues/new/choose):

- **Work item** — feature, improvement, refactor, audit, or bug
- **Question** — ask about behaviour, configuration, or design

Or from the CLI:

```bash
gh issue create -R rcarmo/piclaw
```

## Board lanes

| Lane | Meaning |
|---|---|
| **Inbox** | Raw idea or unrefined request |
| **Next** | Refined and ready to pick up |
| **In Progress** | Actively being worked on |
| **In Review** | Implementation done, under verification |
| **Done** | Closed and verified complete |

## Label taxonomy

| Prefix | Examples |
|---|---|
| `priority:` | `critical` `high` `medium` `low` |
| `area:` | `web` `runtime` `extensions` `workspace` `tools` `sessions` `docs` `packaging` `security` … |
| `type:` | `feature` `bug` `refactor` `audit` `docs` `release` `research` |
| `blocked` | Blocked by another issue or external dependency |
| `deferred` | Intentionally deferred |

## Archive

The previous file-based kanban (`workitems/`) is preserved as a **read-only archive**.
Do not add new files there — all new work items go through GitHub Issues.

- Archive: [`workitems/_archive/`](workitems/_archive/)
- Migration map: [`scripts/migrate-state.json`](scripts/migrate-state.json)
- Migration guide: [`docs/workitems-github-migration.md`](docs/workitems-github-migration.md)
