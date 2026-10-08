import type { AiEngine } from './types';

/**
 * Talks to the ScanVault AI proxy (server/index.ts), which calls Claude with
 * the API key kept server-side. Document text is sent only when the user has
 * picked the Claude engine in Settings.
 */

const BASE = (import.meta.env.VITE_AI_BASE_URL as string | undefined)?.replace(/\/$/, '') || '/api';
const TOKEN = import.meta.env.VITE_AI_APP_TOKEN as string | undefined;

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'X-App-Token': TOKEN } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `AI request failed (${res.status})`);
  return data;
}

export async function claudeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { headers: TOKEN ? { 'X-App-Token': TOKEN } : {} });
    if (!res.ok) return false;
    return ((await res.json()) as { claude?: boolean }).claude === true;
  } catch {
    return false;
  }
}

export const claudeEngine: AiEngine = {
  id: 'claude',
  label: 'Claude',
  async answer(ctx, history, question) {
    const r = await call<{ answer: string }>('/chat', {
      name: ctx.name,
      mode: ctx.mode,
      pages: ctx.pages,
      analysis: ctx.analysis,
      image: ctx.pages.join('').trim() ? undefined : ctx.image,
      history: history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
      question,
    });
    return r.answer;
  },
  async summarize(ctx) {
    const r = await call<{ summary: string }>('/summarize', {
      name: ctx.name,
      mode: ctx.mode,
      pages: ctx.pages,
      analysis: ctx.analysis,
      image: ctx.pages.join('').trim() ? undefined : ctx.image,
    });
    return r.summary;
  },
  async analyzeObject(image, _stats, ocrText) {
    const r = await call<{ analysis: string }>('/analyze', { image, ocrText });
    return r.analysis;
  },
  async suggestTitle(text, mode) {
    return call<{ title: string; keywords: string[]; docType: string }>('/name', { text: text.slice(0, 20000), mode });
  },
};
