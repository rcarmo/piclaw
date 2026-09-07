import { beforeAll, afterAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright";
import { join } from "node:path";
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';

const browserTest = process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS === "1" ? test : test.skip;
let browser: Browser, server: ReturnType<typeof Bun.serve>, base: string;
const grant = "g".repeat(43), enrolled = "e".repeat(43), seed = "A".repeat(32);
const image = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>').toString("base64");
beforeAll(async () => {
  if (process.env.PICLAW_RUN_OPTIONAL_BROWSER_TESTS !== "1") return;
  browser = await chromium.launch({ headless: true });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/auth/invitation") return new Response(Bun.file(join(import.meta.dir, "../../web/static/invitation.html")), { headers: { "Content-Type": "text/html", "Referrer-Policy": "no-referrer" } });
    if (["/static/common/dist/invitation.bundle.js", "/static/common/dist/login.bundle.css"].includes(path)) return new Response(Bun.file(join(import.meta.dir, "../../web/static", path.slice("/static/".length))));
    return new Response("not found", { status: 404 });
  } }); base = `http://localhost:${server.port}`;
});
afterAll(async () => { await browser?.close(); server?.stop(true); });

browserTest('passkey invitation uses native discoverable registration for each account, verifies proof and never logs in', async () => {
  for (const user of ['alice','bob']) {
    const page = await browser.newPage({viewport:{width:375,height:740}}), cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('WebAuthn.enable'); await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
      const options = await generateRegistrationOptions({rpName:'PiClaw',rpID:'localhost',userID:new TextEncoder().encode(user),userName:user,attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'}});
      const calls: string[] = []; let verified = false;
      await page.route('**/auth/invitation/passkey/claim', route => { calls.push('claim'); expect(route.request().postDataJSON()).toEqual({token:grant}); return route.fulfill({json:{enrolment_token:enrolled,options,expires_at:Date.now()+60_000,username:user,user_id:user}}); });
      await page.route('**/auth/invitation/passkey/check', route => { calls.push('check'); expect(route.request().postDataJSON()).toEqual({token:grant,enrolment_token:enrolled}); return route.fulfill({json:{valid:true}}); });
      await page.route('**/auth/invitation/passkey/confirm', async route => {
        calls.push('confirm'); const body = route.request().postDataJSON(); expect(body.token).toBe(grant); expect(body.enrolment_token).toBe(enrolled);
        const result = await verifyRegistrationResponse({response:body.credential,expectedChallenge:options.challenge,expectedRPID:'localhost',expectedOrigin:base,requireUserVerification:true}); verified=result.verified;
        await route.fulfill({json:{enrolled:verified,login_required:true}});
      });
      await page.addInitScript(() => { const create = navigator.credentials.create.bind(navigator.credentials); navigator.credentials.create = async options => { dispatchEvent(new Event('blur')); try { return await create(options); } finally { dispatchEvent(new Event('focus')); } }; });
      await page.goto(base+'/auth/invitation#token='+grant+'&method=passkey'); await page.locator('#claim-invitation').waitFor({state:'visible'});
      expect(page.url()).toBe(base+'/auth/invitation'); expect(calls).toEqual([]); expect(await page.locator('#claim-invitation').textContent()).toBe('Begin passkey setup');
      await page.locator('#claim-invitation').click(); await page.locator('#create-invitation-passkey').waitFor({state:'visible'}); expect(calls).toEqual(['claim']);
      expect(await page.locator('#passkey-enrolment-account').textContent()).toBe('Account: '+user); expect(await page.locator('#enrolment-secret').textContent()).toBe('');
      await page.locator('#create-invitation-passkey').click(); await page.waitForFunction(()=>document.getElementById('invitation-status')?.textContent?.includes('complete'));
      expect(verified).toBe(true); expect(calls).toEqual(['claim','check','confirm']); expect(page.url()).toBe(base+'/auth/invitation'); expect(await page.context().cookies()).toEqual([]);
      expect(await page.locator('#passkey-enrolment').isVisible()).toBe(false); expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length])).toEqual([0,0]);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    } finally { await cdp.detach(); await page.close(); }
  }
},20000);

