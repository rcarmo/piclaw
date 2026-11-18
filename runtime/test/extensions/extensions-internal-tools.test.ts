/**
 * test/extensions/extensions-internal-tools.test.ts – Tests for internal-tools extension.
 */

import { describe, expect, test } from "bun:test";
import "../helpers.js";
import { createFakeExtensionApi } from "./fake-extension-api.js";

describe("internal-tools extension", () => {
  test("registers list_tools as the only built-in tool discovery surface", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({ allTools: [] });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    expect(tool).toBeDefined();
    expect(tool.name).toBe("list_tools");
    expect(fake.tools.has(["list", "internal", "tools"].join("_"))).toBe(false);
  });

  test("lists tools with brief descriptions, query filter, and a visible discovery hint", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        { name: "bash", description: "Run a shell command and return output." },
        { name: "messages", description: "Search, retrieve, add, or delete messages." },
        { name: "list_tools", description: "List available internal tools." },
      ],
      activeTools: ["bash", "list_tools"],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const all = await tool.execute("t1", {});
    expect(all.content[0].text).toContain("Available tools:");
    expect(all.content[0].text).toContain("Hint: use query when you know the capability area");
    // bash line now uses summary from capability registry and includes metadata
    expect(all.content[0].text).toContain("bash");
    expect(all.content[0].text).toContain("[active]");
    expect(all.content[0].text).toContain("{core}");
    expect(all.content[0].text).toContain("[mutating, standard]");

    const filtered = await tool.execute("t2", { query: "search" });
    expect(filtered.content[0].text).toContain("filtered");
    expect(filtered.content[0].text).toContain("messages");
    expect(filtered.content[0].text).toContain("{data}");
    expect(filtered.content[0].text).not.toContain("• bash —");
  });

  test("simple script/skill queries rank list_scripts into the visible list", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        {
          name: "bun_run",
          description: "Run a workspace Bun script directly.",
          promptSnippet: "Execute workspace scripts directly.",
        },
        {
          name: "search_workspace",
          description: "Search workspace notes and script references.",
          promptSnippet: "Search notes and scripts.",
        },
        {
          name: "list_scripts",
          description: "Discover packaged skill scripts plus workspace skill/note scripts with compact summaries and bun invocation hints.",
          promptSnippet: "list_scripts: discover packaged skill or workspace scripts, then use bun_run for workspace-relative entrypoints when appropriate.",
        },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const scriptsQuery = await tool.execute("t-scripts", { query: "scripts", limit: 1 });
    expect(scriptsQuery.details.tools[0].name).toBe("list_scripts");

    const skillsQuery = await tool.execute("t-skills", { query: "skills", limit: 1 });
    expect(skillsQuery.details.tools[0].name).toBe("list_scripts");
  });

  test("includes parameter schemas when requested", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({ allTools: [
      {
        name: "read",
        description: "Read a file.",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ] });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t3", { include_parameters: true });
    expect(result.details.count).toBe(1);
    expect(result.details.tools[0].parameters).toBeDefined();
    expect(result.details.tools[0].toolsets).toEqual(["core"]);
    expect(result.details.tools[0].active).toBe(false);
  });

  test("intent mode recommends built-in tools with compact reasons", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        { name: "messages", description: "Search, retrieve, add, or delete messages.", promptSnippet: "Inspect recent chat history and retrieve timeline messages" },
        { name: "introspect_sql", description: "Run read-only SQL queries against the messages database.", promptSnippet: "Inspect SQL tables and run read-only database queries" },
        { name: "search_workspace", description: "Search indexed workspace content.", promptSnippet: "Search notes and workspace files" },
      ],
      activeTools: ["messages"],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t6", { intent: "inspect recent messages" });
    expect(result.content[0].text).toContain('Recommended tools for "inspect recent messages"');
    expect(result.content[0].text).toContain('messages');
    expect(result.details.intent).toBe('inspect recent messages');
    expect(result.details.recommendations[0].name).toBe('messages');
    expect(result.details.recommendations[0].matched_terms).toContain('messages');
    expect(result.details.recommendations[0].matched_sources.length).toBeGreaterThan(0);
    expect(result.details.recommendations[0].reason_summary).toContain('active');
  });

  test("intent mode can discover extension tools from description and promptSnippet", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        {
          name: "crm_messages",
          description: "Read messages from a customer conversation.",
          promptSnippet: "Read customer messages and inspect recent conversation history",
          parameters: { type: "object", properties: { conversation_id: { type: "string" } } },
        },
        {
          name: "search_workspace",
          description: "Search indexed workspace content.",
          promptSnippet: "Search notes and workspace files",
        },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t7", { intent: "inspect recent customer messages", include_parameters: true });
    expect(result.details.recommendations[0].name).toBe("crm_messages");
    expect(result.details.recommendations[0].matched_sources).toContain("promptSnippet");
    expect(result.details.recommendations[0].parameters).toBeDefined();
  });

  test("image workflows recommend image_process for icons and transparent favicons", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const { imageProcessing } = await import("../../src/extensions/image-processing.js");
    const fake = createFakeExtensionApi({ allTools: [] });
    imageProcessing(fake.api as any);
    fake.setAllTools([
      ...[...fake.tools.values()].map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        promptSnippet: tool.promptSnippet,
        promptGuidelines: tool.promptGuidelines,
        parameters: tool.parameters,
      })),
      {
        name: "attach_file",
        description: "Upload a workspace file so the user gets a download card.",
        promptSnippet: "Attach a file to the chat.",
      },
      {
        name: "read_attachment",
        description: "Load attachment bytes/text/image data by media id.",
        promptSnippet: "Read an uploaded attachment.",
      },
    ]);
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t7-image", {
      intent: "regenerate transparent favicons and app icons from a PNG",
      include_parameters: true,
    });
    expect(result.details.recommendations[0].name).toBe("image_process");
    expect(result.details.recommendations[0].matched_sources.some((source: string) => (
      source === "promptSnippet"
      || source.startsWith("recommend.")
      || source === "jdoc.guidance"
    ))).toBe(true);
    expect(result.details.recommendations[0].parameters).toBeDefined();
  });

  test("query mode ranks image_process for favicon/transparency searches", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        {
          name: "attach_file",
          description: "Upload a workspace file so the user gets a download card.",
          promptSnippet: "Attach a file to the chat.",
        },
        {
          name: "read_attachment",
          description: "Load attachment bytes/text/image data by media id.",
          promptSnippet: "Read an uploaded attachment.",
        },
        {
          name: "image_process",
          description: "Process workspace images with sharp. Useful for icons, favicons, logos, screenshots, avatars, transparent PNGs, and GIF workflows.",
          promptSnippet: "image_process: edit workspace images/icons/screenshots — resize, crop, rotate, convert, optimize, preserve transparency, inspect metadata, and build GIF/tile assets.",
          promptGuidelines: [
            "Prefer image_process over bash or hand-rolled scripts for image editing tasks such as icons, favicons, logos, screenshots, avatars, transparent PNGs, and GIFs.",
          ],
        },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t7-query-image", { query: "favicon transparent png" });
    expect(result.details.tools[0].name).toBe("image_process");
  });

  test("intent mode falls back cleanly when no strong recommendation exists", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        { name: "messages", description: "Search, retrieve, add, or delete messages." },
        { name: "search_workspace", description: "Search indexed workspace content." },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t8", { intent: "solder gpio pins" });
    expect(result.content[0].text).toContain('No strong recommendation');
    expect(result.details.recommendations).toEqual([]);
  });

  test("intent mode can use structured discovery docs as supplemental signals", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        {
          name: "repo_validate",
          description: "Workspace helper.",
          promptSnippet: "General helper.",
          jdoc: {
            summary: "Packaged repo validation helper.",
            keywords: ["repo hygiene", "stale dist", "import boundaries"],
            verbs: ["check", "validate", "audit"],
            nouns: ["repo", "dist", "imports"],
            aliases: ["repo audit"],
            examples: [{ description: "check stale dist files in the repo" }],
          },
        },
        {
          name: "search_workspace",
          description: "Search indexed workspace content.",
          promptSnippet: "Search notes and workspace files",
        },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t8b", { intent: "check stale dist in the repo" });
    expect(result.details.recommendations[0].name).toBe("repo_validate");
    expect(result.details.recommendations[0].matched_sources.some((source: string) => source.startsWith("jdoc."))).toBe(true);
  });

  test("query mode can match structured discovery doc terms", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        {
          name: "repo_validate",
          description: "Workspace helper.",
          promptSnippet: "General helper.",
          discoveryDoc: {
            aliases: ["repo audit"],
            keywords: ["stale dist", "repo hygiene"],
          },
        },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t8c", { query: "repo audit" });
    expect(result.details.count).toBe(1);
    expect(result.details.tools[0].name).toBe("repo_validate");
  });

  test("query mode can match examples and guidance from structured discovery docs", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        {
          name: "send_invoice",
          description: "Billing helper.",
          promptSnippet: "General helper.",
          jdoc: {
            guidance: ["Always confirm before sending an invoice."],
            examples: [{ description: "send the April invoice" }],
          },
        },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const byExample = await tool.execute("t8d", { query: "April invoice" });
    expect(byExample.details.count).toBe(1);
    expect(byExample.details.tools[0].name).toBe("send_invoice");

    const byGuidance = await tool.execute("t8e", { query: "confirm before sending" });
    expect(byGuidance.details.count).toBe(1);
    expect(byGuidance.details.tools[0].name).toBe("send_invoice");
  });

  test("structured discovery doc can be assembled from metadata aliases, promptGuidelines, and examples", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        {
          name: "invoice_send",
          description: "Finance helper.",
          promptSnippet: "General helper.",
          aliases: ["invoice sender"],
          promptGuidelines: ["Always confirm the recipient before sending."],
          examples: [{ description: "send this invoice to accounting" }],
          metadata: {
            discovery: {
              summary: "Send invoices after confirmation.",
              domains: ["finance"],
              verbs: ["send"],
              nouns: ["invoice"],
            },
          },
        },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t8f", { intent: "send invoice to accounting", include_parameters: true });
    expect(result.details.recommendations[0].name).toBe("invoice_send");
    expect(result.details.recommendations[0].matched_sources).toEqual(expect.arrayContaining(["jdoc.aliases", "jdoc.examples"]));
  });

  test("intent fallback includes a query hint when the intent has useful words", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        { name: "messages", description: "Search, retrieve, add, or delete messages." },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t8g", { intent: "solder gpio pins carefully" });
    expect(result.content[0].text).toContain('Try list_tools(query="solder gpio pins carefully")');
  });

  test("details include capability metadata fields", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        { name: "bash", description: "Run a shell command." },
        { name: "read", description: "Read a file." },
        { name: "list_models", description: "List available models." },
        { name: "schedule_task", description: "Schedule a task." },
        { name: "read_attachment", description: "Read attachment." },
      ],
      activeTools: ["bash", "read", "list_models", "schedule_task", "read_attachment"],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t4", {});
    const tools = result.details.tools;

    // bash: mutating, standard, default — summary falls back to tool description
    const bashTool = tools.find((t: any) => t.name === "bash");
    expect(bashTool.kind).toBe("mutating");
    expect(bashTool.weight).toBe("standard");
    expect(bashTool.activation).toBeUndefined();
    expect(bashTool.summary).toBe("Run a shell command.");  // from tool description

    // read: read-only, lightweight, default
    const readTool = tools.find((t: any) => t.name === "read");
    expect(readTool.kind).toBe("read-only");
    expect(readTool.weight).toBe("lightweight");
    expect(readTool.activation).toBeUndefined();

    // list_models: read-only, lightweight, default via effective read-only baseline
    const listModelsTool = tools.find((t: any) => t.name === "list_models");
    expect(listModelsTool.kind).toBe("read-only");
    expect(listModelsTool.weight).toBe("lightweight");
    expect(listModelsTool.activation).toBeUndefined();

    // schedule_task: mutating, standard, default via effective scheduling baseline
    const scheduleTaskTool = tools.find((t: any) => t.name === "schedule_task");
    expect(scheduleTaskTool.kind).toBe("mutating");
    expect(scheduleTaskTool.weight).toBe("standard");
    expect(scheduleTaskTool.activation).toBeUndefined();

    // read_attachment: read-only, lightweight, default via effective attachment baseline
    const readAttachmentTool = tools.find((t: any) => t.name === "read_attachment");
    expect(readAttachmentTool.kind).toBe("read-only");
    expect(readAttachmentTool.weight).toBe("lightweight");
    expect(readAttachmentTool.activation).toBeUndefined();
  });

  test("unknown tools get sensible default capabilities", async () => {
    const { internalTools } = await import("../../src/extensions/internal-tools.js");
    const fake = createFakeExtensionApi({
      allTools: [
        { name: "custom_tool_xyz", description: "A custom tool." },
      ],
    });
    internalTools(fake.api);

    const tool = fake.tools.get("list_tools");
    const result = await tool.execute("t5", {});
    const custom = result.details.tools[0];
    expect(custom.kind).toBe("mixed");
    expect(custom.weight).toBe("standard");
    expect(custom.activation).toBeUndefined();
    // summary falls back to the tool's own description
    expect(custom.summary).toBe("A custom tool.");
  });
});
