import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ACCESS_SCOPE_REFUSAL_TEXT,
  INTRO_TEXT,
  describeAssumptions,
  findQuestion,
  neutralPlatformLabel,
  neutralSupplierLabel,
  R18_COPY,
} from './plain-copy';
import type { Assumption, PlainAnswers, PlainOption, QuestionId } from './plain-copy';
import { plainAnswersToFormValues, resolveAccessScopeAnswer } from '../engine/plain-intake';
import { canContinue, clearDependents, missingQuestionIds, requiredQuestionIds, shownQuestionIds, validOptionKeys } from '../engine/form-visibility';
import { FREE_ANSWER_MAX_CHARS, structureFor } from '../engine/question-structure';
import { buildGraphFromForm } from '../engine/build-graph-from-form';
import { updateFormDraft, loadFormDraft, probeLegacyFormDraft } from './intake-draft';
import { toPlainAnswers } from '../engine/form-answer-state';
import type { AnswerSource, FormAnswerState } from '../engine/prefill-types';
import { originalPrefilled, unconfirmedIds } from '../engine/answer-sources';
import AnswerMark from './AnswerMark';
import RatingInstructionNotice from './RatingInstructionNotice';
import type { DataFlowGraph, PolicyFile } from '../engine/types';

// R16-B (UC-8, UC-10, UC-11; build/prompts/R16.md v2.1 §2.2). Rule 4
// (cross-cutting.md §7): presentation-only — every answer->graph decision
// lives in plainAnswersToFormValues() (src/engine/plain-intake.ts), this
// component only renders questions and collects answers.
//
// Replaces the field-by-field form entirely (UC-3a amendment, 2026-10-02):
// no question or option here names an engine term or code — data class,
// zone, autonomy level, bindingness, model type, tier, track (principle 1,
// §0). The situational questions below are the tested v2.1 set; see
// grounding/PACK-AUTHORING.md's sibling note for why the wording is not
// paraphrased from the contract.
//
// IMPORTANT: SingleSelect/MultiSelect/FreeText/RequiredMark are declared at
// MODULE scope, not nested inside StructuredForm(). A component defined
// inside another component's render body gets a NEW function identity every
// render, which React treats as a different component TYPE — so it tears
// down and recreates the DOM subtree (including every input) on every
// keystroke, dropping focus after the first character. That is a real bug
// this chunk hit directly (every answer field went blank after one
// keystroke in testing) and fixed by hoisting these out.

interface StructuredFormProps {
  policy: PolicyFile;
  // R18-A (specs/intake-flow.md §27.6): Question 2 is the editor of THE
  // description — the form receives it and reports every change, and keeps no
  // copy of its own. The intake flow passes both; a form rendered on its own (the
  // unit tests) may omit them and then holds the text locally, starting from
  // `initialDescription`.
  description?: string;
  onDescriptionChange?: (description: string) => void;
  initialDescription?: string;
  // The reducer's own copy of the answers (present after a trip away from the
  // form, e.g. "Change an answer"). Precedence on mount: the form's own saved
  // draft (strictly newer: what the person was doing on this exact screen) ->
  // this -> initialAnswers -> blank.
  initialAnswerState?: FormAnswerState;
  // W-4 (R16-W §1, D-70): the same, as PlainAnswers. Read only when no answer
  // state is given; every value becomes a `typed` answer, and Question 2 is
  // ignored (it is the description).
  initialAnswers?: PlainAnswers;
  // R18-NF-5: this form was reached from a draft saved by an earlier version.
  earlierVersionNotice?: boolean;
  // The answers travel as the form's own state object; the caller derives
  // PlainAnswers from it (toPlainAnswers) — there is one source of truth.
  onSubmit: (graph: DataFlowGraph, assumptions: Assumption[], answerState: FormAnswerState, description: string) => void;
}

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** D-23: a platform or supplier without a plain_name must never fall back
 *  to its raw registry `name` (which may itself carry the bare `[FIRM]`
 *  placeholder) — it gets this neutral, numbered label instead. */
function dynamicOptions(
  entries: { id: string; plain_name?: string }[],
  neutral: (n: number) => string,
): PlainOption[] {
  return entries.map((e, i) => ({ key: e.id, text: e.plain_name ?? neutral(i + 1) }));
}

