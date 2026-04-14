/**
 * M365 Extension — Regression Validation
 *
 * Run:
 *   bun run runtime/extensions/experimental/m365/tests/validate.ts
 *
 * This suite intentionally avoids live browser/auth dependencies. It guards the
 * source-level regressions that matter for the public extension right now:
 *
 * - auth cache stays in RAM only
 * - no legacy positional graphFetch(...) call sites remain
 * - calendar code uses the options-object headers form
 * - safety helpers standardize dry-run + confirmation handling
 * - m365_spo_move uses PATCH correctly
 * - expected public tools are still registered
 * - browser detection keeps Edge → Chrome → Chromium priority on every OS
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { auth, truncate } from "../shared.ts";

interface TestResult {
	name: string;
	passed: boolean;
	duration: number;
	error?: string;
	details?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void> | void) {
	const start = Date.now();
	try {
		await fn();
		results.push({ name, passed: true, duration: Date.now() - start });
		console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
	} catch (e: any) {
		results.push({ name, passed: false, duration: Date.now() - start, error: e?.message ?? String(e) });
		console.log(`  ❌ ${name}: ${e?.message ?? e} (${Date.now() - start}ms)`);
	}
}

function assert(condition: boolean, message: string) {
	if (!condition) throw new Error(message);
}

function readText(file: string): string {
	return fs.readFileSync(file, "utf-8");
}

const testFile = fileURLToPath(import.meta.url);
const testsDir = path.dirname(testFile);
const extensionDir = path.dirname(testsDir);
const sharedFile = path.join(extensionDir, "shared.ts");
const indexFile = path.join(extensionDir, "index.ts");
const sharedSource = readText(sharedFile);
const indexSource = readText(indexFile);

const expectedTools = [
	"m365_teams_chats",
	"m365_teams_messages",
	"m365_teams_send",
	"m365_teams_send_rich_text",
	"m365_teams_send_markdown_card",
	"m365_teams_upload_file_card",
	"m365_teams_send_link_card",
	"m365_teams_send_file_card",
	"m365_graph_query",
	"m365_profile",
	"m365_mail",
	"m365_people",
	"m365_onedrive",
	"m365_spo_search",
	"m365_spo_browse",
	"m365_spo_download",
	"m365_document_link_metadata",
	"m365_onedrive_share_local_file",
	"m365_spo_upload",
	"m365_spo_sync",
	"m365_calendar",
	"m365_calendar_svg",
	"m365_spo_move",
	"m365_spo_move_many",
];

function extractToolNames(source: string): string[] {
	return [...source.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
}

async function main() {
	console.log("═══════════════════════════════════════════════════════");
	console.log("  M365 Extension — Regression Validation");
	console.log("  " + new Date().toISOString());
	console.log("═══════════════════════════════════════════════════════");

	await test("auth.clearAll empties in-memory cache status", async () => {
		auth.clearAll();
		const status = auth.getCacheStatus();
		assert(status.graph === false, `Expected graph cache false, got ${status.graph}`);
		assert(status.chatsvc === false, `Expected chatsvc cache false, got ${status.chatsvc}`);
		assert(status.spoSites === 0, `Expected spoSites=0, got ${status.spoSites}`);
	});

	await test("truncate helper keeps short text unchanged", async () => {
		assert(truncate("hello") === "hello", "truncate should keep short text unchanged");
	});

	await test("public tool inventory matches expected set", async () => {
		const actual = extractToolNames(indexSource);
		assert(actual.length === expectedTools.length, `Expected ${expectedTools.length} tools, found ${actual.length}`);
		for (const name of expectedTools) {
			assert(actual.includes(name), `Missing tool: ${name}`);
		}
	});

	await test("public extension still exposes status/clear commands", async () => {
		assert(indexSource.includes('pi.registerCommand("m365-status"'), "Missing m365-status command");
		assert(indexSource.includes('pi.registerCommand("m365-clear"'), "Missing m365-clear command");
	});

	await test("RAM-only auth cache helpers are present", async () => {
		assert(sharedSource.includes("const tokenMemCache"), "Missing tokenMemCache");
		assert(sharedSource.includes("const cookieMemCache"), "Missing cookieMemCache");
		assert(sharedSource.includes("In-memory caches only"), "Missing RAM-only cache comment");
	});

	await test("disk-backed auth cache helpers are gone", async () => {
		const forbidden = [
			"const AUTH_DIR",
			"function tokenPath(",
			"function cookiePath(",
			"clearTokenFile(",
			"m365tools-auth",
			"writeFileSync(tokenPath(",
			"writeFileSync(cookiePath(",
			"readFileSync(p, \"utf-8\")",
			"readdirSync(AUTH_DIR)",
		];
		for (const needle of forbidden) {
			assert(!sharedSource.includes(needle), `Found forbidden disk-cache artifact: ${needle}`);
		}
	});

	await test("no legacy positional graphFetch call sites remain", async () => {
		const matches = [...indexSource.matchAll(/graphFetch\([^\n]+,\s*"(?:GET|POST|PATCH|DELETE)"/g)];
		assert(matches.length === 0, `Found ${matches.length} positional graphFetch call(s)`);
	});

	await test("safety helpers exist for dry-run and confirmation", async () => {
		assert(indexSource.includes("const getDryRun"), "Missing getDryRun helper");
		assert(indexSource.includes("const requireConfirmed"), "Missing requireConfirmed helper");
		assert(!indexSource.includes('params.dry_run === "true"'), "Found legacy direct dry_run checks instead of helper");
	});

	await test("destructive and send tools expose standardized safety params", async () => {
		const confirmCount = [...indexSource.matchAll(/confirm:\s*Type\.Optional\(Type\.String/g)].length;
		const dryRunCount = [...indexSource.matchAll(/dryRun:\s*Type\.Optional\(Type\.String/g)].length;
		assert(confirmCount >= 10, `Expected at least 10 confirm params, found ${confirmCount}`);
		assert(dryRunCount >= 10, `Expected at least 10 dryRun params, found ${dryRunCount}`);
	});

	await test("calendar code uses headers option object for timezone preference", async () => {
		const matches = [...indexSource.matchAll(/headers:\s*\{\s*Prefer:\s*`outlook\.timezone="\$\{tz\}"`\s*\}/g)];
		assert(matches.length >= 2, `Expected at least 2 Prefer-header option blocks, found ${matches.length}`);
	});

	await test("m365_spo_move uses PATCH options object", async () => {
		assert(
			indexSource.includes('graphFetch(`drives/${resolved.driveId}/items/${resolved.itemId}`, { method: "PATCH", body })'),
			"m365_spo_move is not using graphFetch(..., { method: \"PATCH\", body })",
		);
	});

	await test("m365_spo_move_many is registered with batch-safety controls", async () => {
		assert(indexSource.includes('name: "m365_spo_move_many"'), "Missing m365_spo_move_many tool");
		assert(indexSource.includes('continueOnError'), "Missing continueOnError parameter");
		assert(indexSource.includes('dryRun'), "Missing dryRun parameter");
		assert(indexSource.includes('Type.Array(Type.Object({'), "Missing structured items array parameter");
	});

	await test("public extension sources no longer embed transcript-specific flows", async () => {
		const forbidden = ["m365_meeting_transcript", "m365_meeting_filmstrip", "stream.aspx"];
		for (const needle of forbidden) {
			assert(!indexSource.includes(needle), `Public extension source still references transcript-only flow: ${needle}`);
		}
	});

	await test("browser search order stays Edge then Chrome then Chromium across platforms", async () => {
		const orderChecks = [
			'// Browser preference order is always Edge → Chrome → Chromium.',
			'// Edge\n\t\t\tpath.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft/Edge/Application/msedge.exe")',
			'// Chrome\n\t\t\tpath.join(process.env["ProgramFiles(x86)"] ?? "", "Google/Chrome/Application/chrome.exe")',
			'// Chromium\n\t\t\tpath.join(process.env["ProgramFiles"] ?? "", "Chromium/Application/chrome.exe")',
			'"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"',
			'"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"',
			'"/Applications/Chromium.app/Contents/MacOS/Chromium"',
			'"/usr/bin/microsoft-edge"',
			'"/usr/bin/google-chrome"',
			'"/usr/bin/chromium"',
		];
		for (const needle of orderChecks) {
			assert(sharedSource.includes(needle), `Missing browser-order marker: ${needle}`);
		}
	});

	await test("stale browser cleanup supports Windows and Unix-like hosts", async () => {
		const cleanupChecks = [
			'const BROWSER_PROCESS_NAMES = ["msedge.exe", "chrome.exe", "chromium.exe"]',
			'const BROWSER_COMMAND_HINTS = ["msedge", "microsoft-edge", "chrome", "google-chrome", "chromium", "chromium-browser"]',
			'execFileSync("ps", ["-ax", "-o", "pid=", "-o", "command="]',
			'process.kill(-pid, "SIGKILL")',
			'taskkill /PID ${pid} /T /F',
			'killMatchingUnixBrowserProcesses((command) => commandHasManagedCdpPort(command))',
		];
		for (const needle of cleanupChecks) {
			assert(sharedSource.includes(needle), `Missing cleanup marker: ${needle}`);
		}
	});

	await test("existing CDP discovery stays lightweight while launchEdge reuse remains strict", async () => {
		const findExistingMatch = sharedSource.match(/export async function findExistingCdpPort\(\): Promise<number \| null> \{([\s\S]*?)\n\}/);
		assert(Boolean(findExistingMatch), "Could not locate findExistingCdpPort implementation");
		const findExistingBody = findExistingMatch?.[1] ?? "";
		assert(sharedSource.includes('const EXISTING_CDP_DISCOVERY_TIMEOUT_MS = 750;'), 'Missing short existing-CDP discovery timeout');
		assert(sharedSource.includes('const EXISTING_CDP_REUSE_TAB_TIMEOUT_MS = 1200;'), 'Missing short existing-CDP tab-open timeout');
		assert(findExistingBody.includes('/json/version'), "findExistingCdpPort should probe /json/version");
		assert(findExistingBody.includes('EXISTING_CDP_DISCOVERY_TIMEOUT_MS'), 'findExistingCdpPort should use the short discovery timeout');
		assert(!findExistingBody.includes('/json/new?'), "findExistingCdpPort should not open probe tabs");
		assert(!findExistingBody.includes('killStaleEdge()'), "findExistingCdpPort should not kill browsers");
		assert(!findExistingBody.includes('killEdgeCdpProcesses()'), "findExistingCdpPort should not kill browser CDP processes");

		const launchEdgeMatch = sharedSource.match(/export async function launchEdge\([\s\S]*?if \(!forceNew\) \{([\s\S]*?)\n\t\}/);
		assert(Boolean(launchEdgeMatch), "Could not locate launchEdge reuse block");
		const launchEdgeBlock = launchEdgeMatch?.[1] ?? "";
		assert(launchEdgeBlock.includes('/json/new?'), "launchEdge reconnect path should still open the requested URL in a new tab");
		assert(launchEdgeBlock.includes('EXISTING_CDP_REUSE_TAB_TIMEOUT_MS'), 'launchEdge reconnect path should use the short reuse timeout');
		assert(launchEdgeBlock.includes('falling back to a fresh browser launch'), "launchEdge should log and fall back when reconnect tab creation fails");
	});

	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;
	const total = results.length;
	const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

	console.log("\n═══════════════════════════════════════════════════════");
	console.log(`  Results: ${passed}/${total} passed, ${failed} failed (${totalTime}ms)`);
	console.log("═══════════════════════════════════════════════════════");

	if (failed > 0) {
		console.log("\n  Failed tests:");
		for (const r of results.filter((r) => !r.passed)) {
			console.log(`    ❌ ${r.name}: ${r.error}`);
		}
	}

	const outFile = path.join(os.tmpdir(), "m365-test-results.json");
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.writeFileSync(outFile, JSON.stringify({ timestamp: new Date().toISOString(), passed, failed, total, results }, null, 2));
	console.log(`\n  Results saved to: ${outFile}`);

	process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error("Fatal:", e);
	process.exit(2);
});
