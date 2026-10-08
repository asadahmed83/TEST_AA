import { jsPDF } from 'jspdf';
import type { OcrPage, PageImage } from '../types';

/** Build a PDF with one image per page, sized to the page aspect ratio. */
export function buildPdf(pages: PageImage[], title: string): Blob {
  const first = pages[0];
  const pdf = new jsPDF({ unit: 'pt', format: pageFormat(first), orientation: first.width > first.height ? 'l' : 'p', compress: true });
  pdf.setProperties({ title, creator: 'ScanVault' });
  pages.forEach((p, i) => {
    if (i > 0) pdf.addPage(pageFormat(p), p.width > p.height ? 'l' : 'p');
    const [w, h] = pageFormat(p);
    pdf.addImage(p.dataUrl, 'JPEG', 0, 0, w, h, undefined, 'FAST');
  });
  return pdf.output('blob');
}

function pageFormat(p: PageImage): [number, number] {
  // Fit the long side to A4's long side (842pt) to keep a natural print size.
  const scale = 842 / Math.max(p.width, p.height);
  return [p.width * scale, p.height * scale];
}

/** Render an uploaded PDF to page images and pull its embedded text layer. */
export async function importPdf(file: Blob, onProgress?: (done: number, total: number) => void): Promise<{ pages: PageImage[]; ocr: (OcrPage | null)[] }> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: PageImage[] = [];
  const ocr: (OcrPage | null)[] = [];
  const total = Math.min(doc.numPages, 50);
  for (let n = 1; n <= total; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1800 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    pages.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.88), width: canvas.width, height: canvas.height });

    const content = await page.getTextContent();
    const words: OcrPage['words'] = [];
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str + (item.hasEOL ? '\n' : ' ');
      if (!item.str.trim()) continue;
      const tx = pdfjs.Util.transform(viewport.transform, item.transform);
      const fontH = Math.hypot(tx[2], tx[3]);
      words.push({
        text: item.str,
        bbox: { x0: tx[4], y0: tx[5] - fontH, x1: tx[4] + item.width * viewport.scale, y1: tx[5] },
        confidence: 100,
      });
    }
    // Scanned PDFs have no text layer: return null so the caller runs OCR.
    ocr.push(text.trim().length > 20 ? { text: text.trim(), words, width: canvas.width, height: canvas.height, source: 'pdf-text' } : null);
    onProgress?.(n, total);
  }
  return { pages, ocr };
}
