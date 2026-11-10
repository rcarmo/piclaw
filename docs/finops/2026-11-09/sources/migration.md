---
title: Claude Fable 5.2 and Claude Mythos 5.2 migration guide
url: https://platform.claude.com/docs/en/models/fable-5-2/migration-guide
description: Switch to Claude Fable 5.2 and Claude Mythos 5.2 from Claude Fable 5.1, Claude Mythos 5.1, Claude Opus 5.5, or an earlier Claude Fable, Claude Mythos, or Claude Opus model with this migration guide. The guidance to enable Claude Fable 5.2 and Claude Mythos 5.2 includes model IDs, breaking changes, and migration checklists.
---

<Note>
  This guide covers migrating [Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages) code. If you use [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), no changes beyond updating the model name are required.
</Note>

Let Claude Code migrate your code for you

```text
/claude-api migrate this project to claude-fable-5-2
```

If your Claude Managed Agents agent has an advisor, the advisor’s `model` is a second model name to update: set it to `claude-fable-5-2` or `claude-mythos-5-2` when you change the agent’s model. See [A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-advisor-pairs).

The following sections cover moving to Claude Fable 5.2, or to Claude Mythos 5.2, from Claude Fable 5.1, Claude Mythos 5.1, Claude Opus 5.5, or an earlier Claude Fable, Claude Mythos, or Claude Opus model. For the changes themselves, see [What’s new in Claude Fable 5.2](https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2). For behavioral differences and model-specific prompting patterns, see [Prompting Claude Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2).

