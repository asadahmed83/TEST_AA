/** Text helpers shared by naming, search and the on-device AI engine. */

export const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers herself him himself
  his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours
  ourselves out over own same she should so some such than that the their theirs them themselves then there these they this
  those through to too under until up very was we were what when where which while who whom why will with would you your
  yours yourself yourselves also may shall per via within without upon please thank thanks dear page
  tell show give find say said says document doc file scan scanned`.split(/\s+/),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) ?? []).map((t) => t.replace(/['’]s$/, ''));
}

/** Very small suffix stemmer — good enough to match "payments" with "payment". */
export function stem(t: string): string {
  if (t.length <= 4) return t;
  return t
    .replace(/(ies)$/, 'y')
    .replace(/(ing|edly|ed|es|ly)$/, '')
    .replace(/s$/, '');
}

export function terms(text: string): string[] {
  return tokenize(text)
    .filter((t) => !STOPWORDS.has(t) && t.length > 1)
    .map(stem);
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z0-9])|\n(?=[A-Z0-9•\-*])/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 2);
}

export function cleanLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/* ---------- Entity extraction ---------- */

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_RE = new RegExp(
  [
    String.raw`\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b`,
    String.raw`\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTHS})\.?,?\s+\d{4}\b`,
    String.raw`\b(?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b`,
  ].join('|'),
  'gi',
);
const AMOUNT_RE = /(?:[$€£¥₹]|\b(?:USD|EUR|GBP|INR|CAD|AUD|PKR|AED)\s?)\s?-?\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{2})?|\b\d{1,3}(?:,\d{3})*\.\d{2}\b/g;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?(?:\(\d{1,4}\)[\s-]?|\d{1,4}[\s-])?\d{3,4}[\s-]\d{3,4}\b/g;
const URL_RE = /\bhttps?:\/\/[^\s]+|\bwww\.[^\s]+/gi;
const IDNUM_RE = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{5,19}\b|\b\d{6,}\b/g;

const uniq = (xs: string[]) => [...new Set(xs.map((x) => x.trim()))].filter(Boolean);

export interface Entities {
  dates: string[];
  amounts: string[];
  emails: string[];
  phones: string[];
  urls: string[];
  ids: string[];
}

export function extractEntities(text: string): Entities {
  const emails = uniq(text.match(EMAIL_RE) ?? []);
  const dates = uniq(text.match(DATE_RE) ?? []);
  return {
    dates,
    amounts: uniq(text.match(AMOUNT_RE) ?? []),
    emails,
    // ≥9 digits (or an explicit +country / (area) prefix) so invoice numbers like 2026-0042 aren't phones
    phones: uniq((text.match(PHONE_RE) ?? []).filter((p) => (p.replace(/\D/g, '').length >= 9 || /^\s*[+(]/.test(p)) && !dates.includes(p.trim()))),
    urls: uniq(text.match(URL_RE) ?? []),
    ids: uniq(text.match(IDNUM_RE) ?? []).filter((x) => !dates.some((d) => d.includes(x))).slice(0, 10),
  };
}

/** Parse the first recognisable date in the text; returns null when none. */
export function parseFirstDate(text: string): Date | null {
  for (const m of text.match(DATE_RE) ?? []) {
    const iso = m.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    let d: Date | null = null;
    if (iso) d = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    else if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(m)) {
      const [a, b, c] = m.split(/[-/.]/).map(Number);
      const y = c < 100 ? 2000 + c : c;
      // Prefer day-first when the first number can't be a month.
      d = a > 12 ? new Date(y, b - 1, a) : new Date(y, a - 1, b);
    } else {
      const t = Date.parse(m.replace(/(\d)(st|nd|rd|th)/i, '$1'));
      if (!Number.isNaN(t)) d = new Date(t);
    }
    if (d && !Number.isNaN(d.getTime()) && d.getFullYear() > 1900 && d.getFullYear() < 2200) return d;
  }
  return null;
}

/** Top keywords by frequency, ignoring stopwords and numbers. */
export function topKeywords(text: string, n = 6): string[] {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) {
    if (STOPWORDS.has(t) || t.length < 4 || /^\d/.test(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([w]) => w);
}

export function isoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
