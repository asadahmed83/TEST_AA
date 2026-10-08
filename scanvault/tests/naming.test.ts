import { describe, expect, it } from 'vitest';
import { detectDocType, detectTitle, sanitizeFileName, suggestFileName } from '../src/lib/naming';

const today = new Date(2026, 9, 8);

const invoice = `ACME CLOUD SERVICES LLC
123 Market Street, San Francisco
INVOICE
Invoice No: INV-2026-0042
Date: 2026-09-30
Bill to: Jane Doe
Cloud hosting - September   $120.00
Support plan                $30.00
Total due: $150.00
Due date: October 15, 2026`;

describe('suggestFileName', () => {
  it('builds date_type_subject from content', () => {
    const s = suggestFileName(invoice, 'document', today);
    expect(s.docType).toBe('Invoice');
    expect(s.primary).toBe('2026-10-08_Invoice_Acme-Cloud-Services-LLC');
    expect(s.documentDate).toBe('2026-09-30');
    expect(s.alternatives.some((a) => a.startsWith('2026-09-30_Invoice'))).toBe(true);
  });

  it('uses a hinted (AI) title when given', () => {
    const s = suggestFileName(invoice, 'document', today, { title: 'Acme hosting invoice September', keywords: ['hosting'] });
    expect(s.primary).toBe('2026-10-08_Invoice_Acme-Hosting-Invoice-September');
  });

  it('falls back to mode labels for empty text', () => {
    expect(suggestFileName('', 'object', today).primary).toBe('2026-10-08_Object');
    expect(suggestFileName('', 'id-single', today).primary).toBe('2026-10-08_ID-Card');
  });

  it('recognises common document types', () => {
    expect(detectDocType('Thank you for your purchase. Subtotal 4.00 Total 4.50')).toBe('Receipt');
    expect(detectDocType('This Agreement is made between the parties hereinafter')).toBe('Contract');
    expect(detectDocType("DRIVER'S LICENSE  Class C")).toBe('Drivers-License');
  });

  it('picks a heading-like title near the top', () => {
    expect(detectTitle('Page 1\nQUARTERLY SALES REPORT\nThis report covers the period from July to September.')).toBe('QUARTERLY SALES REPORT');
  });

  it('produces filesystem-safe names', () => {
    expect(sanitizeFileName('a/b:c*d?"e<f>g|h')).toBe('abcdefgh');
    expect(sanitizeFileName('  ')).toBe('scan');
  });
});
