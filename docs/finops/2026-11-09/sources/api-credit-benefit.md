---
title: API credits for Max, Ultra, and Team plans
url: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
description: Claim the monthly Claude Platform credits included with Claude Max, Ultra, and Team plans, and learn what they cover.
---

Claude Max, Ultra, and Team plans include monthly credits for the Claude API. To claim them, you link a [Claude Console](https://platform.claude.com/) organization to your plan. Credits then arrive in that organization each billing cycle (or monthly for annual plans), and you can use them to build and run your own applications and agents. You don’t need to add a payment method to Claude Platform.

<Note>
  Claude Platform on AWS, Amazon Bedrock, Google Cloud, and Microsoft Foundry: These credits apply only to the Claude API in the Claude Console. They can’t be used on other platforms.
</Note>

## Summary

| Topic                                  | Details                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------- |
| **Eligible plans**                     | Max, Ultra, and Team, including discounted Team plans                     |
| **Monthly amount**                     | $100 USD (Max), $200 USD (Ultra), up to $500 USD (Team, pooled\*)         |
| **Covers**                             | Claude API, Claude Managed Agents, the Claude Agent SDK, and playground   |
| **Doesn’t cover**                      | Claude Code, extra usage in the Claude apps                               |
| **Refresh**                            | Each billing cycle (or monthly for annual plans)                          |
| **Expiry**                             | End of each billing cycle (or monthly for annual plans), with no rollover |
| **Payment method for Claude Platform** | Not required                                                              |

## API credit amounts

| Plan                                          | Monthly credit                                                       |
| --------------------------------------------- | -------------------------------------------------------------------- |
| Max                                           | $100 USD                                                             |
| Ultra                                         | $200 USD                                                             |
| Team, Standard seat                           | $20 USD per seat\*                                                   |
| Team, Premium seat                            | $100 USD per seat\*                                                  |
| Discounted Team plans (Nonprofit, Scientists) | Same as Team: $20 USD per Standard seat, $100 USD per Premium seat\* |

\*On Team plans, credits for all seats are pooled into one monthly balance, capped at $500 USD. Each monthly credit, including the first, is based on the seats on your plan at the start of that billing month. For example, a team with three Standard seats and two Premium seats receives $260 USD a month. Adding another Premium seat raises the next month’s credit to $360 USD.

## Eligibility

* Your eligible plan must be active and in good standing.
* New subscribers can claim credits after 7 days on an eligible plan.
* Plans purchased through Claude for iOS or Claude for Android are eligible. Claim your credits on [claude.ai](https://claude.ai) in a web browser.
* Free, Pro, and Enterprise plans aren’t eligible.

## Claim your credits

### Before you start

You need both of the following roles:

| Where                           | Required role                                                |
| ------------------------------- | ------------------------------------------------------------ |
| **Claude plan**                 | Max or Ultra: the subscriber<br />Team: Primary Owner, Owner |
| **Claude Console organization** | Owner, Admin, or Billing                                     |

If you don’t have a Claude Console organization, create one in the Console at [platform.claude.com](https://platform.claude.com/) first, or create one during the claim flow.

### Steps

<Steps>
  <Step title="Open billing settings">
    On claude.ai, go to **Settings > Billing** on a Max or Ultra plan, or **Organization settings > Billing** on a Team plan.
  </Step>

  <Step title="Link a Console organization">
    In the **API credits** section, select the Console organization that should receive the credits, then accept the [program terms](https://www.anthropic.com/legal/credit-terms) by linking.
  </Step>

  <Step title="Start building">
    Your credits appear in the **Promotional credits** section of the [Billing](https://platform.claude.com/settings/billing) page (`platform.claude.com/settings/billing`) in the Console. Create an API key and make your first request. See [Get started](https://platform.claude.com/docs/en/get-started).
  </Step>
</Steps>

<Warning>
  Each plan links to one Console organization, and each Console organization can receive credits from one plan. You can’t change the linked organization yourself, so link the organization you plan to build in. To change it later, [contact support](https://support.claude.com/en/articles/9015913-how-to-get-support).
</Warning>

Subscribers who aren’t eligible don’t see API credits in their settings page. If you think you should be eligible but don’t see the API credits, [contact support](https://support.claude.com/en/articles/9015913-how-to-get-support).

## What the credits cover

These API credits can only be used on the Claude Platform. The following table shows which products are covered:

| Product                                                                              | Covered |
| ------------------------------------------------------------------------------------ | ------- |
| [Claude API](https://platform.claude.com/docs/en/api/overview)                       | Yes     |
| [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) | Yes     |
| [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)               | Yes     |
| [Playground](https://platform.claude.com/playground) in the Claude Console           | Yes     |
| Claude Code                                                                          | No      |
| Extra usage in the Claude apps                                                       | No      |
| Claude Platform on AWS, Bedrock, Google Cloud, Microsoft Foundry                     | No      |

## How credits are applied

* **Timing.** Credits arrive each billing cycle, shortly after your plan payment is processed. On annual plans, credits arrive monthly.
* **Order.** Included credits are spent first, then any credits you’ve purchased. Auto-reload is based only on your purchased balance. It reloads when that balance reaches your threshold, even if included credits remain.
* **Expiry.** Unused credits expire at the end of each billing cycle (or monthly for annual plans) and don’t roll over.
* **Sharing.** Every API key and workspace in the linked organization draws from the same balance. To cap spending on a project, give it its own workspace and set that workspace’s [spend limit](https://platform.claude.com/docs/en/manage-claude/workspaces#setting-workspace-limits).
* **Visibility.** Your credits appear in the **Promotional credits** section of the [Billing](https://platform.claude.com/settings/billing) page (`platform.claude.com/settings/billing`) in the Console, with the amount and expiry date.
* **Your Claude plan.** Credits don’t change your usage limits in Claude or Claude Code.

## Spend limits and rate limits

Credits don’t change how [rate limits and spend limits](https://platform.claude.com/docs/en/api/rate-limits) work:

* Usage paid with credits counts toward your organization’s [monthly spend cap](https://platform.claude.com/docs/en/api/rate-limits#spend-limits). Spend caps reset on the first of each calendar month, whereas credits refresh on your billing cycle (or monthly for annual plans).
* Organizations linked to an eligible plan move up to at least the Start tier. If their monthly credits are over $200 USD, they move up to at least the Build tier.
* Claiming credits doesn’t otherwise change your [usage tier](https://platform.claude.com/docs/en/api/rate-limits#about-rate-limits), and these credits don’t count toward moving to a higher tier.

### When credits run out

* **If the organization has other credits**, requests continue using purchased credits. Auto-reload, if it’s turned on, adds credits to the purchased balance.
* **If the organization has no credits left**, API requests stop until your next monthly API credits arrive. Usage is never charged to your Claude plan. To keep building, purchase credits or turn on auto-reload on the [Billing](https://platform.claude.com/settings/billing) page (`platform.claude.com/settings/billing`) in the Console.
* **If your organization is invoiced through Anthropic sales**, usage beyond the API credits is billed as usual.

When the balance is exhausted, requests return:

```text wrap
Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.
```

If an organization holds only these credits and sends a request they don’t cover, such as a Claude Code session, Claude Code displays:

```text wrap
Credit balance too low · Add funds: https://platform.claude.com/settings/billing
```

## If your plan changes

| Change                                             | What happens                                                                                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancel, downgrade to an ineligible plan, or refund | New credits stop when your plan ends. Credits you already have stay usable until they expire.                                                                                                        |
| Upgrade from Max to Ultra                          | You receive prorated API credits right away, then $200 USD each billing cycle. If you subscribe through Google Play, the $200 USD credit arrives later, by your next renewal at the latest.          |
| Upgrade from Max or Ultra to Team                  | The link to your Max or Ultra plan ends. A Team owner can claim the team’s credits after the Team plan has been active for 7 days.                                                                   |
| Add or remove Team seats                           | Seats added to your plan count from the next billing month’s credit. Seats you remove stay on your plan until it renews, so the credit might be lower after that. The pool stays capped at $500 USD. |

## Use your credits efficiently

Your monthly cost depends mainly on the model you choose and how often your application runs. To use fewer credits:

* Choose a model that fits each task. To learn how, see [Choosing the right model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model).
* Use [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) for repeated context.
* Use the [Message Batches API](https://platform.claude.com/docs/en/build-with-claude/batch-processing) for work that doesn’t need an immediate response. It costs 50 percent less.
* Check [pricing](https://platform.claude.com/docs/en/about-claude/pricing) and track spend on the [Cost](https://platform.claude.com/cost) page in the Claude Console.

## Related

* [Rate limits and spend limits](https://platform.claude.com/docs/en/api/rate-limits)
* [Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces)
* [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
* [Help Center: API credits for Max, Ultra, and Team plans](https://support.claude.com/en/articles/17154008)
