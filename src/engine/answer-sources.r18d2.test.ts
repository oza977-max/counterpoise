import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { loadPolicy } from '../store/policy';
import { QUESTION_WORDS, findQuestion } from '../components/plain-copy';
import { buildCatalogue, QUESTION_STRUCTURE } from './question-structure';
import { readAnswerSources, answerSourceCounts, toAnswerSources, answersFromRecord, type SourceWords } from './answer-sources';
import { typedAnswersFromPlain } from './form-visibility';
import { toPlainAnswers } from './form-answer-state';
import { WORKED_EXAMPLES } from './worked-examples';
import type { PolicyFile } from './types';
import type { AnswerSource, FormAnswerState, ReadRecord } from './prefill-types';

// R18-D2 (specs/intake-flow.md §27.13 Writer, §27.10): the pure WRITE side of the record and the pure inverse,
// answersFromRecord. The record read back is untrusted (a saved case, or a hand-off file someone else made).

const DESCRIPTION = 'It reads client names and account details. Our UK team will use it every morning.';
const READ_A: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const READ_B: ReadRecord = { model: 'beta:3b', place: 'firm-server', host: 'https://models.example.internal:8443' };

let policy: PolicyFile;
let words: SourceWords;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
  words = {
    catalogue: buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy),
    questionLabel: (id) => (QUESTION_STRUCTURE.some((q) => q.id === id) ? findQuestion(id as never)?.text : undefined),
  };
});

/** Example 1's answers, all typed: a complete, valid form. */
function base(): FormAnswerState {
  const ex = WORKED_EXAMPLES.find((e) => e.id === 'case-1')!;
  return typedAnswersFromPlain(ex.answers, policy);
}

function withSource(state: FormAnswerState, id: '5' | '7' | '11', source: AnswerSource, value?: string | string[]): FormAnswerState {
  const entry = state[id]!;
  return { ...state, [id]: { value: value ?? entry.value, source } };
}

