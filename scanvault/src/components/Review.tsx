import { useEffect, useMemo, useRef, useState } from 'react';
import { SCAN_MODES, type DocContent, type DocMeta, type OcrPage, type PageImage, type ScanMode, type CloudProviderId } from '../types';
import { applyFilter, composeIdSinglePage, imageStats, rotate, thumbnail, type Filter } from '../lib/image';
import { recognizePage } from '../lib/ocr';
import { suggestFileName, sanitizeFileName, type NameSuggestion } from '../lib/naming';
import { currentEngine, withEngine } from '../lib/ai';
import { providers } from '../lib/cloud';
import { folderFor, getPrefs } from '../lib/prefs';
import { saveDocument } from '../lib/vault';
import { exportKind } from '../lib/exportFile';
import { uploadDocument } from '../lib/upload';
import { topKeywords } from '../lib/text';
import { Progress, TopBar, uid, useToast } from './ui';

export interface Draft {
  mode: ScanMode;
  pages: PageImage[];
  /** text layers that came with an imported PDF (null = needs OCR) */
  ocr?: (OcrPage | null)[];
  fromPdf?: boolean;
}

type Dest = CloudProviderId | 'vault';
type SaveStep = { label: string; state: 'pending' | 'active' | 'done' | 'error' };

export function Review({ draft, onBack, onSaved }: { draft: Draft; onBack: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [stage, setStage] = useState<'adjust' | 'details' | 'saving'>(draft.fromPdf ? 'details' : 'adjust');
  const [pages, setPages] = useState<PageImage[]>(draft.pages);
  const [filter, setFilter] = useState<Filter>(draft.mode === 'document' || draft.mode.startsWith('id') ? 'enhanced' : 'original');
  const [previews, setPreviews] = useState<PageImage[]>(draft.pages);
  const [finalPages, setFinalPages] = useState<PageImage[] | null>(draft.fromPdf ? draft.pages : null);

  // Live preview of the chosen filter.
  useEffect(() => {
    if (stage !== 'adjust') return;
    let alive = true;
    Promise.all(pages.map((p) => applyFilter(p, filter))).then((r) => alive && setPreviews(r));
    return () => {
      alive = false;
    };
  }, [pages, filter, stage]);

  const toDetails = async () => {
    let out = previews;
    if (draft.mode === 'id-single' && out.length >= 2) out = [await composeIdSinglePage(out[0], out[1])];
    setFinalPages(out);
    setStage('details');
  };

  if (stage === 'adjust') {
    return (
      <div className="screen">
        <TopBar title="Adjust scan" onBack={onBack} />
        <main className="content">
          <div className="segmented">
            {(['original', 'enhanced', 'bw'] as Filter[]).map((f) => (
              <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
                {f === 'original' ? 'Original' : f === 'enhanced' ? 'Enhanced' : 'B&W document'}
              </button>
            ))}
          </div>
          <div className="page-grid">
            {previews.map((p, i) => (
              <figure key={i} className="page-card">
                <img src={p.dataUrl} alt={`Page ${i + 1}`} />
                <figcaption>
                  <span>{SCAN_MODES[draft.mode].pages?.[i]?.label ?? `Page ${i + 1}`}</span>
                  <span>
                    <button className="icon-btn sm" aria-label="Rotate left" onClick={async () => setPages(await replaceAt(pages, i, await rotate(pages[i], -90)))}>
                      ↺
                    </button>
                    <button className="icon-btn sm" aria-label="Rotate right" onClick={async () => setPages(await replaceAt(pages, i, await rotate(pages[i], 90)))}>
                      ↻
                    </button>
                    {pages.length > 1 && !SCAN_MODES[draft.mode].pages && (
                      <button className="icon-btn sm" aria-label="Delete page" onClick={() => setPages(pages.filter((_, j) => j !== i))}>
                        🗑
                      </button>
                    )}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
          {draft.mode === 'id-single' && <p className="hint">Front and back will be combined onto one page.</p>}
          <button className="btn primary block" onClick={toDetails} disabled={previews.length !== pages.length}>
            Continue
          </button>
        </main>
      </div>
    );
  }

  return <Details draft={draft} pages={finalPages!} onBack={() => (draft.fromPdf ? onBack() : setStage('adjust'))} onSaved={onSaved} toast={toast} />;
}

async function replaceAt<T>(arr: T[], i: number, v: T) {
  return arr.map((x, j) => (j === i ? v : x));
}

function Details({ draft, pages, onBack, onSaved, toast }: { draft: Draft; pages: PageImage[]; onBack: () => void; onSaved: (id: string) => void; toast: ReturnType<typeof useToast> }) {
  const prefs = getPrefs();
  const [ocr, setOcr] = useState<OcrPage[] | null>(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState('');
  const [analysis, setAnalysis] = useState<string | undefined>();
  const [suggestion, setSuggestion] = useState<NameSuggestion | null>(null);
  const [name, setName] = useState('');
  const nameTouched = useRef(false);
  const [aiNaming, setAiNaming] = useState(false);
  const [dest, setDest] = useState<Dest>(prefs.lastProvider);
  const [folder, setFolder] = useState(folderFor(prefs.lastProvider));
  const [encrypt, setEncrypt] = useState(prefs.encryptUploads);
  const [steps, setSteps] = useState<SaveStep[] | null>(null);
  const [showText, setShowText] = useState(false);
  const [, force] = useState(0);

  const text = useMemo(() => (ocr ?? []).map((p) => p.text).join('\n\n'), [ocr]);

  // 1) OCR every page that doesn't already have a text layer.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const out: OcrPage[] = [];
        for (let i = 0; i < pages.length; i++) {
          const existing = draft.fromPdf ? draft.ocr?.[i] : null;
          out.push(existing ?? (await recognizePage(pages[i], (p) => alive && setOcrProgress((i + p) / pages.length))));
          if (alive) setOcrProgress((i + 1) / pages.length);
        }
        if (!alive) return;
        setOcr(out);
        if (draft.mode === 'object') {
          const stats = await imageStats(pages[0]);
          const r = await withEngine((e) => e.analyzeObject(pages[0].dataUrl, stats, out[0]?.text ?? ''));
          if (alive) setAnalysis(r.value);
          if (r.fellBack) toast(`Claude unavailable (${r.fellBack}) — used on-device analysis`, 'error');
        }
      } catch (e) {
        if (!alive) return;
        setOcrError(`Text recognition failed: ${(e as Error).message}. You can still save the scan.`);
        setOcr(pages.map((p) => ({ text: '', words: [], width: p.width, height: p.height, source: 'ocr' as const })));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 2) Suggest a file name from the content + today's date.
  useEffect(() => {
    if (ocr === null) return;
    const s = suggestFileName(text + (analysis ? `\n${analysis}` : ''), draft.mode);
    setSuggestion(s);
    if (!nameTouched.current) setName(s.primary);
    if (currentEngine().suggestTitle && text.trim()) improveWithAi(s);
  }, [ocr, analysis]);

  const improveWithAi = async (base: NameSuggestion | null = suggestion) => {
    const engine = currentEngine();
    if (!engine.suggestTitle) return;
    setAiNaming(true);
    try {
      const r = await engine.suggestTitle(text, draft.mode);
      if (!r) return;
      const s = suggestFileName(text, draft.mode, new Date(), { title: r.title, keywords: r.keywords });
      const merged = { ...s, alternatives: [...new Set([...s.alternatives, base?.primary ?? ''].filter((x) => x && x !== s.primary))] };
      setSuggestion(merged);
      if (!nameTouched.current) setName(merged.primary);
    } catch {
      /* keep the on-device suggestion */
    } finally {
      setAiNaming(false);
    }
  };

  const pickDest = (d: Dest) => {
    setDest(d);
    if (d !== 'vault') setFolder(folderFor(d)); // auto-populate the folder last used there
  };

  const provider = dest === 'vault' ? null : providers[dest];

  const save = async () => {
    if (!ocr) return;
    const fileBase = sanitizeFileName(name.trim() || suggestion?.primary || 'scan');
    const plan: SaveStep[] = [
      { label: 'Encrypting into your vault (AES-256-GCM)', state: 'active' },
      ...(provider ? [{ label: `${encrypt ? 'Encrypting & uploading' : 'Uploading'} to ${provider.label}${provider.demo ? ' (demo)' : ''}`, state: 'pending' as const }] : []),
    ];
    setSteps(plan);
    const mark = (i: number, state: SaveStep['state']) => setSteps((s) => s && s.map((x, j) => (j === i ? { ...x, state } : x)));

    const id = uid();
    const now = Date.now();
    const content: DocContent = { pages, ocr, analysis };
    const meta: DocMeta = {
      id,
      name: fileBase,
      mode: draft.mode,
      createdAt: now,
      updatedAt: now,
      pageCount: pages.length,
      thumbnail: await thumbnail(pages[0]),
      keywords: suggestion?.keywords ?? topKeywords(text),
      searchText: (text + (analysis ? `\n${analysis}` : '')).slice(0, 50_000),
      savedTo: [],
    };
    try {
      await saveDocument(meta, content, analysis ? { messages: [], summary: { content: analysis, at: now, engine: currentEngine().id }, updatedAt: now } : undefined);
      mark(0, 'done');
    } catch (e) {
      mark(0, 'error');
      toast(`Could not save: ${(e as Error).message}`, 'error');
      return;
    }

    if (provider) {
      mark(1, 'active');
      try {
        await uploadDocument(meta, content, provider.id, folder, encrypt);
        mark(1, 'done');
      } catch (e) {
        mark(1, 'error');
        toast(`Saved in your vault, but the upload failed: ${(e as Error).message}`, 'error');
        setTimeout(() => onSaved(id), 1500);
        return;
      }
    }
    toast('Saved securely ✓', 'success');
    setTimeout(() => onSaved(id), 600);
  };

  return (
    <div className="screen">
      <TopBar title="Save scan" onBack={steps ? undefined : onBack} />
      <main className="content review">
        <div className="review-preview">
          {pages.map((p, i) => (
            <img key={i} src={p.dataUrl} alt={`Page ${i + 1}`} />
          ))}
        </div>

        <div className="review-form">
          {ocr === null ? (
            <Progress value={ocrProgress} label={`🔎 Reading text (OCR)… ${Math.round(ocrProgress * 100)}%`} />
          ) : (
            <>
              {ocrError && <p className="error">{ocrError}</p>}
              <button className="link" onClick={() => setShowText(!showText)}>
                {showText ? '▾' : '▸'} Extracted text ({text.split(/\s+/).filter(Boolean).length} words)
              </button>
              {showText && <pre className="ocr-text">{text || 'No text found.'}</pre>}
            </>
          )}
          {draft.mode === 'object' && ocr && !analysis && <Progress value={null} label="🧠 Analysing object…" />}

          <label className="field">
            <span>
              File name {aiNaming && <em className="muted">· ✨ Claude is suggesting…</em>}
            </span>
            <input
              value={name}
              onChange={(e) => {
                nameTouched.current = true;
                setName(e.target.value);
              }}
              placeholder={ocr ? 'Name' : 'Waiting for text…'}
            />
          </label>
          {suggestion && (
            <div className="chips">
              <span className="chip-label">✨ Suggestions:</span>
              {[suggestion.primary, ...suggestion.alternatives].map((s) => (
                <button key={s} className={`chip ${s === name ? 'active' : ''}`} onClick={() => setName(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="field">
            <span>Save to</span>
            <div className="segmented wrap">
              {(['gdrive', 'onedrive', 'device'] as CloudProviderId[]).map((id) => (
                <button key={id} className={dest === id ? 'active' : ''} onClick={() => pickDest(id)}>
                  {providers[id].icon} {providers[id].label}
                  {providers[id].demo && <small className="badge">demo</small>}
                </button>
              ))}
              <button className={dest === 'vault' ? 'active' : ''} onClick={() => pickDest('vault')}>
                🔐 Vault only
              </button>
            </div>
          </div>

          {provider && (
            <>
              {!provider.isConnected() && (
                <div className="notice">
                  {provider.label} isn't connected.{' '}
                  <button className="link" onClick={() => provider.connect().then(() => force((n) => n + 1)).catch((e) => toast(e.message, 'error'))}>
                    Connect now
                  </button>
                </div>
              )}
              <label className="field">
                <span>Folder {getPrefs().folders[provider.id] && <em className="muted">· remembered from last save</em>}</span>
                <input value={folder} onChange={(e) => setFolder(e.target.value)} list="recent-folders" placeholder="ScanVault/Receipts" />
                <datalist id="recent-folders">
                  {(getPrefs().recentFolders[provider.id] ?? []).map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </label>
              <label className="toggle">
                <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
                <span>
                  <strong>Encrypt before upload</strong>
                  <small>
                    {encrypt
                      ? `Uploads ${name || 'file'}.${exportKind({ pageCount: pages.length, mode: draft.mode } as DocMeta).ext}.svenc — only ScanVault with your passphrase can open it.`
                      : 'Uploads a regular file anyone with access to the folder can open.'}
                  </small>
                </span>
              </label>
            </>
          )}

          {steps ? (
            <ul className="save-steps">
              {steps.map((s) => (
                <li key={s.label} className={s.state}>
                  <span className="step-icon">{s.state === 'done' ? '✓' : s.state === 'error' ? '✕' : s.state === 'active' ? <span className="spinner" /> : '•'}</span>
                  {s.label}
                </li>
              ))}
            </ul>
          ) : (
            <button className="btn primary block" disabled={!ocr || (draft.mode === 'object' && !analysis)} onClick={save}>
              🔐 Encrypt & save
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
