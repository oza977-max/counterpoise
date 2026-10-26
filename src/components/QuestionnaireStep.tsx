import { useEffect, useRef, useState } from 'react';
import type { DataFlowGraph, IntakeQuestion, PolicyFile, QuestionAnswer } from '../engine/types';
import { approvedModelOptionList, neutralSupplierLabel, questionnaireCopyForField, type QuestionnaireFieldCopy, supplierDisplayName } from './plain-copy';
import { fillPlaceholders, joinWithAnd } from './verdict-view-model';

// UC-4 (intake-flow.md §6). Rule 4 (cross-cutting.md §7): presentation-only.
//
// R16-E §2/§3 (D-101, D-102, DR7-24/26/28/29/31). This screen used to speak
// its own, separately-invented vocabulary (QUESTION_TEXT, field-copy.ts's
// reviewer labels) — a submitter who answered the guided FORM's Q13
// ("What can it get into by itself?") met a differently-worded question
// here for the identical engine field. `plain-copy.ts`'s QUESTIONNAIRE_COPY
// is now the one source for every question's text, help, option labels and
// "Not sure" assumption, so the words a person answers here are the words
// they'd see again on the summary.

/** DR7-28. `vendor`/`declared_model_id`'s own registry options — merged in
 *  here (the component layer, which has the policy) beside
 *  QUESTIONNAIRE_COPY's two fixed choices ("Not on this list"/"I don't
 *  know"), exactly as the guided form's own Q3supplier/Q3model build their
 *  dynamic option lists. Never matched FROM typed text (D-06) — only ever
 *  picked from this list. */
function supplierVendorOptions(policy: PolicyFile | undefined): Array<{ value: string; label: string }> {
  const vendors = (policy?.vendors ?? []).filter((v) => (v.kind ?? 'supplier') === 'supplier');
  let neutralIndex = 0;
  return vendors.map((v) => ({ value: v.id, label: v.plain_name ?? neutralSupplierLabel(++neutralIndex) }));
}

function approvedModelOptions(policy: PolicyFile | undefined): Array<{ value: string; label: string }> {
  return approvedModelOptionList(policy?.approved_models);
}

/** The "Recorded:" line (BC-4): the chosen option LABEL(s), never the raw
 *  value. A multi-select answer joins its labels "a, b and c"; a vendor id
 *  resolves against the policy when the static table doesn't name it (a
 *  free-text or already-plain-English vendor string, D-72/D-64, falls
 *  through to being shown as-is — it already reads like an answer). */
function recordedAnswerLabel(field: string, value: unknown, policy: PolicyFile | undefined): string {
  const copy = questionnaireCopyForField(field);
  if (Array.isArray(value)) {
    return joinWithAnd(value.map((v) => copy.options[String(v)] ?? String(v)));
  }
  const fromTable = copy.options[String(value)];
  if (fromTable) return fromTable;
  if (field === 'declared_model_id') {
    // CR6-19: the label of the button the person clicked, never the raw id.
    const clicked = approvedModelOptions(policy).find((o) => o.value === value);
    if (clicked) return clicked.label;
  }
  if (field === 'vendor') {
    // R16-E review pass 3: the label of the very button the person clicked
    // (a numbered "Supplier n" when the firm gave no plain name), never the
    // registry id; anything else through the shared lookup.
    const clicked = supplierVendorOptions(policy).find((o) => o.value === value);
    if (clicked) return clicked.label;
    return supplierDisplayName(String(value), policy).name;
  }
  return String(value);
}

/** §3: "the triggering rule's plain_reason as the 'why we ask' line (none
 *  → no line)". A question can be triggered by more than one rule
 *  (dedupeAndMerge, question-generator.ts) — every one with a plain_reason
 *  is shown, resolved through the SAME {audience}/{destination} rule the
 *  verdict screen uses (verdict-view-model.ts's fillPlaceholders, reused
 *  rather than re-derived). A purely-guessed question (no real rule, just
 *  the R6-PV-2 sentinel) has nothing to resolve here — its own intro line
 *  is handled separately, below. */
