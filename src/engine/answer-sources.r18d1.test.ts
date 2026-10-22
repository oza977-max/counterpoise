import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { QUESTION_WORDS, findQuestion } from '../components/plain-copy';
import { buildCatalogue, QUESTION_STRUCTURE } from './question-structure';
import { readAnswerSources, answerSourceCounts, type SourceWords } from './answer-sources';
import { realisticSources, countedSources, READ_LOCAL } from '../test-support/answer-sources-fixtures';
import type { PolicyFile } from './types';
import type { FormAnswerState } from './prefill-types';

// R18-D1 (specs/intake-flow.md §27.13): the pure READ side of the record. The record is untrusted input
// (a saved case, or a hand-off file someone else made), so the reader is tested against hostile and unknown shapes
// as well as the realistic one. Every string it returns has been through visibleText().

let words: SourceWords;
let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
  words = {
    catalogue: buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy),
    questionLabel: (id) => (QUESTION_STRUCTURE.some((q) => q.id === id) ? findQuestion(id as never)?.text : undefined),
  };
});

describe('readAnswerSources - the realistic record', () => {
  it('turns every row into words: question, value in words, origin, quotes, the read that supplied it', () => {
    const v = readAnswerSources(realisticSources(), words)!;
    expect(v.reads).toEqual([READ_LOCAL]);
    expect(v.answers).toHaveLength(5);
    const q5 = v.answers[1]!;
    expect(q5.question).toMatch(/What information will it see or use/);
    expect(q5.value).toMatch(/^Information about people/);
    expect(q5.origin).toBe('prefilled_confirmed');
    expect(q5.quotes).toHaveLength(1);
    expect(q5.quotes[0]!.quote).toBe('client names');
    expect(q5.quotes[0]!.option).toMatch(/^Information about people/);
    expect(q5.read).toEqual(READ_LOCAL);
    expect(q5.quoteGone).toBe(false);
    const q7 = v.answers[2]!;
    expect(q7.quoteGone).toBe(true); // recorded false: said so
    const q11 = v.answers[4]!;
    expect(q11.value).toBe('United States'); // dynamic jurisdiction words come from the policy
    expect(q11.origin).toBe('prefilled_changed');
    expect(q11.quotes).toEqual([{ option: 'United Kingdom', quote: 'Our UK team' }]); // what it was changed FROM
    // a typed free-text answer shows its own text; a typed select shows the option's words
    expect(v.answers[0]!.value).toBe('Client email drafting assistant');
    expect(v.answers[3]!.value).toBe('Yes');
  });

  it('counts N, K and M from the rows: free text, hidden-by-absence and Question 2 are not counted', () => {
    expect(readAnswerSources(realisticSources(), words)!.counts).toEqual({ confirmedFilled: 2, changed: 1, answered: 4 });
    // TC-R18-GI-3-17 example: 14 select answers, 5 pre-filled and confirmed, 2 changed, 7 typed
    expect(readAnswerSources(countedSources(14, 5, 2), words)!.counts).toEqual({ confirmedFilled: 5, changed: 2, answered: 14 });
    const withFreeAndTwo = {
      reads: [],
      answers: [
        { question_id: '1', value: 'a name', origin: 'typed' },
        { question_id: '3model', value: 'a model', origin: 'typed' },
        { question_id: '2', value: 'never a row', origin: 'typed' },
        { question_id: '9', value: '', origin: 'typed' },
      ],
    };
    expect(readAnswerSources(withFreeAndTwo, words)!.counts.answered).toBe(0);
  });

  it('agrees with the confirmation step: the same answers give the same N, K and M', () => {
    const read = READ_LOCAL;
    const q = (quote: string, option = 'yes') => [{ option, quote }];
    const state: FormAnswerState = {
      '4': { value: 'language', source: { kind: 'typed' } },
      '5': { value: ['people'], source: { kind: 'prefilled', quotes: q('client names', 'people'), read, confirmed: true } },
      '6': { value: 'drafts', source: { kind: 'prefilled', quotes: q('drafts', 'drafts'), read, confirmed: false } },
      '7': { value: 'clients', source: { kind: 'changed', from: q('our customers', 'me-or-team'), read } },
      '9': { value: 'yes', source: { kind: 'typed' } },
      '10': { value: 'small', source: { kind: 'record', confirmed: true } },
      '1': { value: 'A name', source: { kind: 'typed' } },
    };
    const screen = answerSourceCounts(state, 'It reads client names. Drafts replies.', policy);
    // the rows D2 will write for the same state (only confirmed answers reach the record)
    const rows = [
      { question_id: '4', value: 'language', origin: 'typed' },
      { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: q('client names', 'people'), read: 0 },
      { question_id: '6', value: 'drafts', origin: 'prefilled_confirmed', quotes: q('drafts', 'drafts'), read: 0 },
      { question_id: '7', value: 'clients', origin: 'prefilled_changed', changed_from: q('our customers', 'me-or-team'), read: 0 },
      { question_id: '9', value: 'yes', origin: 'typed' },
      { question_id: '10', value: 'small', origin: 'from_earlier_record' },
      { question_id: '1', value: 'A name', origin: 'typed' },
    ];
    // the unconfirmed Q6 is the one difference: on the screen it blocks Continue, so it is confirmed before the record
    state['6']!.source = { kind: 'prefilled', quotes: q('drafts', 'drafts'), read, confirmed: true };
    const confirmedScreen = answerSourceCounts(state, 'It reads client names. Drafts replies.', policy);
    expect(screen.confirmedFilled).toBe(1);
    expect(readAnswerSources({ reads: [read], answers: rows }, words)!.counts).toEqual({
      confirmedFilled: confirmedScreen.confirmedFilled,
      changed: confirmedScreen.changed,
      answered: confirmedScreen.answered,
    });
  });

  it('returns null for a record with nothing to show, so an older case renders as before', () => {
    for (const absent of [undefined, null, 5, 'x', [], {}, { reads: [], answers: 'no' }, { reads: [], answers: [] }]) {
      expect(readAnswerSources(absent, words)).toBeNull();
    }
  });

  it('lists each distinct read once, but keeps every row pointing at its own read', () => {
    const v = readAnswerSources(
      {
        reads: [READ_LOCAL, { ...READ_LOCAL }, { model: 'beta:1', place: 'firm-server', host: 'https://m.example:8443' }],
        answers: [
          { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: 'x' }], read: 1 },
          { question_id: '9', value: 'yes', origin: 'prefilled_confirmed', quotes: [{ option: 'yes', quote: 'y' }], read: 2 },
        ],
      },
      words,
    )!;
    expect(v.reads.map((r) => r.model)).toEqual(['alpha:7b', 'beta:1']);
    expect(v.answers.map((a) => a.read?.model)).toEqual(['alpha:7b', 'beta:1']);
  });
});