function RequiredMark({ id, requiredIds, announce = true }: { id: QuestionId; requiredIds: QuestionId[]; announce?: boolean }) {
  return requiredIds.includes(id) ? (
    <span className="required-marker" title="Required">
      {' '}
      <span aria-hidden="true">*</span>
      {/* CR6-07: the asterisk alone is a glyph for sighted users; this is
          what assistive technology reads. */}
      {announce && <span className="visually-hidden"> (required)</span>}
    </span>
  ) : null;
}

interface QuestionProps {
  id: QuestionId;
  extraOptions?: PlainOption[];
  /** Where `extraOptions` are spliced relative to the question's own static
   *  options — undefined prepends (the common case: every dynamic list in
   *  §2.2 other than Q3's sits before or after the WHOLE static list, never
   *  in the middle). Q3 is the one exception: its platform option is
   *  documented as option (d), between the static (c) and (e) — spliced at
   *  this index into `question.options` instead of prepended, so the
   *  rendered order matches the newcomer-tested a/b/c/d/e/f sequence. */
  extraOptionsAtIndex?: number;
  /** W-9 (R16-W §1, D-79): restricts a STATIC option list down to a subset
   *  by key, in the question's own declared order — Q3platformZone's four
   *  options are all static text; only WHICH of them show depends on the
   *  chosen platform's allowed zones (plain-intake.ts's
   *  platformZoneOptionKeys()). Undefined (every other question) renders
   *  the full static list, unfiltered — the pre-existing behaviour. */
  restrictToKeys?: string[];
  requiredIds: QuestionId[];
  answers: PlainAnswers;
  onSingle: (id: QuestionId, key: string) => void;
  onMulti: (id: QuestionId, key: string) => void;
  onText: (id: QuestionId, text: string) => void;
  /** R18-C2: where this answer came from, and its tick (null for a typed answer). */
  markFor: (id: QuestionId) => ReactNode;
}

function mergeOptions(base: PlainOption[], extra: PlainOption[], atIndex?: number): PlainOption[] {
  if (extra.length === 0) return base;
  if (atIndex === undefined) return [...extra, ...base];
  return [...base.slice(0, atIndex), ...extra, ...base.slice(atIndex)];
}

function SingleSelect({
  id,
  extraOptions = [],
  extraOptionsAtIndex,
  restrictToKeys,
  requiredIds,
  answers,
  onSingle,
  markFor,
}: QuestionProps) {
  const question = findQuestion(id);
  if (!question) return null;
  const baseOptions = restrictToKeys ? question.options.filter((o) => restrictToKeys.includes(o.key)) : question.options;
  const options = mergeOptions(baseOptions, extraOptions, extraOptionsAtIndex);
  return (
    <fieldset
      className="plain-form__question"
      role="radiogroup"
      aria-labelledby={`pf-${id}-legend`}
      aria-required={requiredIds.includes(id) || undefined}
    >
      <legend id={`pf-${id}-legend`}>
        {question.text}
        {/* CR6-07e: aria-required on the radiogroup announces "required";
            the hidden text would say it a second time. */}
        <RequiredMark id={id} requiredIds={requiredIds} announce={false} />
      </legend>
      {question.help && <p className="field-help">{question.help}</p>}
      {/* CR6-07/07e: the fieldset itself is the radiogroup (a plain fieldset's
          "group" role does not support aria-required). */}
      <div>
        {options.map((o) => (
          <label key={o.key} className="plain-form__option">
            <input
              type="radio"
              name={`pf-${id}`}
              value={o.key}
              checked={answers[id] === o.key}
              onChange={() => onSingle(id, o.key)}
            />
            {o.text}
          </label>
        ))}
      </div>
      {markFor(id)}
    </fieldset>
  );
}

function MultiSelect({ id, extraOptions = [], requiredIds, answers, onMulti, markFor }: QuestionProps) {
  const question = findQuestion(id);
  if (!question) return null;
  const options = [...extraOptions, ...question.options];
  const current = toArray(answers[id]);
  return (
    <fieldset className="plain-form__question">
      <legend>
        {question.text}
        {/* CR6-07: a tick-all group has no "required" role state, so say it. */}
        {requiredIds.includes(id) && <span className="plain-form__tick-hint"> (tick at least one)</span>}
        <RequiredMark id={id} requiredIds={requiredIds} />
      </legend>
      {question.help && <p className="field-help">{question.help}</p>}
      {options.map((o) => (
        <label key={o.key} className="plain-form__option">
          <input type="checkbox" checked={current.includes(o.key)} onChange={() => onMulti(id, o.key)} />
          {o.text}
        </label>
      ))}
      {markFor(id)}
    </fieldset>
  );
}

