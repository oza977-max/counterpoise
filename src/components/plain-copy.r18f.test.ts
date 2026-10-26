import { describe, it, expect } from 'vitest';
import {
  R18_COPY,
  modelLabelWords,
  testDiscardedWords,
  testNoAnswerWords,
  testProgressWords,
  testQuestionWords,
  testResultWords,
  testStoppedWords,
  testAnswersWords,
} from './plain-copy';
import { CORPUS_CASE_COUNT } from '../llm/model-setting';
import { CASE_BUDGET_MS } from './model-test-budget';

// R18-F: the in-app test's strings (specs/intake-flow.md §27.11). Each sentence is checked in the state where
// it is true and in the state where it would be false (TC-R18-GI-13-01 rows for F), and none says
// "approved" or "rejected" (TC-R18-GI-13-02) or praises the model (TC-R18-MS-4-07).

const TEST_KEYS = Object.keys(R18_COPY).filter((k) => k.startsWith('TEST_') || k.startsWith('LABEL_')) as (keyof typeof R18_COPY)[];

describe('the strings', () => {
  it('carry the wording of the spec', () => {
    expect(R18_COPY.TEST_PROGRESS).toBe('Case {n} of 31');
    expect(R18_COPY.TEST_STOPPED).toBe('Stopped after {n} of 31 cases.');
    expect(R18_COPY.TEST_LIMIT).toBe('Each case gets 60 seconds.');
    expect(R18_COPY.TEST_DISCARDED).toBe('{n} filled-in answers were dropped because they failed the checks.');
    expect(R18_COPY.TEST_NOT_A_GUARANTEE).toBe(
      'These 31 cases are public examples; they are not a guarantee about your own descriptions.',
    );
    expect(R18_COPY.TEST_NOT_COMPARABLE).toContain('2026-10-04 comparison');
  });

  it('say the numbers the code uses: 31 cases and 60 seconds', () => {
    expect(CORPUS_CASE_COUNT).toBe(31);
    expect(CASE_BUDGET_MS).toBe(60_000);
    expect(R18_COPY.TEST_PROGRESS).toContain(String(CORPUS_CASE_COUNT));
    expect(R18_COPY.TEST_LIMIT).toContain(String(CASE_BUDGET_MS / 1000));
  });

  it('TC-R18-GI-13-02: none says approved or rejected, filled or not', () => {
    const filled = [
      ...TEST_KEYS.map((k) => String(R18_COPY[k])),
      testProgressWords(12),
      testStoppedWords(12),
      testDiscardedWords(7) ?? '',
      testDiscardedWords(1) ?? '',
      testResultWords({ stopped: false, casesRun: 31, verdictMatches: 21 }),
      testResultWords({ stopped: true, casesRun: 12, verdictMatches: 9 }),
      testQuestionWords('What information will it see or use', { right: 3, blank: 20, wrong: 1 }),
      testNoAnswerWords(4) ?? '',
      modelLabelWords({ kind: 'partial', casesRun: 3, stopped: false }),
    ];
    expect(filled.filter((s) => /approved|rejected/i.test(s))).toEqual([]);
  });

  it('TC-R18-MS-4-07: nothing calls the model safe, reliable or recommended', () => {
    expect(TEST_KEYS.map((k) => String(R18_COPY[k])).filter((s) => /\b(safe|reliable|recommended)\b/i.test(s))).toEqual([]);
  });
});