function whyWeAskLine(
  question: IntakeQuestion,
  policy: PolicyFile | undefined,
  graph: DataFlowGraph | undefined,
): string | undefined {
  const ruleIds = question.triggered_by.filter((id) => id !== 'R6-PV-2:guessed');
  if (!policy || ruleIds.length === 0) return undefined;
  const reasons = new Set<string>();
  for (const id of ruleIds) {
    const reason = policy.invariants.find((r) => r.id === id)?.plain_reason ??
      policy.hard_lines.find((r) => r.id === id)?.plain_reason;
    if (reason) reasons.add(fillPlaceholders(reason, graph));
  }
  return reasons.size > 0 ? [...reasons].join('; ') : undefined;
}

interface QuestionnaireStepProps {
  questions: IntakeQuestion[];
  answeredCount: number;
  // R6-CX-1: context travels with the answer. `notSure`: this answer came
  // from the field's own "Not sure" control — the caller (IntakeFlow)
  // resolves the stricter value and the assumption text from
  // QUESTIONNAIRE_COPY, so this component never needs to word anything.
  onAnswer: (questionId: string, value: unknown, context?: string, notSure?: boolean) => void;
  // v0.7.1: the most recent recorded answer, for the confirmation line.
  lastAnswer?: QuestionAnswer;
  onUndo?: () => void;
  // Resolves a triggered rule's plain-English name/reason and, for
  // vendor/declared_model_id, the firm's own registry options. Optional so
  // every existing caller stays valid.
  policy?: PolicyFile;
  // R16-E §3: resolves a triggering invariant's {audience}/{destination}
  // placeholders in the "why we ask" line.
  graph?: DataFlowGraph;
}

