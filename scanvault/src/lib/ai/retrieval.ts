import { splitSentences, terms } from '../text';

export interface Passage {
  text: string;
  page: number;
  index: number;
}

/** Split page texts into sentence-sized passages that remember their page. */
export function buildPassages(pages: string[]): Passage[] {
  const out: Passage[] = [];
  pages.forEach((p, page) => splitSentences(p).forEach((text) => out.push({ text, page, index: out.length })));
  return out;
}

/** Okapi BM25 ranking of passages against a query. */
export function rank(passages: Passage[], query: string, k1 = 1.4, b = 0.75): { passage: Passage; score: number }[] {
  const q = [...new Set(terms(query))];
  if (!q.length || !passages.length) return [];
  const docs = passages.map((p) => terms(p.text));
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  return docs
    .map((d, i) => {
      let score = 0;
      for (const t of q) {
        const f = d.filter((x) => x === t).length;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
        score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgdl));
      }
      return { passage: passages[i], score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b2) => b2.score - a.score);
}
