/**
 * login.ts – Web login page behavior (TOTP + optional passkey login).
 *
 * This module is bundled to /static/common/dist/login.bundle.js and loaded by
 * web/static/login.html. It intentionally has no framework/runtime deps.
 */

import { probePasskeyCapabilityBestEffort, readJsonBodyBestEffort, runPasskeyAttemptBestEffort } from './login-safety.js';
import { parseLoginPolicy, buildTotpLoginBody, type LoginPolicy } from './login-policy.js';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Login markup is missing ${id}.`);
  return node as T;
}
const form = element<HTMLFormElement>("login-form");
const codeInput = element<HTMLInputElement>("code");
const errorEl = element<HTMLDivElement>("error");
const description = element<HTMLParagraphElement>("login-description");
const passkeyButton = element<HTMLButtonElement>("passkey-button");
const verifyButton = element<HTMLButtonElement>("verify-button");
const retryButton = element<HTMLButtonElement>("retry-options");
let policy: LoginPolicy | null = null;
let submitting = false;

const base64UrlToBuffer = (value: string): Uint8Array => {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) buffer[i] = raw.charCodeAt(i);
  return buffer;
};

const bufferToBase64Url = (buffer: ArrayBufferLike): string => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const credentialToJSON = (cred: PublicKeyCredential) => ({
  id: cred.id,
  rawId: bufferToBase64Url(cred.rawId),
  type: cred.type,
  response: {
    clientDataJSON: bufferToBase64Url((cred.response as AuthenticatorAssertionResponse).clientDataJSON),
    authenticatorData: bufferToBase64Url((cred.response as AuthenticatorAssertionResponse).authenticatorData),
    signature: bufferToBase64Url((cred.response as AuthenticatorAssertionResponse).signature),
    userHandle: (cred.response as AuthenticatorAssertionResponse).userHandle
      ? bufferToBase64Url((cred.response as AuthenticatorAssertionResponse).userHandle as ArrayBuffer)
      : null,
  },
});

type LoginAllowCredential = {
  id: string;
  type?: string;
  transports?: string[];
};

type LoginOptionsPayload = {
  challenge: string;
  allowCredentials?: LoginAllowCredential[];
  [key: string]: unknown;
};

const parseLoginOptions = (options: LoginOptionsPayload) => ({
  ...options,
  challenge: base64UrlToBuffer(options.challenge),
  allowCredentials: (options.allowCredentials || []).map((cred: LoginAllowCredential) => ({
    ...cred,
    id: base64UrlToBuffer(cred.id),
  })),
});

let passkeyRequest: { controller: AbortController; conditional: boolean; done: Promise<boolean> } | null = null;
let passkeySucceeded = false;

const attemptPasskey = async ({ conditional }: { conditional: boolean }) => {
  if (!policy?.passkey) return;
  if (!window.PublicKeyCredential || !navigator.credentials) {
    if (!conditional) errorEl.textContent = "Passkeys are unavailable in this browser. Use a supported browser over HTTPS.";
    return;
  }
  if (passkeySucceeded || submitting) return;
  if (passkeyRequest) {
    if (conditional || !passkeyRequest.conditional) return;
    // Reserve the explicit request before waiting, so a second click cannot start another prompt.
    passkeyRequest.conditional = false;
    passkeyRequest.controller.abort();
    await passkeyRequest.done;
  }
  if (submitting || passkeySucceeded || !policy?.passkey) return;
  if (!conditional) errorEl.textContent = "";
  const controller = new AbortController();
  const done = runPasskeyAttemptBestEffort(async () => {
    const res = await fetch("/auth/webauthn/login/start", { method: "POST", signal: controller.signal });
    if (!res.ok) return false;

    const payload = await res.json();
    const publicKey = parseLoginOptions(payload.options);
    const cred = (await navigator.credentials.get({
      publicKey,
      mediation: conditional ? "conditional" : "required",
      signal: controller.signal,
    })) as PublicKeyCredential | null;

    if (!cred || controller.signal.aborted) return false;

    const finish = await fetch("/auth/webauthn/login/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: payload.token, credential: credentialToJSON(cred) }),
      signal: controller.signal,
    });

    if (finish.ok && !controller.signal.aborted) {
      passkeySucceeded = true;
      window.location.href = "/";
      return true;
    }
    return false;
  });
  passkeyRequest = { controller, conditional, done };
  const succeeded = await done;
  if (passkeyRequest?.controller === controller) passkeyRequest = null;
  if (succeeded) return;
  if (!conditional && !submitting && !controller.signal.aborted) errorEl.textContent = "Passkey sign-in was cancelled or failed. Try again or use an enabled alternative.";
};

async function loadPolicy(): Promise<void> {
  policy = null;
  form.hidden = true; passkeyButton.hidden = true; retryButton.hidden = true;
  errorEl.textContent = ""; description.textContent = "Loading sign-in options…";
  codeInput.disabled = true; verifyButton.disabled = true;
  try {
    const response = await fetch("/auth/options", { cache: "no-store" });
    if (!response.ok) throw new Error("Cannot load sign-in options.");
    policy = parseLoginPolicy(await response.json());
    if (!policy.auth_enabled) { window.location.href = "/"; return; }
    form.hidden = !policy.totp; passkeyButton.hidden = !policy.passkey;
    codeInput.disabled = !policy.totp; verifyButton.disabled = !policy.totp;
    description.textContent = policy.totp ? "Use the six-digit code from your authenticator app." : "Use a passkey registered for this site.";
    if (policy.totp) codeInput.focus();
    if (policy.passkey && window.PublicKeyCredential && typeof PublicKeyCredential.isConditionalMediationAvailable === "function") {
      const available = await probePasskeyCapabilityBestEffort(() => PublicKeyCredential.isConditionalMediationAvailable());
      if (available) void attemptPasskey({ conditional: true });
    }
  } catch {
    policy = null; form.hidden = true; passkeyButton.hidden = true;
    description.textContent = "Sign-in options could not be loaded.";
    errorEl.textContent = "Retry before entering credentials."; retryButton.hidden = false;
  }
}
passkeyButton.addEventListener("click", () => { void attemptPasskey({ conditional: false }); });
retryButton.addEventListener("click", () => { void loadPolicy(); });

const submitCode = async () => {
  if (submitting || !policy?.totp) return;
  errorEl.textContent = "";
  let body;
  try { body = buildTotpLoginBody(policy, codeInput.value); }
  catch (error) { errorEl.textContent = (error as Error).message; return; }
  submitting = true; verifyButton.disabled = true;
  try {
    if (passkeyRequest) { passkeyRequest.controller.abort(); await passkeyRequest.done; }
    const res = await fetch("/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { window.location.href = "/"; return; }
    const payload = await readJsonBodyBestEffort(res, {} as Record<string, unknown>);
    errorEl.textContent = typeof payload.error === "string" ? payload.error : "Sign-in failed. Check your credentials and try again.";
  } catch {
    errorEl.textContent = "Could not reach the server. Try again.";
  } finally {
    submitting = false; verifyButton.disabled = false;
  }
};

form.addEventListener("submit", (e) => {
  e.preventDefault();
  void submitCode();
});

void loadPolicy();
