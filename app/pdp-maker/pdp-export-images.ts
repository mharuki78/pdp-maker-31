import { getContainRect, getPdpExportPlan } from "../../lib/pdp-export-plan";

export function exportBlobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("다운로드 링크를 만들지 못했습니다. 다시 시도해 주세요."));
    reader.readAsDataURL(blob);
  });
}

export function downloadPreparedExport(url: string, fileName: string) {
  const link = document.createElement("a");
  link.href = url; link.download = fileName;
  document.body.appendChild(link);
  link.click(); link.remove();
}

async function openImage(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { URL.revokeObjectURL(url); throw new Error("내보낼 이미지 중 읽을 수 없는 파일이 있습니다."); }
  return { image, close: () => { image.src = ""; URL.revokeObjectURL(url); } };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => {
    if (blob?.size) resolve(blob);
    else reject(new Error("브라우저에서 이미지를 만들지 못했습니다. 다른 앱을 닫거나 개별 이미지 ZIP을 이용해 주세요."));
  }, type, 0.94));
}

export async function createPdpThumbnail(blob: Blob, size: 750 | 1000 = 750) {
  const source = await openImage(blob);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("썸네일을 만들 수 없는 브라우저입니다.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size, size);
    const rect = getContainRect(source.image.naturalWidth, source.image.naturalHeight, size, size);
    context.drawImage(source.image, rect.x, rect.y, rect.width, rect.height);
    return await canvasBlob(canvas, "image/jpeg");
  } finally { source.close(); canvas.width = canvas.height = 0; }
}

/** Decode only one page at a time; retain compressed blobs, not 12 full canvases. */
export async function joinPdpImages(blobs: Blob[], onProgress?: (completed: number, total: number) => void) {
  const sizes: Array<{ width: number; height: number }> = [];
  for (const blob of blobs) {
    const source = await openImage(blob);
    sizes.push({ width: source.image.naturalWidth, height: source.image.naturalHeight });
    source.close();
  }
  const plan = getPdpExportPlan(sizes);
  const canvas = document.createElement("canvas");
  canvas.width = plan.width; canvas.height = plan.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이어진 이미지를 만들 수 없는 브라우저입니다.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < blobs.length; index++) {
      const source = await openImage(blobs[index]);
      try { context.drawImage(source.image, 0, plan.pages[index].y, plan.width, plan.pages[index].height); }
      finally { source.close(); }
      onProgress?.(index + 1, blobs.length);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    return { blob: await canvasBlob(canvas, "image/png"), width: plan.width, height: plan.height, scaledDown: plan.scaledDown };
  } finally { canvas.width = canvas.height = 0; }
}

export function exportAssetBlob(dataUrl: string) {
  const [header, encoded] = dataUrl.split(",");
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  return new Blob([bytes], { type: header.match(/^data:([^;]+)/)?.[1] ?? "image/png" });
}
