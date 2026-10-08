import { describe, expect, it } from 'vitest';
import { localAnswer, localSummary } from '../src/lib/ai/local';
import { extractEntities, parseFirstDate } from '../src/lib/text';
import type { DocContext } from '../src/lib/ai/types';

const ctx: DocContext = {
  name: 'Lease agreement',
  mode: 'document',
  pages: [
    `RESIDENTIAL LEASE AGREEMENT
This Agreement is made on March 1, 2026 between Oakwood Properties Ltd and John Smith.
The monthly rent is $1,450.00, payable on the first day of each month.
A security deposit of $2,900.00 is due at signing.`,
    `Pets are not allowed without written consent of the landlord.
The lease ends on February 28, 2027. Contact the office at office@oakwood.example or 555-201-3344.`,
  ],
};

describe('on-device answers', () => {
  it('answers amount questions with the figures and source passage', () => {
    const a = localAnswer(ctx, 'How much is the monthly rent?');
    expect(a).toContain('$1,450.00');
    expect(a).toContain('monthly rent');
  });

  it('answers date questions and cites the page', () => {
    const a = localAnswer(ctx, 'When does the lease end?');
    expect(a).toContain('February 28, 2027');
    expect(a).toContain('page 2');
  });

  it('finds policy passages by keyword', () => {
    expect(localAnswer(ctx, 'Are pets allowed?')).toContain('Pets are not allowed');
  });

  it('says so when the answer is not in the document', () => {
    expect(localAnswer(ctx, 'What is the capital of France?')).toMatch(/couldn't find anything/);
  });

  it('summarises with type, parties and key facts', () => {
    const s = localSummary(ctx);
    expect(s).toContain('**Type:** Contract');
    expect(s).toContain('Oakwood Properties Ltd');
    expect(s).toContain('$2,900.00');
  });
});

describe('entity extraction', () => {
  it('pulls emails, phones, dates and amounts', () => {
    const e = extractEntities(ctx.pages.join('\n'));
    expect(e.emails).toEqual(['office@oakwood.example']);
    expect(e.phones).toContain('555-201-3344');
    expect(e.dates).toContain('March 1, 2026');
    expect(e.amounts).toContain('$1,450.00');
  });

  it('parses day-first and ISO dates', () => {
    expect(parseFirstDate('Issued 25/12/2025')?.getMonth()).toBe(11);
    expect(parseFirstDate('on 2026-02-03')?.getDate()).toBe(3);
  });
});

describe('intent routing', () => {
  const inv: DocContext = { name: 'inv', mode: 'document', pages: ['Total due $150.00.\nPayment due by October 15, 2026.'] };
  it('treats "when ... due" as a date question', () => {
    expect(localAnswer(inv, 'When is payment due?')).toMatch(/^\*\*Dates found:\*\* `October 15, 2026`/);
  });
  it('treats "total due" as an amount question', () => {
    expect(localAnswer(inv, 'What is the total due?')).toContain('The total appears to be **$150.00**');
  });
});

describe('phone detection', () => {
  it('ignores invoice-number-like digit groups', () => {
    const e = extractEntities('Invoice No: INV-2026-0042\nCall 555-201-3344 or +44 20 7946 0958');
    expect(e.phones).toEqual(['555-201-3344', '+44 20 7946 0958']);
  });
});
