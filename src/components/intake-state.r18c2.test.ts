import { describe, it, expect } from 'vitest';
import { intakeReducer } from './intake-state';
import type { IntakeState } from './intake-state';
import { textFingerprint } from '../engine/form-answer-state';
import { buildGraphFromForm } from '../engine/build-graph-from-form';
import { plainAnswersToFormValues } from '../engine/plain-intake';
import { WORKED_EXAMPLES } from '../engine/worked-examples';
import { loadPolicy } from '../store/policy';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FormAnswerState, LastRead, ReadRecord } from '../engine/prefill-types';

// R18-C2 reducer rules (specs/intake-flow.md §27.1, §27.5, §27.6): the reading step, PREFILL_DONE, READ_AGAIN,
// Back from the reading step, and `lastRead` carried beside `answerState` on every form-route step.

const D = 'It reads client names and account details. Our UK team will use it.';
const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const policyRes = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
if (!policyRes.valid) throw new Error('policy invalid');
const graph = buildGraphFromForm(
  plainAnswersToFormValues({ ...WORKED_EXAMPLES[0]!.answers, '2': D }, policyRes.policy).values,
  '2026-10-01T00:00:00.000Z',
  () => 'id',
);
const typed: FormAnswerState = { '1': { value: 'Name', source: { kind: 'typed' } } };
const filled: FormAnswerState = {
  ...typed,
  '11': { value: ['UK'], source: { kind: 'prefilled', quotes: [{ option: 'UK', quote: 'Our UK team' }], read: READ, confirmed: false } },
};
const lastRead: LastRead = { fingerprint: textFingerprint(D), outcome: 'ok', read: READ };

describe('the reading step is entered from the similar-cases screen or by Next (TC-R18-GI-3-01 route)', () => {
  it('NO_DUPLICATE_FOUND with reading goes to prefill_reading, carrying the decision, the nudge and lastRead', () => {
    const dup: IntakeState = { step: 'duplicate_check', description: D, nudgeFor: ['countries'], lastRead };
    expect(intakeReducer(dup, { type: 'NO_DUPLICATE_FOUND', method: 'form', reading: true })).toEqual({
      step: 'prefill_reading',
      description: D,
      decidedFor: textFingerprint(D),
      nudgeFor: ['countries'],
      lastRead,
    });
  });

  it('NO_DUPLICATE_FOUND without reading still opens the form, and may record why nothing was read', () => {
    const dup: IntakeState = { step: 'duplicate_check', description: D };
    const none: LastRead = { fingerprint: '', outcome: 'not-configured' };
    expect(intakeReducer(dup, { type: 'NO_DUPLICATE_FOUND', method: 'form', lastRead: none })).toEqual({
      step: 'graph_extraction',
      description: D,
      method: 'form',
      decidedFor: textFingerprint(D),
      lastRead: none,
    });
  });

  it('NO_DUPLICATE_FOUND keeps the lastRead the similar-cases step carried (an unchanged text is not read again)', () => {
    const dup: IntakeState = { step: 'duplicate_check', description: D, lastRead };
    expect(intakeReducer(dup, { type: 'NO_DUPLICATE_FOUND', method: 'form' })).toMatchObject({ step: 'graph_extraction', lastRead });
  });

  it('SUBMIT_DESCRIPTION with an unchanged decision goes to the reading step when asked to read, else to the form', () => {
    const back: IntakeState = { step: 'description_entry', description: D, decidedFor: textFingerprint(D), lastRead };
    expect(intakeReducer(back, { type: 'SUBMIT_DESCRIPTION', reading: true }).step).toBe('prefill_reading');
    expect(intakeReducer(back, { type: 'SUBMIT_DESCRIPTION' })).toMatchObject({ step: 'graph_extraction', lastRead });
  });

  it('the duplicate step carries lastRead from the description step', () => {
    const entry: IntakeState = { step: 'description_entry', description: D, lastRead };
    expect(intakeReducer(entry, { type: 'SUBMIT_DESCRIPTION' })).toMatchObject({ step: 'duplicate_check', lastRead });
  });
});

describe('PREFILL_DONE mounts the form with the merged answers and the new lastRead (TC-R18-GI-8-08)', () => {
  const reading: IntakeState = { step: 'prefill_reading', description: D, decidedFor: textFingerprint(D), nudgeFor: ['countries'] };

  it('moves to the form step carrying description, decision, nudge, answerState and lastRead', () => {
    expect(intakeReducer(reading, { type: 'PREFILL_DONE', answerState: filled, lastRead })).toEqual({
      step: 'graph_extraction',
      description: D,
      method: 'form',
      decidedFor: textFingerprint(D),
      nudgeFor: ['countries'],
      answerState: filled,
      lastRead,
    });
  });

  it('is ignored from any other step', () => {
    const s: IntakeState = { step: 'graph_extraction', description: D, method: 'form' };
    expect(intakeReducer(s, { type: 'PREFILL_DONE', answerState: filled, lastRead })).toBe(s);
  });
});