describe('toAnswerSources - the writer', () => {
  it('writes typed rows for a typed-only case, in the form question order, with no reads', () => {
    const out = toAnswerSources(base(), DESCRIPTION);
    expect(out.reads).toEqual([]);
    expect(out.answers.every((a) => a.origin === 'typed')).toBe(true);
    expect(out.answers.map((a) => a.question_id)).toEqual(
      QUESTION_STRUCTURE.map((q) => q.id).filter((id) => id !== '2' && base()[id as '1'] !== undefined),
    );
  });

  it('never writes Question 2, even when a stray entry is in the state', () => {
    const state = { ...base(), '2': { value: 'sneaky', source: { kind: 'typed' } } } as FormAnswerState;
    expect(toAnswerSources(state, DESCRIPTION).answers.some((a) => a.question_id === '2')).toBe(false);
  });

  it('writes a confirmed pre-fill as prefilled_confirmed with its quotes, read index and quote_in_final_description', () => {
    const state = withSource(base(), '5', {
      kind: 'prefilled',
      quotes: [{ option: 'people', quote: 'client names' }],
      read: READ_A,
      confirmed: true,
    }, ['people']);
    const out = toAnswerSources(state, DESCRIPTION);
    expect(out.reads).toEqual([READ_A]);
    expect(out.answers.find((a) => a.question_id === '5')).toEqual({
      question_id: '5',
      value: ['people'],
      origin: 'prefilled_confirmed',
      quotes: [{ option: 'people', quote: 'client names' }],
      quote_in_final_description: true,
      read: 0,
    });
  });

  it('judges quote_in_final_description against the description it is given', () => {
    const state = withSource(base(), '5', {
      kind: 'prefilled',
      quotes: [{ option: 'people', quote: 'client names' }],
      read: READ_A,
      confirmed: true,
    }, ['people']);
    const out = toAnswerSources(state, 'It reads account details only.');
    expect(out.answers.find((a) => a.question_id === '5')!.quote_in_final_description).toBe(false);
  });

  it('writes a changed answer as prefilled_changed with changed_from (and the same quotes)', () => {
    const state = withSource(base(), '11', {
      kind: 'changed',
      from: [{ option: 'UK', quote: 'Our UK team' }],
      read: READ_A,
    }, ['US']);
    const row = toAnswerSources(state, DESCRIPTION).answers.find((a) => a.question_id === '11')!;
    expect(row).toEqual({
      question_id: '11',
      value: ['US'],
      origin: 'prefilled_changed',
      quotes: [{ option: 'UK', quote: 'Our UK team' }],
      changed_from: [{ option: 'UK', quote: 'Our UK team' }],
      quote_in_final_description: true,
      read: 0,
    });
  });

  it('writes a confirmed earlier-record answer as from_earlier_record with no read and no quotes', () => {
    const state = withSource(base(), '7', { kind: 'record', confirmed: true });
    expect(toAnswerSources(state, DESCRIPTION).answers.find((a) => a.question_id === '7')).toEqual({
      question_id: '7',
      value: 'me-or-team',
      origin: 'from_earlier_record',
    });
  });

  it('writes nothing for an answer that is not confirmed, and nothing for not-carried or blank answers', () => {
    let state = withSource(base(), '5', { kind: 'prefilled', quotes: [{ option: 'everyday', quote: 'x' }], read: READ_A, confirmed: false });
    state = withSource(state, '7', { kind: 'record', confirmed: false });
    state = { ...state, '8': { value: '', source: { kind: 'typed' } }, '12': { value: 'no', source: { kind: 'not-carried' } } };
    const ids = toAnswerSources(state, DESCRIPTION).answers.map((a) => a.question_id);
    expect(ids).not.toContain('5');
    expect(ids).not.toContain('7');
    expect(ids).not.toContain('8');
    expect(ids).not.toContain('12');
  });

  it('writes a typed answer once answered, even one that began as not-carried (it is typed by then)', () => {
    const state: FormAnswerState = { ...base(), '12': { value: 'no', source: { kind: 'typed' } } };
    expect(toAnswerSources(state, DESCRIPTION).answers.find((a) => a.question_id === '12')!.origin).toBe('typed');
  });

  it('de-duplicates reads in first-seen order and points each row at its own read', () => {
    let state = withSource(base(), '5', { kind: 'prefilled', quotes: [{ option: 'everyday', quote: 'x' }], read: READ_B, confirmed: true }, ['everyday']);
    state = withSource(state, '7', { kind: 'prefilled', quotes: [{ option: 'me-or-team', quote: 'y' }], read: READ_A, confirmed: true });
    state = withSource(state, '11', { kind: 'prefilled', quotes: [{ option: 'UK', quote: 'z' }], read: { ...READ_B }, confirmed: true });
    const out = toAnswerSources(state, 'x y z');
    expect(out.reads).toEqual([READ_B, READ_A]);
    const read = (id: string) => out.answers.find((a) => a.question_id === id)!.read;
    expect(read('5')).toBe(0);
    expect(read('7')).toBe(1);
    expect(read('11')).toBe(0);
  });

  it('is deterministic: the same input twice gives byte-identical output, with no undefined fields', () => {
    const state = withSource(base(), '5', { kind: 'prefilled', quotes: [{ option: 'people', quote: 'client names' }], read: READ_A, confirmed: true }, ['people']);
    const a = JSON.stringify(toAnswerSources(state, DESCRIPTION));
    const b = JSON.stringify(toAnswerSources(state, DESCRIPTION));
    expect(a).toBe(b);
    expect(Object.values(JSON.parse(a).answers[0]).includes(undefined)).toBe(false);
    expect(toAnswerSources(state, DESCRIPTION)).toEqual(JSON.parse(a));
  });

  it('does not depend on the order the state was built in', () => {
    const state = base();
    const reversed = Object.fromEntries(Object.entries(state).reverse()) as FormAnswerState;
    expect(JSON.stringify(toAnswerSources(reversed, DESCRIPTION))).toBe(JSON.stringify(toAnswerSources(state, DESCRIPTION)));
  });

  it('copies values: changing the state afterwards cannot change what was written', () => {
    const state = withSource(base(), '5', { kind: 'prefilled', quotes: [{ option: 'people', quote: 'client names' }], read: READ_A, confirmed: true }, ['people']);
    const out = toAnswerSources(state, DESCRIPTION);
    (state['5']!.value as string[]).push('public');
    expect(out.answers.find((a) => a.question_id === '5')!.value).toEqual(['people']);
  });

  it('keeps inside the record bounds for a form-sized state (<= 40 rows, 10 reads, 20 quotes, 500 chars)', () => {
    const out = toAnswerSources(base(), DESCRIPTION);
    expect(out.answers.length).toBeLessThanOrEqual(40);
    expect(out.reads.length).toBeLessThanOrEqual(10);
    const longest = Math.max(...out.answers.map((a) => (Array.isArray(a.value) ? a.value : [a.value]).reduce((m, s) => Math.max(m, s.length), 0)));
    expect(longest).toBeLessThanOrEqual(500);
  });
});