/** R18-B (§27.8): typed free-text answers are limited so every value fits the record's bounds (§27.13). */
export const FREE_TEXT_MAX_CHARS = FREE_ANSWER_MAX_CHARS;

/** Cuts a restored free-text answer to the limit (never in the middle of a surrogate pair). */
function clampFreeText(text: string): string {
  if (text.length <= FREE_TEXT_MAX_CHARS) return text;
  let end = FREE_TEXT_MAX_CHARS;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

const LIMITED_FREE_TEXT_IDS = ['1', '3supplierName', '3model', '8other'] as const;

/** An older draft may hold a longer answer than this build allows; cut it so this build's own export always fits §27.13. */
function clampRestored(state: FormAnswerState): FormAnswerState {
  let out = state;
  for (const id of LIMITED_FREE_TEXT_IDS) {
    const entry = out[id];
    if (entry && typeof entry.value === 'string' && entry.value.length > FREE_TEXT_MAX_CHARS) {
      if (out === state) out = { ...state };
      out[id] = { ...entry, value: clampFreeText(entry.value) };
    }
  }
  return out;
}

function FreeText({
  id,
  multiline = false,
  requiredIds,
  answers,
  onText,
  markFor,
}: QuestionProps & { multiline?: boolean }) {
  const question = findQuestion(id);
  if (!question) return null;
  const value = (answers[id] as string | undefined) ?? '';
  const inputId = `pf-${id}`;
  const isRequired = requiredIds.includes(id);
  return (
    <div className="plain-form__question">
      <label htmlFor={inputId}>
        {question.text}
        <RequiredMark id={id} requiredIds={requiredIds} />
      </label>
      {question.help && <p className="field-help">{question.help}</p>}
      {multiline ? (
        <textarea id={inputId} value={value} required={isRequired} aria-required={isRequired || undefined} onChange={(e) => onText(id, e.target.value)} />
      ) : (
        <>
          <input id={inputId} type="text" maxLength={FREE_TEXT_MAX_CHARS} aria-describedby={`${inputId}-limit`} value={value} required={isRequired} aria-required={isRequired || undefined} onChange={(e) => onText(id, e.target.value)} />
          <p className="field-help" id={`${inputId}-limit`}>{R18_COPY.FREE_TEXT_LIMIT_HINT}</p>
        </>
      )}
      {markFor(id)}
    </div>
  );
}

/** An earlier PlainAnswers (a resubmission through the old props) as the form's
 *  state: every answer `typed`; Question 2 is the description, not an answer. */
function typedFromPlain(plain: PlainAnswers | undefined): FormAnswerState {
  const out: FormAnswerState = {};
  if (!plain) return out;
  for (const key of Object.keys(plain) as QuestionId[]) {
    const value = plain[key];
    if (key === '2' || value === undefined) continue;
    out[key as Exclude<QuestionId, '2'>] = { value: Array.isArray(value) ? [...value] : value, source: { kind: 'typed' } };
  }
  return out;
}

function sameValue(a: string | string[], b: string | string[]): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
  }
  return a === b;
}

/** The same set of option keys, in any order (a tick-all answer is a set). */
function sameSet(a: string | string[], b: string[]): boolean {
  const left = toArray(a);
  return left.length === b.length && left.every((x) => b.includes(x)) && b.every((x) => left.includes(x));
}

/** The source of an answer after the person set it to `value` (§27.6 "Changing"). A change to a pre-filled
 *  answer is a confirmation of its own, so it becomes `changed`; changing it back to what was read returns it to
 *  `prefilled`, confirmed (the person looked and chose that value). A record answer and a not-carried answer
 *  become `typed`: the person now supplied them. */
function nextEntry(
  before: FormAnswerState[Exclude<QuestionId, '2'>],
  value: string | string[],
): { value: string | string[]; source: AnswerSource } {
  const copy = Array.isArray(value) ? [...value] : value;
  if (!before) return { value: copy, source: { kind: 'typed' } };
  const source = before.source;
  switch (source.kind) {
    case 'prefilled': {
      if (sameValue(before.value, value) || sameSet(value, toArray(before.value))) return before;
      return { value: copy, source: { kind: 'changed', from: source.quotes, read: source.read } };
    }
    case 'changed': {
      const original = originalPrefilled(source) ?? [];
      if (sameSet(value, original)) {
        // Back to what was read: the original value (in its own order), confirmed.
        return {
          value: Array.isArray(before.value) || original.length > 1 ? [...original] : original[0]!,
          source: { kind: 'prefilled', quotes: source.from, read: source.read, confirmed: true },
        };
      }
      return { value: copy, source };
    }
    case 'record':
    case 'not-carried':
      return sameValue(before.value, value) && source.kind === 'record' ? before : { value: copy, source: { kind: 'typed' } };
    case 'typed':
      return sameValue(before.value, value) ? before : { value: copy, source };
  }
}

