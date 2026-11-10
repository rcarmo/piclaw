import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

assert.ok(process.versions.bun, "Bun execution required.");
const [provider, mode, root, parentNamespace] = process.argv.slice(2);
assert.ok(root && parentNamespace && ["openai", "openai-codex"].includes(provider));
assert.ok(["success", "denied", "bad-state", "cancel", "provider-only"].includes(mode));
// Fail before CLI startup unless the caller established independent OS isolation.
assert.notEqual(readlinkSync("/proc/self/ns/net"), parentNamespace, "A distinct network namespace is required.");
const interfaces = readFileSync("/proc/net/dev", "utf8").trim().split("\n").slice(2).map(line => line.split(":")[0].trim());
assert.deepEqual(interfaces, ["lo"], "Only loopback is permitted.");
assert.equal(readFileSync("/proc/net/route", "utf8").trim().split("\n").length, 1, "No IPv4 route is permitted.");
assert.equal(process.getuid?.(), Number(process.env.SYNTHETIC_EXPECT_UID), "Privilege drop is required.");
assert.notEqual(process.getuid?.(), 0);
const processStatus = readFileSync("/proc/self/status", "utf8");
for (const field of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"]) assert.match(processStatus, new RegExp(`${field}:\\s+0{16}(?:\\n|$)`));
assert.match(processStatus, /NoNewPrivs:\s+1(?:\n|$)/);
assert.match(processStatus, /Groups:\s*\n/);

const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
const aiRoot = dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-ai"))));
assert.equal(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version, "1.5.1");
assert.equal(JSON.parse(readFileSync(join(aiRoot, "package.json"), "utf8")).version, "1.5.1");
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const bundle = join(packageRoot, "dist/bundle");
const bundleFiles = [...new Bun.Glob("**/*.js").scanSync(bundle)].sort();
const bundleSha256 = createHash("sha256").update(bundleFiles.map(file => `${file}\0${digest(join(bundle, file))}\n`).join("")).digest("hex");
const sdkFileSha256 = Object.fromEntries(["openai-chatgpt.js", "openai-codex.js"].map(file => [file, digest(join(aiRoot, "dist/auth/oauth", file))]));
const artifactPath = resolve(import.meta.dir, "../../fixtures/earendil-package-admission/cli-artifact-1.5.1.json");
assert.equal(digest(artifactPath), "a14ffd81fe812a4be7999857c07163a3c92fcc763d9a6ef3e36f4eb02adca2af", "Exact artifact evidence changed.");
const archived = JSON.parse(readFileSync(artifactPath, "utf8"));
assert.equal(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).bin.pi, archived.bin);
assert.equal(archived.bin, "dist/bundle/cli.js");
assert.equal(bundleSha256, archived.bundleSha256, "Packaged CLI bundle drift.");
assert.deepEqual(sdkFileSha256, archived.sdkFileSha256, "OAuth module drift.");

