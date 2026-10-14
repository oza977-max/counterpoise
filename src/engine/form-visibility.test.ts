import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPolicy } from '../store/policy';
import {
  canContinue,
  clearDependents,
  isValidMultiSelection,
  mergePrefill,
  missingQuestionIds,
  shownQuestionIds,
  toPlainAnswers,
  validOptionKeys,
} from './form-visibility';
import { toPlainAnswers as original } from './form-answer-state';
import { QUESTION_STRUCTURE, buildCatalogue } from './question-structure';
import { QUESTION_WORDS } from '../components/plain-copy';
import type { FormAnswerState, Prefill, ReadRecord } from './prefill-types';
import type { PolicyFile } from './types';

// R18-C1 (ADR-IF-R18-5): the form's own rules as a pure module. The form's existing tests are the
// pin for "no behaviour change"; these cover the module directly.

let policy: PolicyFile;
beforeAll(() => {
  const r = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
  if (!r.valid) throw new Error('policy invalid');
  policy = r.policy;
});

const entry = (id: string, plain_name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, approved_envelope: {}, satisfies_controls: [], plain_name, ...extra });
const withParts = (parts: Record<string, unknown>) => ({ ...(policy as object), ...parts }) as unknown as PolicyFile;

const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const typed = (value: string | string[]) => ({ value, source: { kind: 'typed' as const } });

describe('toPlainAnswers is re-exported, not copied', () => {
  it('is the same function', () => {
    expect(toPlainAnswers).toBe(original);
  });
});