describe('each sentence in its false state', () => {
  it('"Case n of 31" fills n', () => {
    expect(testProgressWords(1)).toBe('Case 1 of 31');
    expect(testProgressWords(31)).toBe('Case 31 of 31');
  });

  it('the dropped-fills sentence is absent when none were dropped, singular for one, the spec sentence for more', () => {
    expect(testDiscardedWords(0)).toBeNull();
    expect(testDiscardedWords(1)).toBe('1 filled-in answer was dropped because it failed the checks.');
    expect(testDiscardedWords(1)).not.toContain('answers were');
    expect(testDiscardedWords(7)).toBe('7 filled-in answers were dropped because they failed the checks.');
  });

  it('a stopped run never reads as a count out of 31; a finished one never says it was stopped', () => {
    const stopped = testResultWords({ stopped: true, casesRun: 12, verdictMatches: 9 });
    expect(stopped).toBe('Right verdict in 9 of the 12 cases that ran if you check every filled answer and answer the rest yourself.');
    expect(stopped).not.toMatch(/of 31/);
    const done = testResultWords({ stopped: false, casesRun: 31, verdictMatches: 21 });
    expect(done).toBe('Right verdict in 21 of 31 cases if you check every filled answer and answer the rest yourself.');
    expect(done).not.toMatch(/stopped|the \d+ cases that ran/i);
    expect(testStoppedWords(12)).toBe('Stopped after 12 of 31 cases.');
  });

  it('the no-usable-answer sentence is absent when every case was answered', () => {
    expect(testNoAnswerWords(0)).toBeNull();
    expect(testNoAnswerWords(3)).toBe('Cases with no usable answer from the model: 3. Each counts as blank, with no right verdict.');
  });

  it('a question line counts only the cases in which it was scored', () => {
    expect(testQuestionWords('Does it replace something?', { right: 2, blank: 5, wrong: 0 })).toBe(
      'Does it replace something?: 2 right, 5 left blank, 0 wrong (cases scored: 7)',
    );
  });

  it('the label for a partial run: stopped says stopped; one that was not stopped says it ran, never "stopped" (the R18-B carried minor)', () => {
    expect(modelLabelWords({ kind: 'partial', casesRun: 12, stopped: true })).toBe('untested (a partial test stopped after 12 of 31 cases)');
    expect(modelLabelWords({ kind: 'partial', casesRun: 12, stopped: false })).toBe('untested (a partial test ran 12 of 31 cases)');
    expect(modelLabelWords({ kind: 'partial', casesRun: 12, stopped: false })).not.toMatch(/stopped|measured/);
  });
});

describe('R18-F owner decision 2026-10-24: the result leads with the answers filled in correctly', () => {
  const t = (over = {}) => ({ kind: 'tested' as const, right: 11, blank: 3, wrong: 1, date: '2026-10-07', ...over });

  it('the label reads the date, then right of scored, blank and wrong, and carries no verdict figure', () => {
    const w = modelLabelWords(t());
    expect(w).toBe('tested on 2026-10-07: 11 of 15 answers filled in correctly, 3 left blank, 1 wrong');
    expect(w).not.toMatch(/\/31|verdict|measured|if you check/);
  });

  it('scored is right + blank + wrong, so the figures always add up', () => {
    expect(modelLabelWords(t({ right: 0, blank: 40, wrong: 0 }))).toBe(
      'tested on 2026-10-07: 0 of 40 answers filled in correctly, 40 left blank, 0 wrong',
    );
  });

  it('false state: a run in which no answer could be scored does not claim a count of answers', () => {
    const w = modelLabelWords(t({ right: 0, blank: 0, wrong: 0 }));
    expect(w).toBe('tested on 2026-10-07: no answers could be scored');
    expect(w).not.toMatch(/\d+ of \d+/);
  });

  it('the Settings answers line: finished says right of scored; stopped says it covers the cases that ran', () => {
    expect(testAnswersWords({ stopped: false, casesRun: 31, perQuestion: { '7': { right: 6, blank: 1, wrong: 1 } } })).toBe(
      '6 of 8 answers filled in correctly, 1 left blank, 1 wrong.',
    );
    const s = testAnswersWords({ stopped: true, casesRun: 12, perQuestion: { '7': { right: 2, blank: 1, wrong: 0 } } });
    expect(s).toBe('In the 12 cases that ran: 2 of 3 answers filled in correctly, 1 left blank, 0 wrong.');
    expect(testAnswersWords({ stopped: false, casesRun: 31, perQuestion: {} })).toBe('No answers could be scored in this run.');
  });

  it('the verdict sentence states its assumption, and says so for a finished and a stopped run alike', () => {
    const done = testResultWords({ stopped: false, casesRun: 31, verdictMatches: 31 });
    expect(done).toMatch(/if you check every filled answer and answer the rest yourself\.$/);
    expect(done).not.toMatch(/Reached/);
    expect(testResultWords({ stopped: true, casesRun: 5, verdictMatches: 5 })).toMatch(
      /^Right verdict in 5 of the 5 cases that ran if you check every filled answer and answer the rest yourself\.$/,
    );
  });

  it('the old suffix is gone and no new line says approved or rejected', () => {
    expect((R18_COPY as unknown as Record<string, string>).TEST_ASSUMPTION_SUFFIX).toBeUndefined();
    const all = [
      modelLabelWords(t()),
      modelLabelWords(t({ right: 0, blank: 0, wrong: 0 })),
      testAnswersWords({ stopped: true, casesRun: 1, perQuestion: {} }),
      testResultWords({ stopped: false, casesRun: 31, verdictMatches: 1 }),
    ];
    expect(all.filter((x) => /approved|rejected/i.test(x))).toEqual([]);
  });
});
