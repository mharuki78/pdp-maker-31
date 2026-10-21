import assert from "node:assert/strict";
import test from "node:test";
import { PdpService } from "../lib/pdp-server/pdp.service";
import { HiggsfieldMcp } from "../lib/pdp-server/higgsfield-mcp";
import type { ImageGenOptions, SectionBlueprint } from "../lib/shared/pdp";

const original = "data:image/png;base64,cHJvZHVjdA==";
const current = "data:image/png;base64,Y3VycmVudA==";
const person = "data:image/png;base64,cGVyc29u";
const request = "중국어 한글로 바꿔줘";
const section = (id: string, name: string): SectionBlueprint => ({
  section_id: id, section_name: name, goal: "제품 소개", headline: "기존 승인 제목",
  headline_en: "", subheadline: "", subheadline_en: "", bullets: [], bullets_en: [],
  trust_or_objection_line: "", trust_or_objection_line_en: "", CTA: "", CTA_en: "",
  layout_notes: "LEGACY_LAYOUT: replace the photograph with a different scene",
  compliance_notes: "", image_id: id, purpose: name, prompt_ko: "",
  prompt_en: "LEGACY_SCENE: photograph a new outdoor scene", negative_prompt: "LEGACY_NO_TRANSLATION",
  style_guide: "LEGACY_STYLE: redesign as studio", reference_usage: "preserve all Chinese labels",
});

// Replace only the paid provider boundary; exercise the real request normalization,
// reference ordering, and prompt selection without sending media or spending credits.
async function capture(section: SectionBlueprint, options: Partial<ImageGenOptions> = {}) {
  let submitted: Parameters<HiggsfieldMcp["generate"]>[0] | undefined;
  const previous = HiggsfieldMcp.prototype.generate;
  HiggsfieldMcp.prototype.generate = async function (input) {
    submitted = input;
    return { imageBase64: "cmVzdWx0", mimeType: "image/png" };
  };
  try {
    await new PdpService().generateSectionImage({
      originalImageBase64: original, section, aspectRatio: "9:16",
      options: { aiProvider: "higgsfield", style: "studio", withModel: false,
        outputMode: "full-image", isRegeneration: true, editInstruction: request,
        baseImageBase64: current, ...options },
    }, undefined, undefined, "test-only-token");
    assert.ok(submitted);
    return submitted;
  } finally {
    HiggsfieldMcp.prototype.generate = previous;
  }
}

for (const [id, name] of [["S1", "대표 히어로"], ["S2", "겨울 외출의 걸 문제"]]) {
  test(`${name}: a text edit uses the current image without reapplying legacy scene/copy instructions`, async () => {
    const sent = await capture(section(id, name));
    assert.ok(sent.prompt.includes(request), "the user's actual instruction must reach the provider");
    assert.doesNotMatch(sent.prompt, /LEGACY_|On-image headline: 기존 승인 제목|FINAL CASTING OVERRIDE/,
      "regeneration must not tell the provider to rebuild the scene or preserve text being translated");
    assert.match(sent.prompt, /LAST reference image.*(?:edit|target)/i);
    assert.deepEqual(sent.references.map(ref => ref.base64), ["cHJvZHVjdA==", "Y3VycmVudA=="]);
  });
}

test("translation edits explicitly include badges and product labels while preserving unrelated image content", async () => {
  const sent = await capture(section("S2", "겨울 외출의 걸 문제"));
  assert.match(sent.prompt, /translation.*(?:overrides|takes precedence)/i);
  assert.match(sent.prompt, /badges.*labels/i);
  assert.match(sent.prompt, /(?:remove|replace).*source-language/i);
  assert.match(sent.prompt, /(?:preserve|keep).*layout.*(?:people|person)/i);
});

test("a model reference never takes the place of the current image edit target", async () => {
  const sent = await capture(section("S2", "겨울 외출의 걸 문제"), {
    withModel: true, referenceModelImageBase64: person, referenceModelImageMimeType: "image/png",
  });
  assert.deepEqual(sent.references.map(ref => ref.base64), ["cHJvZHVjdA==", "cGVyc29u", "Y3VycmVudA=="]);
  assert.match(sent.prompt, /LAST reference image.*(?:edit|target)/i);
});

test("regeneration without a written edit keeps the normal scene-generation workflow", async () => {
  const sent = await capture(section("S2", "겨울 외출의 걸 문제"), {
    editInstruction: "  ", baseImageBase64: undefined,
  });
  assert.match(sent.prompt, /LEGACY_SCENE/);
  assert.match(sent.prompt, /On-image headline: 기존 승인 제목/);
  assert.equal(sent.references.length, 1);
});