describe('shownQuestionIds', () => {
  it('a blank form shows the always-asked questions only, in the form\'s order', () => {
    expect(shownQuestionIds({}, policy)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
  });

  it('agentic work adds 13 and 14; a score adds 4a; "other" adds its free text', () => {
    const ids = shownQuestionIds({ '4': 'agentic', '8': 'other' }, policy);
    expect(ids).toContain('13');
    expect(ids).toContain('14');
    expect(ids).toContain('8other');
    expect(ids).not.toContain('4a');
    expect(shownQuestionIds({ '4': 'score' }, policy)).toContain('4a');
  });
});

describe('clearDependents', () => {
  it('changing Q3 clears every follow-up of the old answer, even ones the new answer also asks', () => {
    const next = clearDependents(
      { '3': 'specialist-product', '3supplier': 'not-on-list', '3supplierName': 'Acme', '3model': 'm', '3a': 'firm-account', '3aWhich': 'x', '3platformZone': 'firm-systems', '5': ['people'] },
      '3',
      policy,
    );
    expect(next).toEqual({ '3': 'specialist-product', '3model': 'm', '5': ['people'] });
  });

  it('the typed model name goes when Q3 stops asking for it, but is kept when it never asked (only a transition clears it)', () => {
    const after = { '3': 'firm-built', '3model': 'm' };
    expect(clearDependents(after, '3', policy, { '3': 'outside-assistant', '3model': 'm' })).toEqual({ '3': 'firm-built' });
    expect(clearDependents(after, '3', policy, { '3': 'not-sure', '3model': 'm' })).toEqual({ '3': 'firm-built', '3model': 'm' });
    // With no "before" it is cleared when it is no longer asked.
    expect(clearDependents(after, '3', policy)).toEqual({ '3': 'firm-built' });
  });

  it('3a clears 3aWhich; 3supplier clears the typed name unless "not on the list"', () => {
    expect(clearDependents({ '3a': 'firm-account', '3aWhich': 'x' }, '3a', policy)).toEqual({ '3a': 'firm-account' });
    expect(clearDependents({ '3supplier': 'dont-know', '3supplierName': 'Acme' }, '3supplier', policy)).toEqual({ '3supplier': 'dont-know' });
    expect(clearDependents({ '3supplier': 'not-on-list', '3supplierName': 'Acme' }, '3supplier', policy)).toEqual({ '3supplier': 'not-on-list', '3supplierName': 'Acme' });
  });

  it('Q4 away from a score clears 4a, away from agentic clears 13 and 14; Q6 and Q8 likewise', () => {
    expect(clearDependents({ '4': 'language', '4a': 'rules', '13': ['none'], '14': 'no' }, '4', policy)).toEqual({ '4': 'language' });
    expect(clearDependents({ '4': 'not-sure', '4a': 'rules', '13': ['none'], '14': 'no' }, '4', policy)).toEqual({ '4': 'not-sure', '13': ['none'], '14': 'no' });
    expect(clearDependents({ '6': 'drafts', '6a': 'little', '6b': 'trades' }, '6', policy)).toEqual({ '6': 'drafts', '6a': 'little' });
    expect(clearDependents({ '6': 'acts-alone', '6a': 'little', '6b': 'trades' }, '6', policy)).toEqual({ '6': 'acts-alone', '6b': 'trades' });
    expect(clearDependents({ '8': 'credit', '8other': 'x' }, '8', policy)).toEqual({ '8': 'credit' });
  });

  it('does not change its input', () => {
    const input = { '4': 'language', '4a': 'rules' };
    clearDependents(input, '4', policy);
    expect(input).toEqual({ '4': 'language', '4a': 'rules' });
  });
});

describe('validOptionKeys', () => {
  it('a plain question offers its static keys', () => {
    expect(validOptionKeys('10', {}, policy)).toEqual(['small', 'team', 'wide']);
    expect(validOptionKeys('1', {}, policy)).toEqual([]);
  });

  it('Q3 includes the policy\'s platforms, Q11 its jurisdictions, 3platformZone only what the chosen platform allows', () => {
    const p = withParts({
      platforms: [entry('PLAT-MANY', 'Many', { approved_envelope: { data_zones: ['Zone B', 'Zone C'] } })],
      jurisdictions: [{ code: 'UK', name: 'United Kingdom', pack_files: [] }],
    });
    expect(validOptionKeys('3', {}, p)).toContain('PLAT-MANY');
    expect(validOptionKeys('11', {}, p)).toEqual(['UK', 'elsewhere-not-sure']);
    expect(validOptionKeys('3platformZone', { '3': 'PLAT-MANY' }, p)).toEqual(['firm-systems', 'outside-supplier', 'not-sure']);
    expect(validOptionKeys('3platformZone', { '3': 'firm-built' }, p)).toEqual([]);
  });
});

describe('isValidMultiSelection', () => {
  it('Q13: "nothing beyond…" cannot be ticked with others; the checker is the engine\'s', () => {
    expect(isValidMultiSelection('13', ['none'])).toBe(true);
    expect(isValidMultiSelection('13', ['none', 'credentialed'])).toBe(false);
    expect(isValidMultiSelection('13', ['credentialed', 'shared'])).toBe(true);
    expect(isValidMultiSelection('13', ['not-sure', 'credentialed'])).toBe(true);
  });

  it('other tick-all questions: "Not sure" may be ticked beside others (as on the form today); repeats and empty are refused', () => {
    expect(isValidMultiSelection('5', ['people', 'not-sure'])).toBe(true);
    expect(isValidMultiSelection('5', ['people', 'people'])).toBe(false);
    expect(isValidMultiSelection('5', [])).toBe(false);
  });
});

describe('mergePrefill', () => {
  const catalogue = () => buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, policy);
  const prefill = (rows: [string, { option: string; quote: string }[]][]): Prefill =>
    new Map(rows.map(([id, values]) => [id, { values }])) as unknown as Prefill;
  const filled = (value: string | string[], confirmed: boolean): FormAnswerState['4'] => ({
    value,
    source: { kind: 'prefilled', quotes: [{ option: 'x', quote: 'old quote words' }], read: READ, confirmed },
  });

  it('on a first read the pre-fill fills blank questions as unconfirmed, with its quotes and the read record', () => {
    const merged = mergePrefill({}, prefill([['10', [{ option: 'small', quote: 'one small trial' }]], ['5', [{ option: 'people', quote: 'client names' }, { option: 'public', quote: 'public news' }]]]), catalogue(), policy, READ);
    expect(merged['10']).toEqual({ value: 'small', source: { kind: 'prefilled', quotes: [{ option: 'small', quote: 'one small trial' }], read: READ, confirmed: false } });
    expect(merged['5']!.value).toEqual(['people', 'public']);
  });

  it('keeps typed, changed, confirmed pre-filled and earlier-record answers untouched', () => {
    const state: FormAnswerState = {
      '10': typed('wide'),
      '9': { value: 'no', source: { kind: 'changed', from: [{ option: 'yes', quote: 'a b' }], read: READ } },
      '7': filled('clients', true),
      '12': { value: 'yes', source: { kind: 'record', confirmed: false } },
    };
    const merged = mergePrefill(
      state,
      prefill([['10', [{ option: 'small', quote: 'q q' }]], ['9', [{ option: 'yes', quote: 'q q' }]], ['7', [{ option: 'me-or-team', quote: 'q q' }]], ['12', [{ option: 'no', quote: 'q q' }]]]),
      catalogue(),
      policy,
      READ,
    );
    expect(merged['10']).toBe(state['10']);
    expect(merged['9']).toBe(state['9']);
    expect(merged['7']).toBe(state['7']);
    expect(merged['12']).toBe(state['12']);
  });

  it('replaces an unconfirmed pre-filled answer with the new one, or blanks it when the new reply gives nothing', () => {
    const state: FormAnswerState = { '10': filled('wide', false), '7': filled('clients', false) };
    const merged = mergePrefill(state, prefill([['10', [{ option: 'small', quote: 'one small trial' }]]]), catalogue(), policy, READ);
    expect(merged['10']!.value).toBe('small');
    expect(merged['7']).toBeUndefined();
  });

  it('clears what depended on a replaced answer and drops answers whose question is hidden', () => {
    const state: FormAnswerState = { '4': filled('score', false), '4a': typed('rules') };
    const merged = mergePrefill(state, prefill([['4', [{ option: 'language', quote: 'writes text' }]]]), catalogue(), policy, READ);
    expect(merged['4']!.value).toBe('language');
    expect(merged['4a']).toBeUndefined();
    const hidden = mergePrefill({ '13': typed(['none']) }, prefill([]), catalogue(), policy, READ);
    expect(hidden['13']).toBeUndefined();
  });

  it('a pre-fill for a question that would not be shown is not kept', () => {
    const merged = mergePrefill({}, prefill([['4a', [{ option: 'rules', quote: 'fixed rules' }]]]), catalogue(), policy, READ);
    expect(merged['4a']).toBeUndefined();
  });

  it('does not change its input and gives the same result twice', () => {
    const state: FormAnswerState = { '10': filled('wide', false) };
    const copy = JSON.stringify(state);
    const p = prefill([['10', [{ option: 'small', quote: 'one small trial' }]]]);
    const a = mergePrefill(state, p, catalogue(), policy, READ);
    expect(JSON.stringify(state)).toBe(copy);
    expect(JSON.stringify(mergePrefill(state, p, catalogue(), policy, READ))).toBe(JSON.stringify(a));
  });
});