browserTest('cancel/navigation or replaced enrolment cookie during native prompt cannot finish a late credential', async () => {
  for (const action of ['cancel','pagehide','cookie']) {
    const page = await browser.newPage(); let finishes=0, checks=0;
    try {
      const options = await generateRegistrationOptions({rpName:'PiClaw',rpID:'localhost',userID:new TextEncoder().encode('alice'),userName:'alice',attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'}});
      await page.route('**/auth/invitation/passkey/claim',route=>route.fulfill({json:{enrolment_token:enrolled,options,expires_at:Date.now()+60_000,username:'alice',user_id:'alice'}}));
      await page.route('**/auth/invitation/passkey/check',route=>{ checks++; return route.fulfill({status:403,json:{}}); });
      await page.route('**/auth/invitation/passkey/confirm',route=>{ finishes++; return route.fulfill({json:{}}); });
      await page.addInitScript(()=>{navigator.credentials.create = options=>new Promise(resolve=>{(window as any).nativeSignal=options?.signal;(window as any).releasePasskey=()=>resolve({id:'late',rawId:new ArrayBuffer(1),type:'public-key',response:{clientDataJSON:new ArrayBuffer(1),attestationObject:new ArrayBuffer(1)},getClientExtensionResults:()=>({})} as any);});});
      await page.goto(base+'/auth/invitation#token='+grant+'&method=passkey'); await page.locator('#claim-invitation').click(); await page.locator('#create-invitation-passkey').click();
      await page.waitForFunction(()=>typeof (window as any).releasePasskey==='function');
      if(action==='cancel') await page.locator('#cancel-invitation-passkey').click(); else if(action==='pagehide') await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
      await page.evaluate(()=>(window as any).releasePasskey());
      if(action==='cookie') await page.waitForFunction(()=>document.getElementById('invitation-status')?.textContent?.includes('could not be verified')); else { expect(await page.evaluate(()=>(window as any).nativeSignal.aborted)).toBe(true); await page.waitForTimeout(70); }
      expect(finishes).toBe(0); expect(checks).toBe(action==='cookie'?1:0); expect(await page.locator('#passkey-enrolment').isVisible()).toBe(false);
    } finally { await page.close(); }
  }
},20000);

browserTest('passkey setup clears on ordinary blur, rejects malformed bindings and never retries failed claims', async () => {
  const page = await browser.newPage(); let claims=0;
  try {
    const options = await generateRegistrationOptions({rpName:'PiClaw',rpID:'localhost',userID:new TextEncoder().encode('alice'),userName:'alice',attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'}});
    await page.route('**/auth/invitation/passkey/claim',route=>{claims++;return route.fulfill({json:{enrolment_token:enrolled,options,expires_at:Date.now()+60_000,username:'alice',user_id:claims===1?'alice':'wrong'}});});
    await page.goto(base+'/auth/invitation#token='+grant+'&method=passkey'); await page.locator('#claim-invitation').click(); await page.locator('#create-invitation-passkey').waitFor({state:'visible'});
    await page.evaluate(()=>dispatchEvent(new Event('blur'))); expect(await page.locator('#passkey-enrolment-account').textContent()).toBe(''); expect(await page.locator('#passkey-enrolment').isVisible()).toBe(false);
    await page.goto(base+'/auth/invitation#token='+grant+'&method=passkey'); await page.locator('#claim-invitation').click(); await page.waitForFunction(()=>document.getElementById('invitation-status')?.textContent?.includes('could not begin'));
    expect(claims).toBe(2); expect(await page.locator('#create-invitation-passkey').isVisible()).toBe(false);
  } finally { await page.close(); }
},20000);

browserTest("invitation clears fragment, claims only on click, confirms and erases seed without logging in", async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 740 } });
  const calls: Array<{ url: string; body: any }> = [];
  try {
    await page.route("**/auth/invitation/claim", route => { calls.push({ url: route.request().url(), body: route.request().postDataJSON() }); return route.fulfill({ json: { enrolment_token: enrolled, secret: seed, expires_at: Date.now()+60_000, username: "alice", qr_data_url: image } }); });
    await page.route("**/auth/invitation/confirm", route => { calls.push({ url: route.request().url(), body: route.request().postDataJSON() }); return route.fulfill({ json: { enrolled: true, login_required: true } }); });
    await page.goto(base + "/auth/invitation#token=" + grant);
    await page.locator("#claim-invitation").waitFor({ state: "visible" });
    expect(page.url()).toBe(base+"/auth/invitation"); expect(calls).toHaveLength(0);
    await page.locator("#claim-invitation").click(); await page.locator("#confirmation-code").waitFor({ state: "visible" });
    expect(calls[0]!.body).toEqual({ token: grant }); expect(calls[0]!.url).not.toContain(grant);
    expect(await page.locator("#enrolment-secret").textContent()).toBe(seed);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#confirmation-code").fill("123456"); await page.locator("#confirm-invitation").click();
    await page.waitForFunction(() => document.getElementById("invitation-status")?.textContent?.includes("complete"));
    expect(calls[1]!.body).toEqual({ token: grant, enrolment_token: enrolled, code: "123456" });
    expect(await page.locator("#enrolment-secret").textContent()).toBe(""); expect(await page.locator("#enrolment-qr").getAttribute("src")).toBeNull();
    expect(page.url()).toBe(base+"/auth/invitation"); expect(await page.locator("#invitation-login").textContent()).toBe("Sign in");
  } finally { await page.close(); }
}, 20000);

