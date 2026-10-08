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
import type { FormAnswerState } from '../engine/prefill-types';

// R18-A reducer rules (specs/intake-flow.md §27.1, §27.3, §27.6): the nudge, the
// duplicate decision's fingerprint, Back from the form for a fresh case only,
// Question 2 as the description's editor, and the derived plainAnswers cache.

const D = 'A dashboard that summarises ticket volumes.';
const policyRes = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
if (!policyRes.valid) throw new Error('policy invalid');
const answers = { ...WORKED_EXAMPLES[0]!.answers };
const graph = buildGraphFromForm(
  plainAnswersToFormValues({ ...answers, '2': D }, policyRes.policy).values,
  '2026-10-01T00:00:00.000Z',
  () => 'id',
);
const typed: FormAnswerState = {
  '1': { value: 'Ticket volumes dashboard', source: { kind: 'typed' } },
  '3': { value: 'firm-built', source: { kind: 'typed' } },
};

describe('the nudge is remembered on the description step (TC-R18-GI-2-02)', () => {
  it('NUDGE_SHOWN records the ids; typing keeps them; RESTART forgets them', () => {
    const s0: IntakeState = { step: 'description_entry', description: 'x' };
    const s1 = intakeReducer(s0, { type: 'NUDGE_SHOWN', nudgeFor: ['countries', 'kind-of-ai'] });
    expect(s1).toEqual({ step: 'description_entry', description: 'x', nudgeFor: ['countries', 'kind-of-ai'] });
    const s2 = intakeReducer(s1, { type: 'DESCRIPTION_CHANGED', description: 'xy' });
    expect(s2).toEqual({ step: 'description_entry', description: 'xy', nudgeFor: ['countries', 'kind-of-ai'] });
    expect(intakeReducer(s2, { type: 'RESTART' })).toEqual({ step: 'description_entry', description: '' });
  });

  it('NUDGE_SHOWN is ignored from any other step', () => {
    const s: IntakeState = { step: 'duplicate_check', description: 'x' };
    expect(intakeReducer(s, { type: 'NUDGE_SHOWN', nudgeFor: ['countries'] })).toBe(s);
  });
});

describe('the duplicate decision is remembered by text fingerprint (TC-R18-GI-8-14)', () => {
  it('passing the similar-cases screen records the fingerprint of the text on the form step', () => {
    const dup: IntakeState = { step: 'duplicate_check', description: D, nudgeFor: ['countries'] };
    expect(intakeReducer(dup, { type: 'NO_DUPLICATE_FOUND', method: 'form' })).toEqual({
      step: 'graph_extraction',
      description: D,
      method: 'form',
      decidedFor: textFingerprint(D),
      nudgeFor: ['countries'],
    });
  });

  it('Next with an unchanged fingerprint goes straight to the form; a changed text runs the check again', () => {
    const back: IntakeState = { step: 'description_entry', description: D, decidedFor: textFingerprint(D) };
    expect(intakeReducer(back, { type: 'SUBMIT_DESCRIPTION' })).toEqual({
      step: 'graph_extraction',
      description: D,
      method: 'form',
      decidedFor: textFingerprint(D),
    });
    const edited = intakeReducer(back, { type: 'DESCRIPTION_CHANGED', description: D + ' It is for managers.' });
    expect(intakeReducer(edited, { type: 'SUBMIT_DESCRIPTION' }).step).toBe('duplicate_check');
  });

  it('whitespace-only edits keep the same fingerprint (normForQuote), a one-word edit does not', () => {
    const back: IntakeState = { step: 'description_entry', description: D + '  ', decidedFor: textFingerprint(D) };
    expect(intakeReducer(back, { type: 'SUBMIT_DESCRIPTION' }).step).toBe('graph_extraction');
    const changed: IntakeState = { step: 'description_entry', description: D.replace('ticket', 'ticketing'), decidedFor: textFingerprint(D) };
    expect(intakeReducer(changed, { type: 'SUBMIT_DESCRIPTION' }).step).toBe('duplicate_check');
  });

  it('with no decision remembered Next always runs the check', () => {
    expect(intakeReducer({ step: 'description_entry', description: D }, { type: 'SUBMIT_DESCRIPTION' }).step).toBe('duplicate_check');
  });
});

describe('Back from the form (TC-R18-GI-8-07, TC-R18-GI-8-13)', () => {
  const fresh: IntakeState = { step: 'graph_extraction', description: D, method: 'form', decidedFor: textFingerprint(D), nudgeFor: ['countries'] };

  it('TC-R18-GI-8-07: a fresh case goes back to the description, handing over decidedFor and nudgeFor', () => {
    expect(intakeReducer(fresh, { type: 'STEP_BACK' })).toEqual({
      step: 'description_entry',
      description: D,
      decidedFor: textFingerprint(D),
      nudgeFor: ['countries'],
    });
  });

  it.each([
    ['a retry or a case with an id (useCaseId)', { useCaseId: 'uc-1' }],
    ['a correction (originalVerdictId)', { originalVerdictId: 'v-1' }],
    ['a correction with its original graph', { originalVerdictId: 'v-1', originalGraph: graph, useCaseId: 'uc-1' }],
    ['after a failed evaluation (afterFailedEvaluation)', { afterFailedEvaluation: true }],
  ])('TC-R18-GI-8-13: Back is refused for %s', (_n, extra) => {
    const s = { ...fresh, ...extra } as IntakeState;
    expect(intakeReducer(s, { type: 'STEP_BACK' })).toBe(s);
  });
});

describe('Question 2 is the editor of the description (TC-R18-GI-8-09 part A)', () => {
  it('DESCRIPTION_EDITED updates state.description on the form step only', () => {
    const form: IntakeState = { step: 'graph_extraction', description: D, method: 'form' };
    expect(intakeReducer(form, { type: 'DESCRIPTION_EDITED', description: 'new words' })).toEqual({
      step: 'graph_extraction', description: 'new words', method: 'form',
    });
    const desc: IntakeState = { step: 'description_entry', description: D };
    expect(intakeReducer(desc, { type: 'DESCRIPTION_EDITED', description: 'x' })).toBe(desc);
  });
});

describe('FORM_SUBMITTED derives the plainAnswers cache from answerState and the description', () => {
  it('sets plainAnswers = toPlainAnswers(answerState, description) and carries answerState on', () => {
    const form: IntakeState = { step: 'graph_extraction', description: D, method: 'form' };
    const next = intakeReducer(form, {
      type: 'FORM_SUBMITTED', graph, useCaseId: 'uc-1', description: D + ' (edited)', answerState: typed,
      assumptions: [], questions: [], contradictions: [], corrections: [],
    });
    expect(next.step).toBe('confirmation');
    const c = next as Extract<IntakeState, { step: 'confirmation' }>;
    expect(c.plainAnswers).toEqual({ '1': 'Ticket volumes dashboard', '3': 'firm-built', '2': D + ' (edited)' });
    expect(c.answerState).toEqual(typed);
    // and Change an answer hands both back to the form
    const back = intakeReducer(next, { type: 'CHANGE_ANSWER' }) as Extract<IntakeState, { step: 'graph_extraction' }>;
    expect(back.answerState).toEqual(typed);
    expect(back.plainAnswers).toEqual(c.plainAnswers);
  });
});
