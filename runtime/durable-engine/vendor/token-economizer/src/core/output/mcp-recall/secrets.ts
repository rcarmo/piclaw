// SPDX-License-Identifier: Apache-2.0
// From sakebomb/mcp-recall@2db17d6d01d965e4181a8f18c674561baa588a24; see NOTICE and LICENSE.
export interface SecretPattern {
  name: string;
  pattern: RegExp;
}

/**
 * Patterns for detecting secrets in tool output content.
 * Any match prevents storage regardless of denylist settings.
 *
 * ReDoS audit (2026-09-11): no catastrophic backtracking. The AWS secret
 * pattern (.{0,20}…{0,20}) tops out at 400 backtracks. The OpenAI watermark arm
 * bounds both runs around a literal ({16,120}); measured linear in input length
 * — 52 KB of adversarial "sk-" starts with no marker takes 0.5 ms, 1 MB takes
 * 10 ms, with no superlinear knee. All other patterns use simple character
 * classes with no nested quantifiers.
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "PEM private key",
    pattern: /-----BEGIN .{0,20}PRIVATE KEY-----/,
  },
  {
    name: "GitHub PAT (classic)",
    pattern: /ghp_[A-Za-z0-9]{36}/,
  },
  {
    name: "GitHub PAT (fine-grained)",
    pattern: /github_pat_[A-Za-z0-9_]{82}/,
  },
  {
    name: "GitHub OAuth token",
    pattern: /gho_[A-Za-z0-9]{36}/,
  },
  {
    // Three arms, most-specific first. Read them together — each covers a shape
    // the others structurally cannot, and dropping any one fails open.
    //
    // The leading lookbehind is what fixed #274, NOT a narrower body class.
    // `[\w-]` matched any hyphenated slug containing "risk-"/"task-"/"disk-" —
    // 97% false positives on a real corpus — because in "ri|sk-" both neighbours
    // are word characters, so there is no boundary. Requiring one killed that
    // whole slug class. It did not, however, help where "sk-" is a *standalone*
    // token: "sk-project-notes-draft-…" and "sk-1042-add-retry-…" (a two-letter
    // Jira key) still matched a bare `[A-Za-z0-9_-]{20,}` body (#276).
    //
    // Arm 1 — the watermark. Every modern OpenAI key embeds `T3BlbkFJ`
    // (base64 "OpenAI") mid-body; gitleaks and Semgrep both key on it precisely
    // because it is specific enough to need no other constraint. This arm is
    // deliberately PREFIX-AGNOSTIC, which is what keeps arm 2's closed list from
    // being a false-negative trap: a future `sk-<newtype>-` key is still caught
    // here. The window is wider than gitleaks' {20,74} so an unknown prefix
    // cannot push the marker out of range; widening cannot add false positives
    // because the marker itself is doing the discriminating.
    //
    // Arm 2 — known prefixes, permissive body, no upper bound. Covers a modern
    // key whose marker is absent or sits beyond arm 1's window. The body must
    // STAY permissive: these carry base64url containing "-" and "_", so a
    // hyphen-free class would fail open on every current key shape — the
    // false-negative trap this pattern was briefly rewritten into.
    // DO NOT "simplify" this list away, and do not treat it as the only
    // prefix defence; it is the backstop for arm 1, not a whitelist.
    //
    // Arm 3 — legacy bare `sk-`: 32+ hyphen-free base62. Stopping at the first
    // hyphen is exactly what rejects the #276 slugs ("project", "1042").
    //
    // The two lookaheads are structurally redundant today (no arm can match
    // "sk-ant-"/"sk-or-v1-"), but they are kept so the "label the vendor
    // unambiguously" invariant survives anyone loosening arm 3's class.
    //
    // ReDoS: bounded quantifiers around a literal; measured linear in input
    // (1 MB → ~10 ms, no plateau), see the audit note above.
    name: "OpenAI API key",
    pattern:
      /(?<![A-Za-z0-9_-])sk-(?!ant-)(?!or-v1-)(?:[A-Za-z0-9_-]{16,120}T3BlbkFJ[A-Za-z0-9_-]{16,120}|(?:proj|svcacct|admin|None)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{32,})/,
  },
  {
    // Previously matched only *by accident*, through the over-broad class that
    // caused #274, and mislabelled "OpenAI API key" when it did. The negative
    // lookahead above keeps the labelling unambiguous.
    name: "OpenRouter API key",
    pattern: /(?<![A-Za-z0-9_-])sk-or-v1-[A-Za-z0-9_-]{20,}/,
  },
  {
    name: "AWS access key ID",
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: "AWS secret access key",
    pattern: /aws.{0,20}secret.{0,20}[A-Za-z0-9/+=]{40}/i,
  },
  {
    name: "Anthropic API key",
    // Same leading-boundary guard as the OpenAI entry above (#274): without it
    // a slug like "risk-ant-..." matches. Body stays permissive by design.
    pattern: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9\-_]{32,}/,
  },
  {
    // Two arms. A length bound on the RFC 6750 charset is what flags ordinary
    // documentation: "Bearer authentication-for-all-internal-endpoints",
    // "Bearer tokens/are/documented/in/the/api/reference" (#280). Since #271 a
    // match is a user-facing refusal.
    //
    // Arm 1 — JWT. `eyJ` is base64(`{"`) and is to JWTs what T3BlbkFJ is to
    // OpenAI keys: specific enough to need no other constraint. Three
    // dot-separated base64url segments (RFC 7519).
    //
    // Arm 2 — opaque. Hyphen-free, slash-free alphanumeric (plus `+` and
    // padding). Those two separators are what the false-positive prose uses
    // as word/path delimiters. A closed prefix list has the #276 trap; this
    // arm is the backstop for non-JWT tokens. Residual false-negative:
    // standard base64 that contains `/`. JWTs use base64url and are arm 1.
    name: "Generic Bearer token",
    pattern:
      /Bearer (?:eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|[A-Za-z0-9+]{32,}={0,2})/,
  },
  {
    name: "SSH private key",
    pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/,
  },
  {
    // Matches any JSON *describing* a service account, not only a private
    // key file. Intended conservatism (#280): the discriminator is the field
    // every real key file carries, and a Terraform/docs snippet of the same
    // shape is rare in MCP tool output. Leave as is.
    name: "GCP service account key",
    pattern: /"type"\s*:\s*"service_account"/,
  },
  {
    name: "Azure storage connection string",
    pattern: /DefaultEndpointsProtocol=https?;AccountName=[^;]{1,100};AccountKey=[A-Za-z0-9+/=]{32,}/,
  },
  {
    // Same leading-boundary guard as the OpenAI/Anthropic entries (#274).
    // Without it, `ri|sk_live_`, `netwo|rk_test_`, `wo|rk_test_` fuse inside
    // ordinary identifiers (#280). Body stays a hyphen-free class; the
    // defect is the missing boundary, not a permissive body.
    name: "Stripe secret/restricted key",
    pattern: /(?<![A-Za-z0-9_-])[sr]k_(?:live|test)_[A-Za-z0-9]{24,}/,
  },
  {
    name: "SendGrid API key",
    pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
  },
  {
    name: "Twilio Account SID",
    pattern: /\bAC[0-9a-f]{32}\b/,
  },
  {
    // Left boundary omitted deliberately (#280). A fused `npm_` needs 36
    // consecutive alphanumerics after it, which ordinary identifiers do not
    // produce. Same class as Stripe's missing boundary, not realistic here.
    name: "npm publish token",
    pattern: /npm_[A-Za-z0-9]{36}/,
  },
];

/**
 * Returns true if the content contains any known secret pattern.
 */
export function containsSecret(content: string): boolean {
  return SECRET_PATTERNS.some(({ pattern }) => pattern.test(content));
}

/**
 * Returns the names of all secret patterns matched in the content.
 * Used for logging/diagnostics without exposing the matched value.
 */
export function findSecrets(content: string): string[] {
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(content)).map(
    ({ name }) => name
  );
}
