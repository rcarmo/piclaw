/** Restricted invitation page. Grants live only in memory; no storage, logging or automatic claim. */
export {};
function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error("Missing invitation form element.");
  return node as T;
}
const status = element<HTMLParagraphElement>("invitation-status");
const error = element<HTMLDivElement>("invitation-error");
const claimButton = element<HTMLButtonElement>("claim-invitation");
const section = element<HTMLElement>("enrolment");
const account = element<HTMLParagraphElement>("enrolment-account");
const secret = element<HTMLElement>("enrolment-secret");
const qr = element<HTMLImageElement>("enrolment-qr");
const form = element<HTMLFormElement>("confirmation-form");
const code = element<HTMLInputElement>("confirmation-code");
const confirmButton = element<HTMLButtonElement>("confirm-invitation");

const fragment = new URLSearchParams(location.hash.slice(1));
const method = fragment.get('method') ?? 'totp';
let token = fragment.get('token') ?? '';
fragment.delete('token');
// Remove fragment and query before any fetch. Reload deliberately requires a fresh invitation link.
history.replaceState(null, "", location.pathname);
let enrolmentToken = "", busy = false, claimed = false, finished = false;
let expiresAt = 0, expiryTimer: ReturnType<typeof setTimeout> | undefined;
let activeRequest: AbortController | undefined;
let nativePrompt: AbortController | undefined, passkeyOptions: any = null;
let nativeActive = false;
const passkeySection = element('passkey-enrolment'), passkeyButton = element<HTMLButtonElement>('create-invitation-passkey');

function clearSecrets(): void {
  token = ""; enrolmentToken = ""; secret.textContent = ""; qr.removeAttribute("src"); code.value = "";
  passkeyOptions = null; passkeySection.hidden = true; passkeyButton.disabled = true; element('passkey-enrolment-account').textContent = ''; nativePrompt?.abort();
  section.hidden = true; code.disabled = true; confirmButton.disabled = true; claimButton.hidden = true;
  if (expiryTimer) clearTimeout(expiryTimer);
}
function expire(): void {
  finished = true; activeRequest?.abort(); clearSecrets();
  status.textContent = "This setup session has expired.";
  error.textContent = "Ask your administrator for a new invitation.";
}

if (!/^[a-zA-Z0-9_-]{43}$/.test(token) || !['totp','passkey'].includes(method)) {
  clearSecrets(); status.textContent = "No valid invitation was provided.";
  error.textContent = "Open the complete invitation link from your administrator.";
} else {
  status.textContent = `This invitation sets up ${method === 'passkey' ? 'a passkey' : 'an authenticator'} for one account. Setup expires five minutes after you begin.`;
  if (method === 'passkey') claimButton.textContent = 'Begin passkey setup';
  claimButton.hidden = false;
}

claimButton.addEventListener("click", async () => {
  if (busy || claimed || !token || finished) return;
  busy = true; claimed = true; claimButton.disabled = true; error.textContent = "";
  activeRequest = new AbortController();
  const timeout = setTimeout(() => activeRequest?.abort(), 15000);
  try {
    const response = await fetch(method === 'passkey' ? '/auth/invitation/passkey/claim' : '/auth/invitation/claim', { method: "POST", cache: 'no-store', credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: activeRequest.signal });
    if (!response.ok) throw new Error("Claim rejected.");
    const body = await response.json();
    if (finished) return;
    if (method === 'passkey') {
      if (typeof body.enrolment_token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(body.enrolment_token) || typeof body.username !== 'string' || typeof body.user_id !== 'string'
        || !Number.isFinite(body.expires_at) || body.expires_at <= Date.now() || body.expires_at > Date.now()+5*60_000
        || !body.options?.challenge || body.options.user?.id !== encode(new TextEncoder().encode(body.user_id).buffer)
        || body.options.authenticatorSelection?.residentKey !== 'required' || body.options.authenticatorSelection?.userVerification !== 'required') throw new Error('Invalid passkey setup.');
      enrolmentToken = body.enrolment_token; expiresAt = body.expires_at; passkeyOptions = body.options;
      element('passkey-enrolment-account').textContent = `Account: ${body.username}`; claimButton.hidden = true; passkeySection.hidden = false;
      passkeyButton.disabled = !window.PublicKeyCredential || !navigator.credentials;
      status.textContent = passkeyButton.disabled ? 'Passkeys require a supported browser and trusted secure origin.' : 'Create a passkey for the displayed account.';
      expiryTimer = setTimeout(expire, expiresAt-Date.now()); return;
    }
    if (typeof body.enrolment_token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(body.enrolment_token)
      || typeof body.secret !== "string" || !/^[A-Z2-7]{32}$/.test(body.secret)
      || typeof body.username !== "string" || !Number.isFinite(body.expires_at) || body.expires_at <= Date.now()
      || typeof body.qr_data_url !== "string" || !body.qr_data_url.startsWith("data:image/svg+xml;base64,")) throw new Error("Invalid enrolment response.");
    enrolmentToken = body.enrolment_token; expiresAt = body.expires_at;
    account.textContent = `Account: ${body.username}`; secret.textContent = body.secret; qr.src = body.qr_data_url;
    claimButton.hidden = true; section.hidden = false; code.disabled = false; confirmButton.disabled = false;
    status.textContent = "Scan the QR code, then enter the six-digit code from your authenticator.";
    expiryTimer = setTimeout(expire, Math.min(expiresAt - Date.now(), 5 * 60_000)); code.focus();
  } catch {
    if (!finished) {
      finished = true; clearSecrets(); status.textContent = "Setup could not begin.";
      error.textContent = "The invitation may be expired or already used. Ask your administrator for a new link; do not retry a consumed claim.";
    }
  } finally { clearTimeout(timeout); busy = false; }
});

