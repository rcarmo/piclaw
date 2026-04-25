#!/usr/bin/env bun
/**
 * SCRIPT_JDOC:
 * {
 *   "summary": "Collect GitHub issues and pull requests into normalized JSON and Markdown digests.",
 *   "aliases": ["github digest", "collate issues prs"],
 *   "domains": ["github", "reporting", "issues", "pull-requests"],
 *   "verbs": ["collect", "collate", "report"],
 *   "nouns": ["issues", "pull requests", "repos", "digest"],
 *   "keywords": ["github", "issues", "prs", "markdown", "json", "snapshot"],
 *   "guidance": [
 *     "Skips private repositories by default; pass --include-private to opt in.",
 *     "Writes normalized JSON plus Markdown output files for later review."
 *   ],
 *   "examples": [
 *     "bun run scripts/github-collate-issues-prs.ts --state open",
 *     "bun run scripts/github-collate-issues-prs.ts --state all --owner rcarmo --include-private"
 *   ],
 *   "kind": "read-only",
 *   "weight": "standard",
 *   "role": "entrypoint"
 * }
 */
/**
 * github-collate-issues-prs.ts
 *
 * Collect issues + pull requests across GitHub repositories visible to the
 * current token, write a normalized JSON snapshot, and render a Markdown report.
 *
 * Auth env vars (first match wins):
 * - GITHUB_TOKEN
 * - GITHUB_PICLAW_BOT_PAT
 * - GH_TOKEN
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type RepoRecord = {
  id: number;
  full_name: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  html_url: string;
  default_branch: string;
  owner: { login: string };
  permissions?: Record<string, boolean>;
};

type IssueApiRecord = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string } | null>;
  assignees?: Array<{ login?: string } | null>;
  body?: string | null;
  pull_request?: unknown;
};

type PullApiRecord = {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  html_url: string;
  created_at: string;
  updated_at: string;
  user?: { login?: string } | null;
  labels?: Array<{ name?: string } | null>;
  assignees?: Array<{ login?: string } | null>;
  body?: string | null;
  head?: { ref?: string } | null;
  base?: { ref?: string } | null;
};

type CollatedItem = {
  repo: string;
  repo_url: string;
  repo_private: boolean;
  repo_archived: boolean;
  type: "issue" | "pull_request";
  number: number;
  title: string;
  state: string;
  draft: boolean;
  url: string;
  author: string;
  created_at: string;
  updated_at: string;
  labels: string[];
  assignees: string[];
  body_preview: string;
  head_ref?: string;
  base_ref?: string;
};

type RepoSummary = {
  full_name: string;
  html_url: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  issues: number;
  pull_requests: number;
  total: number;
};

type Report = {
  generated_at: string;
  state: "open" | "closed" | "all";
  include_archived: boolean;
  include_forks: boolean;
  include_private: boolean;
  owner_filters: string[];
  recent_activity_hours: number | null;
  totals: {
    repos_scanned: number;
    repos_with_items: number;
    total_items: number;
    total_issues: number;
    total_pull_requests: number;
  };
  repos: RepoSummary[];
  items: CollatedItem[];
};

type Options = {
  state: "open" | "closed" | "all";
  outputDir: string;
  outputJson?: string;
  outputMarkdown?: string;
  includeArchived: boolean;
  includeForks: boolean;
  includePrivate: boolean;
  ownerFilters: string[];
  maxRepos?: number;
  activeWithinHours?: number;
};

function readOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) return undefined;
  return next;
}

function readOptions(argv: string[]): Options {
  const stateCandidate = readOption(argv, "--state");
  const state = stateCandidate === "closed" || stateCandidate === "all" ? stateCandidate : "open";
  const outputDir = resolve(readOption(argv, "--output-dir") || "/workspace/tmp/github-collate");
  const outputJson = readOption(argv, "--output-json");
  const outputMarkdown = readOption(argv, "--output-markdown");
  const includeArchived = argv.includes("--include-archived");
  const includeForks = argv.includes("--include-forks");
  const includePrivate = argv.includes("--include-private");
  const ownerFilters = argv
    .flatMap((arg, index) => arg === "--owner" ? [argv[index + 1]] : [])
    .filter((value): value is string => Boolean(value && !value.startsWith("--")))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const maxReposRaw = readOption(argv, "--max-repos");
  const maxRepos = maxReposRaw ? Number.parseInt(maxReposRaw, 10) : undefined;
  const activeWithinHoursRaw = readOption(argv, "--active-within-hours");
  const activeWithinHours = activeWithinHoursRaw ? Number.parseInt(activeWithinHoursRaw, 10) : undefined;
  return {
    state,
    outputDir,
    outputJson,
    outputMarkdown,
    includeArchived,
    includeForks,
    includePrivate,
    ownerFilters,
    maxRepos: Number.isFinite(maxRepos) && Number(maxRepos) > 0 ? Number(maxRepos) : undefined,
    activeWithinHours: Number.isFinite(activeWithinHours) && Number(activeWithinHours) > 0
      ? Number(activeWithinHours)
      : undefined,
  };
}

function requireGithubToken(): string {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PICLAW_BOT_PAT || process.env.GH_TOKEN || "";
  if (!token.trim()) {
    throw new Error("Missing GitHub token. Set GITHUB_TOKEN, GITHUB_PICLAW_BOT_PAT, or GH_TOKEN.");
  }
  return token.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson<T>(token: string, url: string): Promise<{ data: T; headers: Headers }> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "piclaw-github-collate-script",
      },
    });

    if (response.ok) {
      return { data: await response.json() as T, headers: response.headers };
    }

    if ((response.status === 403 || response.status === 429) && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const resetEpoch = Number(response.headers.get("x-ratelimit-reset"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Number.isFinite(resetEpoch) && resetEpoch > 0
          ? Math.max(1000, (resetEpoch * 1000) - Date.now())
          : 2000 * attempt;
      await sleep(delayMs);
      continue;
    }

    const body = await response.text().catch(() => "");
    throw new Error(`GitHub API request failed (${response.status}) for ${url}\n${body}`.trim());
  }
}

function parseLinkHeader(header: string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (!match) continue;
    result[match[2]] = match[1];
  }
  return result;
}

async function fetchAllPages<T>(token: string, url: string): Promise<T[]> {
  const items: T[] = [];
  let nextUrl: string | undefined = url;
  while (nextUrl) {
    const { data, headers } = await fetchJson<T[]>(token, nextUrl);
    items.push(...data);
    const links = parseLinkHeader(headers.get("link"));
    nextUrl = links.next;
  }
  return items;
}

async function fetchAllPagesAllowEmptyOnNotFound<T>(token: string, url: string): Promise<T[]> {
  try {
    return await fetchAllPages<T>(token, url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    if (message.includes("GitHub API request failed (404)") || message.includes("GitHub API request failed (410)")) {
      return [];
    }
    throw error;
  }
}

function previewBody(value: string | null | undefined, maxChars = 160): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

function labelNames(value: Array<{ name?: string } | null> | undefined): string[] {
  return (value || [])
    .map((entry) => typeof entry?.name === "string" ? entry.name.trim() : "")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function assigneeNames(value: Array<{ login?: string } | null> | undefined): string[] {
  return (value || [])
    .map((entry) => typeof entry?.login === "string" ? entry.login.trim() : "")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function normalizeIssue(repo: RepoRecord, record: IssueApiRecord): CollatedItem | null {
  if (record.pull_request) return null;
  return {
    repo: repo.full_name,
    repo_url: repo.html_url,
    repo_private: repo.private,
    repo_archived: repo.archived,
    type: "issue",
    number: record.number,
    title: String(record.title || "").trim(),
    state: String(record.state || "").trim(),
    draft: false,
    url: String(record.html_url || "").trim(),
    author: String(record.user?.login || "").trim(),
    created_at: String(record.created_at || "").trim(),
    updated_at: String(record.updated_at || "").trim(),
    labels: labelNames(record.labels),
    assignees: assigneeNames(record.assignees),
    body_preview: previewBody(record.body),
  };
}

function normalizePull(repo: RepoRecord, record: PullApiRecord): CollatedItem {
  return {
    repo: repo.full_name,
    repo_url: repo.html_url,
    repo_private: repo.private,
    repo_archived: repo.archived,
    type: "pull_request",
    number: record.number,
    title: String(record.title || "").trim(),
    state: String(record.state || "").trim(),
    draft: Boolean(record.draft),
    url: String(record.html_url || "").trim(),
    author: String(record.user?.login || "").trim(),
    created_at: String(record.created_at || "").trim(),
    updated_at: String(record.updated_at || "").trim(),
    labels: labelNames(record.labels),
    assignees: assigneeNames(record.assignees),
    body_preview: previewBody(record.body),
    head_ref: String(record.head?.ref || "").trim() || undefined,
    base_ref: String(record.base?.ref || "").trim() || undefined,
  };
}

function escapeCell(value: string): string {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function compactIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  lines.push("# GitHub issues + PR digest");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- State filter: \`${report.state}\``);
  if (report.recent_activity_hours) {
    lines.push(`- Activity window: **last ${report.recent_activity_hours}h** by created/updated time`);
  }
  lines.push(`- Repos scanned: **${report.totals.repos_scanned}**`);
  lines.push(`- Included private repos: **${report.include_private ? "yes" : "no"}**`);
  lines.push(`- Repos with items: **${report.totals.repos_with_items}**`);
  lines.push(`- Total items: **${report.totals.total_items}**`);
  lines.push(`- Issues: **${report.totals.total_issues}**`);
  lines.push(`- Pull requests: **${report.totals.total_pull_requests}**`);
  lines.push("");

  if (report.repos.length > 0) {
    lines.push("## Repo summary");
    lines.push("");
    lines.push("| Repo | Issues | PRs | Total |");
    lines.push("|---|---:|---:|---:|");
    for (const repo of report.repos) {
      lines.push(`| ${escapeCell(repo.full_name)} | ${repo.issues} | ${repo.pull_requests} | ${repo.total} |`);
    }
    lines.push("");
  }

  lines.push("## Collated items");
  lines.push("");
  if (report.items.length === 0) {
    lines.push("| Updated | Repo | Type | # | Title | Author | Labels | URL |");
    lines.push("|---|---|---|---:|---|---|---|---|");
    lines.push("| — | — | — | — | No matching items | — | — | — |");
    lines.push("");
    return lines.join("\n");
  }

  const itemsByRepo = new Map<string, CollatedItem[]>();
  for (const item of report.items) {
    const existing = itemsByRepo.get(item.repo) || [];
    existing.push(item);
    itemsByRepo.set(item.repo, existing);
  }

  for (const repo of report.repos) {
    const repoItems = itemsByRepo.get(repo.full_name) || [];
    if (repoItems.length === 0) continue;
    const issues = repoItems.filter((item) => item.type === "issue");
    const pullRequests = repoItems.filter((item) => item.type === "pull_request");

    lines.push(`### [${escapeCell(repo.full_name)}](${repo.html_url})`);
    lines.push("");

    if (issues.length > 0) {
      lines.push("#### Issues");
      lines.push("");
      lines.push("| Updated | # | Title | Author | Labels | URL |");
      lines.push("|---|---:|---|---|---|---|");
      for (const item of issues) {
        const labels = item.labels.length > 0 ? item.labels.join(", ") : "—";
        lines.push(
          `| ${escapeCell(compactIso(item.updated_at))} | ${item.number} | ${escapeCell(item.title)} | ${escapeCell(item.author || "—")} | ${escapeCell(labels)} | [#${item.number}](${item.url}) |`,
        );
      }
      lines.push("");
    }

    if (pullRequests.length > 0) {
      lines.push("#### Pull requests");
      lines.push("");
      lines.push("| Updated | # | Title | Author | Labels | URL |");
      lines.push("|---|---:|---|---|---|---|");
      for (const item of pullRequests) {
        const labels = item.labels.length > 0 ? item.labels.join(", ") : "—";
        const title = item.draft ? `${item.title} (draft)` : item.title;
        lines.push(
          `| ${escapeCell(compactIso(item.updated_at))} | ${item.number} | ${escapeCell(title)} | ${escapeCell(item.author || "—")} | ${escapeCell(labels)} | [#${item.number}](${item.url}) |`,
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function isRecentlyActive(item: CollatedItem, nowMs: number, activeWithinHours?: number): boolean {
  if (!activeWithinHours || activeWithinHours <= 0) return true;
  const cutoff = nowMs - (activeWithinHours * 60 * 60 * 1000);
  const createdMs = Date.parse(item.created_at) || 0;
  const updatedMs = Date.parse(item.updated_at) || 0;
  return createdMs >= cutoff || updatedMs >= cutoff;
}

async function collectRepoItems(
  token: string,
  repo: RepoRecord,
  state: Options["state"],
  activeWithinHours?: number,
  nowMs = Date.now(),
): Promise<{ repo: RepoSummary; items: CollatedItem[] }> {
  const [owner = "", name = ""] = String(repo.full_name || "").split("/");
  if (!owner || !name) {
    throw new Error(`Invalid GitHub repo full_name: ${repo.full_name}`);
  }
  const issuesUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=${state}&per_page=100`;
  const pullsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?state=${state}&per_page=100`;

  const [issueRecords, pullRecords] = await Promise.all([
    fetchAllPagesAllowEmptyOnNotFound<IssueApiRecord>(token, issuesUrl),
    fetchAllPagesAllowEmptyOnNotFound<PullApiRecord>(token, pullsUrl),
  ]);

  const items = [
    ...issueRecords.map((record) => normalizeIssue(repo, record)).filter((record): record is CollatedItem => Boolean(record)),
    ...pullRecords.map((record) => normalizePull(repo, record)),
  ]
    .filter((item) => isRecentlyActive(item, nowMs, activeWithinHours))
    .sort((left, right) => {
    const leftTs = Date.parse(left.updated_at) || 0;
    const rightTs = Date.parse(right.updated_at) || 0;
    if (rightTs !== leftTs) return rightTs - leftTs;
    if (left.repo !== right.repo) return left.repo.localeCompare(right.repo);
    return left.number - right.number;
  });

  return {
    repo: {
      full_name: repo.full_name,
      html_url: repo.html_url,
      private: repo.private,
      archived: repo.archived,
      fork: repo.fork,
      default_branch: repo.default_branch,
      issues: items.filter((item) => item.type === "issue").length,
      pull_requests: items.filter((item) => item.type === "pull_request").length,
      total: items.length,
    },
    items,
  };
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const token = requireGithubToken();

  const repos = await fetchAllPages<RepoRecord>(
    token,
    "https://api.github.com/user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=full_name&direction=asc",
  );

  let filteredRepos = repos.filter((repo) => {
    if (!options.includeArchived && repo.archived) return false;
    if (!options.includeForks && repo.fork) return false;
    if (!options.includePrivate && repo.private) return false;
    if (options.ownerFilters.length > 0) {
      const owner = String(repo.owner?.login || "").trim().toLowerCase();
      return options.ownerFilters.includes(owner);
    }
    return true;
  });

  filteredRepos = filteredRepos.sort((a, b) => a.full_name.localeCompare(b.full_name));
  if (options.maxRepos && filteredRepos.length > options.maxRepos) {
    filteredRepos = filteredRepos.slice(0, options.maxRepos);
  }

  const nowMs = Date.now();
  const perRepo = await mapWithConcurrency(
    filteredRepos,
    6,
    async (repo) => collectRepoItems(token, repo, options.state, options.activeWithinHours, nowMs),
  );
  const repoSummaries = perRepo
    .map((entry) => entry.repo)
    .filter((repo) => repo.total > 0)
    .sort((a, b) => b.total - a.total || a.full_name.localeCompare(b.full_name));
  const items = perRepo
    .flatMap((entry) => entry.items)
    .sort((a, b) => {
      const leftTs = Date.parse(a.updated_at) || 0;
      const rightTs = Date.parse(b.updated_at) || 0;
      if (rightTs !== leftTs) return rightTs - leftTs;
      if (a.repo !== b.repo) return a.repo.localeCompare(b.repo);
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      return a.number - b.number;
    });

  const report: Report = {
    generated_at: new Date().toISOString(),
    state: options.state,
    include_archived: options.includeArchived,
    include_forks: options.includeForks,
    include_private: options.includePrivate,
    owner_filters: options.ownerFilters,
    recent_activity_hours: options.activeWithinHours ?? null,
    totals: {
      repos_scanned: filteredRepos.length,
      repos_with_items: repoSummaries.length,
      total_items: items.length,
      total_issues: items.filter((item) => item.type === "issue").length,
      total_pull_requests: items.filter((item) => item.type === "pull_request").length,
    },
    repos: repoSummaries,
    items,
  };

  const slug = timestampSlug();
  const jsonPath = resolve(options.outputJson || join(options.outputDir, `github-items-${options.state}-${slug}.json`));
  const markdownPath = resolve(options.outputMarkdown || join(options.outputDir, `github-items-${options.state}-${slug}.md`));
  const markdown = renderMarkdown(report);

  ensureParentDir(jsonPath);
  ensureParentDir(markdownPath);
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, `${markdown}\n`, "utf8");

  console.log(JSON.stringify({
    json: jsonPath,
    markdown: markdownPath,
    totals: report.totals,
  }, null, 2));
}

await main();
