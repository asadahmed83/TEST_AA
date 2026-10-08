# ScanVault

Encrypted scanning app for **web and Android** (iOS-ready via Capacitor) — scan documents, images, ID cards and objects, extract text with OCR, chat with your documents, and save straight to Google Drive or OneDrive with cross-device sync.

## Features

| Area | What it does |
| --- | --- |
| **Guided scanning** | Pick a mode on the home screen: **Document** (A4 frame, multi-page PDF), **Image**, **ID card · 1 page** (front + back combined on one page), **ID card · 2 pages**, or **Object analysis**. The camera shows a frame matching the mode and walks you through front → back for IDs. Upload from the gallery works too, and you can import existing **PDFs/images**. |
| **Clean-up** | Original / Enhanced (contrast stretch) / B&W document (adaptive threshold) filters, rotate, delete pages. |
| **OCR** | Tesseract (WebAssembly) runs **on the device**, with the engine and English model bundled in the app — works offline. Digital PDFs use their embedded text layer. Text + word positions are stored with the scan. |
| **Select text → Google** | An invisible OCR text layer sits on top of the scan, so you can press-and-drag to select text right on the image (or use the Text tab). **Select area** lets you draw a box; ScanVault reads the words inside it. Then: 🔎 Search Google, 📋 Copy, or 💬 Ask about it. |
| **Smart file names** | `<today>_<Type>_<Title>` — e.g. `2026-10-08_Invoice_Acme-Cloud-Services-LLC` — built from the document's title, detected type (invoice, receipt, contract, passport, …), issuer and keywords, with alternatives (incl. the document's own date). With the Claude engine on, Claude proposes the title/keywords. |
| **Cloud save + remembered folder** | Save to Google Drive, OneDrive, or the device. ScanVault remembers the last provider and **the last folder per provider** and pre-fills them next time (with a recent-folders list). |
| **Encryption** | Zero-knowledge: a random AES-256-GCM data key encrypts every scan, extracted text and chat at rest (IndexedDB). The key is wrapped with a key derived from your passphrase (PBKDF2-SHA256, 600k iterations) and never stored in plaintext. Uploads are encrypted by default (`.svenc`, openable only in ScanVault — 🔓 in the Library decrypts one); untick to upload a regular PDF/JPG. Auto-locks after 5 minutes in the background. |
| **Sync across devices** | Each document (pages, OCR text, chat history) is uploaded as an encrypted bundle to `ScanVault/.sync` in your cloud; newest version wins and deletions propagate. On a new device choose **Join it** on the first screen, pick the cloud and enter your passphrase. Syncs on unlock, after saves and every 3 minutes. |
| **Chat with documents** | Ask questions about any scanned or imported document; answers come only from its content and cite pages. **Summarise** pins a summary to the top of the chat. History is stored (encrypted) per document and syncs. |
| **Two AI engines** | **On-device** (default, private): BM25 passage retrieval + entity extraction (dates, amounts, emails, phones, IDs) + extractive summaries. **Claude** (opt-in in Settings): full natural-language answers, summaries, naming and object recognition through a small server that holds your API key. If Claude is unreachable the app falls back to on-device. |
| **Library & search** | Searches names, keywords **and the text inside scans**, with match snippets and filters by type. |
| **Sharing** | 📤 opens the system share sheet with the actual file attached (Gmail, WhatsApp, Messages, Drive, …) on Android and supporting browsers; elsewhere it falls back to Gmail / WhatsApp / SMS / email links (with the cloud link or extracted text) plus download. |

## Quick start (web)

```bash
cd scanvault
npm install
cp .env.example .env      # optional: add OAuth client IDs / AI settings
npm run dev               # http://localhost:5173
```

Without any keys the app is fully usable: Google Drive and OneDrive run in **demo mode** (a local stand-in cloud, labelled "demo") and the AI uses the on-device engine.

### Claude (optional)

```bash
ANTHROPIC_API_KEY=sk-ant-... npm run server   # AI proxy on :8787 (Vite proxies /api to it)
```