const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const encode = (value: ArrayBuffer) => btoa(Array.from(new Uint8Array(value), byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
function cancelPasskey(): void {
  finished = true; activeRequest?.abort(); clearSecrets(); status.textContent = 'Passkey setup discarded.'; error.textContent = 'Ask your administrator for a new invitation.';
}
element('cancel-invitation-passkey').addEventListener('click', cancelPasskey);
passkeyButton.addEventListener('click', async () => {
  if (busy || finished || !passkeyOptions || !token || !enrolmentToken || Date.now() >= expiresAt) return;
  busy = true; passkeyButton.disabled = true; error.textContent = ''; nativePrompt = new AbortController();
  const options = passkeyOptions; passkeyOptions = null;
  try {
    nativeActive = true;
    let credential: PublicKeyCredential | null;
    try { credential = await navigator.credentials.create({ signal: AbortSignal.any([nativePrompt.signal, AbortSignal.timeout(120_000)]), publicKey: {
      ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((key: any) => ({ ...key, id: decode(key.id) })),
    } }) as PublicKeyCredential | null; } finally { nativeActive = false; }
    if (!credential || finished || nativePrompt.signal.aborted || Date.now() >= expiresAt) throw new Error('Cancelled.');
    // A native dialog may blur the tab. Recheck the restricted cookie/grant, never a normal login.
    activeRequest = new AbortController();
    const post = (path: string, body: unknown) => fetch('/auth/invitation/passkey/'+path, { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([activeRequest!.signal, AbortSignal.timeout(15_000)]) });
    const proof = { token, enrolment_token: enrolmentToken };
    const check = await post('check', proof);
    if (!check.ok || (await check.json()).valid !== true || finished || nativePrompt.signal.aborted) throw new Error('Setup changed.');
    const response = credential.response as AuthenticatorAttestationResponse;
    const confirmed = await post('confirm', { ...proof, credential: { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
      response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(response.attestationObject), transports: response.getTransports?.() ?? [] },
      clientExtensionResults: credential.getClientExtensionResults(), authenticatorAttachment: credential.authenticatorAttachment } });
    const result = await confirmed.json();
    if (finished) return;
    if (!confirmed.ok || result.enrolled !== true || result.login_required !== true) throw new Error('Setup failed.');
    finished = true; clearSecrets(); status.textContent = result.recovery_only === true ? 'Account recovery complete. Ask the operator to stop recovery mode and start Piclaw normally.' : 'Account setup complete. Sign in to continue.';
    const login=element<HTMLAnchorElement>('invitation-login');login.textContent=result.recovery_only===true?'Recovery complete':'Sign in';login.hidden=result.recovery_only===true;
  } catch {
    if (!finished) { finished = true; clearSecrets(); status.textContent = 'Passkey setup could not be verified.'; error.textContent = 'No automatic retry was made. Try signing in if setup completed, or ask for a new invitation.'; }
  } finally { busy = false; nativeActive = false; }
});
addEventListener('blur', () => { if (method === 'passkey' && !finished && !nativeActive) cancelPasskey(); });
document.addEventListener('visibilitychange', () => { if (method === 'passkey' && document.hidden && !finished && !nativeActive) cancelPasskey(); });

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (busy || finished || !token || !enrolmentToken) return;
  if (Date.now() >= expiresAt) { expire(); return; }
  const value = code.value.trim();
  if (!/^\d{6}$/.test(value)) { error.textContent = "Enter a six-digit code."; return; }
  busy = true; confirmButton.disabled = true; error.textContent = "";
  activeRequest = new AbortController();
  const timeout = setTimeout(() => activeRequest?.abort(), 15000);
  try {
    const response = await fetch("/auth/invitation/confirm", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, enrolment_token: enrolmentToken, code: value }), signal: activeRequest.signal });
    const body = await response.json();
    if (finished) return;
    if (!response.ok || body.enrolled !== true || body.login_required !== true) { error.textContent = "The code or invitation was not accepted. Check the code; after repeated failures request a new invitation."; return; }
    finished = true; clearSecrets(); status.textContent = body.recovery_only === true ? "Account recovery complete. Ask the operator to stop recovery mode and start Piclaw normally." : "Account setup complete. Sign in to continue.";
    const login=element<HTMLAnchorElement>("invitation-login");login.textContent=body.recovery_only===true?"Recovery complete":"Sign in";login.hidden=body.recovery_only===true;
  } catch {
    if (!finished) error.textContent = "Confirmation could not be verified. Try signing in if setup completed, or request a new invitation.";
  } finally { clearTimeout(timeout); busy = false; if (!finished) confirmButton.disabled = false; }
});

addEventListener("hashchange", () => {
  if (!location.hash) return;
  // A fresh link in this tab must not reuse the previous one-use ceremony.
  finished = true; activeRequest?.abort(); clearSecrets(); location.reload();
});
addEventListener("pagehide", () => { finished = true; activeRequest?.abort(); clearSecrets(); });
addEventListener("pageshow", event => {
  if ((event as PageTransitionEvent).persisted) { finished = true; clearSecrets(); status.textContent = "Reopen a fresh invitation link to continue."; }
});
