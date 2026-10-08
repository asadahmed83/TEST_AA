import type { PageImage } from '../types';
import type { ImageStats } from './ai/types';

export type Filter = 'original' | 'enhanced' | 'bw';

const MAX_SIDE = 2200;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
}

function toPage(c: HTMLCanvasElement, quality = 0.88): PageImage {
  return { dataUrl: c.toDataURL('image/jpeg', quality), width: c.width, height: c.height };
}

/** Downscale very large captures so OCR and storage stay fast. */
export async function normalize(src: string | CanvasImageSource, crop?: { x: number; y: number; w: number; h: number }): Promise<PageImage> {
  const img = typeof src === 'string' ? await loadImage(src) : src;
  const sw = crop?.w ?? (img as HTMLImageElement).naturalWidth ?? (img as HTMLVideoElement).videoWidth ?? (img as HTMLCanvasElement).width;
  const sh = crop?.h ?? (img as HTMLImageElement).naturalHeight ?? (img as HTMLVideoElement).videoHeight ?? (img as HTMLCanvasElement).height;
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const [c, ctx] = canvas(sw * scale, sh * scale);
  ctx.drawImage(img, crop?.x ?? 0, crop?.y ?? 0, sw, sh, 0, 0, c.width, c.height);
  return toPage(c);
}

export async function rotate(page: PageImage, deg: 90 | -90): Promise<PageImage> {
  const img = await loadImage(page.dataUrl);
  const [c, ctx] = canvas(img.height, img.width);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return toPage(c);
}

/** Document-style clean-up: grayscale + contrast stretch, or adaptive black & white. */
export async function applyFilter(page: PageImage, filter: Filter): Promise<PageImage> {
  if (filter === 'original') return page;
  const img = await loadImage(page.dataUrl);
  const [c, ctx] = canvas(img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  const hist = new Uint32Array(256);
  const gray = new Uint8ClampedArray(px.length / 4);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    gray[j] = g;
    hist[gray[j]]++;
  }
  // 2% / 98% percentiles for contrast stretching
  const total = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) if ((acc += hist[v]) > total * 0.02) { lo = v; break; }
  acc = 0;
  for (let v = 255; v >= 0; v--) if ((acc += hist[v]) > total * 0.02) { hi = v; break; }
  const range = Math.max(1, hi - lo);
  if (filter === 'enhanced') {
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const v = ((gray[j] - lo) / range) * 255;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  } else {
    // Adaptive threshold against a box-blurred background (integral image).
    const w = c.width, h = c.height, r = Math.max(8, Math.round(Math.min(w, h) / 40));
    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x];
        integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r);
        const sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
        const mean = sum / ((x1 - x0) * (y1 - y0));
        const v = gray[y * w + x] < mean * 0.88 ? 0 : 255;
        const i = (y * w + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = v;
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  return toPage(c);
}

/** Front + back of an ID card on one A4-proportioned page. */
export async function composeIdSinglePage(front: PageImage, back: PageImage): Promise<PageImage> {
  const W = 1654, H = 2339; // A4 @ 200dpi
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const margin = 160;
  const slotH = (H - margin * 3) / 2;
  const imgs = await Promise.all([loadImage(front.dataUrl), loadImage(back.dataUrl)]);
  imgs.forEach((img, i) => {
    const scale = Math.min((W - margin * 2) / img.width, slotH / img.height, 1.6);
    const w = img.width * scale, h = img.height * scale;
    const x = (W - w) / 2, y = margin + i * (slotH + margin) + (slotH - h) / 2;
    ctx.drawImage(img, x, y, w, h);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#64748b';
    ctx.font = '28px sans-serif';
    ctx.fillText(i === 0 ? 'FRONT' : 'BACK', x, y - 14);
  });
  return toPage(c, 0.9);
}

export async function thumbnail(page: PageImage, size = 240): Promise<string> {
  const img = await loadImage(page.dataUrl);
  const scale = size / Math.max(img.width, img.height);
  const [c, ctx] = canvas(img.width * scale, img.height * scale);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}

export async function cropPage(page: PageImage, box: { x: number; y: number; w: number; h: number }): Promise<string> {
  const img = await loadImage(page.dataUrl);
  const [c, ctx] = canvas(box.w, box.h);
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  return c.toDataURL('image/png');
}

/** Cheap visual stats for on-device object analysis. */
export async function imageStats(page: PageImage): Promise<ImageStats> {
  const img = await loadImage(page.dataUrl);
  const scale = 160 / Math.max(img.width, img.height);
  const [c, ctx] = canvas(img.width * scale, img.height * scale);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const buckets = new Map<string, number>();
  let lum = 0;
  const g: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const [r, gr, b] = [data[i], data[i + 1], data[i + 2]];
    const key = [r, gr, b].map((v) => Math.round(v / 51) * 51).join(',');
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
    const l = (0.299 * r + 0.587 * gr + 0.114 * b) / 255;
    lum += l;
    g.push(l * 255);
  }
  // Laplacian variance as a sharpness estimate.
  const w = c.width, h = c.height, lap: number[] = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      lap.push(4 * g[y * w + x] - g[y * w + x - 1] - g[y * w + x + 1] - g[(y - 1) * w + x] - g[(y + 1) * w + x]);
  const mean = lap.reduce((a, b) => a + b, 0) / (lap.length || 1);
  const variance = lap.reduce((a, b) => a + (b - mean) ** 2, 0) / (lap.length || 1);
  const colors = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => colorName(k.split(',').map(Number)));
  return { width: page.width, height: page.height, colors: [...new Set(colors)], brightness: lum / (data.length / 4), sharpness: Math.round(variance) };
}

function colorName([r, g, b]: number[]): string {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 510;
  if (max - min < 30) return l > 0.85 ? 'white' : l < 0.15 ? 'black' : 'grey';
  const hue = (() => {
    const d = max - min;
    let hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hh *= 60;
    return hh < 0 ? hh + 360 : hh;
  })();
  const names: [number, string][] = [[15, 'red'], [45, 'orange'], [70, 'yellow'], [160, 'green'], [200, 'cyan'], [260, 'blue'], [300, 'purple'], [340, 'pink'], [360, 'red']];
  const base = names.find(([h]) => hue <= h)![1];
  return l < 0.3 ? `dark ${base}` : l > 0.75 ? `light ${base}` : base;
}

export function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