describe('mergePrefill: a found value must be an option the current merged answers allow (review pass 1, I3)', () => {
  // Two platforms with different zone sets: A reaches Zone A and B, B reaches Zone B and C.
  const platformA = entry('PLAT-A', 'Platform A', { approved_envelope: { data_zones: ['Zone A', 'Zone B'] } });
  const platformB = entry('PLAT-B', 'Platform B', { approved_envelope: { data_zones: ['Zone B', 'Zone C'] } });
  const catalogueFor = (p: PolicyFile) => buildCatalogue(QUESTION_STRUCTURE, QUESTION_WORDS, p);
  const rows = (r: [string, { option: string; quote: string }[]][]): Prefill =>
    new Map(r.map(([id, values]) => [id, { values }])) as unknown as Prefill;

  it('the person typed platform B; the model read platform A and a zone only A allows: the zone is left blank, not written invalid', () => {
    const p = withParts({ platforms: [platformA, platformB] });
    expect(validOptionKeys('3platformZone', { '3': 'PLAT-B' }, p)).not.toContain('outside-service');
    const merged = mergePrefill(
      { '3': typed('PLAT-B') },
      rows([
        ['3', [{ option: 'PLAT-A', quote: 'platform a' }]],
        ['3platformZone', [{ option: 'outside-service', quote: 'outside service' }]],
      ]),
      catalogueFor(p),
      p,
      READ,
    );
    expect(merged['3']).toEqual(typed('PLAT-B'));
    expect(merged['3platformZone']).toBeUndefined();
  });

  it('a zone the typed platform does allow is still filled in', () => {
    const p = withParts({ platforms: [platformA, platformB] });
    const merged = mergePrefill(
      { '3': typed('PLAT-B') },
      rows([['3platformZone', [{ option: 'outside-supplier', quote: 'outside supplier' }]]]),
      catalogueFor(p),
      p,
      READ,
    );
    expect(merged['3platformZone']!.value).toBe('outside-supplier');
  });

  it('a prefilled platform and its prefilled zone together: the zone is checked against the platform just merged', () => {
    const p = withParts({ platforms: [platformA, platformB] });
    const ok = mergePrefill({}, rows([['3', [{ option: 'PLAT-A', quote: 'platform a' }]], ['3platformZone', [{ option: 'outside-service', quote: 'outside service' }]]]), catalogueFor(p), p, READ);
    expect(ok['3platformZone']!.value).toBe('outside-service');
    const bad = mergePrefill({}, rows([['3', [{ option: 'PLAT-B', quote: 'platform b' }]], ['3platformZone', [{ option: 'outside-service', quote: 'outside service' }]]]), catalogueFor(p), p, READ);
    expect(bad['3']!.value).toBe('PLAT-B');
    expect(bad['3platformZone']).toBeUndefined();
  });

  it('a tick-all value is kept only if every option is valid; one invalid option drops the whole value', () => {
    const p = withParts({ platforms: [platformA, platformB] });
    const merged = mergePrefill({}, rows([['5', [{ option: 'people', quote: 'client names' }, { option: 'not-an-option', quote: 'xx yy' }]]]), catalogueFor(p), p, READ);
    expect(merged['5']).toBeUndefined();
  });
});