browserTest("recovery-only completion hides the unavailable normal sign-in link", async () => {
  const page = await browser.newPage();
  try {
    await page.route("**/auth/invitation/claim", route => route.fulfill({ json: { enrolment_token: enrolled, secret: seed, expires_at: Date.now()+60_000, username: "alice", qr_data_url: image } }));
    await page.route("**/auth/invitation/confirm", route => route.fulfill({ json: { enrolled: true, login_required: true, recovery_only: true } }));
    await page.goto(base+"/auth/invitation#token="+grant); await page.locator("#claim-invitation").click(); await page.locator("#confirmation-code").fill("123456"); await page.locator("#confirm-invitation").click();
    await page.waitForFunction(()=>document.getElementById("invitation-status")?.textContent?.includes("recovery complete"));
    expect(await page.locator("#invitation-login").isVisible()).toBe(false); expect(await page.locator("#enrolment-secret").textContent()).toBe("");
  } finally { await page.close(); }
}, 20000);

browserTest("invalid/missing grants and failed claims do not reveal or automatically retry enrolment", async () => {
  const page = await browser.newPage(); let calls=0;
  try {
    await page.route("**/auth/invitation/claim", route => { calls++; return route.fulfill({ status: 403, json: { error: "expired" } }); });
    await page.goto(base+"/auth/invitation?token="+grant);
    await page.waitForFunction(() => document.getElementById("invitation-status")?.textContent?.includes("No valid"));
    expect(await page.locator("#claim-invitation").isVisible()).toBe(false); expect(calls).toBe(0);
    await page.goto(base+"/auth/invitation#token="+grant); await page.locator("#claim-invitation").click();
    await page.waitForFunction(() => document.getElementById("invitation-status")?.textContent?.includes("could not begin"));
    expect(calls).toBe(1); expect(await page.locator("#claim-invitation").isVisible()).toBe(false); expect(await page.locator("#enrolment").isVisible()).toBe(false);
  } finally { await page.close(); }
}, 20000);

browserTest("expiry and pagehide clear secrets; failed code keeps bounded confirmation available", async () => {
  const page = await browser.newPage();
  try {
    await page.clock.install();
    await page.route("**/auth/invitation/claim", route => route.fulfill({ json: { enrolment_token: enrolled, secret: seed, expires_at: Date.now()+5*60_000, username: "alice", qr_data_url: image } }));
    await page.route("**/auth/invitation/confirm", route => route.fulfill({ status: 403, json: { error: "bad code" } }));
    await page.goto(base+"/auth/invitation#token="+grant); await page.locator("#claim-invitation").click(); await page.locator("#confirmation-code").fill("123456");
    await page.locator("#confirm-invitation").click();
    await page.waitForFunction(() => document.getElementById("invitation-error")?.textContent?.includes("not accepted"));
    expect(await page.locator("#confirm-invitation").isEnabled()).toBe(true);
    await page.clock.fastForward(6*60_000);
    expect(await page.locator("#enrolment-secret").textContent()).toBe(""); expect(await page.locator("#enrolment").isVisible()).toBe(false);
    await page.clock.setFixedTime(new Date());
    await page.goto(base+"/auth/invitation#token="+grant); await page.locator("#claim-invitation").click();
    await page.locator("#confirmation-code").waitFor({ state: "visible" });
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(await page.locator("#enrolment-secret").textContent()).toBe(""); expect(await page.locator("#enrolment-qr").getAttribute("src")).toBeNull();
  } finally { await page.close(); }
}, 20000);
