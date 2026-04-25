# Cross-instance IPC (experimental)

> **Status:** Experimental. Implemented behind `PICLAW_REMOTE_INTEROP_ENABLED` (default off).
>
> This feature enables one piclaw instance to interact with another instance in a
> secure, consent-driven way.

---

## 1) Design Intent

Cross-instance IPC must be secure by default and operator-controlled.

> Note: We considered broader federation-style protocols, but this design is intentionally
> scoped to small, interconnected groups of agents behind corporate firewalls with
> pre-defined addresses.

A key design decision:

- **Default mode is LLM-mediated** on the remote side.
- Inbound requests go to a **dedicated remote interop channel**.
- The remote side can **accept / deny / negotiate scope** before execution.
- **Short-circuit (direct RPC-like execution)** is optional and must be explicitly
  enabled by a human operator.

This avoids turning pairing into unconditional remote code execution.

---

## 2) Feature flag & configuration

Remote interop is **disabled by default**. Set `PICLAW_REMOTE_INTEROP_ENABLED=1`
to serve `/api/remote/*` endpoints. When disabled, the router returns `404` for
remote interop routes.

Optional configuration:

- `PICLAW_REMOTE_INTEROP_ALLOW_HTTP=1` – allow `http://` callback URLs (testing only).
- `PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK=1` – skip all SSRF protections
  on callback URLs (private IPs, blocked hostnames, DNS re-resolution).
  Docker/LAN development only.
- `PICLAW_REMOTE_SHORT_CIRCUIT_ENABLED=1` – allow short-circuit execution if the peer
  is configured with `mode=short-circuit` and `profile=full`.
- `PICLAW_REMOTE_INSTANCE_NAME` – display name in metadata.
- `PICLAW_REMOTE_INTEROP_DECISION_MODEL` – label for the mediation model (metadata only).

---

## 3) Threat Model

### Adversaries

1. On-path attacker (MITM, replay, tamper)
2. Scanner/flooder (pairing spam, endpoint abuse)
3. Malicious/compromised paired peer
4. Social engineering via deceptive names/fingerprints
5. Compromised private key
6. Resource exhaustion attacker (LLM/tool budget starvation)

### Trust boundaries

- Local user/operator
- Local runtime + policy engine
- Remote runtime + policy engine
- Network transport
- Remote LLM decision channel (untrusted until policy-validated)

### Security goals

- Cryptographic peer authentication
- Replay resistance
- Explicit operator consent for trust
- Least-privilege authorization
- Abuse resilience (rate/queue/budget controls)
- Revocation + auditability

### Non-goals

- Transitive trust across peers
- Anonymous federation
- Automatic broad trust due to network location alone

---

## 4) Identity and Peer Model

Each instance has a stable Ed25519 identity.

| Field | Definition |
|---|---|
| `public_key` | Ed25519 public key |
| `private_key` | Local secret key (keychain/protected file) |
| `instance_id` | `base64url(sha256(public_key))` |
| `instance_name` | Display-only label |
| `fingerprint` | Human-verifiable short form |

### Rules

- `instance_id` is key-derived (not user-chosen).
- Display names are not security identifiers.
- Accept/deny/revoke operations must use `instance_id` or fingerprint.

---

## 5) Pairing Protocol (Consent + Proof)

## Step A — Request

Initiator sends `POST /api/remote/pair-request` with:

- `instance_id`, `public_key`, `display_name`
- callback URL
- protocol version (`1`)
- nonce + expiry

## Step B — Review

Receiver stores request as `pending_inbound` and prompts operator with:

- callback origin (protocol + host derived from `callback_url`)
- source address (client IP, when available)
- instance ID
- full fingerprint
- display name (if provided)

Mode and permissions are not set during pairing — they default to
`mediated` / `restricted` and can be changed later via `/pair mode` and
`/pair permissions`.

## Step C — URL Control Proof

Receiver verifies initiator controls claimed URL via signed challenge callback.

Callback request (receiver → initiator `callback_url`):

```json
{
  "request_id": "pair_123",
  "challenge": "nonce_from_pair_request",
  "receiver_instance_id": "...",
  "receiver_public_key": "...",
  "receiver_fingerprint": "...",
  "timestamp": "2026-03-06T12:34:56Z"
}
```

Callback response (initiator → receiver):

```json
{
  "request_id": "pair_123",
  "challenge": "nonce_from_pair_request",
  "instance_id": "<initiator_instance_id>",
  "signature": "<base64url(ed25519(request_id\nchallenge\nreceiver_instance_id))>"
}
```

Receiver validates the signature using the initiator `public_key` from the
pair request before accepting.