export default function QuestionnaireStep({
  questions,
  answeredCount,
  onAnswer,
  lastAnswer,
  onUndo,
  policy,
  graph,
}: QuestionnaireStepProps) {
  const [textValue, setTextValue] = useState('');
  const [context, setContext] = useState('');
  // v0.7.1 double-click guard, UI layer: the reducer refuses a duplicate
  // questionId too, but the button should stop offering itself the moment
  // it is used (same two-layer posture as the sign-off actions).
  const [answeredId, setAnsweredId] = useState<string | null>(null);
  const current = questions[answeredCount];

  const guessedCount = questions.filter((q) => q.triggered_by.includes('R6-PV-2:guessed')).length;
  const riskCount = questions.length - guessedCount;

  const lastQuestion = lastAnswer ? questions.find((q) => q.id === lastAnswer.questionId) : undefined;

  // §3: per-question focus — R16-F's step-focus effect (IntakeFlow.tsx)
  // fires only when `state.step` changes, and moving from one targeted
  // question to the next never leaves `questionnaire`, so nothing else
  // moves focus here. Skipped on first render (nothing has "changed" into
  // yet); every hook call stays unconditional (current can be undefined
  // once every question is answered), so the early-return below sits
  // after this effect, not before it.
  const questionRef = useRef<HTMLParagraphElement | null>(null);
  const previousQuestionIdRef = useRef<string | null>(null);
  const currentId = current?.id;
  useEffect(() => {
    if (previousQuestionIdRef.current === null) {
      previousQuestionIdRef.current = currentId ?? null;
      return;
    }
    if (previousQuestionIdRef.current === currentId) return;
    previousQuestionIdRef.current = currentId ?? null;
    if (currentId) questionRef.current?.focus({ preventScroll: true });
  }, [currentId]);

  if (!current) {
    return <p>All questions answered.</p>;
  }

  const locked = answeredId === current.id;
  const copy: QuestionnaireFieldCopy = questionnaireCopyForField(current.field);
  const isGuessed = current.triggered_by.includes('R6-PV-2:guessed');
  const whyWeAsk = whyWeAskLine(current, policy, graph);

  const answer = (value: unknown, notSure = false) => {
    if (locked) return;
    setAnsweredId(current.id);
    onAnswer(current.id, value, context.trim() || undefined, notSure);
    setTextValue('');
    setContext('');
  };

  // DR7-28: vendor/declared_model_id have no closed canonical vocabulary
  // (the legal set is this firm's own registry, not a fixed enum), so the
  // engine's own `answer_type` for them is 'text' — the field name is
  // what actually decides this is a select-like question here.
  const isVendorOrModel = current.field === 'vendor' || current.field === 'declared_model_id';
  const dynamicOptions =
    current.field === 'vendor'
      ? supplierVendorOptions(policy)
      : current.field === 'declared_model_id'
        ? approvedModelOptions(policy)
        : [];
  // vendor_name/declared_model_id_name (DR7-28's own follow-up questions)
  // are optional free text — "Not on this list", left blank, is still a
  // valid answer (D-64's own "An unlisted supplier..." fallback).
  const textOptional = current.field === 'vendor_name' || current.field === 'declared_model_id_name';

  return (
    <section aria-label="Targeted questions" className="questionnaire">
      {/* v0.7.1: the count explains itself — no budget, no tier (principle
          1; the progress line is Question {x} of {y} only). */}
      <p className="questionnaire__progress">
        Question {answeredCount + 1} of {questions.length}
      </p>
      {guessedCount > 0 && (
        <p className="questionnaire__count-note">
          {/* Verifying R16-E: this note still spoke machine ("the model would
              otherwise be guessing", "a local model this size can verify")
              and said "All 1 are asked". Plain words, right for 1 or many;
              the reassurance a user asked for (2026-08-17: "why is it always
              about the same number of questions?") is kept. */}
          {riskCount > 0
            ? `${riskCount} of these ${riskCount === 1 ? 'is' : 'are'} because of your firm’s rules, and ${guessedCount} because your description didn’t say.`
            : guessedCount === 1
              ? 'This is asked because your description didn’t say.'
              : `These are asked because your description didn’t say.`}{' '}
          Most descriptions leave out a few details, so a similar number of questions is normal.
        </p>
      )}

      {/* v0.7.1: acknowledge the previous answer instead of silently
          swapping questions — with one step of undo. BC-4: the LABEL(S),
          never the raw value. */}
      {lastAnswer && lastQuestion && (
        <p className="questionnaire__recorded" role="status">
          Recorded: {questionnaireCopyForField(lastQuestion.field).question}{' '}
          <strong>{recordedAnswerLabel(lastQuestion.field, lastAnswer.value, policy)}</strong>
          {onUndo && (
            <>
              {' '}
              <button type="button" className="questionnaire__undo" onClick={() => { setAnsweredId(null); onUndo(); }}>
                Undo
              </button>
            </>
          )}
        </p>
      )}

      {/* §3: a guessed-field question introduces itself. The intro sits
          INSIDE the element that receives focus (R16-E review pass 1), so a
          screen reader landing on a new question hears both together; it
          still shows on its own line. */}
      <p className="questionnaire__text" ref={questionRef} tabIndex={-1}>
        {isGuessed && (
          <span className="questionnaire__guessed-intro">
            We couldn’t tell this from your description:
          </span>
        )}
        {copy.question}
      </p>
      {copy.help && <p className="field-help">{copy.help}</p>}
      {/* §3: the triggering rule's own plain_reason — "none" renders no
          line at all, never a fallback or the rule's id. */}
      {whyWeAsk && <p className="questionnaire__why-we-ask">Why we ask: {whyWeAsk}</p>}

      <label htmlFor={`context-${current.id}`} className="questionnaire__context-label">
        Anything your AI risk team should know about this answer? (optional)
      </label>
      <input
        id={`context-${current.id}`}
        type="text"
        className="questionnaire__context"
        value={context}
        onChange={(e) => setContext(e.target.value)}
      />
      <p className="field-help">
        Read by the person who signs off — the rules never read it.
      </p>

      {current.answer_type === 'boolean' && (
        <div className="questionnaire__options">
          <button type="button" disabled={locked} onClick={() => answer(true)}>
            {copy.options.true ?? 'Yes'}
          </button>
          <button type="button" disabled={locked} onClick={() => answer(false)}>
            {copy.options.false ?? 'No'}
          </button>
          {copy.notSure && (
            <button type="button" disabled={locked} onClick={() => answer(copy.notSure!.value, true)}>
              Not sure
            </button>
          )}
        </div>
      )}

      {/* DR7-28: vendor/declared_model_id are select-LIKE (a registry
          choice plus two fixed named choices) even though the ENGINE's
          own answer_type for them is 'text' (no closed canonical
          vocabulary exists for either — the legal set is this firm's own
          policy, not a fixed enum) — the field name overrides the type
          here, never the other way round. */}
      {(current.answer_type === 'select' || isVendorOrModel) && (
        <div className="questionnaire__options questionnaire__options--labelled">
          {dynamicOptions.map((o) => (
            <button key={o.value} type="button" disabled={locked} onClick={() => answer(o.value)}>
              {o.label}
            </button>
          ))}
          {Object.entries(copy.options).map(([value, label]) => (
            <button key={value} type="button" disabled={locked} onClick={() => answer(value)}>
              {label}
            </button>
          ))}
          {copy.notSure && (
            <button type="button" disabled={locked} onClick={() => answer(copy.notSure!.value, true)}>
              Not sure
            </button>
          )}
        </div>
      )}

      {current.answer_type === 'multi_select' && (
        <MultiSelectAnswer key={current.id} copy={copy} locked={locked} onDone={(values) => answer(values)} />
      )}
      {current.answer_type === 'multi_select' && copy.notSure && (
        <div className="questionnaire__options">
          <button type="button" disabled={locked} onClick={() => answer(copy.notSure!.value, true)}>
            Not sure
          </button>
        </div>
      )}

      {current.answer_type === 'text' && !isVendorOrModel && (
        <div>
          <label htmlFor={`answer-${current.id}`}>Your answer</label>
          <textarea
            id={`answer-${current.id}`}
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
          />
          <button
            type="button"
            onClick={() => answer(textValue.trim())}
            disabled={locked || (!textOptional && !textValue.trim())}
          >
            Submit answer
          </button>
        </div>
      )}
    </section>
  );
}