describe('readAnswerSources - an imported record is untrusted (TC-R18-GI-5-05)', () => {
  const hostile = (row: Record<string, unknown>, reads: unknown[] = [READ_LOCAL]) =>
    readAnswerSources({ reads, answers: [{ question_id: '9', value: 'yes', origin: 'typed', ...row }] }, words)!;

  it('shows an unknown origin as unrecognised and never carries the word on', () => {
    for (const origin of ['approved-by-model', '<script>alert(1)</script>', 'constructor', '__proto__', 'toString', '']) {
      const a = hostile({ origin }).answers[0]!;
      expect(a.origin).toBe('unrecognised');
      expect(a.quotes).toEqual([]);
    }
  });

  it('shows an unknown or prototype-named place neutrally (place null) and keeps the host as text', () => {
    for (const place of ['constructor', '__proto__', 'hasOwnProperty', 'mars', '']) {
      const r = hostile({}, [{ model: 'm', place, host: 'http://h' }]).reads[0]!;
      expect(r.place).toBeNull();
      expect(r.host).toBe('http://h');
    }
  });

  it('tolerates a read index that is not an integer inside reads: the row has no read', () => {
    for (const read of [99, -1, 1.5, 1, '0', null, {}, [], Number.MAX_SAFE_INTEGER]) {
      const v = hostile({ origin: 'prefilled_confirmed', quotes: [{ option: 'yes', quote: 'q' }], read }, [READ_LOCAL]);
      expect(v.answers[0]!.read).toBeNull();
    }
    expect(hostile({ origin: 'prefilled_confirmed', quotes: [], read: 0 }).answers[0]!.read).toEqual(READ_LOCAL);
  });

  it('tolerates an unknown question id (raw id as text, value as typed) and prototype-named ids and values', () => {
    const v = readAnswerSources(
      {
        reads: [],
        answers: [
          { question_id: 'future-question', value: ['a', 'b'], origin: 'typed' },
          { question_id: 'constructor', value: 'constructor', origin: 'typed' },
          { question_id: '__proto__', value: ['__proto__'], origin: 'typed' },
          { question_id: '5', value: ['constructor', 'prototype'], origin: 'prefilled_confirmed', quotes: [{ option: '__proto__', quote: 'q' }] },
        ],
      },
      words,
    )!;
    expect(v.answers.map((a) => a.question).slice(0, 3)).toEqual(['future-question', 'constructor', '__proto__']);
    expect(v.answers[0]!.value).toBe('a, b');
    expect(v.answers[1]!.value).toBe('constructor');
    expect(v.answers[3]!.value).toBe('constructor, prototype'); // an option key this build does not know: shown raw, inert
    expect(v.answers[3]!.quotes[0]!.option).toBe('__proto__');
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('puts every shown string through visibleText: markup stays text, hidden and bidi characters become escapes', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const v = readAnswerSources(
      {
        reads: [{ model: `${evil}‮gemma`, place: 'this-computer', host: 'http://h​ost' }],
        answers: [
          {
            question_id: '9‮',
            value: 'ye\u0000s',
            origin: 'prefilled_confirmed',
            quotes: [{ option: 'o⁦', quote: `${evil}‮quote` }],
            read: 0,
          },
        ],
      },
      words,
    )!;
    const all = JSON.stringify(v);
    expect(all).not.toMatch(/[‮​\u0000⁦]/);
    expect(all).toContain('⟦U+202E⟧');
    expect(all).toContain('⟦U+200B⟧');
    expect(all).toContain('⟦U+0000⟧');
    expect(v.reads[0]!.model).toContain(evil); // markup is not removed; it is only ever rendered as text
  });

  it('survives rows and reads of the wrong shape without throwing', () => {
    expect(() =>
      readAnswerSources(
        {
          reads: [null, 3, 'x', { model: 4 }, []],
          answers: [null, 'x', 4, [], { question_id: 5 }, { question_id: '9', value: { a: 1 }, origin: 7, quotes: 'q', read: 'x' }, { question_id: '5', value: [1, null, 'ok'], origin: 'prefilled_changed', changed_from: [null, { quote: 3 }, { option: 'o', quote: 'ok' }] }],
        },
        words,
      ),
    ).not.toThrow();
  });

  it('reads a prefilled_changed row from changed_from, falling back to quotes', () => {
    const a = readAnswerSources(
      { reads: [READ_LOCAL], answers: [{ question_id: '10', value: 'wide', origin: 'prefilled_changed', quotes: [{ option: 'small', quote: 'from quotes' }], changed_from: [{ option: 'small', quote: 'from changed_from' }], read: 0 }] },
      words,
    )!.answers[0]!;
    expect(a.quotes[0]!.quote).toBe('from changed_from');
    const b = readAnswerSources(
      { reads: [READ_LOCAL], answers: [{ question_id: '10', value: 'wide', origin: 'prefilled_changed', quotes: [{ option: 'small', quote: 'from quotes' }], read: 0 }] },
      words,
    )!.answers[0]!;
    expect(b.quotes[0]!.quote).toBe('from quotes');
  });

  it('claims a gone quote only when the record says false', () => {
    const base = { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: 'q' }] };
    const gone = (extra: Record<string, unknown>) => readAnswerSources({ reads: [], answers: [{ ...base, ...extra }] }, words)!.answers[0]!.quoteGone;
    expect(gone({ quote_in_final_description: false })).toBe(true);
    expect(gone({ quote_in_final_description: true })).toBe(false);
    expect(gone({})).toBe(false);
    expect(gone({ quote_in_final_description: 'false' })).toBe(false);
  });
});
