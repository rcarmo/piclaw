---
title: Claude Fable 5.2
url: https://platform.claude.com/docs/en/models/fable-5-2/overview
description: "An overview of Claude Fable 5.2: what it's for, model IDs on every platform, context window, output limits, pricing, availability, and resources for building with it."
---

**Latest.** Released November 9, 2026.

For demanding reasoning and long-horizon agentic work

Model ID: `claude-fable-5-2`

Context window: 1M tokens · Max output: 128K tokens · Input pricing: $8 / MTok · Output pricing: $40 / MTok

[Announcement](https://www.anthropic.com/claude-fable-and-mythos-5-2) · [What’s new](https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2) · [Migration guide](https://platform.claude.com/docs/en/models/fable-5-2/migration-guide)

## Overview

Claude Fable 5.2 is built for demanding reasoning and long-horizon agentic work. Typical uses include agent sessions that run for hours, multistep deep research, and analysis carried through to a finished document, spreadsheet, or deck.

## Claude Fable 5.2 and Claude Mythos 5.2

[Claude Mythos 5.2](https://platform.claude.com/docs/en/models/mythos-5-2/overview) offers the same capabilities only to organizations verified through Anthropic’s verification programs, such as the [Cyber Verification Program](https://support.claude.com/en/articles/14604842). It shares Claude Fable 5.2’s specifications and pricing. To request access, apply to the program that covers your use case, or contact your account team.

## How it compares

| Model                                                                               | Context | Max output | Price / MTok       | Latency  | Thinking             | Default effort | Knowledge cutoff |
| :---------------------------------------------------------------------------------- | :------ | :--------- | :----------------- | :------- | :------------------- | :------------- | :--------------- |
| **Claude Fable 5.2** (this model)                                                   | 1M      | 128K       | $8 / $40           | Moderate | Adaptive (always on) | `high`         | Jun 2026         |
| [Claude Opus 5.5](https://platform.claude.com/docs/en/models/opus-5-5/overview)     | 1M      | 128K       | $4 / $20           | Moderate | Adaptive (always on) | `medium`       | Jun 2026         |
| [Claude Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/overview) | 1M      | 128K       | $2 / $10           | Fast     | Adaptive             | `high`         | Jun 2026         |
| [Claude Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview)   | 1M      | 128K       | From $0.10 / $0.50 | Fastest  | Adaptive             | `medium`       | Jun 2026         |

* **Context:** 1M tokens is roughly 555k words or 2.5M Unicode characters on the current tokenizer (introduced with Claude Opus 4.7); models before it fit about 750k words in 1M tokens. 200k tokens is roughly 150k words.
* **Max output:** Synchronous Messages API limit. On the Message Batches API, Claude Opus 5.5, Claude Opus 5, Claude Sonnet 5.5, Claude Sonnet 5, Claude Haiku 5.5, Claude Opus 4.8, Claude Opus 4.7, Claude Opus 4.6, and Claude Sonnet 4.6 support up to 300k output tokens with the output-300k-2026-03-24 beta header.
* **Price / MTok:** Input / output, base price per million tokens. Batch API requests are 50% off; prompt caching reads cost 10% of the base input price (2.5% on Claude Fable 5.2, Claude Mythos 5.2, Claude Fable 5.1, and Claude Mythos 5.1, 5% on Claude Opus 5.5 and Claude Sonnet 5.5). See Pricing for the full list.
* **Latency:** Comparative latency, relative to the current lineup, as published in the models overview. Actual latency depends on prompt length, output length, and thinking effort.
* **Thinking:** Adaptive thinking lets the model decide how much to think, steered by effort. Extended thinking is the manual budget\_tokens mode on earlier models.
* **Default effort:** The effort parameter’s default on the Claude API. Models without a value don’t support the parameter.
* **Knowledge cutoff:** Reliable knowledge cutoff: the date through which the model’s knowledge is most extensive and reliable.

## Specifications

### Model IDs

| Platform                                                                                                                                                   | Model ID           |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------- |
| Claude API                                                                                                                                                 | `claude-fable-5-2` |
| [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed)       | `claude-fable-5-2` |
| [Claude Platform on AWS](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws)                                                     | `claude-fable-5-2` |
| [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed) | `claude-fable-5-2` |

### Pricing

| Feature                                                                                | Value                            |
| :------------------------------------------------------------------------------------- | :------------------------------- |
| Input                                                                                  | $8 / MTok                        |
| Output                                                                                 | $40 / MTok                       |
| [5m cache write](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | $10 / MTok                       |
| [1h cache write](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | $16 / MTok                       |
| [Cache read](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)     | $0.20 / MTok                     |
| [Batch API](https://platform.claude.com/docs/en/build-with-claude/batch-processing)    | 50% discount on input and output |

[Full price list](https://platform.claude.com/docs/en/about-claude/pricing)

### Capabilities

| Feature                                                                                 | Value                  |
| :-------------------------------------------------------------------------------------- | :--------------------- |
| [Context window](https://platform.claude.com/docs/en/build-with-claude/context-windows) | 1M tokens              |
| Max output                                                                              | 128K tokens            |
| [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)              | Adaptive (always on)   |
| [Default effort](https://platform.claude.com/docs/en/build-with-claude/effort)          | `high`                 |
| Comparative latency                                                                     | Moderate               |
| Input → output                                                                          | Text and images → text |
| Reliable knowledge cutoff                                                               | Jun 2026               |
| Training data cutoff                                                                    | Jun 2026               |

### Availability

| Feature                                                                       | Value                                                                                                                                                                                                                                                                                                                                                                                                                                |
| :---------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Status](https://platform.claude.com/docs/en/about-claude/model-deprecations) | Active (latest)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Released                                                                      | November 9, 2026                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Retirement                                                                    | Not sooner than November 9, 2027                                                                                                                                                                                                                                                                                                                                                                                                     |
| Platforms                                                                     | Claude API, [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed), [Claude Platform on AWS](https://platform.claude.com/docs/en/build-with-claude/claude-platform-on-aws), [Claude Models on Google Cloud (Anthropic managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/anthropic-managed) |

## Good to know

* Adaptive thinking is always on and can’t be turned off. Control thinking depth with the [effort parameter](https://platform.claude.com/docs/en/build-with-claude/effort).
* Forced tool use (`tool_choice` types `any` and `tool`) returns a 400 error. See [Thinking and tool choice](https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2#thinking-and-tool-choice).
* Omit `temperature`, `top_p`, and `top_k`. See [Sampling parameters](https://platform.claude.com/docs/en/build-with-claude/thinking#sampling-parameters) for the values that return a 400 error.
* Claude Fable 5.2 requires 30-day data retention and isn’t available under zero data retention unless expressly authorized by Anthropic. See [Model-specific data retention requirements](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention#model-specific-data-retention-requirements).
* Query limits and capabilities programmatically with the [Models API](https://platform.claude.com/docs/en/api/models/list).

## Resources

<CardGroup cols={3}>
  <Card title="Prompting Claude Fable 5.2" icon="lightbulb" href="https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2">
    Behavioral differences and prompting patterns specific to Claude Fable 5.2.
  </Card>

  <Card title="Claude Fable 5.2 migration guide" icon="arrow-right" href="https://platform.claude.com/docs/en/models/fable-5-2/migration-guide">
    What changes when you move from Claude Fable 5.1 or from a Claude Opus model.
  </Card>

  <Card title="Preserved thinking" icon="brain" href="https://platform.claude.com/docs/en/build-with-claude/preserved-thinking">
    Editing earlier turns invalidates thinking blocks, for every account.
  </Card>

  <Card title="Adaptive thinking" icon="brain" href="https://platform.claude.com/docs/en/build-with-claude/thinking">
    How adaptive thinking works. It’s the only thinking mode on Claude Fable 5.2.
  </Card>

  <Card title="Effort" icon="sliders" href="https://platform.claude.com/docs/en/build-with-claude/effort">
    The control for thinking depth, latency, and cost. Choose a level for each workload.
  </Card>

  <Card title="Refusals and fallback" icon="shield" href="https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback">
    Handle classifier refusals and retry on another Claude model.
  </Card>

  <Card title="Fast mode" icon="lightning" href="https://platform.claude.com/docs/en/build-with-claude/fast-mode">
    Faster output from Claude Fable 5.2 in Messages API requests, at premium pricing.
  </Card>
</CardGroup>

## Reference

<CardGroup cols={3}>
  <Card title="System prompt" icon="text" href="https://platform.claude.com/docs/en/release-notes/system-prompts/claude-fable-5-2">
    The system prompt Claude Fable 5.2 uses on claude.ai and the Claude apps.
  </Card>

  <Card title="System card" icon="file" href="https://www.anthropic.com/document/claude-fable-5-2-mythos-5-2-system-card">
    Safety evaluations and deployment decisions for Claude Fable 5.2 and Claude Mythos 5.2.
  </Card>

  <Card title="Pricing" icon="coins" href="https://platform.claude.com/docs/en/about-claude/pricing">
    Full price list, including batch discounts and prompt caching rates.
  </Card>

  <Card title="Model IDs and versioning" icon="fingerprint" href="https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions">
    How model IDs, aliases, and pinned snapshots work.
  </Card>

  <Card title="Model deprecations" icon="clock" href="https://platform.claude.com/docs/en/about-claude/model-deprecations">
    Lifecycle status and retirement commitments for every Claude model.
  </Card>
</CardGroup>