describe('canContinue and missingQuestionIds', () => {
  const complete: FormAnswerState = {
    '1': typed('Name'), '3': typed('firm-built'), '4': typed('language'), '5': typed(['everyday']), '6': typed('read'),
    '7': typed('me-or-team'), '8': typed('operational'), '9': typed('no'), '10': typed('small'), '11': typed(['elsewhere-not-sure']), '12': typed('no'),
  };

  it('is true when the description and every required question are answered', () => {
    expect(canContinue(complete, 'A description', policy)).toBe(true);
    expect(missingQuestionIds(toPlainAnswers(complete, 'A description'), policy)).toEqual([]);
  });

  it('a blank description blocks Continue, and so does a missing answer', () => {
    expect(canContinue(complete, '   ', policy)).toBe(false);
    const { '10': _drop, ...rest } = complete;
    expect(canContinue(rest, 'A description', policy)).toBe(false);
    expect(missingQuestionIds(toPlainAnswers(rest, 'x'), policy)).toEqual(['10']);
  });

  it('a conditional question blocks Continue once shown, in the form\'s order', () => {
    const state: FormAnswerState = { ...complete, '4': typed('agentic') };
    expect(missingQuestionIds(toPlainAnswers(state, 'x'), policy)).toEqual(['13', '14']);
  });

  it('an unconfirmed pre-filled answer, or an unconfirmed earlier-record answer, blocks Continue until confirmed', () => {
    const pre = { value: 'small', source: { kind: 'prefilled' as const, quotes: [], read: READ, confirmed: false } };
    expect(canContinue({ ...complete, '10': pre }, 'x', policy)).toBe(false);
    expect(canContinue({ ...complete, '10': { ...pre, source: { ...pre.source, confirmed: true } } }, 'x', policy)).toBe(true);
    expect(canContinue({ ...complete, '10': { value: 'small', source: { kind: 'record', confirmed: false } } }, 'x', policy)).toBe(false);
    expect(canContinue({ ...complete, '10': { value: 'small', source: { kind: 'changed', from: [], read: READ } } }, 'x', policy)).toBe(true);
  });

  it('a stale value that is not one of the current options does not count as answered', () => {
    expect(canContinue({ ...complete, '10': typed('enormous') }, 'x', policy)).toBe(false);
  });

  it('a not-carried answer is blank', () => {
    expect(canContinue({ ...complete, '10': { value: 'small', source: { kind: 'not-carried' } } }, 'x', policy)).toBe(false);
  });
});