const home = join(root, "home"), agent = join(root, "agent"), bin = join(root, "bin"), cwd = join(root, "cwd");
for (const dir of [home, agent, bin, cwd]) mkdirSync(dir, { recursive: true, mode: 0o700 });
assert.ok(!existsSync(join(agent, "auth.json")), "A fresh profile is required.");
const launcher = join(root, "launcher-called"), guard = join(root, "guard.json");
writeFileSync(join(bin, "xdg-open"), '#!/bin/sh\nprintf "%s\\n" "$#" >> "$SYNTHETIC_LAUNCH_MARKER"\nprintf "%s" "$1" | sha256sum | cut -d " " -f 1 >> "$SYNTHETIC_LAUNCH_MARKER"\n', { mode: 0o700 });
if (mode === "provider-only") {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", resolve(import.meta.dir, "cli-auth-preload-120.mjs"), join(packageRoot, archived.bin),
    "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools", "--provider", provider], {
    cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: bin + ":" + dirname(process.execPath) + ":/usr/bin:/bin", HOME: home, PI_CODING_AGENT_DIR: agent,
      PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true", SYNTHETIC_AUTH_PROVIDER: provider, SYNTHETIC_AUTH_MODE: mode, SYNTHETIC_LAUNCH_MARKER: launcher, SYNTHETIC_AUTH_GUARD: guard },
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    assert.equal(exit, 1); assert.equal(out, "");
    assert.equal(err.trim(), "Error: --provider requires --model (for example: --provider " + provider + " --model <pattern>)");
    const authPath=join(agent,"auth.json"); assert.ok(!existsSync(authPath)||Object.keys(JSON.parse(readFileSync(authPath,"utf8"))).length===0);
    assert.equal(existsSync(launcher),false);
    const proof=JSON.parse(readFileSync(guard,"utf8")); assert.equal(proof.tokenRequests,0); assert.equal(proof.unexpected,0);
    console.log(JSON.stringify({ version:"1.5.1", runtime:"Bun " + Bun.version, provider, mode, status:"pass", exitCode:1, diagnostic:"provider_requires_model", credentialPersistence:"none", tokenRequests:0, unexpectedFetchRequests:0, browserLauncher:"not_invoked", inference:"not_invoked", bundleSha256 }));
  } finally { clearTimeout(timer); if(child.exitCode===null)child.kill("SIGKILL"); await child.exited; }
  process.exit(0);
}
let output = "", sentMethod = false, sentCallback = false, cancelled = false, completed = false;
let authUrl: URL | undefined;
const decoder = new TextDecoder();
const terminal = new Bun.Terminal({ cols: 220, rows: 60, data(term, bytes) {
  const chunk = decoder.decode(bytes, { stream: true });
  output = (output + chunk).slice(-500_000);
  if (chunk.includes("\x1b[6n")) term.write("\x1b[1;1R");
  // OSC hyperlinks and ANSI sequences are terminal protocol bytes.
  // eslint-disable-next-line no-control-regex
  const match = output.match(/\x1b\]8;;(https:\/\/auth\.openai\.com\/[^\x07\x1b]+)/);
  if (match) authUrl = new URL(match[1]);
} });
// eslint-disable-next-line no-control-regex
const plainOutput = () => output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*(?:\x07)/g, "");
const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", resolve(import.meta.dir, "cli-auth-preload-120.mjs"), join(packageRoot, archived.bin),
  "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files", "--no-tools", "--tui-mode", "regular"], {
  cwd, terminal, env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, TERM: "xterm-256color", COLORTERM: "truecolor", PI_CODING_AGENT_DIR: agent,
    PI_OFFLINE: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true", SYNTHETIC_AUTH_PROVIDER: provider, SYNTHETIC_AUTH_MODE: mode, SYNTHETIC_LAUNCH_MARKER: launcher, SYNTHETIC_AUTH_GUARD: guard },
});
const watchdog = setTimeout(() => child.kill("SIGKILL"), 60_000);
const started = Date.now(); let stage = "startup";
try {
  // 1.5.1's compact startup header replaces the old /help hint. Wait for
  // its real rendered onboarding marker rather than exhausting a fixed delay.
  while (!plainOutput().includes("Pi can explain its own features") && Date.now() - started < 20_000 && child.exitCode === null) await Bun.sleep(50);
  assert.ok(plainOutput().includes("Pi can explain its own features"), "CLI startup header did not render.");
  assert.ok(existsSync(guard), "CLI preload guard did not execute.");
  stage = "login-command"; terminal.write(`/login ${provider}\r`);
  while (Date.now() - started < 50_000 && child.exitCode === null) {
    const text = plainOutput();
    if (!sentMethod && /Select authentication method|Select OpenAI Codex login method/.test(text)) {
      if (provider === "openai-codex") {
        assert.ok(text.includes("Browser login (default)"));
        assert.ok(text.includes("Device code login (headless)"));
      }
      terminal.write("\r"); sentMethod = true;
    }
    if (authUrl && !sentCallback && !cancelled && /Paste|paste|callback URL|authorization code/.test(text)) {
      assert.equal(authUrl.protocol, "https:"); assert.equal(authUrl.hostname, "auth.openai.com");
      assert.ok(authUrl.searchParams.get("state"));
      assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
      assert.equal(authUrl.pathname, provider === "openai" ? "/api/accounts/authorize" : "/oauth/authorize");
      if (provider === "openai") {
        assert.match(authUrl.searchParams.get("ext_agent_host_id") ?? "", /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assert.equal(authUrl.searchParams.get("resource"), "https://api.openai.com/v1");
      }
      const expectedRedirect = provider === "openai" ? "http://127.0.0.1:1455/auth/callback" : "http://localhost:1455/auth/callback";
      assert.equal(authUrl.searchParams.get("redirect_uri"), expectedRedirect);
      if (mode === "cancel") { terminal.write("\x1b"); cancelled = true; }
      else {
        const callback = new URL(expectedRedirect);
        callback.searchParams.set("code", "synthetic-cli-code");
        callback.searchParams.set("state", mode === "bad-state" ? "synthetic-wrong-state" : authUrl.searchParams.get("state")!);
        if (provider === "openai") callback.searchParams.set("client_id", "synthetic-issued-client");
        terminal.write(`${callback}\r`); sentCallback = true;
      }
    }
    const authPath = join(agent, "auth.json");
    const hasCredentials = existsSync(authPath) && Object.keys(JSON.parse(readFileSync(authPath, "utf8"))).length > 0;
    if (mode === "success" && hasCredentials && text.includes("Logged in to") && !text.includes("Failed to login") && !text.includes("could not be synchronized")) {
      stage = "validate-persisted-credential";
      const credentials = JSON.parse(readFileSync(authPath, "utf8"));
      assert.deepEqual(Object.keys(credentials), [provider]);
      const stored = credentials[provider];
      assert.equal(stored.type, "oauth"); assert.equal(stored.refresh, "synthetic-cli-refresh");
      const expectedJwt = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-cli-account" } })).toString("base64url")}.fixture`;
      assert.equal(stored.access, expectedJwt);
      const lifetime = provider === "openai" ? 3_420_000 : 3_600_000;
      assert.ok(stored.expires >= started + lifetime && stored.expires <= Date.now() + lifetime);
      if (provider === "openai-codex") assert.equal(stored.accountId, "synthetic-cli-account");
      else { assert.equal(stored.clientId, "synthetic-issued-client"); assert.deepEqual(stored.scopes, ["openid", "chatgpt.tokens.use.direct"]); }
      assert.equal(statSync(authPath).mode & 0o777, 0o600);
      completed = true; break;
    }
    if (mode !== "success" && ((mode === "cancel" && cancelled && Date.now() - started > 3500) || text.includes("Failed to login"))) {
      assert.equal(hasCredentials, false, "Failed login persisted credentials.");
      if (mode === "bad-state") assert.ok(/state mismatch/i.test(text), "Expected state rejection.");
      if (mode === "denied") assert.ok(/token (?:request|exchange) failed \(400\)/.test(text), "Expected token exchange rejection.");
      completed = true; break;
    }
    await Bun.sleep(50);
  }
  stage = "validate-login-terminal-state";
  assert.ok(completed && authUrl && (sentCallback || cancelled), "Packaged CLI login did not reach its expected terminal state.");
  stage = "validate-browser-launch";
  assert.equal(readFileSync(launcher, "utf8"), `1\n${createHash("sha256").update(authUrl.href).digest("hex")}\n`, "Browser must receive exactly the displayed authorization URL once.");
  let exchanged = JSON.parse(readFileSync(guard, "utf8"));
  assert.equal(exchanged.preloadActive, true); assert.equal(exchanged.unexpected, 0);
  const expectedRequests = ["success", "denied"].includes(mode) ? 1 : 0;
  assert.equal(exchanged.tokenRequests, expectedRequests);
  if (expectedRequests) assert.equal(exchanged.pkceChallenge, authUrl.searchParams.get("code_challenge"));
  if (provider === "openai-codex") { assert.ok(exchanged.polyfillAssignments > 0); assert.equal(sentMethod, true); }
  // A restored editor must accept /quit; aborting the process is never success.
  stage = "restored-editor-quit"; terminal.write("/quit\r");
  assert.equal(await child.exited, 0, "CLI did not exit cleanly through the restored editor.");
  exchanged = JSON.parse(readFileSync(guard, "utf8"));
  assert.equal(exchanged.unexpected, 0); assert.equal(exchanged.tokenRequests, expectedRequests);
  console.log(JSON.stringify({ version: "1.5.1", runtime: `Bun ${Bun.version}`, provider, mode, status: "pass", cliLogin: mode === "success" ? "completed" : "rejected_or_cancelled",
    credentialPersistence: mode === "success" ? "disposable_profile" : "none", tokenRequests: expectedRequests, unexpectedFetchRequests: 0, externalEgress: "os_namespace_denied",
    browserLauncher: "test_owned_noop", networkGuard: "distinct_loopback_only_os_namespace_and_stable_preload", cliExit: "restored_editor_quit_0",
    inference: "not_invoked", codexBrowserChoiceVerified: provider === "openai-codex", hostIdVerified: provider === "openai", bundleFileCount: bundleFiles.length, bundleSha256, sdkFileSha256 }));
} catch {
  // PTY output may contain provider URLs, codes or tokens; never emit it.
  const text = plainOutput();
  // Only bounded stage names/booleans are diagnostic; never export raw PTY text.
  throw new Error(`Packaged CLI ${provider}/${mode} qualification failed: ${JSON.stringify({ stage, sentMethod, sentCallback, cancelled, completed, authUrlObserved: Boolean(authUrl), loggedIn: text.includes("Logged in to"), failedLogin: text.includes("Failed to login"), pastePrompt: /Paste|paste|callback URL|authorization code/.test(text), methodPrompt: /Select authentication method|Select OpenAI Codex login method/.test(text), launcherObserved: existsSync(launcher), credentialFileObserved: existsSync(join(agent, "auth.json")), childExit: child.exitCode })}`);
} finally {
  clearTimeout(watchdog); if (child.exitCode === null) child.kill("SIGKILL"); await child.exited; terminal.close();
}
