/**
 * ScanVault AI proxy. Keeps the Anthropic API key on the server and exposes a
 * few narrow endpoints the app needs: chat, summarize, name suggestion and
 * object analysis. Run with `npm run server` (Node 22.18+ runs .ts directly).
 */
import Anthropic from '@anthropic-ai/sdk';
import express, { type NextFunction, type Request, type Response } from 'express';

const PORT = Number(process.env.PORT ?? 8787);
const APP_TOKEN = process.env.APP_TOKEN ?? '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,https://localhost')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MODEL = 'claude-opus-5-5';
const MAX_DOC_CHARS = 400_000; // ~100k tokens; well inside the context window

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: '20mb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return void res.sendStatus(204);
  if (APP_TOKEN && req.headers['x-app-token'] !== APP_TOKEN) return void res.status(401).json({ error: 'Unauthorized' });
  next();
});

type Mode = 'document' | 'image' | 'id-single' | 'id-double' | 'object';
interface DocBody {
  name: string;
  mode: Mode;
  pages: string[];
  analysis?: string;
  image?: string; // data URL
}

const SYSTEM = `You are ScanVault's document assistant. The user scanned or uploaded a document and is asking about it.
Answer using only the document content provided in <document>. Be precise: quote exact figures, names and dates as they appear, and say which page they come from when the document has several pages.
If the document does not contain the answer, say so plainly instead of guessing. The text came from OCR, so tolerate small recognition errors and mention when a value looks garbled.
Keep answers concise and use short Markdown (bold, bullet lists) where it helps.`;

function documentBlock(d: DocBody): string {
  let text = d.pages.map((p, i) => `<page number="${i + 1}">\n${p}\n</page>`).join('\n');
  if (text.length > MAX_DOC_CHARS) throw new HttpError(413, 'Document is too long for a single request.');
  if (d.analysis) text += `\n<object_analysis>\n${d.analysis}\n</object_analysis>`;
  return `<document name="${d.name.replace(/"/g, "'")}" type="${d.mode}">\n${text}\n</document>`;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function imageBlock(dataUrl?: string): Anthropic.Beta.BetaImageBlockParam[] {
  const m = dataUrl?.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);
  if (!m) return [];
  return [{ type: 'image', source: { type: 'base64', media_type: m[1] as 'image/jpeg', data: m[2] } }];
}

async function ask(
  params: {
    system: string;
    messages: Anthropic.Beta.BetaMessageParam[];
    effort: 'low' | 'medium' | 'high';
    format?: Record<string, unknown>;
  },
): Promise<string> {
  if (!client) throw new HttpError(503, 'Claude is not configured on the server (set ANTHROPIC_API_KEY).');
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // Re-runs a request on Anthropic's recommended model if a safety classifier declines it.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: params.effort, ...(params.format ? { format: { type: 'json_schema', schema: params.format } } : {}) },
    system: [{ type: 'text', text: params.system, cache_control: { type: 'ephemeral' } }],
    messages: params.messages,
  });
  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, response.stop_details?.explanation ?? 'Claude declined to answer this request.');
  }
  return response.content
    .flatMap((b) => (b.type === 'text' ? [b.text] : []))
    .join('')
    .trim();
}

const route =
  (fn: (body: any) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      res.json(await fn(req.body));
    } catch (err) {
      if (err instanceof HttpError) return void res.status(err.status).json({ error: err.message });
      if (err instanceof Anthropic.RateLimitError) return void res.status(429).json({ error: 'Rate limited by the AI service — try again shortly.' });
      if (err instanceof Anthropic.APIError) return void res.status(502).json({ error: `AI service error: ${err.message}` });
      console.error(err);
      res.status(500).json({ error: 'Unexpected server error' });
    }
  };

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, claude: Boolean(client), model: MODEL });
});

app.post(
  '/api/chat',
  route(async (b: DocBody & { history: { role: 'user' | 'assistant'; content: string }[]; question: string }) => {
    if (!b.question?.trim()) throw new HttpError(400, 'question is required');
    // The document (and image) always sit in the first, cacheable user turn; the
    // stored chat history follows, so repeated questions reuse the cached prefix.
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      {
        role: 'user',
        content: [
          ...imageBlock(b.image),
          { type: 'text', text: documentBlock(b), cache_control: { type: 'ephemeral' } },
        ],
      },
      { role: 'assistant', content: 'I have read the document. What would you like to know?' },
      ...(b.history ?? []).filter((m) => m.content?.trim()).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: b.question },
    ];
    // Merge consecutive same-role turns (the API requires alternation).
    const merged: Anthropic.Beta.BetaMessageParam[] = [];
    for (const m of messages) {
      const prev = merged.at(-1);
      if (prev && prev.role === m.role && typeof prev.content === 'string' && typeof m.content === 'string') {
        prev.content += `\n\n${m.content}`;
      } else merged.push({ ...m });
    }
    return { answer: await ask({ system: SYSTEM, messages: merged, effort: 'medium' }) };
  }),
);

app.post(
  '/api/summarize',
  route(async (b: DocBody) => {
    const summary = await ask({
      system: SYSTEM,
      effort: 'medium',
      messages: [
        {
          role: 'user',
          content: [
            ...imageBlock(b.image),
            {
              type: 'text',
              text: `${documentBlock(b)}\n\nSummarize this document. Start with one sentence saying what it is. Then list the key facts (parties, dates, amounts, IDs, deadlines, obligations) as bullets. End with any action items for the reader, if there are any.`,
            },
          ],
        },
      ],
    });
    return { summary };
  }),
);

app.post(
  '/api/name',
  route(async (b: { text: string; mode: Mode }) => {
    const raw = await ask({
      system: 'You label scanned documents so they are easy to find later.',
      effort: 'low',
      format: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short descriptive title, 2-6 words, e.g. "Acme Cloud Hosting Invoice"' },
          docType: { type: 'string', description: 'Document type, e.g. Invoice, Receipt, Contract, Passport' },
          keywords: { type: 'array', items: { type: 'string' }, description: '3-6 search keywords' },
        },
        required: ['title', 'docType', 'keywords'],
        additionalProperties: false,
      },
      messages: [{ role: 'user', content: `Scan type: ${b.mode}\n<text>\n${(b.text ?? '').slice(0, 20000)}\n</text>` }],
    });
    return JSON.parse(raw);
  }),
);

app.post(
  '/api/analyze',
  route(async (b: { image: string; ocrText?: string }) => {
    const img = imageBlock(b.image);
    if (!img.length) throw new HttpError(400, 'image must be a base64 data URL');
    const analysis = await ask({
      system: 'You analyse photos of physical objects for the user of a scanning app.',
      effort: 'medium',
      messages: [
        {
          role: 'user',
          content: [
            ...img,
            {
              type: 'text',
              text: `Identify the object in this photo and analyse it. Cover: what it is (brand/model if visible), notable features, condition or visible defects, any readable text or labels, and practical notes (e.g. typical use, care, safety). Use short Markdown sections.${b.ocrText ? `\nOCR found this text on it: ${b.ocrText.slice(0, 2000)}` : ''}`,
            },
          ],
        },
      ],
    });
    return { analysis };
  }),
);

app.listen(PORT, () => {
  console.log(`ScanVault AI proxy on http://localhost:${PORT} (Claude ${client ? 'enabled' : 'NOT configured'})`);
});
