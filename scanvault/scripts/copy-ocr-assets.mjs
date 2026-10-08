// Copies the Tesseract worker, WASM core and English model into public/ocr so
// OCR runs fully offline (web and Android) instead of fetching from a CDN.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'public/ocr';
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

cpSync('node_modules/tesseract.js/dist/worker.min.js', join(out, 'worker.min.js'));
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  // OEM 1 (LSTM) only needs the *-lstm.wasm.js builds (WASM inlined); tesseract.js picks simd/relaxed-simd at runtime.
  if (/-lstm\.wasm\.js$/.test(f)) cpSync(join('node_modules/tesseract.js-core', f), join(out, 'core', f));
}
const model = 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';
if (!existsSync(model)) throw new Error(`Missing ${model}`);
cpSync(model, join(out, 'lang', 'eng.traineddata.gz'));
console.log('OCR assets copied to', out);