// §3 (D-101): tick-all with a "Done" button, disabled until one box is
// ticked; "Nothing beyond…" exclusive, the same rule as the form's own
// Q13. A `<fieldset>`, not one `<label>`
// around everything — a label's control is its FIRST input, so clicking
// any option's words would tick only that one (the bug R16-F found and
// fixed in the retired review editor; this is the questionnaire's own instance of
// the same control).
function MultiSelectAnswer({
  copy,
  locked,
  onDone,
}: {
  copy: QuestionnaireFieldCopy;
  locked: boolean;
  onDone: (values: string[]) => void;
}) {
  const [ticked, setTicked] = useState<string[]>([]);

  function toggle(value: string) {
    if (value === 'none') {
      setTicked((t) => (t.includes('none') ? [] : ['none']));
      return;
    }
    setTicked((t) => {
      const withoutNone = t.filter((v) => v !== 'none');
      return withoutNone.includes(value) ? withoutNone.filter((v) => v !== value) : [...withoutNone, value];
    });
  }

  return (
    <fieldset className="questionnaire__multi-select">
      <legend>{copy.shortLabel}</legend>
      {Object.entries(copy.options).map(([value, label]) => (
        <label key={value} className="questionnaire__multi-select-option">
          <input type="checkbox" checked={ticked.includes(value)} disabled={locked} onChange={() => toggle(value)} />
          {label}
        </label>
      ))}
      <button type="button" disabled={locked || ticked.length === 0} onClick={() => onDone(ticked)}>
        Done
      </button>
    </fieldset>
  );
}
