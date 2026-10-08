import { useEffect, useRef, useState } from 'react';
import type { OcrPage, PageImage } from '../types';
import { recognizeRegion, wordsInBox } from '../lib/ocr';
import { cropPage } from '../lib/image';

/**
 * Shows a page image with an invisible, selectable OCR text layer on top, so
 * users can long-press / drag to select text right on the scan. "Area" mode
 * lets them draw a box instead; the words inside it (or a fresh OCR of that
 * crop) become the selection.
 */
export function PageViewer({ page, ocr, onSelect }: { page: PageImage; ocr?: OcrPage; onSelect: (text: string) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [areaMode, setAreaMode] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / page.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [page.width]);

  const local = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const finishArea = async () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1) / scale;
    const y = Math.min(drag.y0, drag.y1) / scale;
    const w = Math.abs(drag.x1 - drag.x0) / scale;
    const h = Math.abs(drag.y1 - drag.y0) / scale;
    if (w < 8 || h < 8) return setDrag(null);
    const box = { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(w, page.width - x), h: Math.min(h, page.height - y) };
    let text = ocr ? wordsInBox(ocr, box) : '';
    if (!text) {
      setBusy(true);
      try {
        text = await recognizeRegion(await cropPage(page, box));
      } finally {
        setBusy(false);
      }
    }
    setDrag(null);
    setAreaMode(false);
    onSelect(text || '');
  };

  return (
    <div className="page-viewer">
      <div className="viewer-tools">
        <button className={`chip ${areaMode ? 'active' : ''}`} onClick={() => setAreaMode(!areaMode)}>
          ⬚ {areaMode ? 'Drag over the area…' : 'Select area'}
        </button>
        {!areaMode && ocr?.words.length ? <span className="muted small">or press & drag on the text</span> : null}
      </div>
      <div
        ref={boxRef}
        className={`page-box ${areaMode ? 'area-mode' : ''}`}
        onPointerDown={(e) => {
          if (!areaMode) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = local(e);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => areaMode && drag && setDrag({ ...drag, x1: local(e).x, y1: local(e).y })}
        onPointerUp={() => areaMode && finishArea()}
      >
        <img src={page.dataUrl} alt="Scanned page" draggable={false} />
        {ocr && !areaMode && (
          <div className="text-layer" aria-hidden={false}>
            {ocr.words.map((w, i) => {
              const h = (w.bbox.y1 - w.bbox.y0) * scale;
              return (
                <span
                  key={i}
                  style={{
                    left: w.bbox.x0 * scale,
                    top: w.bbox.y0 * scale,
                    width: (w.bbox.x1 - w.bbox.x0) * scale,
                    height: h,
                    fontSize: Math.max(4, h * 0.85),
                  }}
                >
                  {w.text + ' '}
                </span>
              );
            })}
          </div>
        )}
        {drag && (
          <div
            className="area-rect"
            style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }}
          />
        )}
        {busy && <div className="area-busy">Reading selected area…</div>}
      </div>
    </div>
  );
}
