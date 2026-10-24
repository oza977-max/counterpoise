// R18-E (specs/intake-flow.md §27.10, "An older case") - the form's answers for a case saved by a build BEFORE
// Round 18. Engine island: engine types and stdlib only; no React, no store, no clock.
//
// Such a case has no `answer_sources` and the register keeps no graph, so the recorded facts are only the
// description and the "Not sure" assumptions of its confirmation (each names its question). Nothing is guessed
// from a graph that was never kept:
//   - each recorded "Not sure" comes back as THAT answer, a `record` answer, UNCONFIRMED (owner decision
//     2026-10-22: nothing restored from a record comes back confirmed - the record can be self-asserted);
//   - every other question the form shows comes back BLANK and marked `not-carried`;
//   - a question the form would not show (for the answers restored so far) has no entry.
// The record is untrusted input (a saved case, or a hand-off file someone else made), so it is read with the same
// discipline as answersFromRecord: bounded, ids looked up in a Set, only the id of a row is ever used, the first
// row for a question wins, unknown ids and prototype keys are ignored, and the input is never changed.

import { isValidMultiSelection } from './form-visibility';
import { isShown, QUESTION_STRUCTURE, validOptionKeys } from './question-structure';
import type { PlainAnswers, QuestionId } from './plain-questions';
import type { FormAnswerState } from './prefill-types';
import type { PolicyFile } from './types';

const MAX_ROWS = 40;
const MAX_ID = 40;

/** The option key that is a question's own "Not sure" (or "I don't know"). A closed table: a question that is not
 *  listed has no such answer, and a recorded assumption naming it cannot be put back. */
const NOT_SURE_KEY: ReadonlyMap<string, string> = new Map([
  ['3', 'not-sure'],
  ['3supplier', 'dont-know'],
  ['3a', 'not-sure'],
  ['3aWhich', 'not-sure'],
  ['3platformZone', 'not-sure'],
  ['4', 'not-sure'],
  ['5', 'not-sure'],
  ['6', 'not-sure'],
  ['6a', 'not-sure'],
  ['7', 'not-sure'],
  ['9', 'not-sure'],
  ['11', 'elsewhere-not-sure'],
  ['12', 'not-sure'],
  ['13', 'not-sure'],
  ['14', 'not-sure'],
]);

/** The question ids the record's assumptions name: strings of a sane length, the first MAX_ROWS rows only. */
function namedQuestions(assumptions: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(assumptions)) return ids;
  for (const row of assumptions.slice(0, MAX_ROWS)) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue;
    const id = (row as { questionId?: unknown }).questionId;
    if (typeof id === 'string' && id.length <= MAX_ID) ids.add(id);
  }
  return ids;
}

/** The form's answers for an older case (see the file header). The description is not an input: it is the form's
 *  Question 2 and the caller keeps it as it is. `dropped` names, in the form's order, the
 *  questions the record said "Not sure" about which could not be put back (the form does not show that question
 *  for the answers restored, or offers no such answer), so the person can be told. Pure and deterministic. */
export function olderCaseAnswers(
  assumptions: unknown,
  policy: PolicyFile,
): { answerState: FormAnswerState; dropped: string[] } {
  const named = namedQuestions(assumptions);
  const out: FormAnswerState = {};
  const dropped: string[] = [];
  const kept: PlainAnswers = {};
  for (const q of QUESTION_STRUCTURE) {
    if (q.id === '2') continue;
    const id = q.id as Exclude<QuestionId, '2'>;
    const recorded = named.has(id);
    if (!isShown(id, kept, policy)) {
      if (recorded) dropped.push(id);
      continue;
    }
    const key = NOT_SURE_KEY.get(id);
    const value = key === undefined ? null : q.kind === 'multi' ? [key] : key;
    const fits =
      recorded &&
      value !== null &&
      key !== undefined &&
      validOptionKeys(id, kept, policy).includes(key) &&
      (q.kind !== 'multi' || isValidMultiSelection(id, [key]));
    if (fits && value !== null) {
      out[id] = { value: Array.isArray(value) ? [...value] : value, source: { kind: 'record', confirmed: false } };
      kept[id] = Array.isArray(value) ? [...value] : value;
      continue;
    }
    if (recorded) dropped.push(id);
    out[id] = { value: q.kind === 'multi' ? [] : '', source: { kind: 'not-carried' } };
  }
  return { answerState: out, dropped };
}