describe('round trip: the register shows the same origins and counts the confirmation line shows', () => {
  const sourceArb = (id: '5' | '7' | '11', value: string | string[]) =>
    fc.constantFrom<AnswerSource>(
      { kind: 'typed' },
      { kind: 'prefilled', quotes: [{ option: String(Array.isArray(value) ? value[0] : value), quote: 'client names' }], read: READ_A, confirmed: true },
      { kind: 'changed', from: [{ option: String(Array.isArray(value) ? value[0] : value), quote: 'Our UK team' }], read: READ_B },
      { kind: 'record', confirmed: true },
    ).map((s) => ({ id, s }));

  it('property: readAnswerSources(toAnswerSources(x)) has the origins and counts answerSourceCounts(x) has', () => {
    const b = base();
    fc.assert(
      fc.property(
        sourceArb('5', b['5']!.value),
        sourceArb('7', b['7']!.value),
        sourceArb('11', b['11']!.value),
        fc.constantFrom(DESCRIPTION, 'nothing quoted here'),
        (a, c, d, description) => {
          let state = b;
          for (const { id, s } of [a, c, d]) state = withSource(state, id, s);
          const view = readAnswerSources(toAnswerSources(state, description), words)!;
          expect(view.counts).toEqual(answerSourceCounts(state, description, policy));
          const expected = (['5', '7', '11'] as const).map((id) => {
            const k = state[id]!.source.kind;
            return k === 'typed' ? 'typed' : k === 'prefilled' ? 'prefilled_confirmed' : k === 'changed' ? 'prefilled_changed' : 'from_earlier_record';
          });
          const got = (['5', '7', '11'] as const).map((id) => view.answers.find((x) => x.question === findQuestion(id)!.text)!.origin);
          expect(got).toEqual(expected);
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('answersFromRecord - the inverse, over an untrusted record', () => {
  it('restores a written record exactly: typed stays typed, confirmed and changed pre-fills keep quotes and read', () => {
    let state = withSource(base(), '5', { kind: 'prefilled', quotes: [{ option: 'people', quote: 'client names' }], read: READ_A, confirmed: true }, ['people']);
    state = withSource(state, '11', { kind: 'changed', from: [{ option: 'UK', quote: 'Our UK team' }], read: READ_B }, ['US']);
    expect(answersFromRecord(toAnswerSources(state, DESCRIPTION), policy)).toEqual(state);
  });

  it('restores a from_earlier_record answer as an unconfirmed record answer', () => {
    const state = withSource(base(), '7', { kind: 'record', confirmed: true });
    const out = answersFromRecord(toAnswerSources(state, DESCRIPTION), policy);
    expect(out['7']).toEqual({ value: 'me-or-team', source: { kind: 'record', confirmed: false } });
    expect(out['5']!.source.kind).toBe('typed');
  });

  it('property: restoring any written record gives the same plain answers back', () => {
    const b = base();
    fc.assert(
      fc.property(sourceArb2('5', b), sourceArb2('7', b), (a, c) => {
        const state = withSource(withSource(b, '5', a), '7', c);
        const restored = answersFromRecord(toAnswerSources(state, DESCRIPTION), policy);
        expect(toPlainAnswers(restored, DESCRIPTION)).toEqual(toPlainAnswers(state, DESCRIPTION));
      }),
      { numRuns: 40 },
    );
    function sourceArb2(id: '5' | '7', s: FormAnswerState) {
      const opt = String(Array.isArray(s[id]!.value) ? (s[id]!.value as string[])[0] : s[id]!.value);
      return fc.constantFrom<AnswerSource>(
        { kind: 'typed' },
        { kind: 'prefilled', quotes: [{ option: opt, quote: 'client names' }], read: READ_A, confirmed: true },
        { kind: 'record', confirmed: true },
      );
    }
  });

  it('turns an unknown origin word into a blank answer, never a confirmed one', () => {
    const written = toAnswerSources(base(), DESCRIPTION);
    const doctored = { ...written, answers: written.answers.map((a) => (a.question_id === '5' ? { ...a, origin: 'telepathy' } : a)) };
    const out = answersFromRecord(doctored, policy);
    expect(out['5']).toBeUndefined();
    expect(Object.values(out).every((e) => e!.source.kind !== 'prefilled' || e!.source.confirmed === false)).toBe(true);
  });

  it('ignores Question 2, unknown questions, prototype keys, hidden questions and duplicate rows (first wins)', () => {
    const rows = [
      { question_id: '2', value: 'description sneaked in', origin: 'typed' },
      { question_id: 'nope', value: 'x', origin: 'typed' },
      { question_id: '__proto__', value: 'x', origin: 'typed' },
      { question_id: 'constructor', value: 'x', origin: 'typed' },
      { question_id: '6a', value: 'little', origin: 'typed' }, // shown only after 6 = answers/drafts/suggests
      { question_id: '6', value: 'read', origin: 'typed' },
      { question_id: '6', value: 'drafts', origin: 'typed' }, // duplicate: ignored
    ];
    const out = answersFromRecord({ reads: [], answers: rows }, policy);
    expect(Object.keys(out).sort()).toEqual(['6']);
    expect(out['6']!.value).toBe('read');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops a value the form does not offer, a wrong-shaped value and an over-long typed text', () => {
    const rows = [
      { question_id: '9', value: 'maybe-ish', origin: 'typed' },
      { question_id: '4', value: ['score'], origin: 'typed' }, // a single question holds a string
      { question_id: '1', value: 'x'.repeat(201), origin: 'typed' },
      { question_id: '12', value: 7, origin: 'typed' },
      { question_id: '5', value: ['people', 'people'], origin: 'typed' }, // repeats are not a selection
      { question_id: '10', value: 'small', origin: 'typed' },
    ];
    const out = answersFromRecord({ reads: [], answers: rows }, policy);
    expect(Object.keys(out)).toEqual(['10']);
  });

  it('degrades a pre-fill whose read or quotes are unusable to an unconfirmed record answer, never a confirmed one', () => {
    const rows = [
      { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: 'client names' }], read: 9 },
      { question_id: '7', value: 'me-or-team', origin: 'prefilled_confirmed', quotes: 'not a list', read: 0 },
      { question_id: '9', value: 'yes', origin: 'prefilled_changed', changed_from: [], read: 0 },
    ];
    const out = answersFromRecord({ reads: [READ_A], answers: rows }, policy);
    for (const id of ['5', '7', '9'] as const) {
      expect(out[id]!.source).toEqual({ kind: 'record', confirmed: false });
    }
  });

  it('bounds every string it keeps: an over-long quote, option or model name makes the pre-fill unusable, not trusted', () => {
    const rows = [
      { question_id: '5', value: ['people'], origin: 'prefilled_confirmed', quotes: [{ option: 'people', quote: 'q'.repeat(301) }], read: 0 },
      { question_id: '7', value: 'me-or-team', origin: 'prefilled_confirmed', quotes: [{ option: 'me-or-team', quote: 'ok' }], read: 0 },
    ];
    const out = answersFromRecord({ reads: [{ model: 'm'.repeat(101), place: 'this-computer', host: 'http://localhost:11434' }], answers: rows }, policy);
    expect(out['5']!.source.kind).toBe('record');
    expect(out['7']!.source.kind).toBe('record');
  });

  it('returns an empty state for anything that is not a record', () => {
    for (const bad of [null, undefined, 'x', 3, [], {}, { answers: 'no' }, { answers: [null, 4, 'x'] }]) {
      expect(answersFromRecord(bad, policy)).toEqual({});
    }
  });

  it('copies: the restored state shares nothing with the record it came from', () => {
    const record = JSON.parse(JSON.stringify(toAnswerSources(withSource(base(), '5', { kind: 'typed' }, ['people']), DESCRIPTION)));
    const out = answersFromRecord(record, policy);
    (record.answers.find((a: { question_id: string }) => a.question_id === '5').value as string[]).push('public');
    expect(out['5']!.value).toEqual(['people']);
  });
});
