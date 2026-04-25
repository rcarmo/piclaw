#!/usr/bin/env bun
/**
 * scripts/migrate-workitems-to-github.ts
 *
 * Migrates file-based workitem kanban to GitHub Issues.
 * Idempotent: re-running skips files already in migrate-state.json.
 *
 * Usage:
 *   bun scripts/migrate-workitems-to-github.ts --dry-run --lanes 50-done
 *   bun scripts/migrate-workitems-to-github.ts --lanes 50-done --limit 50
 *   bun scripts/migrate-workitems-to-github.ts --lanes 50-done,30-done,40-review,20-doing,10-next,00-inbox
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join, resolve } from "path";

const REPO = "rcarmo/piclaw";
const WORKITEMS_DIR = resolve(import.meta.dir, "../workitems");
const STATE_FILE = resolve(import.meta.dir, "migrate-state.json");
const DELAY_MS = 200; // between API calls

// GitHub Project v2 identifiers (piclaw-core, project #13)
const PROJECT_ID   = "PVT_kwHOAAX9684BVerP";
const PROJECT_OWNER = "rcarmo";
const PROJECT_NUMBER = 13;
const FIELD_STATUS      = "PVTSSF_lAHOAAX9684BVerPzhQ6NQ8";
const FIELD_ESTIMATE    = "PVTSSF_lAHOAAX9684BVerPzhQ6Ukk";
const FIELD_RISK        = "PVTSSF_lAHOAAX9684BVerPzhQ6UmQ";
const FIELD_SOURCE_FILE = "PVTF_lAHOAAX9684BVerPzhQ6UmU";

const STATUS_OPTION_ID: Record<string, string> = {
  "Inbox":       "f75ad846",
  "Next":        "47fc9ee4",
  "In Progress": "98236657",
  "In Review":   "c0d180e8",
  "Done":        "a8006708",
};
const ESTIMATE_OPTION_ID: Record<string, string> = {
  "XS": "66444063", "S": "986af9f6", "M": "8a79fd6d", "L": "e97506dd", "XL": "8f42721f",
};
const RISK_OPTION_ID: Record<string, string> = {
  "low": "437378fd", "medium": "a7d8fa2c", "high": "09306af9",
};

// Lane → project status + issue state
const LANE_CONFIG: Record<string, { status: string; closed: boolean }> = {
  "50-done":   { status: "Done",        closed: true },
  "30-done":   { status: "Done",        closed: true },
  "40-review": { status: "In Review",   closed: false },
  "20-doing":  { status: "In Progress", closed: false },
  "10-next":   { status: "Next",        closed: false },
  "00-inbox":  { status: "Inbox",       closed: false },
};

// Frontmatter tag → GitHub label prefix mapping
const TAG_TO_AREA: Record<string, string> = {
  web: "area:web", "web-ui": "area:web", runtime: "area:runtime",
  extensions: "area:extensions", workspace: "area:workspace",
  tools: "area:tools", sessions: "area:sessions", docs: "area:docs",
  packaging: "area:packaging", security: "area:security",
  "desktop-automation": "area:desktop-automation", m365: "area:m365",
  shell: "area:shell", container: "area:container", providers: "area:providers",
};
const TAG_TO_TYPE: Record<string, string> = {
  refactor: "type:refactor", audit: "type:audit", release: "type:release",
  research: "type:research", evaluation: "type:research",
  feature: "type:feature", bug: "type:bug",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseFrontmatter(text: string): Record<string, unknown> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm: Record<string, unknown> = {};
  let currentKey = "";
  let inList = false;
  const list: string[] = [];
  for (const line of m[1].split("\n")) {
    const listItem = line.match(/^\s+- (.+)/);
    const keyVal = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (listItem) {
      list.push(listItem[1].trim());
      inList = true;
    } else {
      if (inList && currentKey) { fm[currentKey] = [...list]; list.length = 0; inList = false; }
      if (keyVal) {
        currentKey = keyVal[1];
        const val = keyVal[2].trim();
        // Handle inline empty list: blocked-by: []
        if (val === "[]" || val === "[ ]") { fm[currentKey] = []; inList = false; }
        else { fm[currentKey] = val.replace(/^["']|["']$/g, ""); inList = false; }
      }
    }
  }
  if (inList && currentKey) fm[currentKey] = [...list];
  return fm;
}

function issueBody(text: string): string {
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return text;
  return text.slice(end + 5).trim();
}

function buildLabels(fm: Record<string, unknown>): string[] {
  const labels: string[] = [];
  const p = String(fm.priority ?? "");
  if (p && ["critical","high","medium","low"].includes(p)) labels.push(`priority:${p}`);
  const tags: string[] = Array.isArray(fm.tags) ? (fm.tags as string[]) : [];
  for (const tag of tags) {
    if (TAG_TO_AREA[tag]) labels.push(TAG_TO_AREA[tag]);
    if (TAG_TO_TYPE[tag]) labels.push(TAG_TO_TYPE[tag]);
  }
  const blockedBy = Array.isArray(fm["blocked-by"]) ? fm["blocked-by"] as string[] : [];
  if (blockedBy.length > 0 && blockedBy.some((b: string) => b.trim())) labels.push("blocked");
  return [...new Set(labels)];
}

async function ghApi(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API ${method} ${path} → ${res.status}: ${err}`);
  }
  return res.json();
}

async function ghGraphQL(token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json();
  if (json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function addIssueToProject(token: string, issueNodeId: string): Promise<string> {
  const data = await ghGraphQL(token, `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`, { projectId: PROJECT_ID, contentId: issueNodeId });
  return data.addProjectV2ItemById.item.id;
}

async function setProjectFieldViaGh(token: string, itemId: string, fieldId: string, value: { singleSelectOptionId?: string; text?: string }) {
  // Use gh CLI via shell for project field updates — more reliable with project automations
  const args = ["project", "item-edit",
    "--id", itemId,
    "--project-id", PROJECT_ID,
    "--field-id", fieldId,
  ];
  if (value.singleSelectOptionId) args.push("--single-select-option-id", value.singleSelectOptionId);
  if (value.text !== undefined) args.push("--text", value.text);

  const proc = Bun.spawn(["gh", ...args], {
    env: { ...process.env, GITHUB_TOKEN: token },
    stdout: "pipe", stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`gh project item-edit failed: ${err.trim()}`);
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find(a => a.startsWith("--limit="))?.split("=")[1]
  ?? args[args.indexOf("--limit") + 1];
const limit = limitArg ? parseInt(limitArg) : Infinity;
const lanesArg = args.find(a => a.startsWith("--lanes="))?.split("=")[1]
  ?? args[args.indexOf("--lanes") + 1]
  ?? "50-done,30-done,40-review,20-doing,10-next,00-inbox";
const lanes = lanesArg.split(",").map(s => s.trim());
const token = process.env.GITHUB_PICLAW_BOT_PAT ?? process.env.GITHUB_TOKEN ?? "";
if (!token) throw new Error("No GitHub token found in GITHUB_PICLAW_BOT_PAT or GITHUB_TOKEN");

// Load state
const state: Record<string, number> = existsSync(STATE_FILE)
  ? JSON.parse(readFileSync(STATE_FILE, "utf8"))
  : {};

let created = 0;
let skipped = 0;

for (const lane of lanes) {
  const cfg = LANE_CONFIG[lane];
  if (!cfg) { console.error(`Unknown lane: ${lane}`); continue; }

  const dir = join(WORKITEMS_DIR, lane);
  const files = readdirSync(dir)
    .filter(f => f.endsWith(".md") && f !== "README.md")
    .sort(); // sort gives approximate chronological order for dated filenames

  // For 50-done, sort by created: date in frontmatter
  const withMeta = files.map(fname => {
    const text = readFileSync(join(dir, fname), "utf8");
    const fm = parseFrontmatter(text);
    return { fname, text, fm };
  });
  if (lane === "50-done" || lane === "30-done") {
    withMeta.sort((a, b) => String(a.fm.created ?? "").localeCompare(String(b.fm.created ?? "")));
  }

  console.log(`\n── ${lane} (${withMeta.length} files) ──`);

  for (const { fname, text, fm } of withMeta) {
    if (created >= limit) { console.log("  [limit reached]"); break; }
    const key = `${lane}/${fname}`;
    if (state[key]) { skipped++; console.log(`  SKIP ${fname} → #${state[key]}`); continue; }

    const title = String(fm.title ?? fname.replace(".md", "")).replace(/^["']|["']$/g, "");
    const labels = buildLabels(fm);
    const body = issueBody(text);

    if (dryRun) {
      console.log(`  DRY  ${fname}`);
      console.log(`       title: ${title}`);
      console.log(`       labels: ${labels.join(", ") || "(none)"}`);
      console.log(`       closed: ${cfg.closed} | status: ${cfg.status}`);
      created++;
      continue;
    }

    try {
      // 1. Create issue (always open first)
      const issue = await ghApi(token, "POST", `/repos/${REPO}/issues`, {
        title,
        body,
        labels,
      }) as { number: number; node_id: string; html_url: string };
      await sleep(DELAY_MS);

      // 2. Add to project first — so close event fires while item is in the project
      const itemId = await addIssueToProject(token, issue.node_id);
      await sleep(2500); // wait for "Item added" automation to fire

      // 3. Set estimate, risk, source file
      const estimateStr = String(fm.estimate ?? "").trim().toUpperCase();
      const estimateOptionId = ESTIMATE_OPTION_ID[estimateStr];
      if (estimateOptionId) {
        try {
          await setProjectFieldViaGh(token, itemId, FIELD_ESTIMATE, { singleSelectOptionId: estimateOptionId });
        } catch (e) { console.error(`  WARN estimate field: ${e}`); }
        await sleep(DELAY_MS);
      }
      const riskStr = String(fm.risk ?? "").trim().toLowerCase();
      const riskOptionId = RISK_OPTION_ID[riskStr];
      if (riskOptionId) {
        try {
          await setProjectFieldViaGh(token, itemId, FIELD_RISK, { singleSelectOptionId: riskOptionId });
        } catch (e) { console.error(`  WARN risk field: ${e}`); }
        await sleep(DELAY_MS);
      }
      try {
        await setProjectFieldViaGh(token, itemId, FIELD_SOURCE_FILE, { text: `${lane}/${fname}` });
      } catch (e) { console.error(`  WARN source file field: ${e}`); }
      await sleep(DELAY_MS);

      // 4. For open issues: set Status explicitly (automation set "In Progress"; override now)
      //    For closed issues: close AFTER project add so "Item closed" automation fires → Done
      if (cfg.closed) {
        await ghApi(token, "PATCH", `/repos/${REPO}/issues/${issue.number}`, {
          state: "closed",
          state_reason: "completed",
        });
        // automation will move to Done; no manual status override needed
      } else {
        const statusOptionId = STATUS_OPTION_ID[cfg.status];
        if (statusOptionId) {
          try {
            await setProjectFieldViaGh(token, itemId, FIELD_STATUS, { singleSelectOptionId: statusOptionId });
          } catch (e) { console.error(`  WARN status field: ${e}`); }
        }
      }

      state[key] = issue.number;
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      console.log(`  OK   ${fname} → #${issue.number} ${issue.html_url}`);
      created++;
    } catch (err) {
      console.error(`  ERR  ${fname}: ${err}`);
    }

    await sleep(DELAY_MS);
  }
}

console.log(`\nDone. created=${created} skipped=${skipped} total=${Object.keys(state).length}`);
if (!dryRun) console.log(`State written to: ${STATE_FILE}`);

// ── --fix-status: correct Status=Done for all closed project items ────────────
// Run after migration to fix items where the automation didn't fire.
// Usage: bun scripts/migrate-workitems-to-github.ts --fix-status [--dry-run]
async function fixClosedItemStatus() {
  console.log("\n── fix-status: setting Status=Done for all closed project items ──");
  const doneOptionId = STATUS_OPTION_ID["Done"];
  let cursor: string | null = null;
  let fixed = 0, already = 0, errors = 0;

  while (true) {
    const after = cursor ? `, after: "${cursor}"` : "";
    const data = await ghGraphQL(token, `
      query {
        user(login: "${PROJECT_OWNER}") {
          projectV2(number: ${PROJECT_NUMBER}) {
            items(first: 50${after}) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                content { __typename ... on Issue { number state } }
                fieldValues(first: 5) {
                  nodes {
                    __typename
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      optionId
                      field { ... on ProjectV2SingleSelectField { name } }
                    }
                  }
                }
              }
            }
          }
        }
      }`);

    const page = data.user.projectV2.items;
    for (const item of page.nodes) {
      if (item.content?.__typename !== "Issue") continue;
      if (item.content.state !== "CLOSED") continue;

      const currentStatus = item.fieldValues.nodes.find(
        (fv: any) => fv.__typename === "ProjectV2ItemFieldSingleSelectValue" && fv.field?.name === "Status"
      );
      if (currentStatus?.optionId === doneOptionId) { already++; continue; }

      if (dryRun) {
        console.log(`  DRY  item ${item.id} issue #${item.content.number} → Done`);
        fixed++;
        continue;
      }
      try {
        await setProjectFieldViaGh(token, item.id, FIELD_STATUS, { singleSelectOptionId: doneOptionId });
        console.log(`  OK   item ${item.id} issue #${item.content.number} → Done`);
        fixed++;
      } catch (e) {
        console.error(`  ERR  item ${item.id}: ${e}`);
        errors++;
      }
      await sleep(DELAY_MS);
    }

    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  console.log(`fix-status done: fixed=${fixed} already_done=${already} errors=${errors}`);
}

if (args.includes("--fix-status")) {
  await fixClosedItemStatus();
}
