let pending = false;
export const higgsfieldPopupPending = () => pending;

// The proof stays in the opener. Only an encrypted, short-lived ticket crosses
// the popup boundary; OAuth access and refresh tokens never enter client code.
export async function openHiggsfieldPopup(mode: "connect" | "bridge") {
  if (pending) return;
  const popup = window.open("about:blank", "pdp-higgsfield-login", "popup,width=600,height=760");
  if (!popup) throw new Error("팝업이 차단되었습니다. 이 사이트의 팝업을 허용하고 다시 눌러 주세요.");
  pending = true;
  window.dispatchEvent(new Event("pdp-higgsfield-connecting"));
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const verifier = encode(bytes);
    const challenge = encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    await new Promise<void>((resolve, reject) => {
      let received = false, closedChecks = 0;
      const finish = (error?: Error) => {
        window.removeEventListener("message", onMessage);
        window.clearInterval(closed);
        window.clearTimeout(timeout);
        if (error) { popup.close(); reject(error); } else resolve();
      };
      const onMessage = async (event: MessageEvent) => {
        if (received || event.origin !== window.location.origin || event.source !== popup || event.data?.type !== "pdp-higgsfield-handoff") return;
        received = true;
        if (typeof event.data.error === "string") return finish(new Error(event.data.error));
        if (typeof event.data.ticket !== "string" || event.data.ticket.length > 12000) return finish(new Error("연결 확인 응답이 올바르지 않습니다."));
        try {
          const response = await fetch("/api/pdp/higgsfield/session", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticket: event.data.ticket, verifier }),
            signal: AbortSignal.timeout(30000),
          });
          const data = await response.json();
          if (!response.ok || !data.ok) throw new Error(data.message ?? "연결 정보를 적용하지 못했습니다.");
          finish();
        } catch (error) { finish(error instanceof Error ? error : new Error("연결 정보를 적용하지 못했습니다.")); }
      };
      const closed = window.setInterval(() => {
        if (!received && popup.closed && ++closedChecks >= 2) finish(new Error("연결 창이 닫혔습니다. 연결 확인 또는 계정 연결을 다시 눌러 주세요."));
      }, 500);
      const timeout = window.setTimeout(() => finish(new Error("연결 시간이 만료되었습니다. 다시 눌러 주세요.")), 600000);
      window.addEventListener("message", onMessage);
      popup.location.href = `/api/pdp/higgsfield/${mode}?challenge=${encodeURIComponent(challenge)}`;
    });
  } finally {
    pending = false;
    window.dispatchEvent(new Event("pdp-higgsfield-idle"));
  }
  window.dispatchEvent(new Event("pdp-higgsfield-changed"));
}
