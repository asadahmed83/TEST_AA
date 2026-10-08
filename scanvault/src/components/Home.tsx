import { useEffect, useState } from 'react';
import { SCAN_MODES, type DocMeta, type ScanMode } from '../types';
import { listMeta } from '../lib/vault';
import { formatDate, TopBar } from './ui';

export function Home(props: {
  onScan: (mode: ScanMode) => void;
  onImport: (files: FileList) => void;
  onOpen: (id: string) => void;
  onLibrary: () => void;
  onSettings: () => void;
  onLock: () => void;
  refreshKey: number;
}) {
  const [recent, setRecent] = useState<DocMeta[]>([]);
  useEffect(() => {
    listMeta().then((m) => setRecent(m.slice(0, 6)));
  }, [props.refreshKey]);

  return (
    <div className="screen">
      <TopBar
        title="ScanVault"
        actions={
          <>
            <button className="icon-btn" onClick={props.onLibrary} aria-label="Library" title="Library">
              📚
            </button>
            <button className="icon-btn" onClick={props.onSettings} aria-label="Settings" title="Settings">
              ⚙️
            </button>
            <button className="icon-btn" onClick={props.onLock} aria-label="Lock" title="Lock vault">
              🔒
            </button>
          </>
        }
      />
      <main className="content">
        <h2 className="section-title">What are you scanning?</h2>
        <div className="mode-grid">
          {(Object.keys(SCAN_MODES) as ScanMode[]).map((m) => (
            <button key={m} className="mode-card" onClick={() => props.onScan(m)}>
              <span className="mode-icon">{SCAN_MODES[m].icon}</span>
              <span className="mode-label">{SCAN_MODES[m].label}</span>
              <span className="mode-desc">{SCAN_MODES[m].description}</span>
            </button>
          ))}
          <label className="mode-card import">
            <span className="mode-icon">📥</span>
            <span className="mode-label">Import file</span>
            <span className="mode-desc">Upload a PDF or images you already have</span>
            <input
              type="file"
              accept="application/pdf,image/*"
              multiple
              hidden
              onChange={(e) => e.target.files?.length && props.onImport(e.target.files)}
            />
          </label>
        </div>

        <div className="row-between">
          <h2 className="section-title">Recent</h2>
          {recent.length > 0 && (
            <button className="link" onClick={props.onLibrary}>
              See all →
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="empty">No scans yet. Everything you save is encrypted on this device first.</p>
        ) : (
          <div className="recent-strip">
            {recent.map((d) => (
              <button key={d.id} className="recent-card" onClick={() => props.onOpen(d.id)}>
                <img src={d.thumbnail} alt="" />
                <span className="recent-name">{d.name}</span>
                <span className="recent-date">{formatDate(d.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
