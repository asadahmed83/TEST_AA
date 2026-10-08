import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageImage, ScanMode } from './types';
import { isUnlocked, lock } from './lib/vault';
import { getPrefs } from './lib/prefs';
import { providers } from './lib/cloud';
import { syncNow, VaultMismatchError } from './lib/sync';
import { importPdf } from './lib/pdf';
import { fileToDataUrl, normalize } from './lib/image';
import { isNative } from './lib/platform';
import { Unlock } from './components/Unlock';
import { Home } from './components/Home';
import { Scanner } from './components/Scanner';
import { Review, type Draft } from './components/Review';
import { Library } from './components/Library';
import { DocumentView } from './components/DocumentView';
import { Settings } from './components/Settings';
import { Progress, useToast } from './components/ui';

type Route =
  | { name: 'home' }
  | { name: 'scan'; mode: ScanMode }
  | { name: 'review'; draft: Draft }
  | { name: 'library' }
  | { name: 'doc'; id: string }
  | { name: 'settings' }
  | { name: 'importing'; label: string; progress: number | null };

const AUTO_LOCK_MS = 5 * 60 * 1000;
const SYNC_EVERY_MS = 3 * 60 * 1000;

export default function App() {
  const [unlocked, setUnlocked] = useState(isUnlocked());
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [refreshKey, setRefreshKey] = useState(0);
  const toast = useToast();
  const hiddenAt = useRef<number | null>(null);

  const route = stack[stack.length - 1];
  const push = (r: Route) => setStack((s) => [...s, r]);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = (r: Route) => setStack([{ name: 'home' }, ...(r.name === 'home' ? [] : [r])]);
  const refresh = () => setRefreshKey((k) => k + 1);

  const doLock = useCallback(() => {
    lock();
    setUnlocked(false);
    setStack([{ name: 'home' }]);
  }, []);

  const backgroundSync = useCallback(async () => {
    const p = getPrefs();
    if (!isUnlocked() || !p.autoSync || !p.syncProvider || !providers[p.syncProvider].isConnected()) return;
    try {
      const r = await syncNow();
      if (r.pulled) {
        toast(`Synced ${r.pulled} change${r.pulled > 1 ? 's' : ''} from your other devices`);
        refresh();
      }
    } catch (e) {
      if (e instanceof VaultMismatchError) toast('Sync paused: your cloud holds a different vault. Open Settings → Sync now to join it.', 'error');
      // other errors (offline, expired session) are retried on the next tick
    }
  }, [toast]);

  // Auto-lock after being in the background for a while; sync when returning.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else {
        if (hiddenAt.current && Date.now() - hiddenAt.current > AUTO_LOCK_MS) doLock();
        else backgroundSync();
        hiddenAt.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(backgroundSync, SYNC_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, [doLock, backgroundSync]);

  // Android hardware back button.
  useEffect(() => {
    if (!isNative()) return;
    let remove: (() => void) | undefined;
    import('@capacitor/app').then(({ App: CapApp }) =>
      CapApp.addListener('backButton', () => {
        setStack((s) => {
          if (s.length > 1) return s.slice(0, -1);
          CapApp.minimizeApp();
          return s;
        });
      }).then((h) => (remove = () => h.remove())),
    );
    return () => remove?.();
  }, []);

  const importFiles = async (files: FileList) => {
    const list = Array.from(files);
    const pdf = list.find((f) => f.type === 'application/pdf');
    try {
      if (pdf) {
        push({ name: 'importing', label: `Opening ${pdf.name}…`, progress: null });
        const r = await importPdf(pdf, (done, total) => setStack((s) => [...s.slice(0, -1), { name: 'importing', label: `Rendering page ${done} of ${total}…`, progress: done / total }]));
        setStack((s) => [...s.slice(0, -1), { name: 'review', draft: { mode: 'document', pages: r.pages, ocr: r.ocr, fromPdf: true } }]);
      } else {
        const pages: PageImage[] = [];
        for (const f of list.filter((x) => x.type.startsWith('image/'))) pages.push(await normalize(await fileToDataUrl(f)));
        if (!pages.length) return toast('Choose a PDF or image files.', 'error');
        push({ name: 'review', draft: { mode: pages.length > 1 ? 'document' : 'image', pages } });
      }
    } catch (e) {
      toast(`Could not import: ${(e as Error).message}`, 'error');
      setStack([{ name: 'home' }]);
    }
  };

  if (!unlocked)
    return (
      <Unlock
        onUnlocked={(o) => {
          setUnlocked(true);
          if (o?.joined) toast('Joined your vault — syncing your scans…');
          backgroundSync().then(refresh);
        }}
      />
    );

  switch (route.name) {
    case 'home':
      return (
        <Home
          refreshKey={refreshKey}
          onScan={(mode) => push({ name: 'scan', mode })}
          onImport={importFiles}
          onOpen={(id) => push({ name: 'doc', id })}
          onLibrary={() => push({ name: 'library' })}
          onSettings={() => push({ name: 'settings' })}
          onLock={doLock}
        />
      );
    case 'scan':
      return <Scanner mode={route.mode} onBack={back} onDone={(pages) => setStack((s) => [...s.slice(0, -1), { name: 'review', draft: { mode: route.mode, pages } }])} />;
    case 'review':
      return (
        <Review
          draft={route.draft}
          onBack={back}
          onSaved={(id) => {
            refresh();
            reset({ name: 'doc', id });
            backgroundSync();
          }}
        />
      );
    case 'importing':
      return (
        <div className="screen center">
          <Progress value={route.progress} label={route.label} />
        </div>
      );
    case 'library':
      return <Library onBack={back} onOpen={(id) => push({ name: 'doc', id })} />;
    case 'doc':
      return <DocumentView id={route.id} onBack={back} onChanged={refresh} />;
    case 'settings':
      return <Settings onBack={back} onLock={doLock} onSynced={refresh} />;
  }
}