describe('READ_AGAIN goes from a fresh form to the reading step, keeping the answers (TC-R18-GI-8-12)', () => {
  const form: IntakeState = {
    step: 'graph_extraction',
    description: D,
    method: 'form',
    decidedFor: textFingerprint(D),
    answerState: filled,
    lastRead,
  };

  it('carries the description, decision, answers and lastRead to prefill_reading', () => {
    expect(intakeReducer(form, { type: 'READ_AGAIN' })).toEqual({
      step: 'prefill_reading',
      description: D,
      decidedFor: textFingerprint(D),
      answerState: filled,
      lastRead,
    });
  });

  it('is refused for a form that carries a case, a correction or a retry (they have no Back to leave the reading by)', () => {
    for (const extra of [{ useCaseId: 'c1' }, { originalVerdictId: 'v1' }, { afterFailedEvaluation: true }]) {
      const s: IntakeState = { ...(form as object), ...extra } as IntakeState;
      expect(intakeReducer(s, { type: 'READ_AGAIN' })).toBe(s);
    }
  });

  it('is ignored from any other step', () => {
    const s: IntakeState = { step: 'description_entry', description: D };
    expect(intakeReducer(s, { type: 'READ_AGAIN' })).toBe(s);
  });
});

describe('STEP_BACK from the reading step goes to the description with the text kept (release)', () => {
  it('returns description_entry with the decision, nudge and lastRead', () => {
    const reading: IntakeState = {
      step: 'prefill_reading',
      description: D,
      decidedFor: textFingerprint(D),
      nudgeFor: ['countries'],
      answerState: filled,
      lastRead,
    };
    expect(intakeReducer(reading, { type: 'STEP_BACK' })).toEqual({
      step: 'description_entry',
      description: D,
      decidedFor: textFingerprint(D),
      nudgeFor: ['countries'],
      lastRead,
    });
  });
});

describe('STEP_BACK from the form hands lastRead back to the description (TC-R18-GI-8-10, GI-8-11)', () => {
  it('carries lastRead, so Next with the same text asks the model nothing', () => {
    const form: IntakeState = { step: 'graph_extraction', description: D, method: 'form', decidedFor: textFingerprint(D), lastRead };
    expect(intakeReducer(form, { type: 'STEP_BACK' })).toMatchObject({ step: 'description_entry', lastRead });
  });
});

describe('lastRead travels with answerState through every later step (TC-R18-GI-8-11)', () => {
  const form: IntakeState = { step: 'graph_extraction', description: D, method: 'form', answerState: filled, lastRead };
  const submitted = intakeReducer(form, {
    type: 'FORM_SUBMITTED',
    graph,
    useCaseId: 'case-1',
    description: D,
    answerState: filled,
    assumptions: [],
    questions: [],
    contradictions: [],
    corrections: [],
  });

  it('FORM_SUBMITTED keeps the form step\'s lastRead on the confirmation', () => {
    expect(submitted.step).toBe('confirmation');
    expect(submitted).toMatchObject({ answerState: filled, lastRead });
  });

  it('CONFIRMED then EVALUATION_FAILED hands answerState and lastRead back to the form', () => {
    const pending = intakeReducer(submitted, { type: 'CONFIRMED' });
    expect(pending).toMatchObject({ step: 'evaluation_pending', answerState: filled, lastRead });
    const back = intakeReducer(pending, { type: 'EVALUATION_FAILED' });
    expect(back).toMatchObject({ step: 'graph_extraction', method: 'form', answerState: filled, lastRead, useCaseId: 'case-1' });
  });

  it('CHANGE_ANSWER hands both back to the form', () => {
    expect(intakeReducer(submitted, { type: 'CHANGE_ANSWER' })).toMatchObject({ step: 'graph_extraction', answerState: filled, lastRead });
  });

  it('the questionnaire, the contradiction review and the way back all carry it', () => {
    const q = intakeReducer(form, {
      type: 'FORM_SUBMITTED',
      graph,
      useCaseId: 'case-1',
      description: D,
      answerState: filled,
      assumptions: [],
      questions: [{ id: 'q1' } as never],
      contradictions: [],
      corrections: [],
    });
    expect(q).toMatchObject({ step: 'questionnaire', lastRead });
    const c = intakeReducer(q, { type: 'CONTRADICTIONS_DETECTED', contradictions: [{ statement1: 'a', statement2: 'b' } as never] });
    expect(c).toMatchObject({ step: 'contradiction_review', lastRead });
    const q2 = intakeReducer(c, { type: 'CONTRADICTION_RESOLVED', explanation: 'because' });
    expect(q2).toMatchObject({ step: 'questionnaire', lastRead });
    expect(intakeReducer(q2, { type: 'PROCEED_TO_CONFIRMATION' })).toMatchObject({ step: 'confirmation', lastRead });
    expect(intakeReducer(q2, { type: 'STEP_BACK' })).toMatchObject({ step: 'graph_extraction', answerState: filled, lastRead });
  });

  it('CORRECT_VERDICT_WITH_FORM seeds the form with the answers and the lastRead of the verdict being corrected', () => {
    const verdict: IntakeState = { step: 'verdict', verdictId: 'v1' };
    const s = intakeReducer(verdict, {
      type: 'CORRECT_VERDICT_WITH_FORM',
      originalGraph: graph,
      useCaseId: 'case-1',
      originalVerdictId: 'v1',
      description: D,
      answerState: filled,
      lastRead,
      assumptions: [],
    });
    expect(s).toMatchObject({ step: 'graph_extraction', answerState: filled, lastRead });
  });
});

describe('plainAnswers stays a derived cache set only by FORM_SUBMITTED', () => {
  it('PREFILL_DONE and READ_AGAIN never write plainAnswers', () => {
    const reading: IntakeState = { step: 'prefill_reading', description: D };
    const done = intakeReducer(reading, { type: 'PREFILL_DONE', answerState: filled, lastRead });
    expect(done).not.toHaveProperty('plainAnswers');
    expect(intakeReducer(done, { type: 'READ_AGAIN' })).not.toHaveProperty('plainAnswers');
  });
});
