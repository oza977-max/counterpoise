// R18-C1 (specs/intake-flow.md §27.6, ADR-IF-R18-5) — the form's own rules as a pure module,
// extracted from StructuredForm with no behaviour change: which questions are shown, what a change
// clears, which option keys are current, whether a tick-all selection is allowed, how a pre-fill
// merges into the form's answers, and whether Continue is allowed. The form, the verifier and the
// old-case mapping all call it; none keeps a second copy. Pure: engine types and stdlib only.

import { toPlainAnswers } from './form-answer-state';
import { resolveAccessScopeAnswer } from './plain-intake';
import {
  QUESTION_STRUCTURE,
  REQUIRED_ORDER,
  isShown,
  structureFor,
  validOptionKeys as validKeys,
  FREE_ANSWER_MAX_CHARS,
} from './question-structure';
import type { PlainAnswers, QuestionId } from './plain-questions';
import type { FormAnswerState, Prefill, PrefillCatalogue, ReadRecord } from './prefill-types';
import type { PolicyFile } from './types';

export { toPlainAnswers };

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** The ids of the questions shown for these answers, in the form's order. */
export function shownQuestionIds(answers: PlainAnswers, policy: PolicyFile): QuestionId[] {
  return QUESTION_STRUCTURE.filter((q) => isShown(q.id, answers, policy)).map((q) => q.id);
}

/** The ids a change to `changedId` clears, given the answers AFTER the change. `before` (the answers
 *  before it) is needed only for the question that is cleared on a transition (3model). */
function dependentIds(changedId: QuestionId, answers: PlainAnswers, policy: PolicyFile, before?: PlainAnswers): QuestionId[] {
  const out: QuestionId[] = [...(structureFor(changedId)?.clearsOnChange ?? [])];
  for (const q of QUESTION_STRUCTURE) {
    if (q.shownWhen?.question !== changedId || out.includes(q.id)) continue;
    if (isShown(q.id, answers, policy)) continue;
    if (q.clearOnlyOnTransition && before && !isShown(q.id, before, policy)) continue;
    out.push(q.id);
  }
  return out;
}

/** The answers with everything that depended on `changedId` removed (a copy; the input is untouched). */
export function clearDependents(
  answers: PlainAnswers,
  changedId: QuestionId,
  policy: PolicyFile,
  before?: PlainAnswers,
): PlainAnswers {
  const next: PlainAnswers = { ...answers };
  for (const id of dependentIds(changedId, answers, policy, before)) delete next[id];
  return next;
}

/** The option keys the question offers right now (static + policy-driven; 3platformZone by the chosen platform). */
export function validOptionKeys(questionId: QuestionId, answers: PlainAnswers, policy: PolicyFile): string[] {
  return validKeys(questionId, answers, policy);
}

/** Whether a tick-all selection is allowed by the question's own rules: no repeats, and Question 13's
 *  "nothing beyond…" is not ticked with anything else (that question uses the engine's single checker).
 *  Membership in the current options is validOptionKeys' job. An empty selection is not a selection. */
export function isValidMultiSelection(questionId: QuestionId, keys: readonly string[]): boolean {
  if (keys.length === 0) return false;
  if (new Set(keys).size !== keys.length) return false;
  if (questionId === '13') return resolveAccessScopeAnswer([...keys]).ok;
  const exclusive = structureFor(questionId)?.exclusiveKey;
  return !(exclusive !== undefined && keys.includes(exclusive) && keys.length > 1);
}

function isAnswered(id: QuestionId, answers: PlainAnswers, policy: PolicyFile): boolean {
  if (id === '13') return resolveAccessScopeAnswer(toArray(answers['13'])).ok;
  const q = structureFor(id);
  if (q?.kind === 'multi') {
    const ticks = toArray(answers[id]);
    const valid = validKeys(id, answers, policy);
    return ticks.length > 0 && ticks.every((k) => valid.includes(k));
  }
  if (q?.kind === 'free') return Boolean((answers[id] as string | undefined)?.trim());
  const value = answers[id];
  if (value === undefined || value === '') return false;
  return validKeys(id, answers, policy).includes(String(value));
}

/** The shown questions that must be answered, in the order the form lists them. */
export function requiredQuestionIds(answers: PlainAnswers, policy: PolicyFile): QuestionId[] {
  return REQUIRED_ORDER.filter((id) => isShown(id, answers, policy));
}

/** The shown, required questions that are not answered yet, in the order the form lists them. */
export function missingQuestionIds(answers: PlainAnswers, policy: PolicyFile): QuestionId[] {
  return requiredQuestionIds(answers, policy).filter((id) => !isAnswered(id, answers, policy));
}

/** Continue is allowed when the description is not blank, every shown question that must be answered is,
 *  and every pre-filled and every earlier-record answer has been confirmed or changed. */
export function canContinue(answerState: FormAnswerState, description: string, policy: PolicyFile): boolean {
  const answers = toPlainAnswers(answerState, description);
  if (missingQuestionIds(answers, policy).length > 0) return false;
  for (const id of shownQuestionIds(answers, policy)) {
    if (id === '2') continue;
    const entry = answerState[id];
    if (!entry) continue;
    const source = entry.source;
    if ((source.kind === 'prefilled' || source.kind === 'record') && !source.confirmed) return false;
  }
  return true;
}

