import { describe, expect, it } from 'vitest';
import { markdownToHtml } from '../src/components/ui';
import { normalizeFolder } from '../src/lib/prefs';

describe('chat markdown', () => {
  it('escapes HTML from document text', () => {
    const html = markdownToHtml('> <img src=x onerror=alert(1)> **total**');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('<strong>total</strong>');
  });

  it('renders bullet lists', () => {
    expect(markdownToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });
});

describe('folder paths', () => {
  it('normalises user-typed folders', () => {
    expect(normalizeFolder(' /Scans\\\\2026/../Receipts/ ')).toBe('Scans/2026/Receipts');
  });
});
