export interface ProductBounds { x: number; y: number; width: number; height: number; }
export interface ThumbnailAdjustment { zoom: number; x: number; y: number; }

/** Trim only a consistent background; this is not AI product segmentation. */
export function findProductBounds(pixels: Uint8ClampedArray, width: number, height: number): ProductBounds {
  const full = { x: 0, y: 0, width, height };
  const rgb = (index: number) => [0, 1, 2].map(channel => 255 + (pixels[index * 4 + channel] - 255) * pixels[index * 4 + 3] / 255);
  const corners = [0, width - 1, (height - 1) * width, width * height - 1].map(rgb);
  const background = [0, 1, 2].map(channel => corners.map(color => color[channel]).sort((a, b) => a - b)[1]);
  const distance = (color: number[]) => Math.max(...color.map((value, channel) => Math.abs(value - background[channel])));
  if (corners.filter(color => distance(color) < 20).length < 3) return full;
  const rows = new Uint32Array(height), columns = new Uint32Array(width);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (distance(rgb(y * width + x)) > 18) { rows[y]++; columns[x]++; }
  }
  // Ignore isolated compression noise without discarding separate product pieces.
  const minX = columns.findIndex(count => count >= 2), minY = rows.findIndex(count => count >= 2);
  if (minX < 0 || minY < 0) return full;
  let maxX = width - 1, maxY = height - 1;
  while (columns[maxX] < 2) maxX--;
  while (rows[maxY] < 2) maxY--;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function getProductThumbnailFrame(width: number, height: number, bounds: ProductBounds, adjustment: ThumbnailAdjustment = { zoom: 1, x: 0, y: 0 }) {
  const fullScene = bounds.width >= width * .98 && bounds.height >= height * .98;
  const longPage = height > width * 2.4 && bounds.height > height * .8;
  const baseSize = fullScene || longPage ? Math.min(width, height) : Math.max(bounds.width, bounds.height) / .94;
  const size = baseSize / Math.max(.5, Math.min(3, adjustment.zoom));
  const centerX = Math.max(0, Math.min(width, bounds.x + bounds.width / 2 + adjustment.x * width / 100));
  const centerY = Math.max(0, Math.min(height, bounds.y + bounds.height / 2 + adjustment.y * height / 100));
  return { x: centerX - size / 2, y: centerY - size / 2, size };
}
