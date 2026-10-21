export const MAX_OPTIMIZER_UPLOAD_BYTES = 3_600_000;
export async function prepareImageOptimizerUpload(file: File, compress = compressUploadInBrowser) {
  if (file.size <= MAX_OPTIMIZER_UPLOAD_BYTES) return file;
  const copy = await compress(file, MAX_OPTIMIZER_UPLOAD_BYTES);
  if (!copy.size || copy.size > MAX_OPTIMIZER_UPLOAD_BYTES) throw new Error("이미지 전송 용량을 줄이지 못했습니다. 원본과 기존 결과는 보존했으며 이미지 생성 요청은 전송하지 않았습니다.");
  return copy;
}
export async function parseImageOptimizerResponse(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (response.status === 413) throw new Error("이미지 전송 용량이 서버 제한을 초과했습니다. 원본과 기존 결과는 보존했으며 이미지 생성 요청은 전송하지 않았습니다.");
  try {
    const payload = JSON.parse(raw);
    if (!payload || typeof payload.ok !== "boolean" || (payload.ok && (typeof payload.image?.base64 !== "string" || typeof payload.image?.mimeType !== "string"))) throw new Error("Invalid optimizer response");
    return payload;
  } catch {
    throw new Error(`이미지 최적화 응답을 확인하지 못했습니다 (HTTP ${response.status}). 원본과 기존 결과는 보존했으며 이미지 생성 요청은 전송하지 않았습니다.`);
  }
}

async function compressUploadInBrowser(file: File, maxBytes: number): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error("브라우저에서 큰 이미지를 읽지 못했습니다. JPEG 또는 PNG로 저장해 다시 선택해 주세요."); });
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height) throw new Error("이미지 크기를 확인하지 못했습니다.");
    let scale = Math.min(1, 16384 / Math.max(width, height), Math.sqrt(24_000_000 / (width * height)));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 전송용 캔버스를 만들지 못했습니다.");
    for (let attempt = 0; attempt < 4; attempt++) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.92, 0.84, 0.72, 0.6]) {
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= maxBytes) return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
      }
      scale *= 0.75;
    }
    throw new Error("큰 이미지의 전송 용량을 줄이지 못했습니다. 원본과 기존 결과는 보존했으며 이미지 생성 요청은 전송하지 않았습니다.");
  } finally { URL.revokeObjectURL(url); }
}
