import { assertSameOrigin, authJson, readHiggsfieldHandoff } from "../../../../../lib/pdp-server/higgsfield-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("연결 확인 요청 형식을 확인해 주세요.");
    const raw = await request.text();
    if (raw.length > 14000) throw new Error("연결 확인 요청이 너무 큽니다.");
    const body = JSON.parse(raw);
    if (typeof body.ticket !== "string" || typeof body.verifier !== "string") throw new Error("연결 확인 요청이 올바르지 않습니다.");
    const session = readHiggsfieldHandoff(request, body.ticket, body.verifier);
    return authJson(request, session, { ok: true });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "연결 정보를 적용하지 못했습니다." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
