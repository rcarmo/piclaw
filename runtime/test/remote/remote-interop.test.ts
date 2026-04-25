/**
 * test/remote/remote-interop.test.ts – Tests for remote interop API.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import "../helpers.js";
import { generateKeyPairSync } from "crypto";
import { createTempWorkspace, setEnv, importFresh } from "../helpers.js";

interface InteropIdentity {
  instance_id: string;
  public_key: string;
  private_key: string;
  fingerprint: string;
  instance_name: string;
  created_at: string;
}

let service: any;
let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

let deriveInstanceId: (publicKey: string) => string;
let resetInteropIdentityForTests: () => void;
let signPayload: (identity: InteropIdentity, payload: string) => string;
let buildCanonicalRequest: (params: any) => string;
let hashBody: (body: Uint8Array) => string;
let signRequest: (identity: InteropIdentity, canonical: string) => string;
let getRemotePeer: (id: string) => any;
let getRemoteRequestById: (id: string) => any;
let getPendingRemoteRequests: () => any[];
let updateRemoteRequestDecision: (id: string, decision: string, result?: string | null, error?: string | null) => void;
let storeRemoteRequest: (request: any) => void;
let updatePairRequestStatus: (id: string, status: string) => void;
let updateRemotePeer: (id: string, updates: any) => void;
let upsertRemotePeer: (peer: any) => void;
let createOutboundPairRequest: (record: any) => void;
let initDatabase: () => void;
let RemoteInteropService: any;
let handlePairRequest: (req: Request, context: any) => Promise<Response>;

let originalFetch: typeof fetch | null = null;
const TEST_REMOTE_BASE_URL = "https://93.184.216.34";

function base64UrlEncode(buffer: Uint8Array): string {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function makeIdentity(): InteropIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicDer = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
  const publicKeyEncoded = base64UrlEncode(publicDer);
  return {
    instance_id: deriveInstanceId(publicKeyEncoded),
    public_key: publicKeyEncoded,
    private_key: base64UrlEncode(privateDer),
    fingerprint: "test-fp",
    instance_name: "peer",
    created_at: new Date().toISOString(),
  };
}

function buildCallbackProofString(requestId: string, challenge: string, receiverInstanceId: string): string {
  return `${requestId}\n${challenge}\n${receiverInstanceId}`;
}

/** Insert a peer directly into the DB in "paired" status for tests that need a valid signed peer. */
function insertPairedPeer(peer: InteropIdentity, overrides: Record<string, unknown> = {}): void {
  const now = new Date().toISOString();
  upsertRemotePeer({
    instance_id: peer.instance_id,
    public_key: peer.public_key,
    display_name: overrides.display_name ?? "peer",
    status: overrides.status ?? "paired",
    mode: overrides.mode ?? "mediated",
    profile: overrides.profile ?? "restricted",
    trust_epoch: overrides.trust_epoch ?? 1,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    last_seen_at: null,
    blocked_reason: null,
    base_url: overrides.base_url ?? TEST_REMOTE_BASE_URL,
  });
}

function installCallbackStub(peer: InteropIdentity): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const payload = bodyText ? JSON.parse(bodyText) : {};
    const requestId = String(payload.request_id || "");
    const challenge = String(payload.challenge || "");
    const receiverInstanceId = String(payload.receiver_instance_id || "");
    const proof = buildCallbackProofString(requestId, challenge, receiverInstanceId);
    const signature = signPayload(peer, proof);
    return new Response(
      JSON.stringify({
        request_id: requestId,
        challenge,
        instance_id: peer.instance_id,
        signature,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  return () => {
    globalThis.fetch = original;
  };
}

function buildSignedRequest(
  identity: InteropIdentity,
  method: string,
  path: string,
  body?: unknown,
  options: { trustEpoch?: string | null } = {},
) {
  const bodyText = body ? JSON.stringify(body) : "";
  const bodyBytes = new TextEncoder().encode(bodyText);
  const timestamp = new Date().toISOString();
  const nonce = `nonce-${Math.random().toString(36).slice(2, 8)}`;
  const contentType = body ? "application/json" : "";
  const trustEpoch = options.trustEpoch === undefined ? "1" : options.trustEpoch;
  const canonical = buildCanonicalRequest({
    method,
    pathWithQuery: path,
    contentType,
    bodyHash: hashBody(bodyBytes),
    timestamp,
    nonce,
    instanceId: identity.instance_id,
    sigVersion: "v1",
    ...(trustEpoch !== null ? { trustEpoch } : {}),
  });
  const signature = signRequest(identity, canonical);

  const headers: Record<string, string> = {
    "X-Instance-Id": identity.instance_id,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Sig-Version": "v1",
    "X-Signature": signature,
  };
  if (trustEpoch !== null) headers["X-Trust-Epoch"] = trustEpoch;
  if (body) headers["Content-Type"] = "application/json";

  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body ? bodyText : undefined,
  });
}