/** Removes the answers of questions that are not shown: a hidden question holds no answer and no source. */
function dropHidden(state: FormAnswerState, policy: PolicyFile): FormAnswerState {
  const shown = new Set(shownQuestionIds(toPlainAnswers(state, ''), policy));
  let out = state;
  for (const key of Object.keys(state) as Exclude<QuestionId, '2'>[]) {
    if (!shown.has(key)) {
      if (out === state) out = { ...state };
      delete out[key];
    }
  }
  return out;
}

/** Turns the answers after a change back into state, giving each answer the source it now has (see nextEntry),
 *  keeping an untouched not-carried marker, and dropping whatever the change hid. */
function reconcile(next: PlainAnswers, prev: FormAnswerState, policy: PolicyFile): FormAnswerState {
  const out: FormAnswerState = {};
  for (const key of Object.keys(next) as QuestionId[]) {
    const value = next[key];
    if (key === '2' || value === undefined) continue;
    const id = key as Exclude<QuestionId, '2'>;
    out[id] = nextEntry(prev[id], value);
  }
  // toPlainAnswers leaves a not-carried answer out (it is blank); it stays on the screen until answered.
  for (const key of Object.keys(prev) as Exclude<QuestionId, '2'>[]) {
    if (prev[key]?.source.kind === 'not-carried' && out[key] === undefined) out[key] = prev[key];
  }
  return dropHidden(out, policy);
}

