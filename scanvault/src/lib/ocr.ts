import { createWorker, type Worker } from 'tesseract.js';
import type { OcrPage, OcrWord, PageImage } from '../types';

/**
 * Optical character recognition with Tesseract (WebAssembly, runs on-device).
 * Word bounding boxes are kept so text can be selected/highlighted on the image.
 */

let workerPromise: Promise<Worker> | null = null;
let progressCb: ((p: number) => void) | null = null;

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // Self-hosted assets (copied to public/ocr by scripts/copy-ocr-assets.mjs) keep
    // OCR on-device and working offline — no CDN downloads.
    const base = new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href;
    workerPromise = createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: `${base}lang`,
      logger: (m) => {
        if (m.status === 'recognizing text' && progressCb) progressCb(m.progress);
      },
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

export async function recognizePage(page: PageImage, onProgress?: (p: number) => void): Promise<OcrPage> {
  const worker = await getWorker();
  progressCb = onProgress ?? null;
  try {
    const { data } = await worker.recognize(page.dataUrl, {}, { text: true, blocks: true });
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs)
        for (const line of para.lines)
          for (const w of line.words)
            if (w.text.trim() && w.confidence > 30) words.push({ text: w.text, bbox: w.bbox, confidence: Math.round(w.confidence) });
    return { text: data.text.trim(), words, width: page.width, height: page.height, source: 'ocr' };
  } finally {
    progressCb = null;
  }
}

/** OCR a small cropped region (data URL) — used for "select area → search". */
export async function recognizeRegion(dataUrl: string): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(dataUrl);
  return data.text.replace(/\s+/g, ' ').trim();
}

/** Words whose centre lies inside the given box (in image pixel coordinates). */
export function wordsInBox(page: OcrPage, box: { x: number; y: number; w: number; h: number }): string {
  const picked = page.words.filter((w) => {
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
  });
  // keep reading order: by line (y) then x
  picked.sort((a, b) => (Math.abs(a.bbox.y0 - b.bbox.y0) < (a.bbox.y1 - a.bbox.y0) / 2 ? a.bbox.x0 - b.bbox.x0 : a.bbox.y0 - b.bbox.y0));
  return picked.map((w) => w.text).join(' ');
}
