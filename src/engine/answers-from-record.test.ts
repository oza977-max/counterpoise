import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import { olderCaseAnswers } from './answers-from-record';
import { toPlainAnswers } from './form-answer-state';
import { shownQuestionIds } from './form-visibility';
import type { PolicyFile } from './types';

// R18-E (specs/intake-flow.md §27.10, "An older case"): the pure mapping from what a build before Round 18 recorded -
// the description and the "Not sure" assumptions of its confirmation - to the form's answers. The record is untrusted
// (a saved case, or a hand-off file someone else made). Nothing is guessed from a graph that was never kept.

const DESCRIPTION = 'It reads client names and account details to draft emails. Our UK team will use it every morning.';

let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});

const row = (questionId: unknown) => ({ questionId, question: 'q', shortLabel: 's', assumption: 'a', fields: ['f'] });

describe('olderCaseAnswers', () => {
  it('restores a recorded "Not sure" as an unconfirmed record answer and marks every other shown question not-carried', () => {
    const { answerState, dropped } = olderCaseAnswers([row('4'), row('9')], policy);
    expect(dropped).toEqual([]);
    expect(answerState['4']).toEqual({ value: 'not-sure', source: { kind: 'record', confirmed: false } });
    expect(answerState['9']).toEqual({ value: 'not-sure', source: { kind: 'record', confirmed: false } });
    const shown = shownQuestionIds(toPlainAnswers(answerState, DESCRIPTION), policy).filter((id) => id !== '2');
    for (const id of shown) {
      if (id === '4' || id === '9') continue;
      expect(answerState[id as '1']?.source).toEqual({ kind: 'not-carried' });
    }
    // a question that is not shown has no entry at all
    expect(answerState['4a']).toBeUndefined();
    // Question 4 "Not sure" shows the agentic questions
    expect(answerState['13']?.source.kind).toBe('not-carried');
  });

  it('a tick-all question comes back as a one-item list, and the countries question as its own "not sure" key', () => {
    const { answerState } = olderCaseAnswers([row('5'), row('11')], policy);
    expect(answerState['5']).toEqual({ value: ['not-sure'], source: { kind: 'record', confirmed: false } });
    expect(answerState['11']).toEqual({ value: ['elsewhere-not-sure'], source: { kind: 'record', confirmed: false } });
  });

  it('empty assumptions open an entirely blank, marked form - nothing is restored and nothing is confirmed', () => {
    const { answerState } = olderCaseAnswers([], policy);
    expect(Object.values(answerState).every((e) => e!.source.kind === 'not-carried')).toBe(true);
    expect(answerState['1']).toBeDefined();
    expect(answerState['2' as '1']).toBeUndefined();
    expect(toPlainAnswers(answerState, DESCRIPTION)).toEqual({ '2': DESCRIPTION });
  });

  it('an assumption whose question is not shown for the answers kept is left out and named', () => {
    // 3a is only asked after "an outside assistant"; Question 3 is not carried, so 3a is hidden.
    const { answerState, dropped } = olderCaseAnswers([row('3a'), row('4')], policy);
    expect(answerState['3a']).toBeUndefined();
    expect(dropped).toEqual(['3a']);
    expect(answerState['4']?.source.kind).toBe('record');
  });

  it('a Not sure for Question 3 is restored and shows nothing new that is not offered', () => {
    const { answerState } = olderCaseAnswers([row('3')], policy);
    expect(answerState['3']).toEqual({ value: 'not-sure', source: { kind: 'record', confirmed: false } });
  });

  it('ignores ids it does not know: the description, a questionnaire field id, a prototype key, a non-string', () => {
    const hostile = [row('2'), row('field:vendor'), row('__proto__'), row('constructor'), row('toString'), row(7), row(null), row({}), row('4'), null, 'x', 5, [], { questionId: '9' }];
    const { answerState, dropped } = olderCaseAnswers(hostile, policy);
    expect(answerState['4']?.source.kind).toBe('record');
    expect(answerState['9']?.source.kind).toBe('record'); // only the id is read, never trusted text
    expect(answerState['2' as '1']).toBeUndefined();
    expect(Object.getPrototypeOf(answerState)).toBe(Object.prototype);
    expect(Object.keys(answerState)).not.toContain('__proto__');
    expect(dropped).toEqual([]);
  });

  it('is bounded: only the first 40 rows are read, and an over-long id is ignored', () => {
    const many = [...Array.from({ length: 40 }, () => row('nope')), row('4')];
    expect(olderCaseAnswers(many, policy).answerState['4']?.source.kind).toBe('not-carried');
    expect(olderCaseAnswers([row('4'.padEnd(5000, 'x'))], policy).answerState['4']?.source.kind).toBe('not-carried');
  });

  it('not-array assumptions (absent, an object, a string) are treated as none', () => {
    for (const bad of [undefined, null, {}, 'x', 5, { length: 3 }]) {
      const { answerState } = olderCaseAnswers(bad, policy);
      expect(Object.values(answerState).every((e) => e!.source.kind === 'not-carried')).toBe(true);
    }
  });

  it('the first row for a question wins, and nothing is ever confirmed', () => {
    const { answerState } = olderCaseAnswers([row('4'), row('4'), row('9'), row('12')], policy);
    for (const e of Object.values(answerState)) {
      if (e!.source.kind === 'record') expect(e!.source.confirmed).toBe(false);
    }
  });

  it('a hand-off carrying a Not sure the form does not offer is left out and named, never believed', () => {
    // 4a has no "not sure" option at all; 8 has none either.
    const { answerState, dropped } = olderCaseAnswers([row('8'), row('10'), row('4')], policy);
    expect(answerState['8']?.source.kind).toBe('not-carried');
    expect(answerState['10']?.source.kind).toBe('not-carried');
    expect(dropped).toEqual(['8', '10']);
  });

  it('is deterministic and does not touch its input', () => {
    const input = [row('9'), row('4')];
    const frozen = JSON.stringify(input);
    const a = olderCaseAnswers(input, policy);
    const b = olderCaseAnswers(input, policy);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(input)).toBe(frozen);
  });
});