export default function StructuredForm({
  policy,
  description,
  onDescriptionChange,
  initialDescription,
  initialAnswerState,
  initialAnswers,
  earlierVersionNotice = false,
  onSubmit,
}: StructuredFormProps) {
  const platformOptions = dynamicOptions(policy.platforms ?? [], neutralPlatformLabel);
  const supplierOptions = dynamicOptions(
    (policy.vendors ?? []).filter((v) => (v.kind ?? 'supplier') === 'supplier'),
    neutralSupplierLabel,
  );
  const companyAssistantOptions = dynamicOptions(
    (policy.vendors ?? []).filter((v) => v.kind === 'company_assistant'),
    neutralSupplierLabel,
  );
  const jurisdictionOptions: PlainOption[] = (policy.jurisdictions ?? []).map((j) => ({
    key: j.code,
    text: j.name,
  }));

  // D-41, extended in R18-A: probe the OLD draft keys (both) once, before first
  // paint, and never again — an incompatible shape must be reported once and then
  // be gone, not re-detected on every render.
  const legacyRef = useRef<boolean | null>(null);
  if (legacyRef.current === null) legacyRef.current = probeLegacyFormDraft();
  const [legacyDraftFound] = useState(legacyRef.current);

  // R18-A (§27.6). The form's answers are ONE state object, `FormAnswerState`,
  // with a source on every answer (`typed` here: a person supplied each). Question
  // 2 is not in it. Precedence on mount (W-1/W-4): the form's own saved draft ->
  // the reducer's copy -> initialAnswers -> blank. The baseline's stale
  // `restoredRef.current['2']` precedence is gone with Question 2's own copy.
  const restoredRef = useRef<FormAnswerState | null>(null);
  if (restoredRef.current === null) {
    restoredRef.current = dropHidden(
      clampRestored(loadFormDraft()?.answerState ?? initialAnswerState ?? typedFromPlain(initialAnswers)),
      policy,
    );
  }
  const [answerState, setAnswerState] = useState<FormAnswerState>(restoredRef.current);
  const [localDescription, setLocalDescription] = useState(description ?? initialDescription ?? '');
  const currentDescription = onDescriptionChange ? (description ?? '') : localDescription;

  // PlainAnswers is the engine-facing shape, derived here and nowhere kept.
  const answers: PlainAnswers = toPlainAnswers(answerState, currentDescription);

  useEffect(() => {
    updateFormDraft({ answerState });
  }, [answerState]);

  // Applies a change written in terms of PlainAnswers (the form's rules are
  // unchanged) and keeps each untouched answer's source as it was.
  function updateAnswers(change: (prev: PlainAnswers) => PlainAnswers) {
    setAnswerState((prev) => reconcile(change(toPlainAnswers(prev, '')), prev, policy));
  }

  function setSingle(id: QuestionId, key: string) {
    // Conditional follow-ups are cleared when their trigger changes (§2.2 Details:
    // "follow-ups are required when shown and cleared when their trigger changes").
    // The rule lives in form-visibility.ts (CR7-04's model name, W-9's platform zone
    // and the rest); `prev` lets it tell a move between two answers that both ask for
    // the model name from one that stops asking.
    updateAnswers((prev) => clearDependents({ ...prev, [id]: key }, id, policy, prev));
  }

  function setText(id: QuestionId, text: string) {
    // Question 2 is the editor of the description (§27.6), not a stored answer.
    if (id === '2') {
      if (onDescriptionChange) onDescriptionChange(text);
      else setLocalDescription(text);
      return;
    }
    updateAnswers((prev) => ({ ...prev, [id]: text }));
  }

  function toggleMulti(id: QuestionId, key: string) {
    updateAnswers((prev) => {
      const current = toArray(prev[id]);
      const exclusive = structureFor(id)?.exclusiveKey;
      let next: string[];
      if (exclusive !== undefined) {
        // Question 13: "nothing beyond…" replaces every other tick and is replaced by any.
        if (key === exclusive) {
          next = current.includes(exclusive) ? [] : [exclusive];
        } else {
          const without = current.filter((k) => k !== exclusive);
          next = without.includes(key) ? without.filter((k) => k !== key) : [...without, key];
        }
      } else {
        // CR6-06e: a stale tick can't be unticked (it isn't rendered), so
        // any toggle drops keys that are no longer current options — the
        // person re-picks from what is on screen.
        const valid = validOptionKeys(id, prev, policy);
        const live = current.filter((k) => valid.includes(k));
        next = live.includes(key) ? live.filter((k) => k !== key) : [...live, key];
      }
      return { ...prev, [id]: next };
    });
  }

  // ---- visibility and required-ness: the rules are in form-visibility.ts ----
  const shown = new Set(shownQuestionIds(answers, policy));
  const showQ3Supplier = shown.has('3supplier');
  const showQ3Model = shown.has('3model');
  const showQ3a = shown.has('3a');
  const show3supplierName = shown.has('3supplierName');
  const show3aWhich = shown.has('3aWhich');
  const showQ3platformZone = shown.has('3platformZone');
  const q3platformZoneKeys = validOptionKeys('3platformZone', answers, policy);
  const showQ4a = shown.has('4a');
  const isAgentic = shown.has('13');
  const showQ6a = shown.has('6a');
  const showQ6b = shown.has('6b');
  const showQ8other = shown.has('8other');

  // F-8 (DR7-08): Q13 is answered only when its ticks resolve through the single
  // checker — the same function the mapping itself calls (here, for the message).
  const q13Result = resolveAccessScopeAnswer(toArray(answers['13']));

  const requiredIds: QuestionId[] = requiredQuestionIds(answers, policy);

  const missingIds = missingQuestionIds(answers, policy);
  // R18-C2 (§27.6): Continue also waits for every pre-filled and every earlier-record answer to be confirmed
  // or changed, and for a description that is not blank.
  const isComplete = canContinue(answerState, currentDescription, policy);
  const toCheckIds = unconfirmedIds(answerState, currentDescription, policy);
  // CR6-07: what is still missing, in the form's own words — the first few,
  // then a count — shown beside Continue and tied to it with aria-describedby.
  // CR6-07d: strip each item's own trailing stop so the line has no doubled
  // punctuation, and give the count its noun.
  // TC-CR6-07f (live walkthrough): name each question by its FIRST sentence
  // only — some carry help text after it ("…? If more than one fits — …").
  const missingTexts = missingIds.map((id) =>
    (findQuestion(id)?.text ?? id).split(/(?<=[.?!])\s/)[0]!.replace(/[\s.?!;:]+$/, ''),
  );
  const toCheckTexts = toCheckIds.map((id) =>
    (findQuestion(id)?.text ?? id).split(/(?<=[.?!])\s/)[0]!.replace(/[\s.?!;:]+$/, ''),
  );
  const toCheckLine = toCheckTexts.join('; ');
  const missingLine =
    missingTexts.length <= 3
      ? missingTexts.join('; ')
      : `${missingTexts.slice(0, 3).join('; ')}; and ${missingTexts.length - 3} more question${missingTexts.length - 3 === 1 ? '' : 's'}`;

  function handleSubmit() {
    if (!isComplete) return;
    const { values, assumptions } = plainAnswersToFormValues(answers, policy);
    // CR7-13: the saved form answers are NOT cleared here. The policy check
    // (IntakeFlow.handleFormSubmitted) can still refuse this submit, and a
    // person whose answers were wiped before that check lost them for good.
    // IntakeFlow clears the form draft right after FORM_SUBMITTED is accepted.
    // R16-F §5 (DR7-06): the engine returns assumption REFERENCES; this is
    // the one, immediate conversion to the worded `Assumption[]` onSubmit's
    // callers (and the reducer state they carry) still expect.
    // B-15: the engine no longer mints its own timestamp — this component
    // is presentation-only, not the engine, so minting it here (React/I-O
    // territory) rather than inside src/engine/* is exactly where
    // cross-cutting.md §7 Rule 1 puts it. ENG-ID: the same goes for the ids —
    // the engine draws every graph id from the source passed here.
    onSubmit(
      buildGraphFromForm(values, new Date().toISOString(), () => crypto.randomUUID()),
      describeAssumptions(assumptions),
      answerState,
      currentDescription,
    );
  }

  // Bundles the props every question renderer needs, so each call site below
  // stays a one-liner.
  // R18-C2: a tick confirms ONE answer (a pre-filled or earlier-record answer); there is no other way to
  // confirm and no control that does several at once.
  function toggleConfirm(id: QuestionId) {
    if (id === '2') return;
    setAnswerState((prev) => {
      const entry = prev[id];
      if (!entry) return prev;
      const source = entry.source;
      if (source.kind !== 'prefilled' && source.kind !== 'record') return prev;
      return { ...prev, [id]: { ...entry, source: { ...source, confirmed: !source.confirmed } } };
    });
  }
  const dynamicLists = [...platformOptions, ...supplierOptions, ...companyAssistantOptions, ...jurisdictionOptions];
  const optionTextFor = (id: QuestionId) => (key: string) =>
    findQuestion(id)?.options.find((o) => o.key === key)?.text ?? dynamicLists.find((o) => o.key === key)?.text ?? key;
  const markFor = (id: QuestionId): ReactNode => {
    if (id === '2') return null;
    const entry = answerState[id];
    if (!entry) return null;
    const label = (findQuestion(id)?.text ?? id).split(/(?<=[.?!])\s/)[0]!.replace(/[\s.?!;:]+$/, '');
    return (
      <AnswerMark
        questionLabel={label}
        source={entry.source}
        description={currentDescription}
        optionText={optionTextFor(id)}
        multi={structureFor(id)?.kind === 'multi'}
        onToggleConfirm={() => toggleConfirm(id)}
      />
    );
  };
  const qp = { requiredIds, answers, onSingle: setSingle, onMulti: toggleMulti, onText: setText, markFor };

  return (
    <section aria-label="Structured intake form">
      {/* W-2 (R16-W §1, D-68): the old "Guided intake — answer the fields
          below…" paragraph (and its Settings parenthetical) duplicated the
          approved R16 intro below it — two stacked introductions on a
          newcomer's first screen of the form. Deleted; the approved intro
          keeps its exact words, with one new sentence added after it. */}
      <p className="plain-form__intro">{INTRO_TEXT}</p>
      <p className="plain-form__intro">
        No AI reads your answers or makes the decision, so the same answers always get the same
        result.
      </p>
      {/* R18-NF-5: a draft saved by an earlier version landed here with the
          description kept and no answers; say so, once (computed at load, never
          stored). When an earlier form-draft key was also found, the one sentence
          covers both. */}
      {earlierVersionNotice ? (
        <p role="status" className="plain-form__legacy-draft">
          {R18_COPY.EARLIER_VERSION_NOTICE}
        </p>
      ) : (
        legacyDraftFound && (
          <p role="status" className="plain-form__legacy-draft">
            Your saved draft was from an older version of this form and couldn&rsquo;t be reused — please
            start again.
          </p>
        )
      )}

      <fieldset className="structured-form__section">
        <legend>About it</legend>
        <FreeText id="1" {...qp} />
        <FreeText id="2" multiline {...qp} />
        {/* R18-C2 (§27.4): a description that dictates its own rating is warned wherever it is shown. */}
        <RatingInstructionNotice description={currentDescription} />
      </fieldset>

      <fieldset className="structured-form__section">
        <legend>Where it comes from</legend>
        <SingleSelect id="3" extraOptions={platformOptions} extraOptionsAtIndex={3} {...qp} />
        {showQ3platformZone && <SingleSelect id="3platformZone" restrictToKeys={q3platformZoneKeys} {...qp} />}
        {showQ3Supplier && <SingleSelect id="3supplier" extraOptions={supplierOptions} {...qp} />}
        {show3supplierName && <FreeText id="3supplierName" {...qp} />}
        {showQ3Model && <FreeText id="3model" {...qp} />}
        {showQ3a && <SingleSelect id="3a" {...qp} />}
        {show3aWhich && <SingleSelect id="3aWhich" extraOptions={companyAssistantOptions} {...qp} />}
      </fieldset>

      <fieldset className="structured-form__section">
        <legend>What it does</legend>
        <SingleSelect id="4" {...qp} />
        {showQ4a && <SingleSelect id="4a" {...qp} />}
        <MultiSelect id="5" {...qp} />
        <SingleSelect id="6" {...qp} />
        {showQ6a && <SingleSelect id="6a" {...qp} />}
        {showQ6b && <SingleSelect id="6b" {...qp} />}
        <SingleSelect id="7" {...qp} />
      </fieldset>

      <fieldset className="structured-form__section">
        <legend>Decisions and safeguards</legend>
        <SingleSelect id="8" {...qp} />
        {showQ8other && <FreeText id="8other" {...qp} />}
        <SingleSelect id="9" {...qp} />
        <SingleSelect id="12" {...qp} />
        {isAgentic && <MultiSelect id="13" {...qp} />}
        {/* F-8 (DR7-08): a refusal from the single checker becomes a
            validation message here, never a silent "not stated". Shown only
            while something is ticked: nothing ticked (untouched, or every
            tick removed) is just "not answered yet", which the required
            marker already says. Plain words, never the engine's reason. */}
        {isAgentic && toArray(answers['13']).length > 0 && !q13Result.ok && (
          <p role="alert" className="field-help field-help--error">
            {ACCESS_SCOPE_REFUSAL_TEXT}
          </p>
        )}
        {isAgentic && <SingleSelect id="14" {...qp} />}
      </fieldset>

      <fieldset className="structured-form__section">
        <legend>Scope and countries</legend>
        <SingleSelect id="10" {...qp} />
        <MultiSelect id="11" extraOptions={jurisdictionOptions} {...qp} />
      </fieldset>

      <p className="structured-form__scroll-note">One continuous scroll — no Next/Back paging.</p>

      {missingIds.length > 0 && (
        <p id="pf-missing" className="plain-form__missing">
          Still to answer: {missingLine}.
        </p>
      )}
      {toCheckIds.length > 0 && (
        <p id="pf-to-check" className="plain-form__missing">
          {R18_COPY.STILL_TO_CHECK} {toCheckLine}.
        </p>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isComplete}
        aria-describedby={
          isComplete
            ? undefined
            : [missingIds.length > 0 ? 'pf-missing' : null, toCheckIds.length > 0 ? 'pf-to-check' : null].filter(Boolean).join(' ') || undefined
        }
      >
        Continue
      </button>
    </section>
  );
}

// Exported for StructuredForm.test.tsx and the parity test only — not part
// of the component's own render path. Lets both resolve the dynamic
// platform/vendor/jurisdiction option lists the same way the component
// does, without duplicating the policy-reading logic above.
export function buildDynamicOptions(policy: PolicyFile) {
  return {
    platforms: dynamicOptions(policy.platforms ?? [], neutralPlatformLabel),
    suppliers: dynamicOptions(
      (policy.vendors ?? []).filter((v) => (v.kind ?? 'supplier') === 'supplier'),
      neutralSupplierLabel,
    ),
    companyAssistants: dynamicOptions(
      (policy.vendors ?? []).filter((v) => v.kind === 'company_assistant'),
      neutralSupplierLabel,
    ),
    jurisdictions: (policy.jurisdictions ?? []).map((j) => ({ key: j.code, text: j.name })) as PlainOption[],
  };
}
