import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import type { PolicyFile } from './types';
import type { AnswerSource, FormAnswerState, ReadRecord } from './prefill-types';
import {
  quoteInText,
  quoteStillInText,
  quoteContext,
  originalPrefilled,
  answerSourceCounts,
  unconfirmedIds,
} from './answer-sources';

// R18-C2 (specs/intake-flow.md §27.6): the pure helpers behind the marks, the gate and the confirmation line.

const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});

const prefilled = (quotes: { option: string; quote: string }[], confirmed = false): AnswerSource => ({
  kind: 'prefilled',
  quotes,
  read: READ,
  confirmed,
});

describe('quoteInText / quoteStillInText (derived, never stored)', () => {
  const text = 'Our UK team will use it.\nIt reads client names and account details every morning.';

  it('is true while the quote occurs in the whitespace-normalised description', () => {
    expect(quoteInText('Our UK team', text)).toBe(true);
    expect(quoteInText('names and account', text)).toBe(true);
    // a quote that straddles the line break is matched against the normalised text
    expect(quoteInText('use it. It reads', text)).toBe(true);
  });

  it('is false once the quote has left the text, and matching is exact and case-sensitive', () => {
    expect(quoteInText('Our UK team', 'We use it in London.')).toBe(false);
    expect(quoteInText('our uk team', text)).toBe(false);
  });

  it('quoteStillInText needs EVERY quote of a pre-filled source, and is false for a source with none', () => {
    const two = prefilled([
      { option: 'people', quote: 'client names' },
      { option: 'everyday', quote: 'account details' },
    ]);
    expect(quoteStillInText(two, text)).toBe(true);
    expect(quoteStillInText(two, text.replace('account details', 'balances'))).toBe(false);
    expect(quoteStillInText({ kind: 'typed' }, text)).toBe(false);
    expect(quoteStillInText({ kind: 'record', confirmed: true }, text)).toBe(false);
    expect(quoteStillInText({ kind: 'not-carried' }, text)).toBe(false);
  });

  it('a changed answer is judged by the quotes it was changed from', () => {
    const changed: AnswerSource = { kind: 'changed', from: [{ option: 'UK', quote: 'Our UK team' }], read: READ };
    expect(quoteStillInText(changed, text)).toBe(true);
    expect(quoteStillInText(changed, 'Nothing here.')).toBe(false);
  });
});

describe('quoteContext: the quote in its sentence', () => {
  it('returns the sentence around the quote, split at the quote', () => {
    const c = quoteContext('Our UK team will use it. It reads client names and account details every morning.', 'client names');
    expect(c).toEqual({
      before: 'It reads ',
      match: 'client names',
      after: ' and account details every morning.',
    });
  });

  it('a quote that spans a sentence boundary gets the joined span of both sentences', () => {
    const c = quoteContext('First one. Our team uses it. The UK team will join. Last one.', 'uses it. The UK team');
    expect(c!.before + c!.match + c!.after).toBe('Our team uses it. The UK team will join.');
  });

  it('the context is a substring of the normalised description and contains the quote', () => {
    const description = 'Line one.\n\nLine   two has client   names in it.  Line three.';
    const c = quoteContext(description, 'client names')!;
    const sentence = c.before + c.match + c.after;
    expect(sentence).toBe('Line two has client names in it.');
    expect(c.match).toBe('client names');
  });

  it('is null when the quote is not in the text', () => {
    expect(quoteContext('Nothing here.', 'client names')).toBeNull();
  });

  it('keeps hostile characters in the text (the screen escapes them through visibleText)', () => {
    const c = quoteContext('Our UK team reads client names‮ and account details', 'client names')!;
    expect(c.after).toContain('‮');
  });
});

