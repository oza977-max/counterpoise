import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// GT7 / GB, L-1 honesty (TC-UC-3-04e). One canonical paragraph says the free
// local demo model can be misled by a description; it must read the same in
// every place a reader meets the product's limits. If one copy is edited the
// others must follow, so this fails loudly on drift.
const SENTENCE_START = 'The description reader that runs on your own computer is a small free model.';
const SENTENCE_END = 'The stronger defence is not built yet.';

function canonical(file: string): string {
  const text = readFileSync(file, 'utf8');
  const i = text.indexOf('A description can mislead the free local demo model.');
  expect(i, `${file} is missing the paragraph`).toBeGreaterThanOrEqual(0);
  const endIdx = text.indexOf(SENTENCE_END, i);
  expect(endIdx).toBeGreaterThan(i);
  const raw = text.slice(i, endIdx + SENTENCE_END.length);
  return raw.replace(/<\/?strong>/g, '').replace(/\*\*/g, '');
}

describe('GT7 L-1 honesty paragraph (TC-UC-3-04e)', () => {
  it('TC-UC-3-04e: the same paragraph appears in the user guide (both twins), the tester guide and the README limits', () => {
    const files = ['docs/user-guide.md', 'docs/user-guide.html', 'docs/tester-guide.md', 'README.md'];
    const copies = files.map(canonical);
    for (const c of copies) {
      expect(c).toContain(SENTENCE_START);
      expect(c).toContain('the check does not catch every wording');
      expect(c).not.toMatch(/approved|rejected/i);
    }
    expect(new Set(copies).size).toBe(1);
  });
});
