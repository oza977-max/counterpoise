import { useEffect, useRef, useState } from 'react';
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
import { plainAnswersToFormValues, platformZoneOptionKeys, q3ShowsModelQuestion, resolveAccessScopeAnswer } from '../engine/plain-intake';
import { buildGraphFromForm } from '../engine/build-graph-from-form';
import { updateFormDraft, loadFormDraft, probeLegacyFormDraft } from './intake-draft';
import { toPlainAnswers } from '../engine/form-answer-state';
import type { FormAnswerState } from '../engine/prefill-types';
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
    </fieldset>
  );
}

function MultiSelect({ id, extraOptions = [], requiredIds, answers, onMulti }: QuestionProps) {
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
    </fieldset>
  );
}

/** R18-B (§27.8): typed free-text answers are limited so every value fits the record's bounds (§27.13). */
export const FREE_TEXT_MAX_CHARS = 200;

function FreeText({
  id,
  multiline = false,
  requiredIds,
  answers,
  onText,
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
        <input id={inputId} type="text" maxLength={FREE_TEXT_MAX_CHARS} value={value} required={isRequired} aria-required={isRequired || undefined} onChange={(e) => onText(id, e.target.value)} />
      )}
    </div>
  );
}

/** CR7-04. Whether the "Model name, if you know it" question is on screen
 *  for this Q3 answer. The rule lives in ONE place — the engine's
 *  `q3ShowsModelQuestion`, which also decides whether a 3model answer is read
 *  — so what renders, what a Q3 change clears and what the engine reads
 *  cannot drift (pinned by TC-CR7-04e). */