Then Settings → AI assistant → **Claude**. The server (`server/index.ts`) uses `claude-opus-5-5` with server-side refusal fallbacks, prompt caching of the document, and JSON-schema output for naming. Set `APP_TOKEN` (and the same `VITE_AI_APP_TOKEN`) to stop others using your proxy, and `ALLOWED_ORIGINS` for CORS.

### Google Drive

1. In Google Cloud Console enable the **Google Drive API**.
2. Create an **OAuth client ID → Web application**; add your origins (e.g. `http://localhost:5173`, your production URL) to *Authorized JavaScript origins*.
3. Set `VITE_GOOGLE_CLIENT_ID` in `.env`.

Scope used: `drive.file` — ScanVault can only see files/folders it created.

### OneDrive

1. In Azure Portal → App registrations → **New registration** (accounts in any org + personal Microsoft accounts).
2. Add platform **Single-page application** with redirect URI = your origin (e.g. `http://localhost:5173`).
3. API permissions: Microsoft Graph delegated `Files.ReadWrite`, `User.Read`.
4. Set `VITE_MS_CLIENT_ID` in `.env`.

## Android

Requires Android Studio / Android SDK.

```bash
npm run android:sync     # builds the web app and copies it into android/
npm run android:open     # opens Android Studio → Run ▶
```

- Camera capture uses the WebView camera (permission declared in `AndroidManifest.xml`); upload from gallery always works.
- Saving to "This device" writes to `Documents/<folder>/`; sharing uses the native share sheet (`@capacitor/share`).
- For Claude on a phone, deploy `server/` somewhere reachable over HTTPS and set `VITE_AI_BASE_URL=https://your-host/api` before building (`https://localhost` is the app's origin for CORS).
- ⚠️ **Known gap:** Google's and Microsoft's web sign-in popups don't run inside the Android WebView. The cloud code (Drive REST / Graph) is shared, but on Android the sign-in step needs a native OAuth plugin (e.g. `@capacitor-firebase/authentication` or `@recognizebv/capacitor-plugin-msauth`, or a custom-tab OAuth flow) that hands the access token to the existing providers. Until then use the web app for Drive/OneDrive, or the device/demo targets on Android.

### iOS later

`npm i -D @capacitor/ios && npx cap add ios`, add `NSCameraUsageDescription` to `Info.plist`, then `npx cap open ios`. No app code changes are needed beyond the same native-OAuth step.

## Project layout

```
src/
  components/      Home, Scanner, Review (OCR + naming + save), Library, DocumentView, PageViewer, Chat, Settings, Unlock
  lib/crypto.ts    PBKDF2 + AES-GCM vault key, record and file encryption
  lib/vault.ts     encrypted IndexedDB records (meta / content / chats)
  lib/ocr.ts       Tesseract worker (self-hosted assets in public/ocr)
  lib/naming.ts    intelligent file names
  lib/ai/          on-device engine, Claude client, BM25 retrieval
  lib/cloud/       Google Drive, OneDrive, demo cloud, device
  lib/sync.ts      encrypted cross-device sync
  lib/prefs.ts     remembered provider + folder per provider
server/index.ts    Claude proxy (chat, summarize, name, analyze)
android/           Capacitor Android project
```

## Scripts

| Command | |
| --- | --- |
| `npm run dev` / `npm run build` | Web dev server / production build (both copy OCR assets first) |
| `npm test` | Unit tests (naming, on-device AI, crypto, markdown escaping) |
| `npm run typecheck` | TypeScript for app, server and config |
| `npm run server` | Claude proxy (Node 22.18+) |

## Security notes

- Lose the passphrase → the vault can't be decrypted (by design). Each device can use its own passphrase for the same vault (Settings → Change passphrase).
- Shared files (📤) are plain PDFs/JPGs so recipients can open them.
- With the Claude engine on, the document text (and the image, for objects and text-less scans) is sent to your proxy and to Anthropic's API. The on-device engine sends nothing.
- Chat answers are rendered from an escaped Markdown subset, so OCR'd text can't inject HTML.
