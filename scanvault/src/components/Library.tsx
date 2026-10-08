import { useEffect, useMemo, useState } from 'react';
import { SCAN_MODES, type DocMeta, type ScanMode } from '../types';
import { listMeta, key } from '../lib/vault';
import { decryptFile, isEncryptedFile } from '../lib/crypto';
import { saveToDevice } from '../lib/platform';
import { providers } from '../lib/cloud';
import { terms } from '../lib/text';
import { formatDate, TopBar, useToast } from './ui';

function score(doc: DocMeta, q: string[]): number {
  if (!q.length) return 1;
  const name = doc.name.toLowerCase();
  const kw = doc.keywords.join(' ').toLowerCase();
  const body = doc.searchText.toLowerCase();
  let s = 0;
  for (const t of q) {
    if (name.includes(t)) s += 5;
    else if (kw.includes(t)) s += 3;
    else if (body.includes(t)) s += 1;
    else return 0; // every term must match somewhere
  }
  return s;
}

function snippet(doc: DocMeta, q: string[]): string | null {
  if (!q.length) return null;
  const body = doc.searchText;
  const i = body.toLowerCase().indexOf(q[0]);
  if (i < 0) return null;
  return (i > 40 ? '…' : '') + body.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, ' ') + '…';
}

export function Library({ onBack, onOpen }: { onBack: () => void; onOpen: (id: string) => void }) {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ScanMode | 'all'>('all');
  const toast = useToast();

  useEffect(() => {
    listMeta().then(setDocs);
  }, []);

  const q = useMemo(() => {
    const raw = query.toLowerCase().trim();
    // exact substring terms work for numbers/ids, stemmed terms for words
    return raw ? [...new Set([...raw.split(/\s+/).filter((t) => t.length > 1)])].map((t) => (/\d/.test(t) ? t : terms(t)[0] ?? t)) : [];
  }, [query]);

  const results = useMemo(
    () =>
      (docs ?? [])
        .filter((d) => mode === 'all' || d.mode === mode || (mode === 'id-single' && d.mode === 'id-double'))
        .map((d) => ({ d, s: score(d, q) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || b.d.updatedAt - a.d.updatedAt)
        .map((r) => r.d),
    [docs, q, mode],
  );

  const openEncrypted = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isEncryptedFile(bytes)) return toast('That is not a ScanVault encrypted file (.svenc).', 'error');
      const out = await decryptFile(key(), bytes);
      await saveToDevice('ScanVault/Decrypted', out.name, new Blob([out.bytes], { type: out.type }));
      toast(`Decrypted ${out.name}`, 'success');
    } catch {
      toast('Could not decrypt — this file was encrypted with a different vault.', 'error');
    }
  };

  return (
    <div className="screen">
      <TopBar
        title="Library"
        onBack={onBack}
        actions={
          <label className="icon-btn" title="Decrypt a .svenc file" aria-label="Decrypt a .svenc file">
            🔓
            <input type="file" hidden accept=".svenc,application/octet-stream" onChange={(e) => e.target.files?.[0] && openEncrypted(e.target.files[0])} />
          </label>
        }
      />
      <main className="content">
        <input className="search" type="search" placeholder="🔍 Search names, keywords and text inside scans…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <div className="chips">
          <button className={`chip ${mode === 'all' ? 'active' : ''}`} onClick={() => setMode('all')}>
            All
          </button>
          {(['document', 'image', 'id-single', 'object'] as ScanMode[]).map((m) => (
            <button key={m} className={`chip ${mode === m ? 'active' : ''}`} onClick={() => setMode(m)}>
              {SCAN_MODES[m].icon} {m === 'id-single' ? 'ID cards' : SCAN_MODES[m].label}
            </button>
          ))}
        </div>

        {docs === null ? (
          <p className="muted">Decrypting library…</p>
        ) : results.length === 0 ? (
          <p className="empty">{docs.length ? 'No scans match your search.' : 'Your library is empty.'}</p>
        ) : (
          <ul className="doc-list">
            {results.map((d) => (
              <li key={d.id}>
                <button className="doc-row" onClick={() => onOpen(d.id)}>
                  <img src={d.thumbnail} alt="" />
                  <span className="doc-info">
                    <span className="doc-name">{d.name}</span>
                    <span className="doc-sub">
                      {SCAN_MODES[d.mode].icon} {d.pageCount} page{d.pageCount > 1 ? 's' : ''} · {formatDate(d.updatedAt)}
                    </span>
                    {snippet(d, q) && <span className="doc-snippet">{snippet(d, q)}</span>}
                    <span className="doc-tags">
                      {d.savedTo.map((s, i) => (
                        <span key={i} className="tag" title={`${s.folder}/${s.fileName}`}>
                          {providers[s.provider].icon} {s.folder}
                          {s.encrypted ? ' 🔒' : ''}
                        </span>
                      ))}
                      {d.keywords.slice(0, 3).map((k) => (
                        <span key={k} className="tag muted">
                          #{k}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
