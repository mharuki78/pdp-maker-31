import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import * as auth from "../lib/pdp-server/higgsfield-auth";
import { GET as bridge } from "../app/api/pdp/higgsfield/bridge/route";
import { POST as exchange } from "../app/api/pdp/higgsfield/session/route";
import { POST as disconnect } from "../app/api/pdp/higgsfield/disconnect/route";
import { GET as callback } from "../app/api/pdp/higgsfield/callback/route";

process.env.HIGGSFIELD_APP_ORIGIN = "https://wizard.example";
process.env.HIGGSFIELD_SESSION_SECRET = Buffer.alloc(32, 7).toString("base64");
const request = () => new Request("https://wizard.example/api/pdp/higgsfield/session", {
  headers: { origin: "https://wizard.example", "sec-fetch-site": "same-origin" },
});
const session = { accessToken: "test-access", refreshToken: "test-refresh", expiresAt: Date.now() + 3600000, clientId: "test-client" };
const verifier = "a".repeat(43);
const challenge = createHash("sha256").update(verifier).digest("base64url");

test("an embedded wizard can read the session set in its own cookie partition", async () => {
  const response = auth.authJson(request(), session, { ok: true });
  const cookies = response.headers.getSetCookie();
  const embedded = cookies.find((value) => value.startsWith("pdp-higgsfield-embedded="));
  assert.ok(embedded, "the embedded wizard needs its own session cookie");
  assert.match(embedded, /; SameSite=None;/);
  assert.match(embedded, /; Secure;/);
  assert.match(embedded, /; Partitioned/);
  assert.match(embedded, /; HttpOnly;/);
  const next = new Request(request(), { headers: { cookie: embedded.split(";")[0] } });
  assert.equal((await auth.getHiggsfieldSession(next))?.accessToken, "test-access");
});

test("a disconnected iframe probe cannot erase a previously connected popup session", () => {
  const response = auth.authJson(request(), null, { ok: true, connected: false });
  assert.equal(response.headers.has("set-cookie"), false);
});

test("a handoff is encrypted, bound to the initiating verifier and app origin", () => {
  const ticket = auth.createHiggsfieldHandoff(request(), session, challenge);
  assert.equal(ticket.includes("test-access"), false);
  assert.equal(ticket.includes("test-refresh"), false);
  assert.deepEqual(auth.readHiggsfieldHandoff(request(), ticket, verifier), session);
  assert.throws(() => auth.readHiggsfieldHandoff(request(), ticket, "b".repeat(43)));
  assert.throws(() => auth.readHiggsfieldHandoff(request(), ticket.slice(0, -4) + "AAAA", verifier));
  assert.throws(() => auth.readHiggsfieldHandoff(request(), auth.seal(session), verifier));
  process.env.HIGGSFIELD_APP_ORIGIN = "https://other.example";
  try { assert.throws(() => auth.readHiggsfieldHandoff(request(), ticket, verifier)); }
  finally { process.env.HIGGSFIELD_APP_ORIGIN = "https://wizard.example"; }
});

test("expired handoffs cannot establish a new session", () => {
  const ticket = auth.createHiggsfieldHandoff(request(), session, challenge);
  const original = Date.now;
  Date.now = () => original() + 120000;
  try { assert.throws(() => auth.readHiggsfieldHandoff(request(), ticket, verifier)); }
  finally { Date.now = original; }
});

test("foreign origins and cross-site mutation requests remain rejected", () => {
  assert.throws(() => auth.assertSameOrigin(new Request(request(), { headers: { origin: "https://attacker.example" } })));
  assert.throws(() => auth.assertSameOrigin(new Request(request(), { headers: { "sec-fetch-site": "cross-site" } })));
  assert.doesNotThrow(() => auth.assertSameOrigin(request()));
});

test("the popup handoff establishes an HttpOnly iframe session without exposing provider tokens", async () => {
  const popupRequest = new Request(`https://wizard.example/api/pdp/higgsfield/bridge?challenge=${challenge}`, {
    headers: { cookie: auth.sessionCookie(request(), session).split(";")[0], "sec-fetch-site": "same-origin" },
  });
  const popup = await bridge(popupRequest);
  const html = await popup.text();
  assert.equal(popup.status, 200);
  assert.equal(html.includes("test-access"), false);
  assert.equal(html.includes("test-refresh"), false);
  assert.match(popup.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  const ticket = /"ticket":"([A-Za-z0-9_-]+)"/.exec(html)?.[1];
  assert.ok(ticket);
  const accepted = await exchange(new Request(request(), {
    method: "POST", headers: { ...Object.fromEntries(request().headers), "content-type": "application/json" },
    body: JSON.stringify({ ticket, verifier }),
  }));
  assert.equal(accepted.status, 200);
  const embedded = accepted.headers.getSetCookie().find(value => value.startsWith("pdp-higgsfield-embedded="))!;
  assert.equal((await auth.getHiggsfieldSession(new Request(request(), { headers: { cookie: embedded.split(";")[0] } })))?.accessToken, "test-access");
});

test("a forged handoff or a foreign site never receives a session cookie", async () => {
  for (const headers of [{ origin: "https://attacker.example" }, { origin: "https://wizard.example" }]) {
    const response = await exchange(new Request(request(), {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ ticket: "forged-ticket", verifier }),
    }));
    assert.equal(response.status, 400);
    assert.equal(response.headers.has("set-cookie"), false);
  }
});

test("disconnect expires both the popup and embedded session cookies", async () => {
  const response = await disconnect(new Request(request(), { method: "POST" }));
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) assert.match(cookie, /Max-Age=0/);
});

test("cancelled OAuth returns an error to the initiating wizard without setting a session", async () => {
  const pending = { state: "test-state", verifier, clientId: "test-client", redirectUri: "https://wizard.example/api/pdp/higgsfield/callback", expiresAt: Date.now() + 600000, handoffChallenge: challenge };
  const response = await callback(new Request("https://wizard.example/api/pdp/higgsfield/callback?state=test-state&error=access_denied", {
    headers: { cookie: auth.pendingCookie(request(), pending).split(";")[0] },
  }));
  const html = await response.text();
  assert.equal(response.status, 400);
  assert.match(html, /pdp-higgsfield-handoff/);
  assert.match(html, /"error":/);
  assert.equal(response.headers.getSetCookie().some(value => value.startsWith("pdp-higgsfield-session=")), false);
});
