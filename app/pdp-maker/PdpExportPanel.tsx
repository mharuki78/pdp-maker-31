"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import type { PdpExportAsset, PdpExportAssets } from "../../lib/pdp-export-plan";
import { loadPdpExportAssets, readPdpExportAsset, savePdpExportAsset } from "./pdp-export-assets";
import { createPdpThumbnail, exportAssetBlob, exportBlobDataUrl, downloadPreparedExport, joinPdpImages } from "./pdp-export-images";
import { sanitizeSectionFileName } from "./pdp-editor-support";
import ui from "./pdp-maker.module.css";
import styles from "./pdp-export.module.css";

export interface PdpExportSection { id: string; name: string; image?: string; }
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: PdpExportSection[];
  renderSection: (index: number) => Promise<Blob>;
  onBusyChange: (busy: boolean) => void;
}

export function PdpExportPanel({ open, onOpenChange, sections, renderSection, onBusyChange }: Props) {
  const [assets, setAssets] = useState<PdpExportAssets>({ first: null, last: null });
  const [loading, setLoading] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [makingThumbnail, setMakingThumbnail] = useState(false);
  const [thumbnailError, setThumbnailError] = useState("");
  const [thumbnail, setThumbnail] = useState<{ naver: { blob: Blob; url: string }; coupang: { blob: Blob; url: string } } | null>(null);
  const [combined, setCombined] = useState<{ blob: Blob; url: string; width: number; height: number; scaledDown: boolean } | null>(null);
  const [zipUrl, setZipUrl] = useState("");
  const heroBlob = useRef<Blob | null>(null);
  const available = sections.map((section, index) => ({ ...section, index })).filter(section => section.image);
  const missing = sections.length - available.length;
  const heroIndex = sections.findIndex(section => section.image && /hero|히어로/i.test(`${section.id} ${section.name}`));
  const thumbnailIndex = heroIndex >= 0 ? heroIndex : sections.findIndex(section => section.image);
  const locked = loading || saving || busy;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true); setSettingsReady(false); setError(""); setMessage("");
    loadPdpExportAssets().then(value => { if (!cancelled) { setAssets(value); setSettingsReady(true); } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "공통 이미지를 불러오지 못했습니다."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    setCombined(null); setZipUrl("");
  }, [open, assets, renderSection]);

  useEffect(() => {
    heroBlob.current = null; setThumbnail(null); setThumbnailError("");
    if (!open || thumbnailIndex < 0) return;
    let cancelled = false;
    setMakingThumbnail(true);
    (async () => {
      const hero = await renderSection(thumbnailIndex);
      const naverBlob = await createPdpThumbnail(hero, 750);
      const coupangBlob = await createPdpThumbnail(hero, 1000);
      const naverUrl = await exportBlobDataUrl(naverBlob), coupangUrl = await exportBlobDataUrl(coupangBlob);
      if (cancelled) return;
      heroBlob.current = hero;
      setThumbnail({ naver: { blob: naverBlob, url: naverUrl }, coupang: { blob: coupangBlob, url: coupangUrl } });
    })().catch(reason => { if (!cancelled) setThumbnailError(reason instanceof Error ? reason.message : "썸네일을 만들지 못했습니다."); })
      .finally(() => { if (!cancelled) setMakingThumbnail(false); });
    return () => { cancelled = true; };
  }, [open, renderSection, thumbnailIndex]);

  async function updateAsset(slot: keyof PdpExportAssets, file: File | null) {
    setSaving(true); setError(""); setMessage("");
    try {
      const image = file ? await readPdpExportAsset(file) : null;
      setAssets(await savePdpExportAsset(slot, image));
      setSettingsReady(true);
      setMessage(`${slot === "first" ? "첫" : "마지막"} 이미지를 ${image ? "공통 설정에 저장했습니다. 다음 작업에도 유지됩니다." : "공통 설정에서 제외했습니다."}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "공통 이미지를 저장하지 못했습니다."); }
    finally { setSaving(false); }
  }

  async function preparePages() {
    const pages: Array<{ label: string; blob: Blob; ext: string }> = [];
    const fixed = (asset: PdpExportAsset, label: string) => ({ label, blob: exportAssetBlob(asset.dataUrl), ext: asset.dataUrl.startsWith("data:image/png") ? "png" : asset.dataUrl.startsWith("data:image/webp") ? "webp" : "jpg" });
    if (assets.first) pages.push(fixed(assets.first, "first"));
    for (const section of available) {
      setProgress(`본문 이미지 준비 ${pages.length - (assets.first ? 1 : 0) + 1}/${available.length}`);
      const blob = section.index === thumbnailIndex && heroBlob.current ? heroBlob.current : await renderSection(section.index);
      pages.push({ label: sanitizeSectionFileName(section.id), blob, ext: "jpg" });
    }
    if (assets.last) pages.push(fixed(assets.last, "last"));
    return pages;
  }

  async function exportImages(format: "joined" | "zip") {
    setBusy(true); onBusyChange(true); setError(""); setMessage("");
    try {
      if (!available.length) throw new Error("다운로드할 본문 이미지가 없습니다.");
      if (format === "joined" && missing) throw new Error("모든 본문 이미지를 만든 뒤 통합 PNG를 다운로드해 주세요.");
      if (format === "joined" && combined) {
        downloadPreparedExport(combined.url, "pdp-full.png");
        setMessage("이어진 상세페이지 PNG를 다운로드했습니다.");
        return;
      }
      const pages = await preparePages();
      if (format === "joined") {
        setProgress("상세페이지를 한 장으로 이어 붙이는 중…");
        const result = await joinPdpImages(pages.map(page => page.blob), (done, total) => setProgress(`이어 붙이기 ${done}/${total}`));
        const url = await exportBlobDataUrl(result.blob);
        setCombined({ ...result, url });
        downloadPreparedExport(url, "pdp-full.png");
        setMessage(`통합 PNG ${result.width.toLocaleString()}×${result.height.toLocaleString()}px를 다운로드했습니다.${result.scaledDown ? " 긴 이미지의 브라우저 저장 한도에 맞춰 전체 폭을 조절했습니다." : ""}`);
      } else {
        setProgress("ZIP 파일을 만드는 중…");
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        pages.forEach((page, index) => zip.file(`pdp-${String(index + 1).padStart(2, "0")}-${page.label}.${page.ext}`, page.blob));
        if (thumbnail) {
          zip.file("thumbnail-naver-750x750.jpg", thumbnail.naver.blob);
          zip.file("thumbnail-coupang-1000x1000.jpg", thumbnail.coupang.blob);
        }
        const url = await exportBlobDataUrl(await zip.generateAsync({ type: "blob" }));
        setZipUrl(url);
        downloadPreparedExport(url, "pdp-images.zip");
        setMessage(`${pages.length}장${thumbnail ? "과 네이버·쿠팡 썸네일 2장" : ""}을 ZIP으로 다운로드했습니다.${missing ? ` 미생성 본문 ${missing}장은 제외했습니다.` : ""}`);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "다운로드 파일을 만들지 못했습니다. 다시 시도해 주세요."); }
    finally { setBusy(false); onBusyChange(false); setProgress(""); }
  }

  return <Sheet open={open} onOpenChange={next => { if (!busy && !saving) onOpenChange(next); }}>
    <SheetContent closeLabel="닫기" closeDisabled={busy || saving} className={styles.panel} style={{ width: "min(960px, 100vw)", maxWidth: "100vw" }} onClick={event => event.stopPropagation()} onEscapeKeyDown={event => { if (busy || saving) event.preventDefault(); }} onPointerDownOutside={event => { if (busy || saving) event.preventDefault(); }}>
      <SheetHeader className={styles.header}>
        <SheetTitle>상세페이지 다운로드</SheetTitle>
        <SheetDescription>첫 이미지부터 마지막까지 한 장으로. 썸네일도 함께 준비합니다.</SheetDescription>
      </SheetHeader>
      <div className={styles.layout}>
        <div className={styles.settings}>
          <section className={styles.group} aria-labelledby="pdp-fixed-images-title">
            <h3 id="pdp-fixed-images-title">매번 붙이는 공통 이미지</h3>
            <p className={styles.help}>한 번 선택하면 이 PC·브라우저의 새 작업에도 유지됩니다.</p>
            {(["first", "last"] as const).map(slot => <FixedImage key={slot} slot={slot} asset={assets[slot]} disabled={locked} onChange={file => void updateAsset(slot, file)} />)}
            <p className={styles.help}>{loading ? "저장된 공통 이미지를 불러오는 중…" : "PNG·JPG·WebP · 파일당 10MB 이하 · 원본 비율 유지"}</p>
          </section>
          <section className={styles.group} aria-labelledby="pdp-thumbnail-title">
            <div className={styles.sectionHeading}><h3 id="pdp-thumbnail-title">자동 썸네일</h3><span>네이버·쿠팡 · JPG</span></div>
            <div className={styles.thumbnailRow}>
              <div className={styles.thumbnailPreview}>
                {thumbnail ? <img src={thumbnail.naver.url} width={750} height={750} alt="자동 생성된 정사각형 썸네일 미리보기" /> : <span>{makingThumbnail ? "만드는 중…" : "이미지 준비 전"}</span>}
              </div>
              <div><p>대표 히어로를 정사각형에 맞춥니다. 제품과 글자가 잘리지 않게 여백을 둡니다.</p><p className={styles.help}>추가 AI 생성 비용 없음</p>
                <div className={styles.thumbnailDownloads}>
                  {thumbnail && !locked ? <>
                    <a className={ui.secondaryButton} href={thumbnail.naver.url} download="pdp-thumbnail-naver-750x750.jpg"><Download size={15} aria-hidden="true" />네이버 750×750 저장</a>
                    <a className={ui.secondaryButton} href={thumbnail.coupang.url} download="pdp-thumbnail-coupang-1000x1000.jpg"><Download size={15} aria-hidden="true" />쿠팡 1000×1000 저장</a>
                  </> : <><button className={ui.secondaryButton} disabled type="button">네이버 750×750 저장</button><button className={ui.secondaryButton} disabled type="button">쿠팡 1000×1000 저장</button></>}
                </div>
              </div>
            </div>
            {thumbnailError ? <p className={styles.error} role="alert">{thumbnailError}</p> : null}
          </section>
          <div className={styles.actions}>
            {missing ? <p className={styles.warning}>본문 {missing}장이 아직 없습니다. 모두 생성하면 통합 PNG를 저장할 수 있습니다. ZIP에는 이미지가 있는 {available.length}장만 포함됩니다.</p> : null}
            <button className={ui.primaryButton} disabled={locked || !settingsReady || makingThumbnail || !available.length || missing > 0} onClick={() => void exportImages("joined")} type="button">
              {busy ? <Loader2 className={styles.spin} size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}{busy ? "파일 준비 중…" : "이어진 PNG 다운로드"}
            </button>
            <button className={ui.secondaryButton} disabled={locked || !settingsReady || makingThumbnail || !available.length} onClick={() => void exportImages("zip")} type="button"><Download size={16} aria-hidden="true" />개별 이미지 ZIP 다운로드</button>
            <p className={styles.help}>편집한 문구와 레이어도 포함됩니다. 긴 이미지는 저장 한도에 맞춰 폭을 조절합니다.</p>
            <div className={styles.feedback} role="status" aria-live="polite">{progress || message}</div>
            {!busy && (combined || zipUrl) ? <div className={styles.readyLinks}>
              {combined ? <a href={combined.url} download="pdp-full.png">만들어진 통합 PNG 다시 저장</a> : null}
              {zipUrl ? <a href={zipUrl} download="pdp-images.zip">만들어진 ZIP 다시 저장</a> : null}
            </div> : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
        </div>
        <section className={styles.preview} aria-label="다운로드 이미지 배치 미리보기">
          <div className={styles.previewHeading}><h3>{combined ? "이어진 이미지" : "이어질 순서"}</h3><span>{combined ? `${combined.width}×${combined.height}px` : `${assets.first ? "첫 이미지 → " : ""}본문 ${sections.length}장${assets.last ? " → 마지막 이미지" : ""}`}</span></div>
          <div className={styles.previewViewport}>
            <div className={styles.strip}>
              {combined ? <img src={combined.url} alt="첫 이미지부터 마지막까지 이어진 상세페이지" /> : <>
                {assets.first ? <img src={assets.first.dataUrl} alt="첫 이미지 배치 미리보기" /> : <div className={styles.emptySlot}>첫 이미지 · 선택 사항</div>}
                {sections.map((section, index) => section.image ? <img key={section.id} src={section.image} alt={`본문 ${index + 1} · ${section.name}`} /> : <div className={styles.emptySlot} key={section.id}>본문 {index + 1} · 이미지 준비 전</div>)}
                {assets.last ? <img src={assets.last.dataUrl} alt="마지막 이미지 배치 미리보기" /> : <div className={styles.emptySlot}>마지막 이미지 · 선택 사항</div>}
              </>}
            </div>
          </div>
          <p className={styles.help}>이미지를 자르지 않고 같은 폭으로 연결합니다.</p>
        </section>
      </div>
    </SheetContent>
  </Sheet>;
}

function FixedImage({ slot, asset, disabled, onChange }: { slot: keyof PdpExportAssets; asset: PdpExportAsset | null; disabled: boolean; onChange: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const title = slot === "first" ? "첫 이미지" : "마지막 이미지";
  return <div className={styles.fixedImage}>
    <div className={styles.fixedHeading}><strong>{title}</strong><span>{slot === "first" ? "회사 로고·브랜드 안내" : "저작권·마무리 안내"}</span></div>
    {asset ? <div className={styles.assetPreview}><img src={asset.dataUrl} alt={`저장된 ${title}`} /><span title={asset.fileName}>{asset.fileName}</span></div> : null}
    <div className={styles.assetActions}>
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={`${title} 파일`} onChange={event => { const file = event.target.files?.[0]; if (file) onChange(file); event.target.value = ""; }} />
      <button className={ui.secondaryButton} disabled={disabled} type="button" onClick={() => input.current?.click()}><ImagePlus size={15} aria-hidden="true" />{title} {asset ? "교체" : "선택"}</button>
      {asset ? <button className={styles.remove} disabled={disabled} type="button" aria-label={`${title} 공통 설정에서 제외`} onClick={() => onChange(null)}><Trash2 size={16} aria-hidden="true" /></button> : null}
    </div>
  </div>;
}
