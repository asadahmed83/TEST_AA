import type { ScanMode } from '../types';
import { cleanLines, isoDate, parseFirstDate, topKeywords } from './text';

/**
 * Intelligent file names: `<today>_<Type>_<Title or keywords>` built from the
 * document's own title, recognised document type, issuer and keywords.
 */

const DOC_TYPES: { type: string; re: RegExp }[] = [
  { type: 'Invoice', re: /\b(tax\s+)?invoice\b|\binv(oice)?\s*(no|#|number)/i },
  { type: 'Receipt', re: /\breceipt\b|\bthank you for (your )?(purchase|shopping)|\bsubtotal\b.*\btotal\b/is },
  { type: 'Bank-Statement', re: /\b(bank|account)\s+statement\b|\bopening balance\b|\bclosing balance\b/i },
  { type: 'Payslip', re: /\b(pay\s?slip|payslip|pay stub|earnings statement|net pay)\b/i },
  { type: 'Tax-Form', re: /\b(form\s+(w-?2|1099|1040)|tax return|income tax)\b/i },
  { type: 'Utility-Bill', re: /\b(electricity|water|gas|internet|utility)\s+(bill|statement)\b|\bkwh\b/i },
  { type: 'Contract', re: /\b(agreement|contract|terms and conditions|hereinafter|witnesseth)\b/i },
  { type: 'Passport', re: /\bpassport\b|P<[A-Z]{3}/ },
  { type: 'Drivers-License', re: /\bdriv(er'?s|ing)\s+licen[cs]e\b|\bDL\s*(no|#)/i },
  { type: 'ID-Card', re: /\b(identity|identification|national id|id card|resident card|cnic)\b/i },
  { type: 'Insurance', re: /\b(insurance|policy (number|no)|insured|premium)\b/i },
  { type: 'Prescription', re: /\b(prescription|rx\b|dosage|mg\b.*\btablet)/i },
  { type: 'Medical-Report', re: /\b(lab (report|results)|diagnosis|patient (name|id)|specimen)\b/i },
  { type: 'Resume', re: /\b(curriculum vitae|resume|work experience|professional experience)\b/i },
  { type: 'Boarding-Pass', re: /\bboarding pass\b|\bgate\b.*\bseat\b/is },
  { type: 'Ticket', re: /\b(ticket|admit one|e-ticket)\b/i },
  { type: 'Certificate', re: /\bcertificate\b|\bthis is to certify\b/i },
  { type: 'Quote', re: /\b(quotation|estimate|quote (no|#))\b/i },
  { type: 'Purchase-Order', re: /\bpurchase order\b|\bP\.?O\.?\s*(no|#)/i },
  { type: 'Letter', re: /^\s*(dear|to whom it may concern)\b|\b(sincerely|regards|yours faithfully)\b/im },
  { type: 'Menu', re: /\b(appetizers|starters|desserts|main course|beverages)\b/i },
  { type: 'Report', re: /\b(report|executive summary|findings|conclusion)\b/i },
  { type: 'Notes', re: /\b(notes|meeting minutes|agenda|action items)\b/i },
];

const MODE_FALLBACK: Record<ScanMode, string> = {
  document: 'Document',
  image: 'Image',
  'id-single': 'ID-Card',
  'id-double': 'ID-Card',
  object: 'Object',
};

const ORG_RE = /\b[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}\s+(?:Inc|LLC|Ltd|Limited|Corp|Corporation|GmbH|Co|Company|Bank|Plc|PLC|Pvt|S\.A\.|AG)\b\.?/;
const BOILERPLATE = /^(page \d|confidential|copy|original|tel|phone|fax|email|www\.|http|date|invoice|receipt|to:|from:|re:|subject:)/i;

export function detectDocType(text: string): string | null {
  for (const { type, re } of DOC_TYPES) if (re.test(text)) return type;
  return null;
}

/** The most title-like line near the top: short, mostly letters, not boilerplate. */
export function detectTitle(text: string): string | null {
  const lines = cleanLines(text).slice(0, 12);
  let best: { line: string; score: number } | null = null;
  lines.forEach((line, i) => {
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (line.length < 4 || line.length > 70 || letters / line.length < 0.6 || BOILERPLATE.test(line)) return;
    if (/[.:;,]$/.test(line) && line.split(' ').length > 6) return; // sentence, not a heading
    let score = 10 - i; // nearer the top is better
    if (line === line.toUpperCase() && letters > 3) score += 4; // headings are often caps
    const words = line.split(' ').length;
    if (words >= 2 && words <= 8) score += 3;
    if (/^[A-Z]/.test(line)) score += 1;
    if (!best || score > best.score) best = { line, score };
  });
  return best ? (best as { line: string }).line : null;
}

export function detectOrganization(text: string): string | null {
  return text.match(ORG_RE)?.[0]?.trim() ?? null;
}

export function slug(s: string, maxWords = 6): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .map((w) => (w.length > 3 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join('-')
    .slice(0, 60);
}

export function sanitizeFileName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'scan';
}

export interface NameSuggestion {
  primary: string;
  alternatives: string[];
  docType: string;
  title: string | null;
  keywords: string[];
  documentDate: string | null;
}

/** Suggest a file name (without extension) from the extracted text. */
export function suggestFileName(text: string, mode: ScanMode, today = new Date(), hint?: { title?: string; keywords?: string[] }): NameSuggestion {
  const docType = (mode === 'document' || mode === 'image' ? detectDocType(text) : null) ?? (mode.startsWith('id') ? detectDocType(text) ?? 'ID-Card' : null) ?? MODE_FALLBACK[mode];
  const title = hint?.title || detectTitle(text);
  const org = detectOrganization(text);
  const keywords = hint?.keywords?.length ? hint.keywords : topKeywords(text);
  const docDate = parseFirstDate(text);
  const date = isoDate(today);

  const titleSlug = title ? slug(title) : '';
  const orgSlug = org ? slug(org, 4) : '';
  const kwSlug = slug(keywords.slice(0, 3).join(' '));

  // Avoid "Invoice_Invoice": drop the title when it only repeats the type.
  const titleAddsInfo = titleSlug && titleSlug.toLowerCase().replace(/-/g, '') !== docType.toLowerCase().replace(/-/g, '');
  const subject = (titleAddsInfo ? titleSlug : '') || orgSlug || kwSlug;

  const candidates = [
    [date, docType, subject],
    [date, docType, orgSlug && orgSlug !== subject ? orgSlug : kwSlug],
    [date, titleSlug || docType],
    docDate ? [isoDate(docDate), docType, subject] : null,
  ]
    .filter((c): c is string[] => !!c)
    .map((parts) => sanitizeFileName(parts.filter(Boolean).join('_')));

  const unique = [...new Set(candidates)];
  return {
    primary: unique[0],
    alternatives: unique.slice(1),
    docType,
    title,
    keywords,
    documentDate: docDate ? isoDate(docDate) : null,
  };
}
