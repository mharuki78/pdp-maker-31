import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ISSUER = "https://clerk.higgsfield.ai";
const SESSION_COOKIE = "pdp-higgsfield-session";
const EMBEDDED_COOKIE = "pdp-higgsfield-embedded";
const PENDING_COOKIE = "pdp-higgsfield-oauth";
const runtime = globalThis as typeof globalThis & { pdpHiggsfieldCookieKey?: Buffer };
function key() {
  const configured = process.env.HIGGSFIELD_SESSION_SECRET;
  if (configured) {
    const buffer = Buffer.from(configured, "base64");
    if (buffer.length !== 32) throw new Error("HIGGSFIELD_SESSION_SECRET must be a base64-encoded 32-byte key.");
    return buffer;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Higgsfield 연결을 위해 서버에 HIGGSFIELD_SESSION_SECRET을 설정해 주세요.");
  return runtime.pdpHiggsfieldCookieKey ??= randomBytes(32);
}
export function seal(value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
function unseal<T>(value: string): T | null {
  try {
    const data = Buffer.from(value, "base64url"), decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
  } catch { return null; }
}
function readCookie<T>(request: Request, name: string) {
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return value ? unseal<T>(value) : null;
}
export function higgsfieldAppOrigin(request: Request) {
  const configured = process.env.HIGGSFIELD_APP_ORIGIN;
  if (configured) return new URL(configured).origin;
  const url = new URL(request.url), host = request.headers.get("host");
  if (!host) return url.origin;
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  const protocol = forwardedProtocol === "https" ? "https:" : url.protocol;
  const origin = new URL(`${protocol}//${host}`);
  if (origin.username || origin.password || origin.pathname !== "/") throw new Error("앱 연결 주소를 확인하지 못했습니다.");
  return origin.origin;
}
function cookie(request: Request, name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/api/pdp; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(higgsfieldAppOrigin(request)).protocol === "https:" ? "; Secure" : ""}`;
}
export interface HiggsfieldSession { accessToken: string; refreshToken?: string; expiresAt: number; clientId: string }
export interface HiggsfieldPending { state: string; verifier: string; clientId: string; redirectUri: string; expiresAt: number; handoffChallenge?: string }
export const pendingCookie = (request: Request, value: HiggsfieldPending) => cookie(request, PENDING_COOKIE, seal(value), 600);
export const readPending = (request: Request) => readCookie<HiggsfieldPending>(request, PENDING_COOKIE);
export const clearPendingCookie = (request: Request) => cookie(request, PENDING_COOKIE, "", 0);
export function sessionCookie(request: Request, value: HiggsfieldSession) {
  const encrypted = seal(value);
  if (encrypted.length > 3800) throw new Error("Higgsfield 로그인 정보가 브라우저 쿠키 용량을 초과했습니다.");
  return cookie(request, SESSION_COOKIE, encrypted, 30 * 86400);
}
export const clearSessionCookie = (request: Request) => cookie(request, SESSION_COOKIE, "", 0);
function embeddedCookie(request: Request, value: string, maxAge: number) {
  if (new URL(higgsfieldAppOrigin(request)).protocol !== "https:") return null;
  return `${EMBEDDED_COOKIE}=${value}; Path=/api/pdp; HttpOnly; SameSite=None; Max-Age=${maxAge}; Secure; Partitioned`;
}
export function clearHiggsfieldSession(request: Request) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", clearSessionCookie(request));
  const embedded = embeddedCookie(request, "", 0);
  if (embedded) headers.append("Set-Cookie", embedded);
  return Response.json({ ok: true, connected: false }, { headers });
}
export function validHandoffChallenge(value: string) { return /^[A-Za-z0-9_-]{43}$/.test(value); }
interface HiggsfieldHandoff { kind: "higgsfield-handoff-v1"; origin: string; challenge: string; expiresAt: number; session: HiggsfieldSession }
export function createHiggsfieldHandoff(request: Request, session: HiggsfieldSession, challenge: string) {
  if (!validHandoffChallenge(challenge)) throw new Error("연결 요청을 다시 시작해 주세요.");
  return seal({ kind: "higgsfield-handoff-v1", origin: higgsfieldAppOrigin(request), challenge, expiresAt: Date.now() + 60000, session } satisfies HiggsfieldHandoff);
}
export function readHiggsfieldHandoff(request: Request, ticket: string, verifier: string) {
  if (ticket.length > 12000 || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new Error("연결 확인 요청이 올바르지 않습니다.");
  const value = unseal<HiggsfieldHandoff>(ticket);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  if (!value || value.kind !== "higgsfield-handoff-v1" || value.origin !== higgsfieldAppOrigin(request) || !Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || !validState(value.challenge, challenge) || !value.session?.accessToken || value.session.expiresAt < Date.now()) throw new Error("연결 확인 요청이 만료되었거나 일치하지 않습니다. 다시 확인해 주세요.");
  return value.session;
}
export function higgsfieldBridgePage(request: Request, result: { ticket: string } | { error: string }, headers = new Headers()) {
  const nonce = randomBytes(18).toString("base64url");
  const message = "ticket" in result ? "연결 정보를 확인했습니다. 마법사 화면에 적용하고 있습니다." : result.error;
  const safeMessage = message.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
  const payload = JSON.stringify({ type: "pdp-higgsfield-handoff", ...result }).replace(/</g, "\\u003c");
  return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Higgsfield 연결 확인</title><body><h1>Higgsfield 연결 확인</h1><p>${safeMessage}</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${payload},${JSON.stringify(higgsfieldAppOrigin(request))});window.close();}</script></body></html>`, { headers, status: "ticket" in result ? 200 : 400 });
}
export function validState(left: string, right: string) { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if ((origin && origin !== higgsfieldAppOrigin(request)) || site === "cross-site") throw new Error("다른 사이트에서 시작한 연결 요청은 허용되지 않습니다.");
}
export async function oauthRequest(path: string, body: Record<string, unknown>, json = false) {
  const response = await fetch(`${ISSUER}${path}`, {
    method: "POST", headers: { "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded", "User-Agent": "pdp-maker/3.0" },
    body: json ? JSON.stringify(body) : new URLSearchParams(body as Record<string, string>), cache: "no-store", signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error(`Higgsfield 로그인 처리에 실패했습니다 (${response.status}). 다시 연결해 주세요.`);
  return response.json();
}
export function toSession(data: { access_token?: string; refresh_token?: string; expires_in?: number }, clientId: string): HiggsfieldSession {
  if (!data.access_token) throw new Error("Higgsfield 로그인 토큰을 받지 못했습니다.");
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000, clientId };
}
export async function getHiggsfieldSession(request: Request): Promise<HiggsfieldSession | null> {
  const session = readCookie<HiggsfieldSession>(request, SESSION_COOKIE) ?? readCookie<HiggsfieldSession>(request, EMBEDDED_COOKIE);
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60000) return session;
  if (!session.refreshToken) return null;
  try {
    const data = await oauthRequest("/oauth/token", { grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: session.clientId });
    return { ...toSession(data, session.clientId), refreshToken: data.refresh_token ?? session.refreshToken };
  } catch { return null; }
}
export function authJson(request: Request, session: HiggsfieldSession | null, data: unknown, status = 200) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  // A probe from a different browser partition must not erase another context's login.
  if (session) {
    headers.append("Set-Cookie", sessionCookie(request, session));
    const embedded = embeddedCookie(request, seal(session), 30 * 86400);
    if (embedded) headers.append("Set-Cookie", embedded);
  }
  return Response.json(data, { status, headers });
}
export const HIGGSFIELD_AUTHORIZE_URL = `${ISSUER}/oauth/authorize`;
