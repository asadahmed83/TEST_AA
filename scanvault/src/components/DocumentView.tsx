import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloudProviderId, DocContent, DocMeta } from '../types';
import { SCAN_MODES } from '../types';
import { deleteDocument, getContent, getMeta, putMeta } from '../lib/vault';
import { buildExport } from '../lib/exportFile';
import { openExternal, searchGoogle, shareFile, shareLinks, saveToDevice } from '../lib/platform';
import { providers } from '../lib/cloud';
import { folderFor, getPrefs } from '../lib/prefs';
import { sanitizeFileName } from '../lib/naming';
import { uploadDocument } from '../lib/upload';
import type { DocContext } from '../lib/ai';
import { PageViewer } from './PageViewer';
import { Chat } from './Chat';
import { formatDate, Modal, TopBar, useToast } from './ui';

export function DocumentView({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [content, setContent] = useState<DocContent | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [tab, setTab] = useState<'page' | 'text'>('page');
  const [selection, setSelection] = useState('');
  const [prefill, setPrefill] = useState<string | undefined>();
  const [modal, setModal] = useState<'share' | 'upload' | 'info' | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [mobilePane, setMobilePane] = useState<'preview' | 'chat'>('preview');
  const previewRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    Promise.all([getMeta(id), getContent(id)]).then(([m, c]) => {
      setMeta(m ?? null);
      setContent(c ?? null);
    });
  }, [id]);

  // Track text the user highlights in the preview (image text layer or text tab).
  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !previewRef.current?.contains(sel.anchorNode)) return;
      const t = sel.toString().replace(/\s+/g, ' ').trim();
      if (t) setSelection(t);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const clearPrefill = useCallback(() => setPrefill(undefined), []);

  if (!meta || !content) return <div className="screen center muted">Decrypting…</div>;

  const ctx: DocContext = {
    name: meta.name,
    mode: meta.mode,
    pages: content.ocr.map((o) => o.text),
    analysis: content.analysis,
    image: content.pages[0]?.dataUrl,
  };
  const page = content.pages[pageIdx];

  const rename = async (name: string) => {
    const clean = sanitizeFileName(name.trim());
    if (!clean || clean === meta.name) return setRenaming(false);
    const next = { ...meta, name: clean, updatedAt: Date.now() };
    await putMeta(next);
    setMeta(next);
    setRenaming(false);
    onChanged();
  };

  const remove = async () => {
    if (!confirm(`Delete “${meta.name}” from your vault? Copies already uploaded to the cloud are not removed.`)) return;
    await deleteDocument(meta.id);
    onChanged();
    onBack();
  };

  return (
    <div className="screen doc-screen">
      <TopBar
        onBack={onBack}
        title={
          renaming ? (
            <input
              className="rename"
              autoFocus
              defaultValue={meta.name}
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && rename((e.target as HTMLInputElement).value)}
            />
          ) : (
            <button className="title-btn" onClick={() => setRenaming(true)} title="Rename">
              {meta.name} ✎
            </button>
          )
        }
        actions={
          <>
            <button className="icon-btn" onClick={() => setModal('share')} title="Share" aria-label="Share">
              📤
            </button>
            <button className="icon-btn" onClick={() => setModal('upload')} title="Save to cloud" aria-label="Save to cloud">
              ☁️
            </button>
            <button className="icon-btn" onClick={() => setModal('info')} title="Details" aria-label="Details">
              ℹ️
            </button>
            <button className="icon-btn" onClick={remove} title="Delete" aria-label="Delete">
              🗑
            </button>
          </>
        }
      />

      <div className="mobile-tabs">
        <button className={mobilePane === 'preview' ? 'active' : ''} onClick={() => setMobilePane('preview')}>
          📄 Preview
        </button>
        <button className={mobilePane === 'chat' ? 'active' : ''} onClick={() => setMobilePane('chat')}>
          💬 Chat
        </button>
      </div>

      <div className={`split show-${mobilePane}`}>
        <section className="preview-pane" ref={previewRef}>
          <div className="segmented small">
            <button className={tab === 'page' ? 'active' : ''} onClick={() => setTab('page')}>
              Image
            </button>
            <button className={tab === 'text' ? 'active' : ''} onClick={() => setTab('text')}>
              Text
            </button>
          </div>
          {tab === 'page' ? (
            <PageViewer key={pageIdx} page={page} ocr={content.ocr[pageIdx]} onSelect={(t) => (t ? setSelection(t) : toast('No text found in that area', 'error'))} />
          ) : (
            <pre className="ocr-text selectable">{content.ocr[pageIdx]?.text || 'No text was recognised on this page.'}</pre>
          )}
          {content.pages.length > 1 && (
            <div className="pager">
              <button className="btn sm" disabled={pageIdx === 0} onClick={() => setPageIdx(pageIdx - 1)}>
                ‹ Prev
              </button>
              <span>
                Page {pageIdx + 1} / {content.pages.length}
              </span>
              <button className="btn sm" disabled={pageIdx === content.pages.length - 1} onClick={() => setPageIdx(pageIdx + 1)}>
                Next ›
              </button>
            </div>
          )}

          {selection && (
            <div className="selection-bar" role="toolbar">
              <span className="selection-text">“{selection.length > 80 ? selection.slice(0, 77) + '…' : selection}”</span>
              <button className="btn sm primary" onClick={() => searchGoogle(selection)}>
                🔎 Search Google
              </button>
              <button className="btn sm" onClick={() => navigator.clipboard?.writeText(selection).then(() => toast('Copied'))}>
                📋 Copy
              </button>
              <button
                className="btn sm"
                onClick={() => {
                  setPrefill(`What does "${selection.slice(0, 200)}" mean in this document?`);
                  setMobilePane('chat');
                }}
              >
                💬 Ask
              </button>
              <button className="icon-btn sm" onClick={() => (setSelection(''), document.getSelection()?.removeAllRanges())} aria-label="Clear selection">
                ✕
              </button>
            </div>
          )}
        </section>

        <section className="chat-pane">
          <Chat docId={meta.id} ctx={ctx} prefill={prefill} onPrefillUsed={clearPrefill} />
        </section>
      </div>

      {modal === 'share' && <ShareModal meta={meta} content={content} onClose={() => setModal(null)} />}
      {modal === 'upload' && (
        <UploadModal
          meta={meta}
          content={content}
          onClose={() => setModal(null)}
          onDone={async () => {
            setMeta((await getMeta(meta.id)) ?? meta);
            onChanged();
          }}
        />
      )}
      {modal === 'info' && (
        <Modal title="Details" onClose={() => setModal(null)}>
          <dl className="details">
            <dt>Type</dt>
            <dd>
              {SCAN_MODES[meta.mode].icon} {SCAN_MODES[meta.mode].label}
            </dd>
            <dt>Created</dt>
            <dd>{formatDate(meta.createdAt)}</dd>
            <dt>Pages</dt>
            <dd>{meta.pageCount}</dd>
            <dt>Keywords</dt>
            <dd>{meta.keywords.join(', ') || '—'}</dd>
            <dt>Encryption</dt>
            <dd>AES-256-GCM in your vault</dd>
            <dt>Saved to</dt>
            <dd>
              {meta.savedTo.length === 0
                ? 'Vault only'
                : meta.savedTo.map((s, i) => (
                    <div key={i}>
                      {providers[s.provider].icon} {providers[s.provider].label}: {s.folder}/{s.fileName} {s.encrypted ? '🔒' : ''}{' '}
                      {s.webUrl && (
                        <button className="link" onClick={() => openExternal(s.webUrl!)}>
                          open
                        </button>
                      )}
                    </div>
                  ))}
            </dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}

function ShareModal({ meta, content, onClose }: { meta: DocMeta; content: DocContent; onClose: () => void }) {
  const toast = useToast();
  const [fallback, setFallback] = useState(false);
  const cloudLink = meta.savedTo.find((s) => s.webUrl && !s.encrypted)?.webUrl;
  const body = cloudLink ? `${meta.name}: ${cloudLink}` : `${meta.name}\n\n${(content.ocr.map((o) => o.text).join('\n\n') || content.analysis || '').slice(0, 1500)}`;
  const links = shareLinks(meta.name, body);

  const shareNow = async () => {
    try {
      const r = await shareFile(buildExport(meta, content), meta.name);
      if (r === 'unsupported') setFallback(true);
      else if (r === 'shared') onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal title="Share" onClose={onClose}>
      <p className="hint">The shared copy is a regular (unencrypted) file so the recipient can open it.</p>
      <button className="btn primary block" onClick={shareNow}>
        📤 Share file… <small>(Gmail, WhatsApp, Messages, Drive…)</small>
      </button>
      {fallback && <p className="notice">This browser can't attach files to other apps. Download the file and attach it, or send a link/text below.</p>}
      <div className="share-grid">
        <button className="share-btn" onClick={() => openExternal(links.gmail)}>
          <span>✉️</span>Gmail
        </button>
        <button className="share-btn" onClick={() => openExternal(links.whatsapp)}>
          <span>🟩</span>WhatsApp
        </button>
        <a className="share-btn" href={links.sms}>
          <span>💬</span>Messages
        </a>
        <a className="share-btn" href={links.email}>
          <span>📧</span>Email
        </a>
        <button
          className="share-btn"
          onClick={async () => {
            const f = buildExport(meta, content);
            await saveToDevice('ScanVault', f.name, f);
            toast(`Saved ${f.name}`);
          }}
        >
          <span>⬇️</span>Download
        </button>
      </div>
      <p className="fineprint">{cloudLink ? 'Links include the cloud link to this file.' : 'Without a cloud link, the message includes the extracted text.'}</p>
    </Modal>
  );
}

function UploadModal({ meta, content, onClose, onDone }: { meta: DocMeta; content: DocContent; onClose: () => void; onDone: () => void }) {
  const prefs = getPrefs();
  const [dest, setDest] = useState<CloudProviderId>(prefs.lastProvider);
  const [folder, setFolder] = useState(folderFor(prefs.lastProvider));
  const [encrypt, setEncrypt] = useState(prefs.encryptUploads);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const go = async () => {
    setBusy(true);
    try {
      const loc = await uploadDocument(meta, content, dest, folder, encrypt);
      toast(`Saved to ${providers[dest].label}: ${loc.folder}/${loc.fileName}`, 'success');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Save to cloud" onClose={onClose}>
      <div className="segmented wrap">
        {(['gdrive', 'onedrive', 'device'] as CloudProviderId[]).map((id) => (
          <button
            key={id}
            className={dest === id ? 'active' : ''}
            onClick={() => {
              setDest(id);
              setFolder(folderFor(id));
            }}
          >
            {providers[id].icon} {providers[id].label}
            {providers[id].demo && <small className="badge">demo</small>}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Folder</span>
        <input value={folder} onChange={(e) => setFolder(e.target.value)} list="modal-folders" />
        <datalist id="modal-folders">
          {(prefs.recentFolders[dest] ?? []).map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} />
        <span>
          <strong>Encrypt before upload</strong>
          <small>Only ScanVault can open encrypted (.svenc) files.</small>
        </span>
      </label>
      <button className="btn primary block" disabled={busy} onClick={go}>
        {busy ? 'Uploading…' : `Save to ${providers[dest].label}`}
      </button>
    </Modal>
  );
}
