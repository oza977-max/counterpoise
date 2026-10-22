import { describe, it, expect } from 'vitest';
import { R18_COPY, readLineWords, originLineWords } from './plain-copy';
import type { AnswerView, ReadView } from '../engine/answer-sources';

// R18-D1: the register's wording. Reserved words stay out of every string (the verdict screen is asserted with a
// single-match /approved|rejected/ query), no sentence carries the present-tense promise, and each sentence builder
// says only what its inputs hold.

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

const read = (patch: Partial<ReadView> = {}): ReadView => ({ model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434', ...patch });
const answer = (patch: Partial<AnswerView> = {}): AnswerView => ({ question: 'Q', value: 'v', origin: 'typed', quotes: [], read: null, quoteGone: false, ...patch });

describe('R18_COPY - register strings', () => {
  it('contains no string with "approved" or "rejected", anywhere in the table', () => {
    const all = strings(R18_COPY);
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((s) => /approved|rejected/i.test(s))).toEqual([]);
  });

  it('the register never repeats the present-tense promise', () => {
    const mine = [R18_COPY.READ_LINE, R18_COPY.PLACE_UNRECOGNISED_WORDS, R18_COPY.READ_NOTE, R18_COPY.ORIGIN_TYPED, R18_COPY.ORIGIN_PREFILLED_CONFIRMED, R18_COPY.ORIGIN_CHANGED, R18_COPY.ORIGIN_RECORD, R18_COPY.ORIGIN_UNRECOGNISED, R18_COPY.ORIGIN_QUOTE_GONE, R18_COPY.HANDOFF_EXPORT_STATEMENT, R18_COPY.HANDOFF_IMPORT_PROVENANCE, ...Object.values(R18_COPY.PLACE_RECORD_WORDS)];
    for (const s of mine) expect(s).not.toMatch(/never leaves|will be read|is read/i);
    // and it claims no more than it holds: no verification, no digest
    expect(R18_COPY.READ_NOTE).toMatch(/does not check/);
    expect(strings(R18_COPY.READ_NOTE).join(' ')).not.toMatch(/verified|digest|proven/i);
  });
});

describe('readLineWords / originLineWords', () => {
  it('words a read in the past tense, and shows an unrecognised place as such, never the word', () => {
    expect(readLineWords(read())).toBe('read by alpha:7b by the program at http://localhost:11434 on the computer in use');
    const odd = readLineWords(read({ place: null, host: 'http://h' }));
    expect(odd).toBe("read by alpha:7b at http://h, a place this version doesn't recognise");
  });

  it('says only what the row holds', () => {
    expect(originLineWords(answer())).toBe('typed by you');
    expect(originLineWords(answer({ origin: 'from_earlier_record' }))).toBe('from the earlier record');
    expect(originLineWords(answer({ origin: 'unrecognised' }))).toBe('source not recognised');
    const filled = answer({ origin: 'prefilled_confirmed', quotes: [{ option: 'A', quote: 'q' }], read: read() });
    expect(originLineWords(filled)).toBe('filled from your description and confirmed by you — “q” (suggested by alpha:7b)');
    expect(originLineWords({ ...filled, read: null })).toBe('filled from your description and confirmed by you — “q”');
    expect(originLineWords({ ...filled, quoteGone: true })).toContain('; the quote is no longer in your description');
    expect(originLineWords(filled)).not.toContain('no longer');
    const changed = answer({ origin: 'prefilled_changed', quotes: [{ option: 'Small', quote: 'a trial' }], read: read() });
    expect(originLineWords(changed)).toBe('changed by you (from Small — “a trial”, suggested by alpha:7b)');
    expect(originLineWords({ ...changed, quotes: [], read: null })).toBe('changed by you');
  });
});
