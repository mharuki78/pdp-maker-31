import assert from "node:assert/strict";
import test from "node:test";
import { getPdpExportPlan, validatePdpExportAsset } from "../lib/pdp-export-plan";

test("joining preserves first image, ordered body and last image without gaps or crops", () => {
  const plan = getPdpExportPlan([
    { width: 600, height: 100 }, { width: 1024, height: 1024 },
    { width: 600, height: 1200 }, { width: 900, height: 300 },
  ]);
  assert.equal(plan.width, 1080);
  assert.equal(plan.height, 3780);
  assert.deepEqual(plan.pages.map(p => [p.y, p.height]), [[0, 180], [180, 1080], [1260, 2160], [3420, 360]]);
  assert.equal(plan.scaledDown, false);
});

test("a long detail page fits browser canvas limits while keeping one common width", () => {
  const plan = getPdpExportPlan(Array.from({ length: 16 }, () => ({ width: 1080, height: 1920 })));
  assert.ok(plan.scaledDown);
  assert.ok(plan.width * plan.height <= 16_000_000);
  assert.ok(plan.height <= 30_000);
  assert.equal(plan.pages.at(-1)!.y + plan.pages.at(-1)!.height, plan.height);
  for (let i = 1; i < plan.pages.length; i++) {
    assert.equal(plan.pages[i].y, plan.pages[i - 1].y + plan.pages[i - 1].height);
  }
});

test("invalid or empty image sizes are rejected instead of producing an incomplete export", () => {
  for (const dimensions of [[], [{ width: 0, height: 300 }], [{ width: 100, height: NaN }]]) {
    assert.throws(() => getPdpExportPlan(dimensions));
  }
});

test("saved fixed images accept local raster data only, with bounded dimensions and size", () => {
  const valid = { fileName: "logo.png", dataUrl: "data:image/png;base64,aGVsbG8=", width: 600, height: 100 };
  assert.deepEqual(validatePdpExportAsset(valid), valid);
  for (const bad of [
    { ...valid, dataUrl: "https://elsewhere.example/logo.png" },
    { ...valid, dataUrl: "data:image/svg+xml;base64,aGVsbG8=" },
    { ...valid, height: 0 }, { ...valid, width: 20_000, height: 20_000 },
    { ...valid, dataUrl: "data:image/png;base64," },
  ]) assert.throws(() => validatePdpExportAsset(bad));
});