describe("remote interop", () => {
  beforeEach(async () => {
    const ws = createTempWorkspace("piclaw-interop-");
    cleanupWorkspace = ws.cleanup;
    restoreEnv = setEnv({
      PICLAW_WORKSPACE: ws.workspace,
      PICLAW_STORE: ws.store,
      PICLAW_DATA: ws.data,
      PICLAW_REMOTE_INTEROP_ENABLED: "1",
      PICLAW_REMOTE_INTEROP_DECISION_MODEL: "github-copilot/gpt-5-mini",
    });

    const identityMod = await importFresh("../src/remote/identity.js");
    deriveInstanceId = identityMod.deriveInstanceId;
    resetInteropIdentityForTests = identityMod.resetInteropIdentityForTests;
    signPayload = identityMod.signPayload;

    const signatureMod = await importFresh("../src/remote/signature.js");
    buildCanonicalRequest = signatureMod.buildCanonicalRequest;
    hashBody = signatureMod.hashBody;
    signRequest = signatureMod.signRequest;

    const dbMod = await importFresh("../src/db.js");
    initDatabase = dbMod.initDatabase;

    const remoteDbMod = await importFresh("../src/db/remote-interop.js");
    getRemotePeer = remoteDbMod.getRemotePeer;
    getRemoteRequestById = remoteDbMod.getRemoteRequestById;
    getPendingRemoteRequests = remoteDbMod.getPendingRemoteRequests;
    updateRemoteRequestDecision = remoteDbMod.updateRemoteRequestDecision;
    storeRemoteRequest = remoteDbMod.storeRemoteRequest;
    updatePairRequestStatus = remoteDbMod.updatePairRequestStatus;
    updateRemotePeer = remoteDbMod.updateRemotePeer;
    upsertRemotePeer = remoteDbMod.upsertRemotePeer;
    createOutboundPairRequest = remoteDbMod.createOutboundPairRequest;

    const serviceMod = await importFresh("../src/remote/service.js");
    RemoteInteropService = serviceMod.RemoteInteropService;

    const pairingMod = await importFresh("../src/remote/service-pairing.js");
    handlePairRequest = pairingMod.handlePairRequest;

    resetInteropIdentityForTests();
    initDatabase();
    // Explicitly set allowPrivateNetwork: false so tests are isolated from
    // the container's injected PICLAW_REMOTE_INTEROP_ALLOW_PRIVATE_NETWORK env var.
    service = new RemoteInteropService(undefined, {
      enabled: true,
      allowHttp: false,
      allowPrivateNetwork: false,
      shortCircuitEnabled: false,
      instanceName: "test",
      decisionModel: "",
    });
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
      originalFetch = null;
    }
    restoreEnv?.();
    restoreEnv = null;
    cleanupWorkspace?.();
    cleanupWorkspace = null;
  });

  test("pair request rejects localhost callback", async () => {
    const peer = makeIdentity();
    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: "http://localhost:8080/api/remote/pair-confirm",
          protocol_version: "1",
          nonce: "abc",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("callback_url");
  });

  test("pair request requires protocol version", async () => {
    const peer = makeIdentity();
    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
          nonce: "abc",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
    );

    expect(res.status).toBe(400);
  });

  test("pair request rejects unsupported protocol", async () => {
    const peer = makeIdentity();
    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
          protocol_version: "2",
          nonce: "abc",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
    );

    expect(res.status).toBe(400);
  });

  test("pair request requires JSON content type", async () => {
    const peer = makeIdentity();
    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
          protocol_version: "1",
          nonce: "abc",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
    );

    expect(res.status).toBe(415);
  });

  test("pair request rejects oversized content-length", async () => {
    const peer = makeIdentity();
    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": "999999" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
          protocol_version: "1",
          nonce: "abc",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
    );

    expect(res.status).toBe(413);
  });

  test("pair request rate limit", async () => {
    const peer = makeIdentity();
    const payload = {
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "peer",
      callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
      protocol_version: "1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };

    let lastStatus = 0;
    for (let i = 0; i < 4; i += 1) {
      const res = await service.handleRequest(
        new Request("http://localhost/api/remote/pair-request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, nonce: `nonce-${i}` }),
        })
      );
      lastStatus = res.status;
      if (res.status === 202) {
        const body = await res.json();
        updatePairRequestStatus(body.request_id, "expired");
      }
    }

    expect(lastStatus).toBe(429);
  });

  test("pair request checks rate limit before callback validation", async () => {
    const peer = makeIdentity();
    let validateCalls = 0;

    const res = await handlePairRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
          protocol_version: "1",
          nonce: "abc",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
      {
        pairLimiter: { allow: () => false },
        pairConfirmLimiter: { allow: () => true },
        nonceCache: {},
        validateCallbackUrl: async () => {
          validateCalls += 1;
          return { ok: true, url: new URL(`${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`) };
        },
      }
    );

    expect(res.status).toBe(429);
    expect(validateCalls).toBe(0);
  });

  test("pair request rejects already paired peers before callback validation", async () => {
    const peer = makeIdentity();
    let validateCalls = 0;
    const now = new Date().toISOString();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "peer",
      status: "paired",
      mode: "mediated",
      profile: "restricted",
      trust_epoch: 1,
      created_at: now,
      updated_at: now,
      last_seen_at: now,
      blocked_reason: null,
    });

    const res = await handlePairRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
          protocol_version: "1",
          nonce: "abc",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      }),
      {
        pairLimiter: { allow: () => true },
        pairConfirmLimiter: { allow: () => true },
        nonceCache: {},
        validateCallbackUrl: async () => {
          validateCalls += 1;
          return { ok: true, url: new URL(`${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`) };
        },
      }
    );

    expect(res.status).toBe(409);
    expect(validateCalls).toBe(0);
    expect(await res.json()).toEqual({ error: "Peer is already paired." });
  });

  test("pair confirm rate limit", async () => {
    const peer = makeIdentity();
    const imposter = makeIdentity();
    createOutboundPairRequest({
      id: "pair-rl-test",
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      fingerprint: peer.fingerprint,
      base_url: TEST_REMOTE_BASE_URL,
      nonce: "challenge",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    let lastStatus = 0;
    for (let i = 0; i < 7; i += 1) {
      const res = await service.handleRequest(
        buildSignedRequest(imposter, "POST", "/api/remote/pair-confirm", {
          request_id: "pair-rl-test",
          challenge: "challenge",
        })
      );
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  test("pair request returns 409 when pending", async () => {
    const peer = makeIdentity();
    const res1 = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
          protocol_version: "1",
          nonce: "abc",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
    );

    expect(res1.status).toBe(202);
    const res2 = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "peer",
          callback_url: `${TEST_REMOTE_BASE_URL}/api/remote/pair-confirm`,
          protocol_version: "1",
          nonce: "def",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
    );

    expect(res2.status).toBe(409);
  });

  test("pair request rejected for blocked peer before callback validation", async () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "blocked-peer",
      status: "blocked",
      mode: "mediated",
      profile: "restricted",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: `${TEST_REMOTE_BASE_URL}`,
    });

    // Use a private-network URL that would fail callback validation –
    // if the blocked check runs first this never reaches validateCallbackUrl.
    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instance_id: peer.instance_id,
          public_key: peer.public_key,
          display_name: "blocked-peer",
          callback_url: "https://10.0.0.1/api/remote/pair-confirm",
          protocol_version: "1",
          nonce: "nonce-blocked",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      })
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("blocked");
  });

  test("pair request + confirm establishes peer", async () => {
    const peer = makeIdentity();
    const outboundId = "pair-confirm-ok";
    createOutboundPairRequest({
      id: outboundId,
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      fingerprint: peer.fingerprint,
      base_url: TEST_REMOTE_BASE_URL,
      nonce: "challenge",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const confirmRes = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/pair-confirm", {
        request_id: outboundId,
      }, { trustEpoch: null }),
    );
    expect(confirmRes.status).toBe(200);
    const confirmBody = await confirmRes.json();
    expect(confirmBody.status).toBe("paired");

    const stored = getRemotePeer(peer.instance_id);
    expect(stored?.status).toBe("paired");
  });

  test("pair confirm rejects invalid callback proof", async () => {
    const peer = makeIdentity();
    const imposter = makeIdentity();
    const outboundId = "pair-confirm-bad-sig";
    createOutboundPairRequest({
      id: outboundId,
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      fingerprint: peer.fingerprint,
      base_url: TEST_REMOTE_BASE_URL,
      nonce: "challenge",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    // Sign with the wrong key (imposter) so the signature won't verify
    const confirmRes = await service.handleRequest(
      buildSignedRequest(imposter, "POST", "/api/remote/pair-confirm", {
        request_id: outboundId,
      }, { trustEpoch: null }),
    );
    expect(confirmRes.status).toBe(401);
  });

  test("signed ping enforces nonce replay", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer);

    const pingReq = buildSignedRequest(peer, "GET", "/api/remote/ping");
    const pingRes = await service.handleRequest(pingReq);
    expect(pingRes.status).toBe(200);

    const replayReq = new Request("http://localhost/api/remote/ping", {
      method: "GET",
      headers: pingReq.headers,
    });
    const replayRes = await service.handleRequest(replayReq);
    expect(replayRes.status).toBe(401);
  });

  test("ping rate limit", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer);

    let lastStatus = 0;
    for (let i = 0; i < 61; i += 1) {
      const pingReq = buildSignedRequest(peer, "GET", "/api/remote/ping");
      const res = await service.handleRequest(pingReq);
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  test("proposal requires JSON content type", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer);

    const signed = buildSignedRequest(peer, "POST", "/api/remote/proposal", { prompt: "hi" });
    const headers = new Headers(signed.headers);
    headers.set("Content-Type", "text/plain");

    const proposalRes = await service.handleRequest(
      new Request("http://localhost/api/remote/proposal", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "hi" }),
      })
    );

    expect(proposalRes.status).toBe(415);
  });

  test("proposal creates remote request entry", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer);

    const proposalRes = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/proposal", {
        prompt: "Check disk usage",
      })
    );
    expect(proposalRes.status).toBe(200);
    const proposalBody = await proposalRes.json();
    expect(proposalBody.decision).toBe("human_required");
    expect(proposalBody.decision_model).toBe("github-copilot/gpt-5-mini");

    const stored = getRemoteRequestById(proposalBody.negotiation_id);
    expect(stored?.request_type).toBe("proposal");
  });

  test("proposal rejects read-only peers", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer, { profile: "read-only" });

    const proposalRes = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/proposal", {
        prompt: "Check disk usage",
      })
    );
    expect(proposalRes.status).toBe(403);
    const body = await proposalRes.json();
    expect(body.error).toContain("read-only");
  });

  test("proposal accepts non-mutating peers", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer, { profile: "non-mutating" });

    const proposalRes = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/proposal", {
        prompt: "List files",
      })
    );
    expect(proposalRes.status).toBe(200);
    const body = await proposalRes.json();
    expect(body.decision).toBe("human_required");
  });

  test("execute requires JSON content type", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer, { mode: "short-circuit", profile: "full" });

    const signed = buildSignedRequest(peer, "POST", "/api/remote/execute", { prompt: "hello" });
    const headers = new Headers(signed.headers);
    headers.set("Content-Type", "text/plain");

    const blocked = await service.handleRequest(
      new Request("http://localhost/api/remote/execute", {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "hello" }),
      })
    );
    expect(blocked.status).toBe(415);
  });

  test("execute returns recovery metadata and logs recovery summary on recovered success", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer, { mode: "short-circuit", profile: "full" });

    const serviceMod = await importFresh("../src/remote/service.js");
    const recoveringService = new serviceMod.RemoteInteropService(
      {
        runAgent: async () => ({
          status: "success",
          result: "Recovered remote result",
          recovery: {
            attemptsUsed: 1,
            totalElapsedMs: 900,
            recovered: true,
            exhausted: false,
            lastClassifier: "context_pressure",
            strategyHistory: ["compact_then_retry"],
          },
        }),
      } as any,
      {
        enabled: true,
        allowHttp: false,
        shortCircuitEnabled: true,
        instanceName: "",
        decisionModel: "github-copilot/gpt-5-mini",
      }
    );

    const response = await recoveringService.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/execute", { prompt: "hello" })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decision).toBe("accept_execute");
    expect(body.result).toBe("Recovered remote result");
    expect(body.recovery?.recovered).toBe(true);
    expect(body.recovery?.strategyHistory).toEqual(["compact_then_retry"]);
  });

  test("execute returns recovery metadata on exhausted failure", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer, { mode: "short-circuit", profile: "full" });

    const serviceMod = await importFresh("../src/remote/service.js");
    const exhaustedService = new serviceMod.RemoteInteropService(
      {
        runAgent: async () => ({
          status: "error",
          error: "Execution failed after retries",
          recovery: {
            attemptsUsed: 2,
            totalElapsedMs: 5000,
            recovered: false,
            exhausted: true,
            lastClassifier: "context_pressure",
            strategyHistory: ["retry", "compact_then_retry"],
          },
        }),
      } as any,
      {
        enabled: true,
        allowHttp: false,
        shortCircuitEnabled: true,
        instanceName: "",
        decisionModel: "github-copilot/gpt-5-mini",
      }
    );

    const response = await exhaustedService.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/execute", { prompt: "hello" })
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.decision).toBe("deny");
    expect(body.error).toBe("Execution failed after retries");
    expect(body.recovery?.exhausted).toBe(true);
    expect(body.recovery?.attemptsUsed).toBe(2);
  });

  test("execute is blocked without short-circuit enablement", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer);

    const blocked = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/execute", { prompt: "hello" })
    );
    expect(blocked.status).toBe(403);
  });

  // ─── Bidirectional pairing ─────────────────────────────────────────────────

  test("pair confirm stores base_url on receiver side", async () => {
    const peer = makeIdentity();
    const outboundId = "pair-confirm-base-url";
    createOutboundPairRequest({
      id: outboundId,
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      fingerprint: peer.fingerprint,
      base_url: TEST_REMOTE_BASE_URL,
      nonce: "challenge",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const confirmRes = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/pair-confirm", {
        request_id: outboundId,
      }, { trustEpoch: null }),
    );
    expect(confirmRes.status).toBe(200);

    const stored = getRemotePeer(peer.instance_id);
    expect(stored?.base_url).toBe(TEST_REMOTE_BASE_URL);
  });

  // ─── pair-callback endpoint ─────────────────────────────────────────────────

  test("pair-callback returns signed proof for valid outbound request", async () => {
    const receiver = makeIdentity();
    const outbound = {
      id: "pair-outbound-ok",
      instance_id: receiver.instance_id,
      public_key: receiver.public_key,
      fingerprint: "test-fp",
      base_url: TEST_REMOTE_BASE_URL,
      nonce: "test-challenge",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    };
    createOutboundPairRequest(outbound);

    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: outbound.id,
          challenge: outbound.nonce,
          receiver_instance_id: receiver.instance_id,
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toBe(outbound.id);
    expect(body.challenge).toBe(outbound.nonce);
    expect(body.instance_id).toBeTruthy();
    expect(body.signature).toBeTruthy();
  });

  test("pair-callback rejects challenge mismatch", async () => {
    const receiver = makeIdentity();
    createOutboundPairRequest({
      id: "pair-outbound-mismatch",
      instance_id: receiver.instance_id,
      public_key: receiver.public_key,
      fingerprint: "test-fp",
      base_url: TEST_REMOTE_BASE_URL,
      nonce: "correct-challenge",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: "pair-outbound-mismatch",
          challenge: "wrong-challenge",
          receiver_instance_id: receiver.instance_id,
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Challenge mismatch");
  });

  test("pair-callback rejects expired outbound request", async () => {
    const receiver = makeIdentity();
    createOutboundPairRequest({
      id: "pair-outbound-expired",
      instance_id: receiver.instance_id,
      public_key: receiver.public_key,
      fingerprint: "test-fp",
      base_url: TEST_REMOTE_BASE_URL,
      nonce: "challenge",
      status: "pending",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: "pair-outbound-expired",
          challenge: "challenge",
          receiver_instance_id: receiver.instance_id,
        }),
      })
    );

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain("expired");
  });

  test("pair-callback rejects receiver_instance_id mismatch", async () => {
    const receiver = makeIdentity();
    createOutboundPairRequest({
      id: "pair-outbound-rcv-mismatch",
      instance_id: receiver.instance_id,
      public_key: receiver.public_key,
      fingerprint: "test-fp",
      base_url: TEST_REMOTE_BASE_URL,
      nonce: "challenge",
      status: "pending",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: "pair-outbound-rcv-mismatch",
          challenge: "challenge",
          receiver_instance_id: "wrong-receiver-id",
        }),
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Receiver instance_id mismatch");
  });

  test("pair-callback returns 404 for unknown request", async () => {
    const res = await service.handleRequest(
      new Request("http://localhost/api/remote/pair-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_id: "nonexistent",
          challenge: "challenge",
          receiver_instance_id: "some-id",
        }),
      })
    );

    expect(res.status).toBe(404);
  });

  // ─── revoke endpoint ────────────────────────────────────────────────────────

  test("revoke marks peer as revoked and increments trust_epoch", async () => {
    const peer = makeIdentity();
    insertPairedPeer(peer);

    const stored = getRemotePeer(peer.instance_id);
    expect(stored?.status).toBe("paired");
    const originalEpoch = stored?.trust_epoch ?? 1;

    // Now revoke
    const revokeRes = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/revoke", {})
    );

    expect(revokeRes.status).toBe(200);
    const revokeBody = await revokeRes.json();
    expect(revokeBody.status).toBe("revoked");
    expect(revokeBody.trust_epoch).toBe(originalEpoch + 1);

    const revoked = getRemotePeer(peer.instance_id);
    expect(revoked?.status).toBe("revoked");
  });

  // ─── blocked peer rejection on operation endpoints ──────────────────────────

  test("proposal rejects blocked peer", async () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "blocked",
      status: "blocked",
      mode: "mediated",
      profile: "restricted",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: TEST_REMOTE_BASE_URL,
    });

    const res = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/proposal", { prompt: "test" })
    );

    expect(res.status).toBe(403);
  });

  test("ping rejects blocked peer", async () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "blocked",
      status: "blocked",
      mode: "mediated",
      profile: "restricted",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: TEST_REMOTE_BASE_URL,
    });

    const res = await service.handleRequest(
      buildSignedRequest(peer, "GET", "/api/remote/ping")
    );

    expect(res.status).toBe(403);
  });

  test("execute rejects blocked peer", async () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "blocked",
      status: "blocked",
      mode: "short-circuit",
      profile: "full",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: TEST_REMOTE_BASE_URL,
    });

    const res = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/execute", { prompt: "test" })
    );

    expect(res.status).toBe(403);
  });

  // ─── DB function tests ────────────────────────────────────────────────────

  test("getPendingRemoteRequests returns only pending proposals", () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "peer",
      status: "paired",
      mode: "mediated",
      profile: "full",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: TEST_REMOTE_BASE_URL,
    });

    storeRemoteRequest({
      id: "req-pending-1",
      peer_instance_id: peer.instance_id,
      request_type: "proposal",
      status: "pending",
      prompt: "do something",
      created_at: new Date().toISOString(),
      decision: null,
      remote_mode: "mediated",
      error: null,
      result: null,
    });
    storeRemoteRequest({
      id: "req-completed-1",
      peer_instance_id: peer.instance_id,
      request_type: "proposal",
      status: "completed",
      prompt: "already done",
      created_at: new Date().toISOString(),
      decision: "accepted",
      remote_mode: "mediated",
      error: null,
      result: "done",
    });

    const pending = getPendingRemoteRequests();
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe("req-pending-1");
  });

  test("updateRemoteRequestDecision marks proposal as accepted with result", () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "peer",
      status: "paired",
      mode: "mediated",
      profile: "full",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: TEST_REMOTE_BASE_URL,
    });

    storeRemoteRequest({
      id: "req-to-accept",
      peer_instance_id: peer.instance_id,
      request_type: "proposal",
      status: "pending",
      prompt: "test",
      created_at: new Date().toISOString(),
      decision: null,
      remote_mode: "mediated",
      error: null,
      result: null,
    });

    updateRemoteRequestDecision("req-to-accept", "accepted", "result text");
    const updated = getRemoteRequestById("req-to-accept");
    expect(updated?.status).toBe("completed");
    expect(updated?.decision).toBe("accepted");
    expect(updated?.result).toBe("result text");
  });

  test("updateRemoteRequestDecision marks proposal as rejected", () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "peer",
      status: "paired",
      mode: "mediated",
      profile: "full",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: TEST_REMOTE_BASE_URL,
    });

    storeRemoteRequest({
      id: "req-to-reject",
      peer_instance_id: peer.instance_id,
      request_type: "proposal",
      status: "pending",
      prompt: "test",
      created_at: new Date().toISOString(),
      decision: null,
      remote_mode: "mediated",
      error: null,
      result: null,
    });

    updateRemoteRequestDecision("req-to-reject", "rejected", null, "not allowed");
    const updated = getRemoteRequestById("req-to-reject");
    expect(updated?.status).toBe("rejected");
    expect(updated?.decision).toBe("rejected");
    expect(updated?.error).toBe("not allowed");
  });

  // ─── Result callback endpoint tests ───────────────────────────────────────

  test("result callback notifies operator with execution result", async () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "callback-peer",
      status: "paired",
      mode: "mediated",
      profile: "full",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: TEST_REMOTE_BASE_URL,
    });

    const res = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/result", {
        negotiation_id: "neg-123",
        decision: "accept_execute",
        result: "The answer is 42.",
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("result callback rejects unpaired peer", async () => {
    const peer = makeIdentity();
    // No upsertRemotePeer call — peer is unknown, so signature verification
    // fails before the pairing check (returns 401, not 403).

    const res = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/result", {
        negotiation_id: "neg-456",
        decision: "deny",
        reason: "nope",
      })
    );

    expect(res.status).toBe(401);
  });

  test("result callback rejects missing negotiation_id", async () => {
    const peer = makeIdentity();
    upsertRemotePeer({
      instance_id: peer.instance_id,
      public_key: peer.public_key,
      display_name: "peer",
      status: "paired",
      mode: "mediated",
      profile: "full",
      trust_epoch: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_seen_at: null,
      blocked_reason: null,
      base_url: TEST_REMOTE_BASE_URL,
    });

    const res = await service.handleRequest(
      buildSignedRequest(peer, "POST", "/api/remote/result", {
        decision: "accept_execute",
        result: "oops",
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("negotiation_id");
  });
});
