import { extractEntities, splitSentences, terms, topKeywords } from '../text';
import { detectDocType, detectOrganization, detectTitle } from '../naming';
import { buildPassages, rank } from './retrieval';
import type { AiEngine, DocContext } from './types';

/**
 * Fully on-device engine: nothing leaves the phone. Answers are extracted from
 * the document's own text (BM25 retrieval + entity extraction), so they are
 * always grounded in the content — but it cannot reason like an LLM.
 */

type Intent = { name: keyof ReturnType<typeof extractEntities>; label: string; re: RegExp };
const INTENTS: Intent[] = [
  // Order matters: "when is payment due?" is a date question, "total due?" an amount one.
  { name: 'dates', label: 'Dates found', re: /\b(when|date|deadline|expire[sd]?|expiry|expiration|issued|valid until|birth|dob|what day)\b/i },
  { name: 'amounts', label: 'Amounts found', re: /\b(total|amount|price|cost|pay|paid|owe|due|balance|fee|charge|how much|sum|tax)\b/i },
  { name: 'emails', label: 'Email addresses', re: /\b(e-?mail|contact)\b/i },
  { name: 'phones', label: 'Phone numbers', re: /\b(phone|call|mobile|tel|telephone|number to)\b/i },
  { name: 'urls', label: 'Links', re: /\b(website|url|link|site)\b/i },
  { name: 'ids', label: 'Reference / ID numbers', re: /\b(id|number|no\.?|reference|ref|account|invoice number|policy|license|passport)\b/i },
];

function cite(page: number, pageCount: number) {
  return pageCount > 1 ? ` _(page ${page + 1})_` : '';
}

export function localAnswer(ctx: DocContext, question: string): string {
  const fullText = ctx.pages.join('\n\n');
  if (!fullText.trim()) {
    return ctx.analysis
      ? `I couldn't find readable text in this scan. Here's what I know from the analysis:\n\n${ctx.analysis}`
      : "I couldn't find any readable text in this scan, so I can't answer from its content. Try rescanning with better light, or switch to the Claude engine in Settings for visual understanding.";
  }
  const q = question.trim();

  if (/\b(summar|overview|tl;?dr|gist|what is this|what's this|about)\b/i.test(q)) return localSummary(ctx);

  const passages = buildPassages(ctx.pages);
  const ranked = rank(passages, q);
  const parts: string[] = [];

  // Entity-style questions ("what's the total?", "when is it due?")
  const intent = INTENTS.find((i) => i.re.test(q));
  if (intent) {
    // Prefer entities found in the best-matching passages, then the whole doc.
    const near = ranked.slice(0, 3).flatMap((r) => extractEntities(r.passage.text)[intent.name]);
    const all = extractEntities(fullText)[intent.name];
    const values = [...new Set([...near, ...all])].slice(0, 6);
    if (values.length) {
      parts.push(`**${intent.label}:** ${values.map((v) => `\`${v}\``).join(', ')}`);
      if (intent.name === 'amounts' && /\btotal\b/i.test(q)) {
        const totalLine = passages.find((p) => /\b(grand\s+)?total\b/i.test(p.text) && extractEntities(p.text).amounts.length);
        if (totalLine) parts.unshift(`The total appears to be **${extractEntities(totalLine.text).amounts.at(-1)}**${cite(totalLine.page, ctx.pages.length)}.`);
      }
    }
  }

  if (ranked.length) {
    const top = ranked.slice(0, 3).filter((r, i) => i === 0 || r.score >= ranked[0].score * 0.5);
    parts.push(
      `${parts.length ? 'Relevant passages' : 'Here is what the document says'}:\n\n` +
        top.map((r) => `> ${r.passage.text}${cite(r.passage.page, ctx.pages.length)}`).join('\n>\n'),
    );
  }

  if (!parts.length) {
    const kw = topKeywords(fullText, 5);
    return `I couldn't find anything about that in **${ctx.name}**. The document mainly mentions: ${kw.join(', ') || 'no clear topics'}. Try different words, or switch to the Claude engine for deeper answers.`;
  }
  return parts.join('\n\n');
}

export function localSummary(ctx: DocContext): string {
  const text = ctx.pages.join('\n\n');
  if (!text.trim()) return ctx.analysis ?? 'No readable text was found in this scan.';

  const sentences = splitSentences(text).filter((s) => s.split(' ').length >= 4);
  const freq = new Map<string, number>();
  for (const t of terms(text)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const scored = sentences.map((s, i) => {
    const ts = terms(s);
    const score = ts.reduce((a, t) => a + (freq.get(t) ?? 0), 0) / Math.sqrt(ts.length || 1) + (i < 3 ? 2 : 0);
    return { s, i, score };
  });
  const key = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .sort((a, b) => a.i - b.i)
    .map((x) => `- ${x.s.length > 220 ? x.s.slice(0, 217) + '…' : x.s}`);

  const e = extractEntities(text);
  const type = detectDocType(text);
  const title = detectTitle(text);
  const org = detectOrganization(text);
  const facts = [
    type && `**Type:** ${type.replace(/-/g, ' ')}`,
    title && `**Title:** ${title}`,
    org && `**From:** ${org}`,
    e.dates.length && `**Dates:** ${e.dates.slice(0, 4).join(', ')}`,
    e.amounts.length && `**Amounts:** ${e.amounts.slice(0, 5).join(', ')}`,
    e.emails.length && `**Emails:** ${e.emails.slice(0, 3).join(', ')}`,
    e.phones.length && `**Phones:** ${e.phones.slice(0, 3).join(', ')}`,
  ].filter(Boolean);

  const words = text.split(/\s+/).length;
  return [
    `**${ctx.name}** — ${ctx.pages.length} page${ctx.pages.length > 1 ? 's' : ''}, ~${words} words.`,
    facts.join('\n'),
    key.length ? `**Key points**\n${key.join('\n')}` : '',
    `**Keywords:** ${topKeywords(text, 8).join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const localEngine: AiEngine = {
  id: 'local',
  label: 'On-device',
  async answer(ctx, _history, question) {
    return localAnswer(ctx, question);
  },
  async summarize(ctx) {
    return localSummary(ctx);
  },
  async analyzeObject(_image, stats, ocrText) {
    const lines = [
      `**On-device analysis** (basic — enable the Claude engine in Settings for full object recognition)`,
      `- **Size:** ${stats.width} × ${stats.height}px`,
      `- **Dominant colours:** ${stats.colors.join(', ')}`,
      `- **Lighting:** ${stats.brightness < 0.3 ? 'dark' : stats.brightness > 0.75 ? 'very bright' : 'good'} (${Math.round(stats.brightness * 100)}%)`,
      `- **Sharpness:** ${stats.sharpness < 50 ? 'blurry — try holding steadier' : stats.sharpness < 150 ? 'acceptable' : 'sharp'}`,
    ];
    if (ocrText.trim()) lines.push(`- **Visible text / labels:** ${ocrText.replace(/\s+/g, ' ').trim().slice(0, 300)}`);
    return lines.join('\n');
  },
};