## Step D — Accept / Deny / Block

- **accept**: signed confirmation, peer record created
- **deny**: reject request (retry allowed)
- **block**: deny + suppress future attempts under policy

## Step E — Confirm

Initiator verifies signature + challenge binding and marks peer as paired.

### Anti-spoof constraints

- Never accept by display name alone.
- Require explicit fingerprint/ID confirmation.
- Optional short authentication string (SAS) strongly recommended.

### Convenience routing vs identity-safe operations

Commands like `/pair`, `/ask`, and the `remote-peer` skill accept
display name, instance ID prefix, or fingerprint as shortcuts for peer
lookup. This is a **convenience feature** — the underlying security
model always resolves to the full `instance_id` and validates signatures
against the stored `public_key`. Display-name lookups are
non-authoritative; if multiple peers share a name, the command will
report ambiguity rather than guessing.

---

## 6) Interaction Modes

## 5.1 Default: LLM-Mediated Mode (Recommended)

Inbound prompt is treated as a **proposal**, not an immediate RPC.

Flow:

1. Peer sends signed `proposal`.
2. Remote runtime routes proposal to a **dedicated interop channel**.
3. Remote LLM evaluates and returns a decision envelope:
   - `accept_execute`
   - `accept_defer`
   - `deny`
   - `negotiate`
   - `human_required`
4. Runtime policy engine validates decision against hard limits.
5. If allowed, execution proceeds in bounded scope.
6. Response returns result and optional scope proposal updates.

### Important security rule

The LLM is a **policy advisor**, not a policy authority.

- LLM may narrow scope or deny.
- LLM must not expand permissions beyond deterministic policy ceiling.
- If LLM output conflicts with policy, runtime denies.

## 5.2 Optional: Short-Circuit Mode (Direct RPC-like)

Enabled explicitly per peer by human operator.

- Bypasses negotiation step for eligible request types.
- Executes directly under pre-approved scope profile.
- Still requires full signature, replay, budget, and authorization checks.

Use cases: low-latency trusted automation between tightly controlled peers.

---

## 7) Request Authentication Protocol

All remote requests are signed after pairing.

### Required headers

| Header | Purpose |
|---|---|
| `X-Instance-Id` | Sender identity |
| `X-Trust-Epoch` | Peer trust epoch |
| `X-Timestamp` | Request time |
| `X-Nonce` | Unique request nonce |
| `X-Sig-Version` | Signature/canonicalization version |
| `X-Signature` | Ed25519 signature |

### Canonical payload (v1)

```text
METHOD + "\n" +
PATH_WITH_QUERY + "\n" +
CONTENT_TYPE + "\n" +
SHA256(BODY_BYTES) + "\n" +
X-Timestamp + "\n" +
X-Nonce + "\n" +
X-Instance-Id + "\n" +
X-Sig-Version + "\n" +
X-Trust-Epoch
```

### Verification sequence

1. Lookup peer by `X-Instance-Id`
2. Require `status=paired`
3. Validate timestamp skew bound
4. Reject reused nonce (per-peer replay cache)
5. Verify Ed25519 signature
6. Validate peer `trust_epoch`
7. Apply mode + permission + budget checks
8. Execute request

---

## 8) API Shape (Experimental)

| Endpoint | Purpose | Auth |
|---|---|---|
| `POST /api/remote/pair-request` | initiate pairing | validated unauth input |
| `POST /api/remote/pair-confirm` | complete pairing | signed |
| `GET /api/remote/ping` | health/metadata | signed |
| `POST /api/remote/proposal` | default mediated inbound prompt | signed |
| `POST /api/remote/execute` | optional short-circuit direct exec | signed + mode gate |
| `POST /api/remote/result` | push execution result callback | signed |
| `POST /api/remote/revoke` | revoke relationship | signed |

All POST endpoints require `Content-Type: application/json`.

### Proposal response envelope

```json
{
  "decision": "negotiate",
  "reason": "Need narrower tool scope",
  "proposed_scope": {
    "tools": ["read", "search_workspace"],
    "max_timeout_sec": 30,
    "max_tool_calls": 5
  },
  "negotiation_id": "neg_123",
  "remote_mode": "mediated"
}
```

### Execute response envelope

```json
{
  "decision": "accept_execute",
  "result": "Disk usage: /workspace 18%",
  "usage": {
    "duration_ms": 950,
    "tool_calls": 1
  },
  "scope_applied": {
    "profile": "restricted"
  }
}
```

### Result callback envelope (`POST /api/remote/result`)

Pushed by the executing peer back to the requesting peer after a
mediated proposal is approved and executed (or rejected).