function sameValue(a: string | string[], b: string | string[]): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/**
 * Merges a new pre-fill into the form's answers (§27.6). Per catalogue question: a typed, changed,
 * confirmed pre-filled or earlier-record answer is kept untouched; a blank, not-carried or
 * unconfirmed pre-filled answer is replaced by the new pre-fill (or becomes blank if the new reply
 * gives nothing there); what depended on a changed answer is cleared; a hidden question's answer is
 * dropped. Walks the questions in the form's order with progressive answers, so a pre-fill for a
 * question that would not be shown is never kept. A copy; the input is untouched.
 *
 * `read` is the ReadRecord stamped on every new pre-filled answer (the spec's four-argument form has
 * nowhere else to take it from).
 */
export function mergePrefill(
  answerState: FormAnswerState,
  prefill: Prefill,
  catalogue: PrefillCatalogue,
  policy: PolicyFile,
  read: ReadRecord,
): FormAnswerState {
  const state: FormAnswerState = { ...answerState };
  delete state['2'];
  const plain = () => toPlainAnswers(state, '');
  for (const q of QUESTION_STRUCTURE) {
    if (q.id === '2') continue;
    const id = q.id as Exclude<QuestionId, '2'>;
    const old = state[id];
    const cataloguedQuestion = catalogue.get(q.id);
    if (cataloguedQuestion) {
      const kind = old?.source.kind;
      const kept =
        old !== undefined &&
        (kind === 'typed' || kind === 'changed' || kind === 'record' || (kind === 'prefilled' && old.source.kind === 'prefilled' && old.source.confirmed));
      if (!kept) {
        const found = prefill.get(q.id);
        const before = plain();
        // A found value counts only if every option is one the CURRENT merged answers offer (the question
        // order is the form's, so earlier merged answers are already in `before`): a zone read for platform
        // A is not written beside a typed platform B that does not allow it.
        const offered = found && found.values.length > 0 ? validKeys(q.id, before, policy) : [];
        const usable = found !== undefined && found.values.length > 0 && found.values.every((v) => offered.includes(v.option));
        if (found && usable) {
          const options = found.values.map((v) => v.option);
          state[id] = {
            value: cataloguedQuestion.kind === 'multi' ? options : options[0]!,
            source: { kind: 'prefilled', quotes: found.values.map((v) => ({ option: v.option, quote: v.quote })), read, confirmed: false },
          };
        } else if (old !== undefined && kind === 'prefilled') {
          delete state[id];
        }
        const now = state[id];
        const changed = (old === undefined) !== (now === undefined) || (old !== undefined && now !== undefined && !sameValue(old.value, now.value));
        if (changed) {
          const after = plain();
          for (const dep of dependentIds(q.id, after, policy, before)) delete state[dep as Exclude<QuestionId, '2'>];
        }
      }
    }
    // A hidden question holds no answer.
    if (!isShown(q.id, plain(), policy)) delete state[id];
  }
  return state;
}

/**
 * R18-C2 (§27.7, TC-R18-NF-5-03): the answers of an earlier build's saved case, as the form's answer
 * state. Walks the questions in the form's order; an answer is kept — always as `typed`, never as
 * confirmed or pre-filled — only if its question is shown for the answers kept so far and its value is
 * one the form offers now (a single key, a valid tick-all list, or non-blank free text within the form's
 * 200-character limit). Everything else is simply absent, so the form asks again. Question 2 is the
 * description and is never carried. Reads only own properties of `plain`, so a hostile key does nothing.
 */
export function typedAnswersFromPlain(plain: PlainAnswers, policy: PolicyFile): FormAnswerState {
  const out: FormAnswerState = {};
  const kept: PlainAnswers = {};
  const own = (id: QuestionId): unknown => (Object.prototype.hasOwnProperty.call(plain, id) ? plain[id] : undefined);
  for (const q of QUESTION_STRUCTURE) {
    if (q.id === '2' || !isShown(q.id, kept, policy)) continue;
    const value = own(q.id);
    let accepted: string | string[] | undefined;
    if (q.kind === 'free') {
      if (typeof value === 'string' && value.trim() !== '' && value.length <= FREE_ANSWER_MAX_CHARS) accepted = value;
    } else if (q.kind === 'single') {
      if (typeof value === 'string' && validKeys(q.id, kept, policy).includes(value)) accepted = value;
    } else if (
      Array.isArray(value) &&
      value.every((k) => typeof k === 'string') &&
      isValidMultiSelection(q.id, value as string[]) &&
      (value as string[]).every((k) => validKeys(q.id, kept, policy).includes(k))
    ) {
      accepted = [...(value as string[])];
    }
    if (accepted === undefined) continue;
    kept[q.id] = accepted;
    out[q.id as Exclude<QuestionId, '2'>] = { value: accepted, source: { kind: 'typed' } };
  }
  return out;
}