Claude Fable 5.2 is available on the Claude API, [Claude Platform on AWS](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws), and [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed). It’s also available on [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed). [Claude Mythos 5.2](https://platform.claude.com/docs/en/models/mythos-5-2/overview) has the same capabilities and is available only to organizations verified through Anthropic’s verification programs, such as the [Cyber Verification Program](https://support.claude.com/en/articles/14604842).

The baseline settings shared by `claude-fable-5-2` and `claude-mythos-5-2`:

* **Thinking:** [Adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) is always on, unchanged from Claude Fable 5.1. The model determines when and how much to think, and the [effort](https://platform.claude.com/docs/en/build-with-claude/effort) parameter controls how deeply. Both `thinking: {type: "disabled"}` and manual extended thinking (`thinking: {type: "enabled", budget_tokens: N}`) return a 400 error.
* **Effort:** All five [effort](https://platform.claude.com/docs/en/build-with-claude/effort) levels are supported, and the default is `high`, unchanged from Claude Fable 5.1. See [Recommended effort levels for Claude Fable 5.2](https://platform.claude.com/docs/en/build-with-claude/effort#recommended-effort-levels-for-claude-fable-5-2).
* **Prefill:** Prefilling the assistant message returns a 400 error, unchanged from Claude Fable 5.1. Use system prompt instructions instead.
* **Sampling parameters:** Omit `temperature`, `top_p`, and `top_k`, as on Claude Fable 5.1. See [Sampling parameters](https://platform.claude.com/docs/en/build-with-claude/thinking#sampling-parameters) for the values that return a 400 error.
* **Tool choice:** `{type: "auto"}` (the default) and `{type: "none"}` are supported. Forcing a tool call with `{type: "any"}` or `{type: "tool", name: "..."}` returns a 400 error, unchanged from Claude Fable 5.1.
* **Structured outputs:** In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek) (CMEK), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) aren’t available for either model, as for Claude Fable 5.1. That covers both strict tool use and JSON outputs. If your requests set `strict: true` or `output_config.format` there, remove them and validate the output in your code.
* **Preserved thinking across models:** On the Claude API and Claude Models on Google Cloud (Google managed), Claude Fable 5.2 and Claude Mythos 5.2 read each other’s thinking blocks and those from other models, including Claude Opus 5.5, Claude Sonnet 5.5, and Claude Haiku 5.5. No other model reads their blocks. See [Switching models mid-conversation](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#switching-models) for the list.
* **Account-bound thinking:** Thinking blocks from Claude Fable 5.2 and Claude Mythos 5.2 work only in the account that produced them, or in an account linked to it. When another account sends one of these blocks, the API drops the block before the model receives it, and the request succeeds. On the Claude API and Claude Models on Google Cloud (Google managed), with the `thinking-binding-controls-2026-08-01` beta header, the response lists each dropped block in `input_transformations` with `reason: "organization_binding_mismatch"`. See [Thinking blocks stay with the account that produced them](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#account-bound-thinking).
* **Context window and output:** A [1M token context window](https://platform.claude.com/docs/en/build-with-claude/context-windows) by default, and up to 128k output tokens for each request.
* **Pricing:** $8 USD per million input tokens and $40 USD per million output tokens, compared with $10 USD and $50 USD on Claude Fable 5.1 and Claude Mythos 5.1. Prompt cache reads are $0.20 USD per million tokens, compared with $0.25 USD on those models. See [Pricing](https://platform.claude.com/docs/en/about-claude/pricing).
* **Data retention:** Both models require 30-day data retention, aren’t available under zero data retention (ZDR) arrangements unless expressly authorized by Anthropic, and are designated Covered Models, the same as Claude Fable 5.1 and Claude Mythos 5.1. On the Claude API, a request from an organization or workspace without 30-day retention returns a 400 `invalid_request_error`. Organizations with a ZDR arrangement should contact their Anthropic account team, or configure retention for individual workspaces. See [Model-specific data retention requirements](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements) for per-platform details.
* **Priority Tier:** Neither model is supported on [Priority Tier](https://platform.claude.com/docs/en/api/service-tiers#supported-models).
* **Fast mode:** Both models support [fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) in Messages API requests. [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists each model’s platforms.

Where the two models diverge:

* **Availability:** On the Claude API, Claude Fable 5.2 doesn’t require access approval. Claude Mythos 5.2 is available only to organizations verified through Anthropic’s verification programs, such as the [Cyber Verification Program](https://support.claude.com/en/articles/14604842). To request access, apply to the program that covers your use case, or contact your Anthropic account team.
* **Rate limits:** Claude Fable 5.2 has its own rate limit, separate from the combined limit that Claude Fable 5.1 and Claude Fable 5 share. Claude Mythos 5.2 shares one combined limit with Claude Mythos 5.1 and Claude Mythos 5. See [Rate limits](https://platform.claude.com/docs/en/api/rate-limits#rate-limits).

## Migrating to Claude Fable 5.2 from Claude Fable 5.1

Migration is mostly drop-in. The API surface, always-on adaptive thinking, the forced tool choice restriction, refusal handling, `stop_details` categories, and the data retention requirement all match Claude Fable 5.1. Claude Fable 5.2 costs less: $8 USD per million input tokens and $40 USD per million output tokens, compared with $10 USD and $50 USD on Claude Fable 5.1. Four changes can break your code. The [prefix check](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#prefix-check), which catches edits to earlier turns, applies to every account. Claude Fable 5.1 can’t read Claude Fable 5.2’s thinking blocks. The earlier computer use tool, `computer_20251124`, returns a 400 error. With the advisor tool, a Claude Fable 5.2 executor accepts only Claude Fable 5.2 or Claude Mythos 5.2 as its advisor.

### Update your model name

```python
model = "claude-fable-5-1"  # Before
model = "claude-fable-5-2"  # After
```

The model ID is `claude-fable-5-2` on every platform. For each platform’s ID, see the [Claude Fable 5.2](https://platform.claude.com/docs/en/models/fable-5-2/overview) model page.

### Breaking changes

1. **The prefix check applies to every account:** Each `thinking` block from Claude Fable 5.2 is valid only against the `system` prompt, `tools`, and conversation history that preceded it, as on Claude Fable 5.1. Claude Fable 5.2 enforces this [prefix check](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#prefix-check) for every account, whatever its age. Claude Fable 5.1 enforces it by default for accounts created on or after August 31, 2026. So on an older account, requests that pass on Claude Fable 5.1 can fail on Claude Fable 5.2.

   Nothing changes for you if Claude Code, claude.ai, [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), or the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) manages your conversation history. If your code builds the `messages` array itself, compare what it does between requests with the list in [Who the prefix check affects](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#who-is-affected). A request that sends a thinking block back after one of those edits returns a 400 error:

   ```text wrap
   messages.5.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block". That setting requires the `thinking-binding-controls-2026-08-01` value in the `anthropic-beta` header.
   ```

   Retrying the same request body doesn’t clear the error. To find these edits before you switch production traffic, run the check in [Check whether your code edits the prefix](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#how-to-tell-whether-your-integration-is-impacted) against the model you use now, Claude Fable 5.1 or Claude Opus 5.5. It works from any account, because setting `prefix_mismatch_behavior` opts the request into the check. [Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking) gives the fix for each pattern.

   In production, leave `prefix_mismatch_behavior` at its default, `"error"`, if a mismatch can only mean a bug in your code. To drop the affected blocks and continue without that reasoning while you fix the edit, set it to `"drop_block"`. Treat that as a stopgap, not a long-term setting: [dropping blocks can raise output tokens](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#drop-block-cost).

2. **Claude Fable 5.1 can’t read Claude Fable 5.2’s thinking blocks:** On the Claude API and Claude Models on Google Cloud (Google managed), Claude Fable 5.2 reads Claude Fable 5.1’s blocks, so a conversation that moves from `claude-fable-5-1` onto `claude-fable-5-2` keeps its earlier reasoning. In the other direction, Claude Fable 5.1 can’t read Claude Fable 5.2’s blocks. If a router switch, a client-side retry, or a [classifier refusal fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback) moves a conversation from Claude Fable 5.2 to another model, Claude Fable 5.1 included, the API drops the blocks that model can’t read. The request succeeds, and you aren’t billed for the dropped input tokens. The model then works without that reasoning, which can raise cost and latency on the first turn after the switch. With the `thinking-binding-controls-2026-08-01` beta header, `input_transformations` lists each dropped block with `reason: "model_binding_mismatch"`. See [Switching models mid-conversation](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#switching-models).

3. **Use the computer use toolset instead of `computer_20251124`:** A `tools` entry of type `computer_20251124` returns a 400 error. Declare the `computer_toolset_20260801` toolset instead: drop the beta header and send the entry with no `name` or display dimensions. Then update your agent loop for the toolset, as [Migrate from `computer_20251124`](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool#migrate-from-computer-20251124) describes.

4. **A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor:** With the [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool), which is in beta, the advisor must be at least as capable as the executor. A Claude Fable 5.2 or Claude Mythos 5.2 executor accepts only Claude Fable 5.2 or Claude Mythos 5.2 as its advisor, and any other advisor, including Claude Fable 5.1 and Claude Mythos 5.1, returns a 400 `invalid_request_error`. When you change the executor’s model ID, set the `model` in the advisor tool definition to `claude-fable-5-2` or `claude-mythos-5-2`. Changing the advisor’s `model` is an edit to `tools`, so make the change in new conversations. A request that sends earlier thinking blocks back after the change fails the prefix check (see [The prefix check applies to every account](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-preserved-thinking)) and returns a 400 error, unless you set `prefix_mismatch_behavior` to `"drop_block"`. To keep your current executor and change only the advisor, set the advisor’s `model` to `claude-fable-5-2`: every executor model accepts it. A Claude Fable 5.2 advisor returns its advice encrypted, so if your code reads the advice text, see [Result variants](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool#result-variants). The same pairs apply to the advisor of a [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) agent, so set that advisor’s `model` to one of these two models when you change the agent’s. See [Model compatibility](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool#model-compatibility) and [Give the session an advisor](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration#give-the-session-an-advisor).

### Behavior changes

1. **Prompt lines that ask for less thinking don’t stop the model from thinking at `medium` effort and above:** Claude Fable 5.1 usually follows a line such as “answer directly without deliberating.” In Anthropic’s testing, such a line didn’t stop Claude Fable 5.2 from thinking at `medium` and above. Remove these lines and lower the effort level. See [Calibrate effort](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#calibrate-effort).
2. **The model can start subagents to review its own work at higher effort:** In an agentic coding product at higher effort levels, such as `xhigh` and `max`, Anthropic observed Claude Fable 5.2 using subagents to review its own work. Claude Fable 5.1 didn’t do this on the same tasks. Subagents can account for a large part of what a session costs. See [Set expectations for subagents](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#set-expectations-for-subagents).
3. **A small `max_tokens` can leave no room for text:** Thinking tokens count toward `max_tokens`, so a request with a small `max_tokens` can stop with `stop_reason: "max_tokens"` after a `thinking` block and before any text. A prompt line that usually keeps Claude Fable 5.1 from thinking doesn’t keep Claude Fable 5.2 from thinking at `medium` effort and above. So a request that relied on such a line to fit a small `max_tokens` on Claude Fable 5.1 can run out of tokens before any text on Claude Fable 5.2. Raise `max_tokens` to leave room for thinking, or choose a lower [effort](https://platform.claude.com/docs/en/build-with-claude/effort) level.

For the other behaviors to check when you carry prompts over, see [Behavior differences](https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2#behavior-differences).

### Migration checklist

* Update the model name from `claude-fable-5-1` to `claude-fable-5-2`.
* Check your [rate limits](https://platform.claude.com/docs/en/api/rate-limits#rate-limits) before you move production traffic. Claude Fable 5.2 has its own rate limit, separate from the one Claude Fable 5.1 and Claude Fable 5 share.
* If you use computer use through `computer_20251124`, Claude Fable 5.2 returns a 400 error for that tool. Declare `computer_toolset_20260801` instead and update your agent loop for the toolset.
* If you use the advisor tool with Claude Fable 5.2 as the executor, set the advisor’s `model` to `claude-fable-5-2` or `claude-mythos-5-2`.
* If your code builds the `messages` array itself, run a session with the `thinking-binding-controls-2026-08-01` beta header and `prefix_mismatch_behavior: "drop_block"`, log `input_transformations`, and fix every `prefix_binding_mismatch` entry. Do this even if your account never hit the check on Claude Fable 5.1.
* Pick a production `prefix_mismatch_behavior`: `"error"` (the default), or `"drop_block"` as a stopgap while you fix the edits, because [dropping blocks can raise output tokens](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#drop-block-cost). Monitor the 400 errors or the `input_transformations` entries.
* Keep passing `thinking` blocks back unchanged on every turn, including empty ones. If a router or fallback can move a conversation from Claude Fable 5.2 to Claude Fable 5.1, expect Claude Fable 5.1 to run without Claude Fable 5.2’s blocks.
* If you replay stored conversations through a different account, replay each one through the account that produced it, or an account linked to it. The API drops Claude Fable 5.2 thinking blocks that another account produced. See [Thinking blocks stay with the account that produced them](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#account-bound-thinking).
* Re-run your [effort sweep](https://platform.claude.com/docs/en/build-with-claude/effort#recommended-effort-levels-for-claude-fable-5-2) on your own evals, and re-baseline cost and latency.
* Check the system prompts, skills, and other instructions you carry over against [Review instructions written for earlier models](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#review-instructions-written-for-earlier-models).

## Migrating to Claude Mythos 5.2 from Claude Mythos 5.1

[Claude Mythos 5.2](https://platform.claude.com/docs/en/models/mythos-5-2/overview) is the counterpart to Claude Fable 5.2 for organizations verified through Anthropic’s verification programs, such as the [Cyber Verification Program](https://support.claude.com/en/articles/14604842). Confirm that your organization has access to Claude Mythos 5.2 before you switch model IDs.

Claude Mythos 5.2 enforces the [prefix check](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#prefix-check) for every account, as Claude Fable 5.2 does. [When `prefix_mismatch_behavior` is unset](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#enforcement) shows where Claude Mythos 5.1 already returns the error. If your code edits earlier turns, see [Editing earlier turns invalidates thinking blocks](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-edited-history) for what to change and how to test, and run the test against `claude-mythos-5-2`.

On the Claude API and Claude Models on Google Cloud (Google managed), Claude Mythos 5.2 reads Claude Mythos 5.1’s thinking blocks, so a conversation that moves from `claude-mythos-5-1` onto `claude-mythos-5-2` keeps its earlier reasoning. In the other direction, Claude Mythos 5.1 can’t read Claude Mythos 5.2’s blocks: the API drops them, and the request succeeds. See [Switching models mid-conversation](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#switching-models).

With the [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool), which is in beta, a Claude Mythos 5.2 executor accepts only Claude Mythos 5.2 or Claude Fable 5.2 as its advisor. A Claude Mythos 5.1 or Claude Fable 5.1 advisor returns a 400 error. See [A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-advisor-pairs).

Claude Mythos 5.2 supports computer use through the `computer_toolset_20260801` toolset. A `tools` entry of type `computer_20251124` returns a 400 error. See [Use the computer use toolset instead of `computer_20251124`](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-computer-use).

Claude Mythos 5.2 costs $8 USD per million input tokens and $40 USD per million output tokens, compared with $10 USD and $50 USD on Claude Mythos 5.1. Prompt cache reads are $0.20 USD per million tokens, compared with $0.25 USD.

### Update your model name

```python
model = "claude-mythos-5-1"  # Before
model = "claude-mythos-5-2"  # After
```

### Migration checklist

* Update the model name from `claude-mythos-5-1` to `claude-mythos-5-2`.
* If you use computer use through `computer_20251124`, Claude Mythos 5.2 returns a 400 error for that tool. Declare `computer_toolset_20260801` instead and update your agent loop for the toolset.
* If you use the advisor tool with Claude Mythos 5.2 as the executor, set the advisor’s `model` to `claude-mythos-5-2` or `claude-fable-5-2`.
* Keep passing `thinking` blocks back unchanged on every turn, including empty ones.
* If you replay stored conversations through a different account, replay each one through the account that produced it, or an account linked to it. The API drops Claude Mythos 5.2 thinking blocks that another account produced. See [Thinking blocks stay with the account that produced them](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#account-bound-thinking).
* If your code builds the `messages` array itself, run the check in [Editing earlier turns invalidates thinking blocks](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-edited-history) against `claude-mythos-5-2`, fix every `prefix_binding_mismatch` entry, and keep conversation history append-only (see [What counts as an edit](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#what-counts-as-an-edit)). An append-only history also keeps the prompt cache warm.
* Handle `stop_reason: "refusal"` and read `stop_details.category` before response content. See [Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback).
* Re-run your effort sweep, and re-baseline cost and latency.
* Check the system prompts, skills, and other instructions you carry over against [Review instructions written for earlier models](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#review-instructions-written-for-earlier-models).

## Migrating to Claude Fable 5.2 from Claude Opus 5.5

Claude Fable 5.2 uses the same Messages API and tool use patterns as [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview). Both models always think adaptively and return a 400 error for forced tool choice, so those parts of your requests carry over. The following differences apply when you move traffic, or a fallback path, onto Claude Fable 5.2.

### Update your model name

```python
model = "claude-opus-5-5"  # Before
model = "claude-fable-5-2"  # After
```

### What changes

1. **Data retention is required:** Claude Fable 5.2 requires 30-day data retention and isn’t available under a zero data retention (ZDR) arrangement unless expressly authorized by Anthropic. If your organization or workspace runs Claude Opus 5.5 under ZDR, enable 30-day retention for a workspace or contact your Anthropic account team before you switch. Otherwise, on the Claude API, every request to Claude Fable 5.2 returns a 400 `invalid_request_error`. See [Model-specific data retention requirements](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements).

2. **The prefix check applies to every account:** Claude Opus 5.5 enforces the prefix check by default for accounts created on or after August 31, 2026. Claude Fable 5.2 enforces it for every account, whatever its age. If your account is older and your code edits earlier turns, requests that work on Claude Opus 5.5 fail on Claude Fable 5.2. To test before you switch, see [The prefix check applies to every account](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-preserved-thinking).

3. **Claude Opus 5.5 can’t read Claude Fable 5.2’s thinking blocks:** A conversation that moves from Claude Fable 5.2 to Claude Opus 5.5 keeps its text and tool calls, but the turns after the switch run without Claude Fable 5.2’s reasoning. The API drops those blocks before the model receives them, the request succeeds, and the dropped blocks aren’t billed. Expect higher cost and latency on the first turn after the switch. In the other direction, on the Claude API and Claude Models on Google Cloud (Google managed), Claude Fable 5.2 reads Claude Opus 5.5’s thinking blocks, so a conversation that moves from `claude-opus-5-5` onto `claude-fable-5-2` keeps its earlier reasoning.

4. **Safety classifiers and fallback:** Claude Fable 5.2 runs safety classifiers covering the same `stop_details` categories as Claude Fable 5.1. Handle every category in the [refusal category table](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#refusal-response), not only the ones you’ve seen from Claude Opus 5.5. To re-run declined requests on another model, set `fallbacks: "default"`, which retries on the model Anthropic recommends for that category, or build your own retry. That parameter is in beta on the Claude API and Claude Models on Google Cloud (Anthropic managed), and needs the `server-side-fallback-2026-07-01` beta header. The permitted fallback targets for Claude Fable 5.2 are Claude Opus 4.8 (`claude-opus-4-8`) and Claude Opus 5 (`claude-opus-5`). Server-side fallback doesn’t retry a request declined with `"reasoning_extraction"`. That refusal comes back to you. The fallback model doesn’t receive Claude Fable 5.2’s thinking blocks. See [Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback).

5. **Pricing:** Claude Fable 5.2 costs $8 USD per million input tokens and $40 USD per million output tokens, compared with $4 USD and $20 USD for Claude Opus 5.5. Prompt cache reads are $0.20 USD per million tokens on both models. See [Pricing](https://platform.claude.com/docs/en/about-claude/pricing).

6. **Fast mode:** Claude Fable 5.2 supports [fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) (`speed: "fast"`) in Messages API requests on the Claude API, as Claude Opus 5.5 does. Fast mode for Claude Fable 5.2 costs $16 USD per million input tokens and $80 USD per million output tokens, compared with $8 USD and $40 USD for Claude Opus 5.5 in fast mode. See [Fast mode pricing](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing).

   Claude Fable 5.2 also supports fast mode on [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed), with the same `speed: "fast"` setting.

   Claude Fable 5.2 also supports fast mode on [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed), with the same `speed: "fast"` setting. Google Cloud sets its prices there. See [Cloud platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing).

   Claude Mythos 5.2 also supports fast mode in Messages API requests on the Claude API, at Claude Fable 5.2’s fast mode prices. [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists every platform where Claude Mythos 5.2 has fast mode.

   Remove `speed: "fast"` in Claude Managed Agents. Also remove it on any platform or hosting option where [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) doesn’t list the model you move to.

7. **Structured outputs in CMEK organizations:** In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), Claude Opus 5.5 supports [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) and Claude Fable 5.2 doesn’t. Remove `strict: true` and `output_config.format` from requests you move, and validate the output in your code.

8. **The default effort is `high`:** Claude Opus 5.5 defaults to `medium`, so a request that omits `effort` runs one level higher on Claude Fable 5.2. The request succeeds, and the change shows up only as different cost, latency, and results. Set `effort` explicitly, then re-run your [effort sweep](https://platform.claude.com/docs/en/build-with-claude/effort#recommended-effort-levels-for-claude-fable-5-2) on your own evals.

9. **A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor:** With the [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool), which is in beta, a Claude Opus 5.5 executor accepts several advisors, Claude Opus 5.5 and Claude Fable 5.1 among them. A Claude Fable 5.2 executor accepts only Claude Fable 5.2 or Claude Mythos 5.2, and any other advisor returns a 400 error. Set the advisor’s `model` to `claude-fable-5-2` or `claude-mythos-5-2` when you change the executor’s. See [A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-advisor-pairs).

### Migration checklist

* If your organization has a ZDR arrangement, enable 30-day retention for the workspace, or confirm eligibility with your Anthropic account team, before anything else.
* Update the model ID from `claude-opus-5-5` to `claude-fable-5-2`.
* Check your [rate limits](https://platform.claude.com/docs/en/api/rate-limits#rate-limits) before you move production traffic. Claude Fable 5.2’s rate limit is separate from Claude Opus 5.5’s, with lower token limits at each tier.
* If your code builds the `messages` array itself, run the test in [The prefix check applies to every account](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-preserved-thinking), even if your account never hit the check on Claude Opus 5.5.
* Handle every `stop_details.category`. If you set an explicit `fallbacks` list, name only Claude Fable 5.2’s permitted targets.
* If a router or fallback moves conversations from Claude Fable 5.2 to Claude Opus 5.5, expect the turns after the switch to run without Claude Fable 5.2’s thinking blocks.
* If you replay stored conversations through a different account, replay each one through the account that produced it, or an account linked to it. The API drops Claude Fable 5.2 thinking blocks that another account produced. See [Thinking blocks stay with the account that produced them](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#account-bound-thinking).
* If you use fast mode in Messages API requests, keep `speed: "fast"` only on a platform or hosting option where [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists the model you move to. On those platforms and hosting options, re-baseline cost against the [fast mode prices](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing). On every other platform or hosting option, and in Claude Managed Agents, remove `speed: "fast"`. You don’t need the `fast-mode-2026-02-01` beta header. On the Claude API, requests that send it keep working.
* If you use the advisor tool with Claude Fable 5.2 as the executor, set the advisor’s `model` to `claude-fable-5-2` or `claude-mythos-5-2`.
* In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), remove `strict: true` and `output_config.format`, and validate the output in your code.
* Set `effort` explicitly: Claude Fable 5.2’s default is `high`, where Claude Opus 5.5’s is `medium`, so a request that omits it runs one level higher. Then re-run your [effort sweep](https://platform.claude.com/docs/en/build-with-claude/effort#recommended-effort-levels-for-claude-fable-5-2) on your own evals, and re-baseline cost and latency.
* Check the system prompts, skills, and other instructions you carry over against [Review instructions written for earlier models](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#review-instructions-written-for-earlier-models).

## Migrating to Claude Fable 5.2 from Claude Fable 5

The API surface, context window and output limits, tokenizer, always-on adaptive thinking, and refusal handling all match Claude Fable 5. Some of the following changes also apply when you move from Claude Mythos 5 to Claude Mythos 5.2. [Migrating to Claude Mythos 5.2 from Claude Mythos 5](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#migrating-from-claude-mythos-5-to-claude-mythos-5-2) says which ones.

### Update your model name

```python
model = "claude-fable-5"  # Before
model = "claude-fable-5-2"  # After
```

### Breaking changes

1. **Forced tool choice returns a 400 error:** Claude Fable 5 accepts `tool_choice` `auto`, `none`, `any`, and `tool`. On `claude-fable-5-2`, `{type: "any"}` and `{type: "tool", name: "..."}` return a 400 `invalid_request_error`, and so does the [token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) endpoint. See [Forced tool use not supported](https://platform.claude.com/docs/en/api/errors#forced-tool-use-not-supported) for the error message.

   To get the tool call without forcing it, leave `tool_choice` at `auto` and name the tool in your instruction. Set `strict: true` on the tool so the call matches your schema. See [Strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use). If you forced a tool only to get schema-valid JSON, use [JSON outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#usage) instead. In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) aren’t available for Claude Fable 5.2 or Claude Mythos 5.2. That covers both strict tool use and JSON outputs. There, keep `auto` and the instruction, leave out `strict`, and validate the tool input in your code.

   If your application requires a specific tool call on the current turn, append a [mid-conversation system message](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages) after the latest `user` turn. Name the tool, say that the call is required for this turn, and tell Claude to open its response with it. Earlier turns stay unchanged, so their prompt cache hits and thinking blocks stay valid. [Mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages) lists the platforms where they’re available. For a turn that must not call tools, `tool_choice: {"type": "none"}` still works. See [Forcing tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#forcing-tool-use).

2. **Editing earlier turns invalidates thinking blocks, on every account:** Claude Fable 5 doesn’t check whether earlier turns changed. On Claude Fable 5.2, each `thinking` block is valid only against the `system` prompt, `tools`, and messages that came before it. Claude Fable 5.2 enforces this [prefix check](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#prefix-check) for every account. A request that sends a thinking block back after any of those changed returns a 400 error, and retrying the same request body doesn’t clear it.

   Nothing changes for you if Claude Code, claude.ai, [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview), or the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) manages your conversation history. If your code builds the `messages` array itself, keep the history append-only. Freeze `system` and `tools` for the session. Make instruction and tool changes with [mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages), and trim context with server-side [compaction](https://platform.claude.com/docs/en/build-with-claude/compaction) or [context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing). [Mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages) lists the platforms where they’re available. [Make changes without editing the prefix](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#replace-prefix-edits) gives the replacement for each common edit.

   To find these edits before you switch production traffic, run the check in [Check whether your code edits the prefix](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#how-to-tell-whether-your-integration-is-impacted) against `claude-fable-5-2`. In production, leave `prefix_mismatch_behavior` at its default, `"error"`, if a mismatch can only mean a bug in your code. To drop the affected blocks and continue without that reasoning while you fix the edit, set it to `"drop_block"` with the `thinking-binding-controls-2026-08-01` beta header. Treat that as a stopgap, not a long-term setting: [dropping blocks can raise output tokens](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#drop-block-cost).

3. **Claude Fable 5 can’t read Claude Fable 5.2’s thinking blocks:** On the Claude API and Claude Models on Google Cloud (Google managed), Claude Fable 5.2 reads Claude Fable 5’s blocks, so a conversation that moves from `claude-fable-5` onto `claude-fable-5-2` keeps its earlier reasoning. In the other direction, Claude Fable 5 can’t read Claude Fable 5.2’s blocks. If a router switch, a client-side retry, or a [classifier refusal fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback) moves a conversation from Claude Fable 5.2 to another model, Claude Fable 5 included, the API drops the blocks that model can’t read. The request succeeds, and you aren’t billed for the dropped input tokens. With the `thinking-binding-controls-2026-08-01` beta header, `input_transformations` lists each dropped block with `reason: "model_binding_mismatch"`. See [Switching models mid-conversation](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#switching-models).

4. **Use the computer use toolset instead of `computer_20251124`:** On Claude Fable 5.2, a `tools` entry of type `computer_20251124` returns a 400 error. Claude Fable 5 accepts it with its beta header. Declare the `computer_toolset_20260801` toolset instead, as [Use the computer use toolset instead of `computer_20251124`](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-computer-use) describes.

5. **A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor:** With the [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool), which is in beta, a Claude Fable 5.2 executor accepts only Claude Fable 5.2 or Claude Mythos 5.2 as its advisor. The other advisors a Claude Fable 5 executor accepts, such as Claude Fable 5 and Claude Opus 5.5, return a 400 error. Set the advisor’s `model` to `claude-fable-5-2` or `claude-mythos-5-2` when you change the executor’s. See [A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-advisor-pairs).

### Other changes

* **Pricing:** $8 USD per million input tokens and $40 USD per million output tokens, compared with $10 USD and $50 USD on Claude Fable 5. Prompt cache reads are $0.20 USD per million tokens, compared with $1 USD. See [Pricing](https://platform.claude.com/docs/en/about-claude/pricing).
* **Priority Tier:** Claude Fable 5.2 isn’t supported on [Priority Tier](https://platform.claude.com/docs/en/api/service-tiers#supported-models). Claude Fable 5 is. If your organization has a Priority Tier commitment, plan capacity separately.
* **Per-message effort (beta):** To change effort partway through a conversation without losing prompt cache hits, send a [per-message effort](https://platform.claude.com/docs/en/build-with-claude/effort#change-effort-mid-conversation-beta) `role: "system"` message instead of changing `output_config.effort` between requests. That section lists the platforms where it’s available.

### Migration checklist

* Update the model name from `claude-fable-5` to `claude-fable-5-2`.
* Check your [rate limits](https://platform.claude.com/docs/en/api/rate-limits#rate-limits) before you move production traffic. Claude Fable 5.2 has its own rate limit, separate from the one Claude Fable 5.1 and Claude Fable 5 share.
* Replace forced `tool_choice` (`{type: "any"}` or `{type: "tool", ...}`) with `{type: "auto"}` plus an explicit instruction and `strict: true` tools, or with JSON outputs. Put the instruction in the `user` turn. When your application requires the call, put it in a mid-conversation `role: "system"` message instead, on the platforms that [Mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages) lists. In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), strict tool use and JSON outputs aren’t available for Claude Fable 5.2. There, keep `{type: "auto"}` and the instruction, and validate the tool input in your code.
* If your code builds the `messages` array itself, run a session with the `thinking-binding-controls-2026-08-01` beta header and `prefix_mismatch_behavior: "drop_block"`, log `input_transformations`, and fix every `prefix_binding_mismatch` entry. `model_binding_mismatch` entries after a model switch are expected.
* Keep the history append-only: freeze `system` and `tools` at session start, make mid-session changes with `role: "system"` messages, and trim context on the server. [Mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages) lists the platforms where they’re available.
* Pick a production `prefix_mismatch_behavior`: `"error"` (the default), or `"drop_block"` as a stopgap while you fix the edits, because [dropping blocks can raise output tokens](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#drop-block-cost). Monitor the 400 errors or the `input_transformations` entries.
* Keep passing `thinking` blocks back unchanged on every turn, including empty ones. If a router or fallback can move a conversation from Claude Fable 5.2 to Claude Fable 5, expect Claude Fable 5 to run without Claude Fable 5.2’s blocks.
* If you replay stored conversations through a different account, replay each one through the account that produced it, or an account linked to it. The API drops Claude Fable 5.2 thinking blocks that another account produced. See [Thinking blocks stay with the account that produced them](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#account-bound-thinking).
* If you use computer use through `computer_20251124`, Claude Fable 5.2 returns a 400 error for that tool. Declare `computer_toolset_20260801` instead and update your agent loop for the toolset.
* If you use the advisor tool with Claude Fable 5.2 as the executor, set the advisor’s `model` to `claude-fable-5-2` or `claude-mythos-5-2`.
* If you change effort between requests, move the change to a per-message effort `role: "system"` message, which is in beta, where your platform supports it.
* If your organization has a Priority Tier commitment, plan capacity separately.
* Handle `stop_reason: "refusal"` and read `stop_details.category`. Consider `fallbacks: "default"`, in beta on the Claude API and Claude Models on Google Cloud (Anthropic managed).
* Re-run your [effort sweep](https://platform.claude.com/docs/en/build-with-claude/effort#recommended-effort-levels-for-claude-fable-5-2) on your own evals, and re-baseline cost and latency.
* Check the system prompts, skills, and other instructions you carry over against [Review instructions written for earlier models](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#review-instructions-written-for-earlier-models).

## Migrating to Claude Mythos 5.2 from Claude Mythos 5

[Claude Mythos 5.2](https://platform.claude.com/docs/en/models/mythos-5-2/overview) is the counterpart to Claude Fable 5.2 for organizations verified through Anthropic’s verification programs, such as the [Cyber Verification Program](https://support.claude.com/en/articles/14604842). Confirm that your organization has access to Claude Mythos 5.2 before you switch model IDs.

Four of the changes in [Migrating to Claude Fable 5.2 from Claude Fable 5](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#migrating-from-claude-fable-5-to-claude-fable-5-2) apply as written:

* [Forced tool choice returns a 400 error](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-forced-tool-choice).
* [Editing earlier turns invalidates thinking blocks](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-edited-history) (for every account).
* [Use the computer use toolset instead of `computer_20251124`](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-computer-use).
* A Claude Fable 5.2 or Claude Mythos 5.2 executor [needs one of those two models as its advisor](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-advisor-pairs).

On the Claude API and Claude Models on Google Cloud (Google managed), Claude Mythos 5.2 reads Claude Mythos 5’s thinking blocks, so a conversation that moves from `claude-mythos-5` onto `claude-mythos-5-2` keeps its earlier reasoning. In the other direction, Claude Mythos 5 can’t read Claude Mythos 5.2’s blocks: the API drops them, and the request succeeds. See [Switching models mid-conversation](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#switching-models). Claude Mythos 5.2 costs $8 USD per million input tokens and $40 USD per million output tokens, compared with $10 USD and $50 USD on Claude Mythos 5. Prompt cache reads are $0.20 USD per million tokens, compared with $1 USD.

### Update your model name

```python
model = "claude-mythos-5"  # Before
model = "claude-mythos-5-2"  # After
```

### Migration checklist

* Update the model name from `claude-mythos-5` to `claude-mythos-5-2`.
* Replace forced `tool_choice` (`any` or `tool`) with `auto` plus an explicit instruction and `strict: true` tools, or with JSON outputs. In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), strict tool use and JSON outputs aren’t available for Claude Mythos 5.2. There, keep `auto` and the instruction, and validate the tool input in your code.
* If you use computer use through `computer_20251124`, Claude Mythos 5.2 returns a 400 error for that tool. Declare `computer_toolset_20260801` instead and update your agent loop for the toolset.
* If you use the advisor tool with Claude Mythos 5.2 as the executor, set the advisor’s `model` to `claude-mythos-5-2` or `claude-fable-5-2`.
* Keep passing `thinking` blocks back unchanged on every turn, including empty ones.
* If you replay stored conversations through a different account, replay each one through the account that produced it, or an account linked to it. The API drops Claude Mythos 5.2 thinking blocks that another account produced. See [Thinking blocks stay with the account that produced them](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#account-bound-thinking).
* If your code builds the `messages` array itself, run the check in [Editing earlier turns invalidates thinking blocks](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-edited-history) against `claude-mythos-5-2`, fix every `prefix_binding_mismatch` entry, and keep conversation history append-only (see [What counts as an edit](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#what-counts-as-an-edit)). An append-only history also keeps the prompt cache warm.
* Handle `stop_reason: "refusal"` and read `stop_details.category` before response content. See [Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback).
* Re-run your effort sweep, and re-baseline cost and latency.
* Check the system prompts, skills, and other instructions you carry over against [Review instructions written for earlier models](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#review-instructions-written-for-earlier-models).

## Migrating to Claude Fable 5.2 from Claude Opus 5

Claude Fable 5.2 uses the same [Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages) and [tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) patterns as [Claude Opus 5](https://platform.claude.com/docs/en/models/opus-5/overview). The 1M token context window, 128k max output tokens, the 512-token prompt caching minimum, and [mid-conversation system messages](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages) carry over. So do the restrictions on prefill and sampling parameters. The following differences apply when you move traffic, or a fallback path, onto Claude Fable 5.2.

### Update your model name

```python
model = "claude-opus-5"  # Before
model = "claude-fable-5-2"  # After
```

### What changes

1. **Thinking can’t be disabled:** Claude Opus 5 accepts `thinking: {type: "disabled"}` at an [effort](https://platform.claude.com/docs/en/build-with-claude/effort) level of `high` or lower. On Claude Fable 5.2, [adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) is always on, and `thinking: {type: "disabled"}` returns a 400 error at any effort level. Remove the field, and control token spend with lower effort levels. For workloads that ran with thinking disabled, revisit `max_tokens`, which covers thinking plus response text. If that code reads content by position, such as `content[0].text`, select content blocks by `type` instead, because `thinking` blocks come first.

2. **Forced tool choice returns a 400 error:** Claude Opus 5 accepts `tool_choice` `any` and `tool`. Claude Fable 5.2 rejects both. See [Forced tool choice returns a 400 error](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-forced-tool-choice) for what to send instead.

3. **Editing earlier turns invalidates thinking blocks, on every account:** Claude Opus 5 doesn’t check whether earlier turns changed. Claude Fable 5.2 does, for every account. If your code edits earlier messages, rebuilds `system` or `tools`, or compacts on the client between requests, Claude Fable 5.2 rejects the request or drops the invalid thinking blocks. See [Editing earlier turns invalidates thinking blocks](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-edited-history) for what to change and how to test.

4. **Claude Opus 5 can’t read Claude Fable 5.2’s thinking blocks:** On the Claude API and Claude Models on Google Cloud (Google managed), Claude Fable 5.2 reads Claude Opus 5’s blocks, so a conversation that moves from `claude-opus-5` onto `claude-fable-5-2` keeps its earlier reasoning. In the other direction, Claude Opus 5 can’t read Claude Fable 5.2’s blocks. A conversation that moves from Claude Fable 5.2 to Claude Opus 5 runs the turns after the switch without Claude Fable 5.2’s reasoning. The API drops those blocks before the model receives them, the request succeeds, and the dropped blocks aren’t billed. See [Switching models mid-conversation](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#switching-models).

5. **Text between tool calls is returned in thinking blocks:** On Claude Opus 5, text the model writes between tool calls comes back as `text` blocks. On Claude Fable 5.2, that narration comes back as progress-update `thinking` blocks, at most one before each tool call. If your interface renders that narration, set `thinking.display` to `"updates"`, which is in beta, to receive the progress updates as text while reasoning stays hidden, or to `"summarized"` to receive both. Then render the non-empty `thinking` blocks between `tool_use` blocks. See [Progress updates between tool calls](https://platform.claude.com/docs/en/build-with-claude/thinking#progress-updates).

6. **Use the computer use toolset instead of `computer_20251124`:** Claude Opus 5 accepts the earlier `computer_20251124` tool with its beta header. Claude Fable 5.2 returns a 400 error for it. See [Use the computer use toolset instead of `computer_20251124`](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-computer-use).

7. **Safety classifiers and fallback:** Claude Fable 5.2’s safety classifiers cover a broader set of `stop_details` categories than Claude Opus 5’s classifiers. Expect additional `stop_details.category` values, such as `"bio"`. Handle every category in the [refusal category table](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback#refusal-response). To re-run declined requests on another model, set `fallbacks: "default"` or build your own retry. That parameter is in beta on the Claude API and Claude Models on Google Cloud (Anthropic managed), and needs the `server-side-fallback-2026-07-01` beta header. [Refusals, fallback, and billing](https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2#refusals-fallback-and-billing) lists the permitted fallback targets.

8. **Pricing:** Claude Fable 5.2 costs $8 USD per million input tokens and $40 USD per million output tokens, compared with $5 USD and $25 USD for Claude Opus 5. Prompt cache reads are $0.20 USD per million tokens, compared with $0.50 USD. See [Pricing](https://platform.claude.com/docs/en/about-claude/pricing).

9. **Data retention is required:** Claude Fable 5.2 requires 30-day data retention and isn’t available under a zero data retention (ZDR) arrangement unless expressly authorized by Anthropic. Claude Opus 5 is available under ZDR. On the Claude API, a request from an organization or workspace without 30-day retention returns a 400 `invalid_request_error`. See [Model-specific data retention requirements](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements).

10. **Fast mode:** Claude Opus 5 supports [fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode) (`speed: "fast"`) in research preview, with the `fast-mode-2026-02-01` beta header. Claude Fable 5.2 supports it in Messages API requests on the Claude API without the header. Requests that send the header keep working. Fast mode for Claude Fable 5.2 costs $16 USD per million input tokens and $80 USD per million output tokens, compared with $10 USD and $50 USD for Claude Opus 5 in fast mode. See [Fast mode pricing](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing).

    Claude Fable 5.2 also supports fast mode on [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed), with the same `speed: "fast"` setting.

    Claude Fable 5.2 also supports fast mode on [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed), with the same `speed: "fast"` setting. Google Cloud sets its prices there. See [Cloud platform pricing](https://platform.claude.com/docs/en/about-claude/pricing#cloud-platform-pricing).

    Claude Mythos 5.2 also supports fast mode in Messages API requests on the Claude API, without the header and at Claude Fable 5.2’s fast mode prices. [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists every platform where Claude Mythos 5.2 has fast mode.

    Remove `speed: "fast"` in Claude Managed Agents. Also remove it if [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) doesn’t list the model you move to.

11. **Structured outputs in CMEK organizations:** In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), Claude Opus 5 supports [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) and Claude Fable 5.2 doesn’t. Remove `strict: true` and `output_config.format` from requests you move, and validate the output in your code.

12. **A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor:** With the [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool), which is in beta, a Claude Opus 5 executor accepts several advisors, Claude Opus 5 and Claude Fable 5.1 among them. A Claude Fable 5.2 executor accepts only Claude Fable 5.2 or Claude Mythos 5.2, and any other advisor returns a 400 error. Set the advisor’s `model` to `claude-fable-5-2` or `claude-mythos-5-2` when you change the executor’s. See [A Claude Fable 5.2 executor needs a Claude Fable 5.2 or Claude Mythos 5.2 advisor](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-advisor-pairs).

### Migration checklist

* If your organization has a ZDR arrangement, enable 30-day retention for the workspace, or confirm eligibility with your Anthropic account team, before anything else.
* Update the model ID from `claude-opus-5` to `claude-fable-5-2`.
* Check your [rate limits](https://platform.claude.com/docs/en/api/rate-limits#rate-limits) before you move production traffic. Claude Fable 5.2’s rate limit is separate from Claude Opus 5’s, with lower token limits at each tier.
* Remove any `thinking: {type: "disabled"}` configuration. Control token spend with lower effort levels, revisit `max_tokens`, and select content blocks by `type`.
* Pass `thinking` blocks back unchanged on every turn, including empty ones. In a tool-use loop, send them back with the tool results. See [Preserving thinking blocks](https://platform.claude.com/docs/en/build-with-claude/thinking#preserving-thinking-blocks).
* Replace forced `tool_choice` (`any` or `tool`) with `auto` plus an explicit instruction and `strict: true` tools, or with JSON outputs. In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), strict tool use and JSON outputs aren’t available for Claude Fable 5.2. There, keep `auto` and the instruction, and validate the tool input in your code.
* If your code builds the `messages` array itself, run the check in [Editing earlier turns invalidates thinking blocks](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#fable-5-2-edited-history) against `claude-fable-5-2`, fix every `prefix_binding_mismatch` entry, and keep the history append-only.
* If you use computer use through `computer_20251124`, Claude Fable 5.2 returns a 400 error for that tool. Declare `computer_toolset_20260801` instead and update your agent loop for the toolset.
* If you use the advisor tool with Claude Fable 5.2 as the executor, set the advisor’s `model` to `claude-fable-5-2` or `claude-mythos-5-2`.
* If a router or fallback moves conversations from Claude Fable 5.2 to Claude Opus 5, expect the turns after the switch to run without Claude Fable 5.2’s thinking blocks.
* If you replay stored conversations through a different account, replay each one through the account that produced it, or an account linked to it. The API drops Claude Fable 5.2 thinking blocks that another account produced. See [Thinking blocks stay with the account that produced them](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking#account-bound-thinking).
* If your interface renders text between tool calls, set `thinking.display` to `"updates"`, which is in beta, or to `"summarized"`, and render the non-empty `thinking` blocks.
* Handle every `stop_details.category`. If you set an explicit `fallbacks` list, name only Claude Fable 5.2’s permitted targets.
* If you use fast mode in Messages API requests on the Claude API, keep `speed: "fast"` only if [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists the model you move to. If you keep it, re-baseline cost against the [fast mode prices](https://platform.claude.com/docs/en/about-claude/pricing#fast-mode-pricing). Remove `speed: "fast"` in Claude Managed Agents. You don’t need the `fast-mode-2026-02-01` beta header, and requests that send it keep working.
* In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), remove `strict: true` and `output_config.format`, and validate the output in your code.
* Re-run your [effort sweep](https://platform.claude.com/docs/en/build-with-claude/effort#recommended-effort-levels-for-claude-fable-5-2) on your own evals, and re-baseline cost and latency.
* Check the system prompts, skills, and other instructions you carry over against [Review instructions written for earlier models](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2#review-instructions-written-for-earlier-models).

## Migrating to Claude Fable 5.2 from Claude Opus 4.8 or earlier

First work through [Migrating to Claude Fable 5.2 from Claude Opus 5](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#migrating-from-claude-opus-5-to-claude-fable-5-2), with `claude-opus-4-8` as the model ID you replace. That section applies to code on Claude Opus 4.8 as written, because Claude Opus 4.8, like Claude Opus 5:

* Accepts `thinking: {type: "disabled"}`, forced tool choice, the `computer_20251124` tool, and fast mode.
* Returns the text between tool calls as `text` blocks.
* Is available under zero data retention (ZDR) arrangements.
* Costs $5 USD per million input tokens and $25 USD per million output tokens, with prompt cache reads at $0.50 USD.

This section adds the differences that the Claude Opus 5 section doesn’t cover.

### What changes

1. **Thinking runs on requests that omit it:** On Claude Opus 4.8, thinking is off unless you ask for it. On Claude Fable 5.2, a request with no `thinking` field runs with adaptive thinking. Responses can carry `thinking` blocks before `text` blocks, so select content blocks by `type` instead of reading `content[0].text`. In a tool-use loop, send the `thinking` blocks back unchanged with the tool results, including empty ones. Thinking tokens are billed as output tokens, and `max_tokens` covers thinking plus response text. Revisit `max_tokens`, and lower `effort` where you want less thinking. On the Claude API and Claude Models on Google Cloud (Google managed), Claude Fable 5.2 reads the thinking blocks from earlier Claude Opus 4.8 turns, so a conversation that moves onto `claude-fable-5-2` keeps that reasoning.

2. **Lower prompt caching minimum:** The minimum cacheable prompt length on Claude Fable 5.2 is 512 tokens, down from 1,024 tokens on Claude Opus 4.8. Prompts that were too short to cache can create cache entries, with no code changes required. See [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#cache-limitations).

3. **Priority Tier isn’t supported:** Claude Opus 4.8 supports [Priority Tier](https://platform.claude.com/docs/en/api/service-tiers#supported-models). Claude Fable 5.2 doesn’t. If your organization has a Priority Tier commitment, plan capacity separately.

4. **Advice from the advisor tool comes back encrypted:** With the [advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool), which is in beta, a Claude Opus 4.8 executor can pair with an advisor that returns its advice as plaintext, such as Claude Opus 4.8. The only advisors a Claude Fable 5.2 executor accepts, Claude Fable 5.2 and Claude Mythos 5.2, return the advice encrypted, as an `advisor_redacted_result` block, so your client can’t read its text. If your code reads the advice text, remove that dependency. See [Result variants](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool#result-variants).

If your code is on Claude Opus 4.7 or earlier, also apply part of the Claude Opus 5.5 guide’s migration checklist. Start at the group [Claude Opus 4.7 or earlier](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide#migration-checklist-from-claude-opus-47) and go down to the group that names your model. These groups cover request changes made before Claude Opus 4.8, such as removed sampling parameters and beta headers. Apply that checklist’s fast mode item only if [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists the model you move to. In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), structured outputs aren’t available for Claude Fable 5.2, so don’t apply the `output_config.format` item there. Remove `output_format` from your requests instead, and validate the JSON in your code.

### Migration checklist

* Work through the [Claude Opus 5 checklist](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide#migration-checklist-fable-5-2-from-opus-5), with `claude-opus-4-8` as the model ID you replace.
* Review workloads that ran without a `thinking` field. On Claude Fable 5.2 they run with thinking, so revisit `max_tokens`, lower `effort` where you want less thinking, and select content blocks by `type`.
* Check that any code that parses the `thinking` field treats it as display text only. Set `thinking.display` to `"summarized"` to receive readable summaries.
* Review prompts near the caching minimum: prompts of 512 tokens or more can create cache entries.
* If your organization has a Priority Tier commitment, plan capacity separately.
* If you use the advisor tool and your code reads the advice text, remove that dependency: the advice arrives as an encrypted `advisor_redacted_result` block.
* Run a fresh effort sweep on your own evals rather than carrying over a setting tuned for Claude Opus 4.8.
* On Claude Opus 4.7 or earlier, also apply the Claude Opus 5.5 guide’s checklist groups for your model. Leave out the fast mode item unless [Availability of fast mode](https://platform.claude.com/docs/en/build-with-claude/fast-mode#feature-availability) lists the model you move to. In an organization with [customer-managed encryption keys](https://platform.claude.com/docs/en/manage-claude/cmek), also leave out the `output_config.format` item and remove `output_format` from your requests.
