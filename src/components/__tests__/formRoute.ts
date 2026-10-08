import { saveDraft, updateFormDraft } from '../intake-draft';
import type { IntakeState } from '../intake-state';
import type { FormAnswerState } from '../../engine/prefill-types';
import type { PlainAnswers, QuestionId } from '../../engine/plain-questions';
import { WORKED_EXAMPLES } from '../../engine/worked-examples';

// R18-A: test seam for "the person is on the guided form with these answers
// already in it", the same state a refresh on the form restores. Built from the
// real producers: the intake draft is written by saveDraft (a version-4 envelope),
// the answers by updateFormDraft, and the answer sets are the scripted
// WORKED_EXAMPLES. Question 2 is the description, never a form answer.

/** The form's answer-state for scripted PlainAnswers: every answer typed, no question 2. */
export function typedAnswerState(answers: PlainAnswers): FormAnswerState {
  const out: FormAnswerState = {};
  for (const key of Object.keys(answers) as QuestionId[]) {
    if (key === '2') continue;
    const value = answers[key];
    if (value === undefined) continue;
    out[key as Exclude<QuestionId, '2'>] = {
      value: Array.isArray(value) ? [...value] : value,
      source: { kind: 'typed' },
    };
  }
  return out;
}

/** The scripted answers of worked example `n` (1-based). */
export function workedAnswers(n: number): PlainAnswers {
  const example = WORKED_EXAMPLES[n - 1];
  if (!example) throw new Error(`no worked example ${n}`);
  return example.answers;
}

/** Leave sessionStorage as it would be on the guided form, answers filled in. */
export function seedFormRoute(description: string, answers: PlainAnswers, extra: Record<string, unknown> = {}): void {
  saveDraft({ step: 'graph_extraction', description, method: 'form', ...extra } as IntakeState);
  updateFormDraft({ answerState: typedAnswerState(answers) });
}
