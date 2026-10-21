import assert from "node:assert/strict";
import test from "node:test";
import { parseImageOptimizerResponse, prepareImageOptimizerUpload } from "../lib/pdp-image-upload";

test("an oversized reference is reduced before it reaches the optimizer upload", async () => {
  const original = new File([new Uint8Array(5 * 1024 * 1024)], "original.png", { type: "image/png" });
  const result = await prepareImageOptimizerUpload(original, async (file, maxBytes) => {
    assert.equal(file, original);
    assert.ok(maxBytes < 4_500_000);
    return new File([new Uint8Array(400000)], "transport.jpg", { type: "image/jpeg" });
  });
  assert.ok(result.size < 4_500_000);
  assert.equal(original.size, 5 * 1024 * 1024);
  assert.equal(original.type, "image/png");
});

test("a small reference passes through without recompression", async () => {
  const original = new File([new Uint8Array(1024)], "small.png", { type: "image/png" });
  const result = await prepareImageOptimizerUpload(original, async () => { throw new Error("must not compress"); });
  assert.equal(result, original);
});

test("an oversized compression result is stopped before any upload", async () => {
  const original = new File([new Uint8Array(5 * 1024 * 1024)], "too-large.png", { type: "image/png" });
  await assert.rejects(prepareImageOptimizerUpload(original, async file => file), /이미지 생성 요청은 전송하지 않았습니다/);
});

test("an optimizer 413 produces an actionable error instead of a JSON SyntaxError", async () => {
  await assert.rejects(parseImageOptimizerResponse(new Response("Request Entity Too Large", { status: 413 })), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /용량/);
    assert.equal(error instanceof SyntaxError, false);
    return true;
  });
});

test("an invalid optimizer response does not leak its body or report a provider submission", async () => {
  await assert.rejects(parseImageOptimizerResponse(new Response("<html>gateway error</html>", { status: 502 })), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /이미지 생성 요청은 전송하지 않았습니다/);
    assert.equal(error.message.includes("gateway error"), false);
    return true;
  });
});