```json
{
  "negotiation_id": "neg_123",
  "decision": "accept_execute",
  "result": "The answer is 42.",
  "usage": { "duration_ms": 1200 }
}
```

Or for a rejection:

```json
{
  "negotiation_id": "neg_123",
  "decision": "deny",
  "reason": "Rejected by operator."
}
```

---

## 9) Authorization and Scope

Pairing grants identity trust, not blanket execution rights.

## Permission profiles

| Profile | Allowed |
|---|---|
| `read-only` | ping/status only — no tool execution or proposals permitted |
| `non-mutating` | all tools classified as read-only (no side-effects) |
| `restricted` (default) | proposal channel with constrained tools (shell, file-write, keychain, and other mutating tools denied) |
| `full` | full remote execution rights |
| `custom` | explicit allowlist (internal only — not yet user-facing) |

**`read-only`** is the most conservative profile: the peer can only ping and
check status. Proposals and execution are rejected at the endpoint level.

**`non-mutating`** allows the peer to run any tool whose capability kind is
`read-only` in the tool-capabilities registry (e.g. `read`, `find`, `grep`,
`ls`, `list_tools`). Mutating tools are blocked by the tool ceiling filter.

### Restricted baseline (deny by default)

Disallow at minimum:

- shell execution
- file write/edit/delete
- keychain access
- SQL introspection
- model/provider switching
- scheduler/task creation
- privileged auth/session operations

Only explicitly granted tools/capabilities are enabled.

---

## 10) Abuse Resistance

### Mandatory controls

- per-peer request rate limit
- per-peer concurrent run cap
- per-peer daily token/time budget
- request/response size caps
- max tool calls per request
- queue isolation (local user traffic priority)
- circuit breaker on repeated invalid/abusive traffic

### Loop prevention (agent-to-agent)

Use chain metadata:

- `X-Request-Chain-Id`
- `X-Request-Hop`

Reject if hop exceeds configured max.

---

## 11) SSRF and URL Safety

Pairing/callback URLs are untrusted input.

Must enforce:

- `https` by default (dev-only exception explicit)
- block localhost/link-local/metadata ranges by default
- DNS rebinding-aware checks where feasible
- redirect + timeout limits
- optional domain/ACL allowlists

---

## 12) Revocation, Rotation, Recovery

### Revocation

`/pair revoke <instance_id>` immediately blocks new requests.

### Trust epoch

Each peer has `trust_epoch`; requests with stale trust context are rejected.

### Key rotation

Key changes require re-verification/re-pair flow; no silent key swaps.

### Compromise runbook

1. revoke compromised peer/key
2. block source if needed
3. rotate local identity key
4. re-pair trusted peers
5. audit and backfill incident timeline

---

## 13) Logging, Privacy, Retention

Audit logs required, but minimize sensitive payload retention.

Recommended logged fields:

- peer ID
- endpoint + decision
- auth result/failure code
- mode used (mediated/short-circuit)
- applied scope profile
- resource usage (duration/tokens/tool calls)
- redacted error summary

Avoid logging raw secrets and full payloads by default.

---

## 14) Minimum Viable Secure Defaults

These defaults are recommended for first implementation.

| Control | Default |
|---|---|
| feature flag | disabled |
| default mode | `mediated` |
| default peer profile | `restricted` |
| timestamp skew | ±90s |
| nonce replay TTL | 5 min |
| nonce cache size | 10k per peer (bounded LRU) |
| pending pair request TTL | 24h |
| pair-request rate | 3 / 10 min / source + ID |
| pair-confirm rate | 6 / 10 min / source + ID |
| proposal rate | 12 / min / peer |
| ping rate | 60 / min / peer |
| execute rate | 6 / min / peer |
| revoke rate | 6 / min / peer |
| concurrent runs | 1 / peer, 4 global remote |
| max prompt size | 32 KB |
| max response size | 256 KB |
| max tool calls | 8 (restricted), 32 (full) |
| max execution timeout | 60s (restricted), 180s (full) |
| request hop limit | 3 |
| audit retention | 30 days (configurable) |

---

## 15) Command UX

```text
/pair request <url>
/pair accept <instance_id|fingerprint>
/pair deny <instance_id|fingerprint>
/pair block <instance_id|fingerprint>
/pair revoke <instance_id|fingerprint>
/pair list
/pair list revoked
/pair inbox
/pair history [page]
/pair approve <proposal_id>
/pair reject <proposal_id> [reason]
/pair permissions <instance_id> <profile>
/pair mode <instance_id> <mediated|short-circuit>
/ask <instance_id|fingerprint|name> <prompt>
```

