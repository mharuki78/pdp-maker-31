import { validatePdpExportAsset, type PdpExportAsset, type PdpExportAssets } from "../../lib/pdp-export-plan";

const DB_NAME = "baegot-pdp-export-settings";
const STORE_NAME = "settings";
const EMPTY: PdpExportAssets = { first: null, last: null };

function openSettings(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("공통 이미지를 저장할 공간을 열지 못했습니다. 브라우저 저장 공간을 확인해 주세요."));
    request.onblocked = () => reject(new Error("다른 탭에서 공통 이미지 저장 공간을 사용 중입니다. 잠시 후 다시 시도해 주세요."));
  });
}

function normalizeAssets(value: unknown): PdpExportAssets {
  const source = value as Partial<PdpExportAssets> | null;
  const read = (slot: keyof PdpExportAssets) => {
    if (!source?.[slot]) return null;
    try { return validatePdpExportAsset(source[slot]); } catch { return null; }
  };
  return { first: read("first"), last: read("last") };
}

export async function loadPdpExportAssets(): Promise<PdpExportAssets> {
  const db = await openSettings();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get("defaults");
    transaction.oncomplete = () => { db.close(); resolve(normalizeAssets(request.result)); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(new Error("저장된 공통 이미지를 읽지 못했습니다. 다시 열어 주세요.")); };
  });
}

/** Read/modify/write one slot atomically, preserving the other slot. */
export async function savePdpExportAsset(slot: keyof PdpExportAssets, image: PdpExportAsset | null): Promise<PdpExportAssets> {
  const asset = image ? validatePdpExportAsset(image) : null;
  const db = await openSettings();
  return new Promise((resolve, reject) => {
    let next = EMPTY;
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get("defaults");
    request.onsuccess = () => {
      next = { ...normalizeAssets(request.result), [slot]: asset };
      store.put(next, "defaults");
    };
    transaction.oncomplete = () => { db.close(); resolve(next); };
    transaction.onabort = transaction.onerror = () => { db.close(); reject(new Error("공통 이미지를 저장하지 못했습니다. 파일 용량이나 브라우저 저장 공간을 확인해 주세요. 기존 설정은 유지됩니다.")); };
  });
}

export async function readPdpExportAsset(file: File): Promise<PdpExportAsset> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("PNG·JPG·WebP 파일을 10MB 이하로 선택해 주세요.");
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지 파일을 읽지 못했습니다. 다른 파일을 선택해 주세요."));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = dataUrl;
  try { await image.decode(); } catch { throw new Error("열 수 없는 이미지입니다. PNG·JPG·WebP 파일을 다시 선택해 주세요."); }
  return validatePdpExportAsset({ fileName: file.name, dataUrl, width: image.naturalWidth, height: image.naturalHeight });
}
