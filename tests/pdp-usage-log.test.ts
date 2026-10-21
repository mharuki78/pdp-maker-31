import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/pdp/usage-log/route";

test("Vercel logs acknowledge events through a runtime sink without logging private payloads", async () => {
  const previous = process.env.VERCEL;
  const originalInfo = console.info;
  const messages: string[] = [];
  process.env.VERCEL = "1";
  console.info = (...values: unknown[]) => { messages.push(values.join(" ")); };
  try {
    const response = await POST(new Request("https://wizard.example/api/pdp/usage-log", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "editor.test", sessionId: "test-session", metadata: { apiKey: "private-test-key", customerNote: "private-customer-note" } }),
    }));
    assert.equal(response.status, 200);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /editor.test/);
    assert.equal(messages[0].includes("private-test-key"), false);
    assert.equal(messages[0].includes("private-customer-note"), false);
  } finally {
    console.info = originalInfo;
    if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous;
  }
});
