import { useCallback, useEffect, useRef, useState } from 'react';
import { SCAN_MODES, type PageImage, type ScanMode } from '../types';
import { fileToDataUrl, normalize } from '../lib/image';
import { TopBar, useToast } from './ui';

/**
 * Camera capture guided by the selected mode: an A4 frame for documents, an
 * ID-1 card frame for IDs (front → back steps), and a free frame for images and
 * objects. Falls back to the gallery / file picker when no camera is available.
 */
export function Scanner({ mode, onBack, onDone }: { mode: ScanMode; onBack: () => void; onDone: (pages: PageImage[]) => void }) {
  const cfg = SCAN_MODES[mode];
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [pages, setPages] = useState<PageImage[]>([]);
  const [camError, setCamError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number } | null>(null);
  const toast = useToast();

  const fixedSteps = cfg.pages;
  const step = fixedSteps ? fixedSteps[Math.min(pages.length, fixedSteps.length - 1)] : null;
  const complete = fixedSteps ? pages.length >= fixedSteps.length : false;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('Camera is not available in this browser. Upload photos instead.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (e) {
        setCamError(
          (e as Error).name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow it in your settings, or upload photos instead.'
            : 'No camera found. Upload photos instead.',
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /** Guide frame in video pixel coordinates. */
  const frame = useCallback(() => {
    if (!videoSize) return null;
    const { w, h } = videoSize;
    if (!cfg.aspect) return { x: w * 0.04, y: h * 0.04, w: w * 0.92, h: h * 0.92 };
    let fw = w * 0.88;
    let fh = fw / cfg.aspect;
    if (fh > h * 0.88) {
      fh = h * 0.88;
      fw = fh * cfg.aspect;
    }
    return { x: (w - fw) / 2, y: (h - fh) / 2, w: fw, h: fh };
  }, [videoSize, cfg.aspect]);

  const capture = async () => {
    const v = videoRef.current;
    const f = frame();
    if (!v || !f) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
    // Documents/IDs are cropped to the guide frame; images/objects keep the whole shot.
    const page = await normalize(v, cfg.aspect ? f : undefined);
    addPage(page);
  };

  const addPage = (page: PageImage) => {
    setPages((p) => {
      const next = [...p, page];
      if (fixedSteps && next.length === fixedSteps.length - 1) toast(fixedSteps[next.length].hint);
      return next;
    });
  };

  const onFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      addPage(await normalize(await fileToDataUrl(file)));
    }
  };

  useEffect(() => {
    if (complete && fixedSteps) onDone(pages.slice(0, fixedSteps.length));
  }, [complete]);

  const f = frame();

  return (
    <div className="screen scanner">
      <TopBar title={`${cfg.icon} ${cfg.label}`} onBack={onBack} />
      <div className="camera">
        {!camError ? (
          <div className="video-box">
            <video
              ref={videoRef}
              playsInline
              muted
              onLoadedMetadata={(e) => setVideoSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
            />
            {f && videoSize && (
              <div
                className={`guide ${cfg.aspect ? 'guide-fixed' : ''} ${mode.startsWith('id') ? 'guide-card' : ''}`}
                style={{
                  left: `${(f.x / videoSize.w) * 100}%`,
                  top: `${(f.y / videoSize.h) * 100}%`,
                  width: `${(f.w / videoSize.w) * 100}%`,
                  height: `${(f.h / videoSize.h) * 100}%`,
                }}
              >
                <span className="corner tl" />
                <span className="corner tr" />
                <span className="corner bl" />
                <span className="corner br" />
              </div>
            )}
            {flash && <div className="flash" />}
          </div>
        ) : (
          <div className="no-camera">
            <p>📷 {camError}</p>
          </div>
        )}
        <div className="scan-hint">
          {step ? (
            <>
              <strong>
                Step {Math.min(pages.length + 1, fixedSteps!.length)} of {fixedSteps!.length} · {step.label}
              </strong>
              <span>{step.hint}</span>
            </>
          ) : (
            <span>
              {mode === 'document' ? 'Fit the page inside the frame. Capture as many pages as you need.' : 'Frame your shot and capture.'}
            </span>
          )}
        </div>
      </div>

      {pages.length > 0 && (
        <div className="thumb-strip">
          {pages.map((p, i) => (
            <div key={i} className="thumb">
              <img src={p.dataUrl} alt={`Page ${i + 1}`} />
              <button className="thumb-del" onClick={() => setPages((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove page ${i + 1}`}>
                ✕
              </button>
              <span className="thumb-num">{fixedSteps?.[i]?.label ?? i + 1}</span>
            </div>
          ))}
        </div>
      )}

      <div className="capture-bar">
        <label className="btn ghost">
          🖼️ Upload
          <input type="file" accept="image/*" multiple={!fixedSteps || fixedSteps.length > 1} hidden onChange={(e) => e.target.files && onFiles(e.target.files)} />
        </label>
        <button className="shutter" onClick={capture} disabled={!!camError || !videoSize || complete} aria-label="Capture" />
        <button className="btn primary" disabled={pages.length === 0 || (!!fixedSteps && !complete)} onClick={() => onDone(pages)}>
          Done{pages.length ? ` (${pages.length})` : ''}
        </button>
      </div>
    </div>
  );
}