function q3KeyShowsModelQuestion(q3: string | undefined): boolean {
  return q3 !== undefined && q3ShowsModelQuestion({ '3': q3 });
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

/** Turns the answers after a change back into state, keeping the source of every
 *  answer whose value did not change and marking a new or changed one `typed`. */
function reconcile(next: PlainAnswers, prev: FormAnswerState): FormAnswerState {
  const out: FormAnswerState = {};
  for (const key of Object.keys(next) as QuestionId[]) {
    const value = next[key];
    if (key === '2' || value === undefined) continue;
    const id = key as Exclude<QuestionId, '2'>;
    const before = prev[id];
    out[id] =
      before && sameValue(before.value, value)
        ? before
        : { value: Array.isArray(value) ? [...value] : value, source: { kind: 'typed' } };
  }
  return out;
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
    restoredRef.current = loadFormDraft()?.answerState ?? initialAnswerState ?? typedFromPlain(initialAnswers);
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
    setAnswerState((prev) => reconcile(change(toPlainAnswers(prev, '')), prev));
  }

  function setSingle(id: QuestionId, key: string) {
    updateAnswers((prev) => {
      const next: PlainAnswers = { ...prev, [id]: key };
      // Conditional follow-ups are cleared when their trigger changes
      // (§2.2 Details: "follow-ups are required when shown and cleared
      // when their trigger changes").
      if (id === '3') {
        // CR7-04: the model name belongs to the Q3 answers that ask for it.
        // Moving from one that shows the question to one that does not (e.g.
        // "outside assistant" -> "something a team in your firm built") used to
        // leave the typed name behind, hidden: it still reached the engine as
        // a declared model for a tool that has none.
        if (q3KeyShowsModelQuestion(typeof prev['3'] === 'string' ? prev['3'] : undefined) && !q3KeyShowsModelQuestion(key)) {
          delete next['3model'];
        }
        delete next['3a'];
        delete next['3aWhich'];
        delete next['3supplier'];
        delete next['3supplierName'];
        // W-9: a platform-zone answer for one platform must never survive
        // onto a different Q3 answer, including a different platform.
        delete next['3platformZone'];
      }
      if (id === '3a') {
        delete next['3aWhich'];
      }
      if (id === '3supplier' && key !== 'not-on-list') {
        delete next['3supplierName'];
      }
      if (id === '4') {
        if (key !== 'score') delete next['4a'];
        if (key !== 'agentic' && key !== 'not-sure') {
          delete next['13'];
          delete next['14'];
        }
      }
      if (id === '6') {
        if (!['answers', 'drafts', 'suggests'].includes(key)) delete next['6a'];
        if (!['acts-reviewed', 'acts-bounded', 'acts-alone'].includes(key)) delete next['6b'];
      }
      if (id === '8' && key !== 'other') {
        delete next['8other'];
      }
      return next;
    });
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
      let next: string[];
      if (id === '13') {
        if (key === 'none') {
          next = current.includes('none') ? [] : ['none'];
        } else {
          const withoutNone = current.filter((k) => k !== 'none');
          next = withoutNone.includes(key) ? withoutNone.filter((k) => k !== key) : [...withoutNone, key];
        }
      } else {
        // CR6-06e: a stale tick can't be unticked (it isn't rendered), so
        // any toggle drops keys that are no longer current options — the
        // person re-picks from what is on screen.
        const valid = multiSelectValidKeys(id);
        const live = current.filter((k) => valid.includes(k));
        next = live.includes(key) ? live.filter((k) => k !== key) : [...live, key];
      }
      return { ...prev, [id]: next };
    });
  }

  // ---- visibility ----
  const q3 = typeof answers['3'] === 'string' ? (answers['3'] as string) : undefined;
  const showQ3Supplier = q3 === 'supplier-feature' || q3 === 'specialist-product';
  const showQ3Model = q3KeyShowsModelQuestion(q3);
  const showQ3a = q3 === 'outside-assistant';
  const show3supplierName = answers['3supplier'] === 'not-on-list';
  const show3aWhich = answers['3a'] === 'firm-account' && companyAssistantOptions.length > 1;
  // W-9 (D-79): the matched platform, if Q3's answer is one of the dynamic
  // platform ids rather than a static option key. A platform allowing only
  // one zone keeps today's mapping with no follow-up.
  const matchedPlatform = (policy.platforms ?? []).find((p) => p.id === q3);
  const showQ3platformZone = Boolean(matchedPlatform) && (matchedPlatform!.approved_envelope.data_zones?.length ?? 0) > 1;
  const q3platformZoneKeys = matchedPlatform ? platformZoneOptionKeys(matchedPlatform) : [];
  const q4 = typeof answers['4'] === 'string' ? (answers['4'] as string) : undefined;
  const showQ4a = q4 === 'score';
  const isAgentic = q4 === 'agentic' || q4 === 'not-sure';
  const q6 = typeof answers['6'] === 'string' ? (answers['6'] as string) : undefined;
  const showQ6a = q6 !== undefined && ['answers', 'drafts', 'suggests'].includes(q6);
  const showQ6b = q6 !== undefined && ['acts-reviewed', 'acts-bounded', 'acts-alone'].includes(q6);
  const showQ8other = answers['8'] === 'other';

  // ---- required-ness (§2.2 Details: "required = an option chosen") ----
  // F-8 (DR7-08): Q13 is answered only when its ticks resolve through the
  // single checker — the same function the mapping itself calls. A tick
  // list that maps to nothing real (a stale draft, an unexpected value)
  // must never silently count as answered here and reach the engine as
  // "not stated" — that was the DR7-08 bug.
  const q13Result = resolveAccessScopeAnswer(toArray(answers['13']));
  // CR6-06: the current, valid key set for a single-select question — its
  // own static options PLUS whatever policy-driven options this render
  // actually spliced in (Q3's platforms, Q3supplier's suppliers, Q3aWhich's
  // company assistants), or Q3platformZone's own platform-restricted subset.
  // A value outside this set (a stale draft, a registry entry since
  // renamed or removed, an option an older build offered) is not one of
  // the choices on screen right now, so it must not count as answered.
  function singleSelectValidKeys(id: QuestionId): string[] {
    if (id === '3platformZone') return q3platformZoneKeys;
    const staticKeys = findQuestion(id)?.options.map((o) => o.key) ?? [];
    if (id === '3') return [...staticKeys, ...platformOptions.map((o) => o.key)];
    if (id === '3supplier') return [...staticKeys, ...supplierOptions.map((o) => o.key)];
    if (id === '3aWhich') return [...staticKeys, ...companyAssistantOptions.map((o) => o.key)];
    return staticKeys;
  }
  // CR6-06e: a multi-select's current keys — its static options plus the
  // policy-driven extras the render splices in (Q11's jurisdictions). Q13
  // keeps its own checker (resolveAccessScopeAnswer).
  function multiSelectValidKeys(id: QuestionId): string[] {
    const staticKeys = findQuestion(id)?.options.map((o) => o.key) ?? [];
    if (id === '11') return [...jurisdictionOptions.map((o) => o.key), ...staticKeys];
    return staticKeys;
  }
  function isAnswered(id: QuestionId): boolean {
    if (id === '13') return q13Result.ok;
    const q = findQuestion(id);
    if (q?.multi) {
      const ticks = toArray(answers[id]);
      const valid = multiSelectValidKeys(id);
      return ticks.length > 0 && ticks.every((k) => valid.includes(k));
    }
    if (q?.freeText) return Boolean((answers[id] as string | undefined)?.trim());
    const value = answers[id];
    if (value === undefined || value === '') return false;
    // F-8/DR7-08's sibling rule for single-select: counted only when the
    // stored value names one of THIS render's current options — static or
    // policy-driven — never merely "is a non-empty string".
    return singleSelectValidKeys(id).includes(String(value));
  }

  const requiredIds: QuestionId[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
  if (showQ3Supplier) requiredIds.push('3supplier');
  if (showQ3platformZone) requiredIds.push('3platformZone');
  if (showQ3a) requiredIds.push('3a');
  if (show3aWhich) requiredIds.push('3aWhich');
  if (showQ4a) requiredIds.push('4a');
  if (showQ6a) requiredIds.push('6a');
  if (showQ6b) requiredIds.push('6b');
  if (showQ8other) requiredIds.push('8other');
  if (isAgentic) requiredIds.push('13', '14');

  const missingIds = requiredIds.filter((id) => !isAnswered(id));
  const isComplete = missingIds.length === 0;
  // CR6-07: what is still missing, in the form's own words — the first few,
  // then a count — shown beside Continue and tied to it with aria-describedby.
  // CR6-07d: strip each item's own trailing stop so the line has no doubled
  // punctuation, and give the count its noun.
  // TC-CR6-07f (live walkthrough): name each question by its FIRST sentence
  // only — some carry help text after it ("…? If more than one fits — …").
  const missingTexts = missingIds.map((id) =>
    (findQuestion(id)?.text ?? id).split(/(?<=[.?!])\s/)[0]!.replace(/[\s.?!;:]+$/, ''),
  );
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
  const qp = { requiredIds, answers, onSingle: setSingle, onMulti: toggleMulti, onText: setText };

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

      {!isComplete && (
        <p id="pf-missing" className="plain-form__missing">
          Still to answer: {missingLine}.
        </p>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isComplete}
        aria-describedby={isComplete ? undefined : 'pf-missing'}
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
