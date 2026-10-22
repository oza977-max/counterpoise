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
import type { FormAnswerState, ReadRecord } from '../engine/prefill-types';

// R18-D2 reducer rules (specs/intake-flow.md §27.10): OPEN_CORRECTION_FROM_RECORD opens a case from the register
// on the form, as a correction: the case id and the verdict being corrected are set, so Back is refused and the
// existing correction flow (and verdict_corrected) applies unchanged.

const D = 'It reads client names and account details. Our UK team will use it.';
const READ: ReadRecord = { model: 'alpha:7b', place: 'this-computer', host: 'http://localhost:11434' };
const policyRes = loadPolicy(readFileSync(resolve(__dirname, '../../policy/appetite.yaml'), 'utf-8'));
if (!policyRes.valid) throw new Error('policy invalid');
const graph = buildGraphFromForm(
  plainAnswersToFormValues({ ...WORKED_EXAMPLES[0]!.answers, '2': D }, policyRes.policy).values,
  '2026-10-01T00:00:00.000Z',
  () => 'id',
);
const answerState: FormAnswerState = {
  '1': { value: 'Name', source: { kind: 'typed' } },
  '11': { value: ['UK'], source: { kind: 'prefilled', quotes: [{ option: 'UK', quote: 'Our UK team' }], read: READ, confirmed: true } },
  '9': { value: 'yes', source: { kind: 'record', confirmed: false } },
};
const action = {
  type: 'OPEN_CORRECTION_FROM_RECORD' as const,
  useCaseId: 'uc-1',
  originalVerdictId: 'v-1',
  description: D,
  answerState,
  originalGraph: graph,
  assumptions: [],
};

describe('OPEN_CORRECTION_FROM_RECORD', () => {
  it('from a fresh intake opens the form as a correction, with every answer restored', () => {
    const next = intakeReducer({ step: 'description_entry', description: '' }, action);
    expect(next).toEqual({
      step: 'graph_extraction',
      description: D,
      method: 'form',
      useCaseId: 'uc-1',
      plainAnswers: { '1': 'Name', '9': 'yes', '11': ['UK'], '2': D },
      answerState,
      // Seeded so the unchanged description makes no model call (decision recorded in §27.10).
      lastRead: { fingerprint: textFingerprint(D), outcome: 'not-read' },
      assumptions: [],
      originalVerdictId: 'v-1',
      originalGraph: graph,
    });
  });

  it('also opens from the verdict step (the reload fallback of handleCorrectVerdict)', () => {
    const next = intakeReducer({ step: 'verdict', verdictId: 'uc-1' }, action);
    expect(next).toMatchObject({ step: 'graph_extraction', useCaseId: 'uc-1', originalVerdictId: 'v-1' });
  });

  it('Back is refused on the opened correction, and the state stays what it was', () => {
    const opened = intakeReducer({ step: 'description_entry', description: '' }, action);
    expect(intakeReducer(opened, { type: 'STEP_BACK' })).toBe(opened);
  });

  it('is refused while a confirmation is being evaluated (an in-flight write must not be abandoned)', () => {
    const pending = { step: 'evaluation_pending', useCaseId: 'uc-1', description: D } as unknown as IntakeState;
    expect(intakeReducer(pending, action)).toBe(pending);
  });

  it('does not share the answer state with the action (a later edit cannot reach back into the record)', () => {
    const next = intakeReducer({ step: 'description_entry', description: '' }, action);
    expect(next).toMatchObject({ plainAnswers: { '11': ['UK'] } });
    if (next.step !== 'graph_extraction') throw new Error('wrong step');
    (next.plainAnswers!['11'] as string[]).push('US');
    expect(answerState['11']!.value).toEqual(['UK']);
  });
});
