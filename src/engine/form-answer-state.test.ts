import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toPlainAnswers, textFingerprint } from './form-answer-state';
import type { FormAnswerState } from './prefill-types';

// R18-A deliverables 2-3 (specs/intake-flow.md §27.1, §27.6). Question 2 is
// the description, never a form answer; the fingerprint is a deterministic
// 53-bit hash of the whitespace-normalised text.

const READ = { model: 'm', place: 'this-computer' as const, host: 'http://localhost:11434' };

describe('toPlainAnswers (R18-A, intake-flow §27.6)', () => {
  it('adds Question 2 from the description and flattens each answer to its value', () => {
    const state: FormAnswerState = {
      '1': { value: 'My tool', source: { kind: 'typed' } },
      '3': { value: 'build', source: { kind: 'typed' } },
      '11': { value: ['UK', 'EU'], source: { kind: 'typed' } },
    };
    expect(toPlainAnswers(state, 'A description.')).toEqual({
      '1': 'My tool',
      '2': 'A description.',
      '3': 'build',
      '11': ['UK', 'EU'],
    });
  });

  it('is the only source of Question 2: a stale "2" entry in the state cannot beat the description', () => {
    const state = { '2': { value: 'stale', source: { kind: 'typed' } } } as unknown as FormAnswerState;
    expect(toPlainAnswers(state, 'fresh')['2']).toBe('fresh');
  });

  it('keeps every source kind’s value (the source is bookkeeping, not an answer)', () => {
    const state: FormAnswerState = {
      '4': { value: 'score', source: { kind: 'prefilled', quotes: [{ option: 'score', quote: 'a score' }], read: READ, confirmed: true } },
      '5': { value: ['people'], source: { kind: 'record', confirmed: true } },
      '6': { value: 'drafts', source: { kind: 'changed', from: [], read: READ } },
    };
    const out = toPlainAnswers(state, 'd');
    expect(out['4']).toBe('score');
    expect(out['5']).toEqual(['people']);
    expect(out['6']).toBe('drafts');
  });

  it('copies arrays, so later edits to the result cannot reach the state', () => {
    const state: FormAnswerState = { '11': { value: ['UK'], source: { kind: 'typed' } } };
    const out = toPlainAnswers(state, 'd');
    (out['11'] as string[]).push('EU');
    expect(state['11']!.value).toEqual(['UK']);
  });

  it('leaves out a "not-carried" question (blank, nothing to derive)', () => {
    const state: FormAnswerState = { '9': { value: '', source: { kind: 'not-carried' } } };
    expect('9' in toPlainAnswers(state, 'd')).toBe(false);
  });

  it('is deterministic: the same inputs give an identical serialisation', () => {
    const state: FormAnswerState = { '3': { value: 'build', source: { kind: 'typed' } } };
    expect(JSON.stringify(toPlainAnswers(state, 'd'))).toBe(JSON.stringify(toPlainAnswers(state, 'd')));
  });
});

describe('textFingerprint (R18-A, intake-flow §27.6)', () => {
  it('is deterministic and a non-empty string', () => {
    const f = textFingerprint('We bought it from a supplier.');
    expect(f).toBe(textFingerprint('We bought it from a supplier.'));
    expect(f.length).toBeGreaterThan(0);
  });

  it('ignores whitespace-run differences (it hashes the quote-normalised text) but not wording', () => {
    expect(textFingerprint('a  b\n\tc ')).toBe(textFingerprint('a b c'));
    expect(textFingerprint('a b c')).not.toBe(textFingerprint('a b d'));
    expect(textFingerprint('Abc')).not.toBe(textFingerprint('abc'));
  });

  it('the never-read sentinel "" never equals any real text’s fingerprint, even for empty text', () => {
    for (const t of ['', ' ', 'x', 'It replaces our old scorecard.', ' ', '😀']) {
      expect(textFingerprint(t)).not.toBe('');
    }
  });

  it('is a 53-bit value: at most 14 hex digits, and different texts differ', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const f = textFingerprint(`text number ${i}`);
      expect(f).toMatch(/^[0-9a-f]{1,14}$/);
      expect(Number.parseInt(f, 16)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
      seen.add(f);
    }
    expect(seen.size).toBe(500);
  });
});

describe('prefill-types.ts (R18-A deliverable 2)', () => {
  it('is types only: no runtime exports, no imports beyond engine files', () => {
    const src = readFileSync(resolve(__dirname, 'prefill-types.ts'), 'utf-8');
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/export\s+(const|let|var|function|class|enum)\b/);
    for (const m of code.matchAll(/from\s+'([^']+)'/g)) expect(m[1]).toMatch(/^\.\/[a-z-]+$/);
  });
});