describe('originalPrefilled: what a changed answer was pre-filled with', () => {
  it('returns the options, in order, from the changed-from quotes', () => {
    const changed: AnswerSource = {
      kind: 'changed',
      from: [
        { option: 'people', quote: 'client names' },
        { option: 'everyday', quote: 'ticket volumes' },
      ],
      read: READ,
    };
    expect(originalPrefilled(changed)).toEqual(['people', 'everyday']);
    expect(originalPrefilled(prefilled([{ option: 'UK', quote: 'Our UK team' }]))).toEqual(['UK']);
    expect(originalPrefilled({ kind: 'typed' })).toBeNull();
  });
});

describe('answerSourceCounts: N, M, K for the confirmation line', () => {
  const base: FormAnswerState = {
    '1': { value: 'Name', source: { kind: 'typed' } },
    '4': { value: 'score', source: { kind: 'typed' } },
    '5': { value: ['people'], source: prefilled([{ option: 'people', quote: 'client names' }], true) },
    '7': { value: 'me-or-team', source: prefilled([{ option: 'me-or-team', quote: 'my own team' }], false) },
    '10': { value: 'small', source: { kind: 'changed', from: [{ option: 'wide', quote: 'the whole business' }], read: READ } },
    '11': { value: ['UK'], source: prefilled([{ option: 'UK', quote: 'Our UK team' }], true) },
  };

  it('N counts confirmed pre-filled answers, K counts changed ones, M counts shown select questions with a value', () => {
    const c = answerSourceCounts(base, 'text', policy);
    expect(c.confirmedFilled).toBe(2); // Q5 and Q11 (one per QUESTION, not per tick)
    expect(c.changed).toBe(1);
    // Q4, Q5, Q7, Q10, Q11 are shown select questions with a value; Q1 is free text and not counted
    expect(c.answered).toBe(5);
  });

  it('a tick-all question with two quotes counts once', () => {
    const state: FormAnswerState = {
      '5': {
        value: ['people', 'everyday'],
        source: prefilled(
          [
            { option: 'people', quote: 'client names' },
            { option: 'everyday', quote: 'ticket volumes' },
          ],
          true,
        ),
      },
    };
    expect(answerSourceCounts(state, 'text', policy)).toEqual({ confirmedFilled: 1, changed: 0, answered: 1 });
  });

  it('is not affected by whether the quote is still in the description', () => {
    const state: FormAnswerState = {
      '11': { value: ['UK'], source: prefilled([{ option: 'UK', quote: 'Our UK team' }], true) },
    };
    expect(answerSourceCounts(state, 'The quote left.', policy).confirmedFilled).toBe(1);
  });

  it('a hidden question is not counted even if the state holds it', () => {
    const state: FormAnswerState = {
      '4': { value: 'language', source: { kind: 'typed' } },
      '4a': { value: 'rules', source: prefilled([{ option: 'rules', quote: 'fixed rules' }], true) }, // 4a is shown only for "score"
    };
    const c = answerSourceCounts(state, 'x', policy);
    expect(c.confirmedFilled).toBe(0);
    expect(c.answered).toBe(1);
  });

  it('an unconfirmed pre-fill and a typed-only form give zero', () => {
    const typedOnly: FormAnswerState = { '4': { value: 'score', source: { kind: 'typed' } } };
    expect(answerSourceCounts(typedOnly, 'x', policy)).toEqual({ confirmedFilled: 0, changed: 0, answered: 1 });
  });
});

describe('unconfirmedIds: the answers still waiting for a tick', () => {
  it('lists shown pre-filled and record answers that are not confirmed, in form order', () => {
    const state: FormAnswerState = {
      '11': { value: ['UK'], source: prefilled([{ option: 'UK', quote: 'Our UK team' }], false) },
      '5': { value: ['people'], source: prefilled([{ option: 'people', quote: 'client names' }], false) },
      '7': { value: 'me-or-team', source: { kind: 'record', confirmed: false } },
      '10': { value: 'small', source: { kind: 'record', confirmed: true } },
      '4': { value: 'score', source: { kind: 'typed' } },
    };
    expect(unconfirmedIds(state, 'x', policy)).toEqual(['5', '7', '11']);
  });
});
