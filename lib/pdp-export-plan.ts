export interface PdpExportAsset {
  fileName: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface PdpExportAssets {
  first: PdpExportAsset | null;
  last: PdpExportAsset | null;
}

export function validatePdpExportAsset(value: unknown): PdpExportAsset {
  const asset = value as PdpExportAsset | null;
  if (!asset || typeof asset.fileName !== "string" || !asset.fileName.trim() ||
    typeof asset.dataUrl !== "string" || asset.dataUrl.length > 14_000_000 ||
    !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(asset.dataUrl) ||
    !Number.isInteger(asset.width) || !Number.isInteger(asset.height) ||
    asset.width < 1 || asset.height < 1 || asset.width * asset.height > 32_000_000) {
    throw new Error("PNG·JPG·WebP 이미지(10MB, 3,200만 화소 이하)를 선택해 주세요.");
  }
  return { fileName: asset.fileName.slice(0, 200), dataUrl: asset.dataUrl, width: asset.width, height: asset.height };
}

export function getPdpExportPlan(sizes: Array<{ width: number; height: number }>) {
  if (!sizes.length || sizes.some(size => !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0)) {
    throw new Error("모든 이미지의 크기를 확인한 뒤 다시 다운로드해 주세요.");
  }
  const ratio = sizes.reduce((sum, size) => sum + size.height / size.width, 0);
  let width = Math.min(1080, Math.floor(30_000 / ratio), Math.floor(Math.sqrt(16_000_000 / ratio)));
  const heightAt = (candidate: number) => sizes.reduce((sum, size) => sum + Math.max(1, Math.round(candidate * size.height / size.width)), 0);
  while (width > 0 && (heightAt(width) > 30_000 || width * heightAt(width) > 16_000_000)) width--;
  if (width < 320) throw new Error("이어진 이미지가 너무 깁니다. 첫·마지막 이미지 높이를 줄이거나 개별 이미지 ZIP을 이용해 주세요.");
  let y = 0;
  const pages = sizes.map(size => {
    const height = Math.max(1, Math.round(width * size.height / size.width));
    const page = { y, height };
    y += height;
    return page;
  });
  return { width, height: y, pages, scaledDown: width < 1080 };
}

/** Contain the whole hero: a square thumbnail must never cut off product or copy. */
export function getContainRect(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}