| Command | Description |
|---|---|
| `/pair request <url>` | Initiate pairing with a remote piclaw instance |
| `/pair accept <id>` | Accept an inbound pair request |
| `/pair deny <id>` | Deny an inbound pair request |
| `/pair block <id>` | Deny and block peer |
| `/pair revoke <id>` | Revoke a pairing (local + best-effort remote notify) |
| `/pair list` | Show paired peers and pending inbound pair requests |
| `/pair list revoked` | Show revoked peers |
| `/pair inbox` | Show pending proposals awaiting review |
| `/pair history [page]` | Show inbound mediated proposals with status and outcome (50 per page) |
| `/pair approve <id>` | Approve and execute a pending proposal |
| `/pair reject <id> [reason]` | Reject a proposal, optionally with reason |
| `/pair permissions <id> <profile>` | Set capability profile (`read-only`, `non-mutating`, `restricted`, `full`) |
| `/pair mode <id> <mode>` | Set interaction mode (`mediated`, `short-circuit`) |
| `/ask <id> <prompt>` | Send a prompt to a paired peer (signed HTTP request) |

Prompts can also be sent via the `remote-peer` skill CLI
(`peer.ts send <fingerprint|name> <prompt>`).

UX requirements:

- always show fingerprint and immutable ID
- explicit warning on `full` or `short-circuit`
- require confirm step for privilege escalation

---

## 16) Implementation Plan (Security-Gated)

| Phase | Scope | Security gate |
|---|---|---|
| 1 | identity + key storage | key-derived IDs enforced |
| 2 | pairing + peer state | challenge/URL proof complete |
| 3 | signature middleware | canonicalization + nonce replay cache |
| 4 | policy engine | deterministic scope enforcement |
| 5 | mediated channel | decision envelope + negotiation flow |
| 6 | short-circuit mode | explicit operator opt-in + tests |
| 7 | capacity controls | quotas/queue isolation/circuit breakers |
| 8 | revocation + rotation | trust epoch checks + runbooks |
| 9 | observability | audit, redaction, retention, alerts |

---

## 17) Must-Fix Checklist Before Enabling

- [x] canonical signature spec implemented and versioned
- [x] nonce replay cache enforced per peer
- [x] acceptance/revocation only by immutable ID/fingerprint
- [x] URL ownership challenge implemented in pairing
- [x] pair-callback endpoint hardened (validates nonce + request_id against outbound records)
- [ ] strict SSRF protections for callback URLs
- [x] deterministic policy ceiling (LLM cannot escalate): tool ceiling enforced via
  `toolCeilingFilter` on `RunAgentOptions`; `setActiveToolsByName` patched for the
  duration of each remote run to prevent self-escalation; `custom` profile deferred
  (falls back to `restricted`)
- [ ] mediated mode default with dedicated channel
- [x] short-circuit mode explicit opt-in only
- [ ] per-peer quotas, concurrency caps, and queue isolation
- [x] loop/hop prevention implemented
- [x] trust-epoch revocation checks in request path
- [ ] TLS enforcement (no silent plaintext fallback)
- [ ] audit logging with redaction and retention controls

### Checklist status (completed/missing)

Completed:
- Canonical signature spec + versioning (v1)
- Nonce replay cache per peer
- URL ownership challenge callback
- Short-circuit explicit opt-in gate
- Loop/hop limit checks
- Trust-epoch checks on signed requests
- Bidirectional peer storage (both sides store each other after pair-confirm)
- **Explicit operator consent gate**: pairing is now two-stage — initiator sends
  `pair-request` and waits; receiver operator must run `/pair accept` to drive
  the URL proof and notify the initiator via a signed `pair-confirm` callback
- **pair-callback hardened**: validates request_id, challenge nonce, and
  receiver_instance_id against the pending outbound record before signing

Missing (or partial):
- SSRF hardening beyond baseline allow/deny rules (e.g., redirect-follow cap,
  DNS rebinding defenses)
- Deterministic policy ceiling + scoped tool enforcement
- Dedicated mediated channel UI + decision workflow
- Quotas/queue isolation beyond basic concurrency limits
- TLS-only enforcement for interop endpoints
- Audit redaction + retention controls
- [x] Tool-call limit enforcement in execute handler (constants defined and
  passed to agentPool.runAgent; cap enforced via tool_execution_end subscriber)
- [x] pair-callback endpoint rate limiter (PAIR_CALLBACK_LIMIT: 6/10 min/source)

---

## 18) Diagram

See [`cross-instance-ipc-design.svg`](cross-instance-ipc-design.svg).

The diagram should be interpreted together with this document’s security gates
and default mode behavior.
