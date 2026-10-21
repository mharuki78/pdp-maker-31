import { assertSameOrigin, createHiggsfieldHandoff, getHiggsfieldSession, higgsfieldBridgePage, sessionCookie, validHandoffChallenge } from "../../../../../lib/pdp-server/higgsfield-auth";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const challenge = new URL(request.url).searchParams.get("challenge") ?? "";
    if (!validHandoffChallenge(challenge)) throw new Error("마법사에서 연결 확인을 다시 눌러 주세요.");
    const session = await getHiggsfieldSession(request);
    if (!session) throw new Error("새 창에 저장된 연결이 없습니다. Higgsfield 계정 연결을 눌러 로그인해 주세요.");
    return higgsfieldBridgePage(request, { ticket: createHiggsfieldHandoff(request, session, challenge) }, new Headers({ "Set-Cookie": sessionCookie(request, session) }));
  } catch (error) {
    return higgsfieldBridgePage(request, { error: error instanceof Error ? error.message : "연결 확인에 실패했습니다." });
  }
}
