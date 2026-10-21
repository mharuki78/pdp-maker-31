import assert from "node:assert/strict";
import test from "node:test";
import { findProductBounds, getProductThumbnailFrame } from "../lib/pdp-thumbnail";

function photo(width: number, height: number, transparent = false) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  if (transparent) for (let i = 3; i < pixels.length; i += 4) pixels[i] = 0;
  return { pixels, paint(x: number, y: number, w: number, h: number) {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) pixels.set([30, 120, 100, 255], (row * width + col) * 4);
  } };
}

test("a small off-centre product loses empty margins, including transparent margins", () => {
  for (const transparent of [false, true]) {
    const image = photo(200, 200, transparent);
    image.paint(120, 40, 40, 100);
    // One stray dark pixel must not make the product tiny again.
    image.paint(1, 1, 1, 1);
    const bounds = findProductBounds(image.pixels, 200, 200);
    assert.deepEqual(bounds, { x: 120, y: 40, width: 40, height: 100 });
    const frame = getProductThumbnailFrame(200, 200, bounds);
    assert.ok(Math.abs(100 / frame.size - 0.94) < 0.001);
    assert.equal(frame.x + frame.size / 2, 140);
    assert.equal(frame.y + frame.size / 2, 90);
    assert.ok(frame.x <= 120 && frame.x + frame.size >= 160);
  }
});

test("multiple product pieces remain together without stretching or cutting them", () => {
  const image = photo(200, 200);
  image.paint(30, 50, 40, 100); image.paint(120, 60, 50, 80);
  const bounds = findProductBounds(image.pixels, 200, 200);
  assert.deepEqual(bounds, { x: 30, y: 50, width: 140, height: 100 });
  const frame = getProductThumbnailFrame(200, 200, bounds);
  assert.ok(frame.x < 30 && frame.x + frame.size > 170);
});

test("a full scene or long detail page uses a square view instead of shrinking the whole page", () => {
  assert.deepEqual(getProductThumbnailFrame(900, 1600, { x: 0, y: 0, width: 900, height: 1600 }), { x: 0, y: 350, size: 900 });
  assert.deepEqual(getProductThumbnailFrame(800, 8000, { x: 0, y: 0, width: 800, height: 8000 }), { x: 0, y: 3600, size: 800 });
});

test("framing can move to the product and zoom in, identically for both export sizes", () => {
  const bounds = { x: 0, y: 0, width: 800, height: 8000 };
  const frame = getProductThumbnailFrame(800, 8000, bounds, { zoom: 2, x: 0, y: -45 });
  assert.deepEqual(frame, { x: 200, y: 200, size: 400 });
  for (const size of [750, 1000]) assert.equal(size / frame.size * frame.size, size);
});

test("an empty background safely keeps the original bounds", () => {
  assert.deepEqual(findProductBounds(photo(100, 100).pixels, 100, 100), { x: 0, y: 0, width: 100, height: 100 });
});
