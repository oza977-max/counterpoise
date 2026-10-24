// Intake flow state machine (intake-flow.md §3). Kept separate from
// IntakeFlow.tsx so the reducer is independently unit-testable without
// React Testing Library (Dan Vanderkam: typed discriminated unions).
import type { Contradiction, DataFlowGraph, GraphCorrection, IntakeQuestion, QuestionAnswer } from '../engine/types';
import type { Assumption, PlainAnswers } from './plain-copy';
import type { AuditEvent } from '../store/types';
import type { ChecklistItemId, FormAnswerState, LastRead } from '../engine/prefill-types';
import { textFingerprint, toPlainAnswers } from '../engine/form-answer-state';

export type { Contradiction, IntakeQuestion, QuestionAnswer };

export type IntakeState =
  | {
      step: 'description_entry';
      description: string;
      // R18-GI-2 (specs/intake-flow.md §27.3): the sorted ids of the items the
      // first Next press listed. The second press proceeds only if the
      // currently-unmentioned set still equals it.
      nudgeFor?: ChecklistItemId[];
      // R18-GI-8 (§27.1): the text fingerprint at which the similar-cases
      // screen was passed, handed back by a Back from the form. A Next with an
      // unchanged fingerprint goes straight to the form.
      decidedFor?: string;
      // R18-C2 (§27.6): what the model last read, handed back with the Back so a
      // Next with an unchanged text asks nothing.
      lastRead?: LastRead;
    }
  | { step: 'duplicate_check'; description: string; nudgeFor?: ChecklistItemId[]; lastRead?: LastRead }
  | {
      // R18-C2 (§27.1, §27.5): the model is reading the description. Persisted like
      // evaluation_pending and mapped on load to the form (a reload never reads).
      step: 'prefill_reading';
      description: string;
      nudgeFor?: ChecklistItemId[];
      decidedFor?: string;
      // The form's answers as they stood when the read began (Read my description again).
      answerState?: FormAnswerState;
      lastRead?: LastRead;
    }
  | {
      step: 'graph_extraction';
      description: string;
      // D-1 (Minor): this is intake-flow's OWN method name, not the
      // graph's — the engine's field (DataFlowGraph.intake_method,
      // engine/types.ts) has its own values. Two spellings for
      // the same concept; a test fixture once used the invalid value
      // 'form' here and nothing caught it. Since R18-E (specs/intake-flow.md
      // §27.10) there is one route, so the only value is 'form'; the field
      // stays so the saved-draft shape and every reader are unchanged.
      method: 'form';
      // R18-A: see description_entry. Carried so a Back to the description keeps
      // the nudge decision and the duplicate decision already made.
      nudgeFor?: ChecklistItemId[];
      decidedFor?: string;
      // R18-A (§27.1): Back from the form is refused when this is set. Nothing
      // sets it today — a failed evaluation re-enters the form carrying
      // `useCaseId`, which refuses Back just the same; named so the spec's three
      // refusal conditions are all in the type.
      afterFailedEvaluation?: boolean;
      // W-4 (R16-W §1, D-70). Present only on a RESUBMISSION of the form —
      // CHANGE_ANSWER and the form-path STEP_BACK set these so the form
      // reopens filled in (plainAnswers) and so a second Continue reuses
      // the use case this intake already minted rather than writing a
      // second use_case_created (useCaseId). Absent on the very first
      // visit to the form, and always absent on the description/LLM path.
      useCaseId?: string;
      plainAnswers?: PlainAnswers;
      // R18-A (§27.6): the form's one answer store, carried on every form-route
      // step from here on. `plainAnswers` stays as the derived cache that
      // FORM_SUBMITTED sets from it with toPlainAnswers and nothing else writes.
      answerState?: FormAnswerState;
      lastRead?: LastRead;
      assumptions?: Assumption[];
      // R16-D2 §5 (D-82, DR7-17/DR7-22). Present only on a CORRECTION of a
      // form-built verdict (`CORRECT_VERDICT_WITH_FORM`, carried forward by
      // every return trip to this step — CHANGE_ANSWER, a form-path
      // EVALUATION_FAILED, the questionnaire's own STEP_BACK). `useCaseId`
      // above is reused the same way a plain resubmission already reuses
      // it; these two name the correction itself: which verdict is being
      // corrected, and the graph it was produced from, so a resubmission's
      // `formCorrections()` diff is always against the ORIGINAL answers —
      // never against a previous, never-attested resubmission attempt.
      originalVerdictId?: string;
      originalGraph?: DataFlowGraph;
    }
  | {
      step: 'questionnaire';
      description: string;
      graph: DataFlowGraph;
      questions: IntakeQuestion[];
      answers: QuestionAnswer[];
      resolutionNotes: string[];
      // B-10c (FX-2 review pass 2). Keys (see contradictionKey) of the
      // contradictions the person has already explained, so the next answer's
      // re-run of detectContradictions does not raise the same one again.
      // Threaded questionnaire <-> contradiction_review and persisted with the
      // draft; starts empty wherever resolutionNotes does.
      explainedContradictions?: string[];
      corrections: GraphCorrection[];
      useCaseId: string;
      originalVerdictId?: string;
      // R16-D2 §5: see graph_extraction's own comment above — carried
      // forward only so a further "Change an answer"/STEP_BACK/evaluation
      // failure during this correction can hand it back to the form.
      originalGraph?: DataFlowGraph;
      // v0.7.1: single-level undo — the graph and corrections length as
      // they stood BEFORE the most recent answer. Cleared by the next
      // answer. Ephemeral review state; the trail records only what is
      // attested. R16-E §3: also snapshots `questions` (an answer can
      // insert a follow-up right after itself — undoing it must remove
      // that follow-up too, not just the answer) and the assumptions
      // length (a "Not sure" answer can append one).
      // CR6-04 (Critical, BC-002): `questions`/`assumptionsLen` were added
      // at 9348882 — a draft saved by an older build has an `undo` with
      // neither (the pre-9348882 shape was `{ graph, correctionsLen }`
      // only). ANSWER_UNDONE below falls back rather than reading either
      // as `undefined` and crashing QuestionnaireStep, which indexes
      // `questions[answeredCount]`; intake-draft.ts's versioned envelope
      // is the first layer (drops an incompatible `undo` on restore —
      // never lets it reach here from an old draft at all) — this is
      // defense in depth for anything that still does.
      //
      // CR7-02 (4): the snapshot holds the assumptions ARRAY, not its length.
      // A "Not sure" re-answer now REPLACES an assumption in place (ANSWER_
      // SUBMITTED), so slicing by a remembered length no longer undoes it.
      // `assumptionsLen` stays optional only for a snapshot an older build
      // wrote (ANSWER_UNDONE reads it as before when `assumptions` is absent).
      undo?: {
        graph: DataFlowGraph;
        correctionsLen: number;
        questions: IntakeQuestion[];
        assumptions?: Assumption[];
        assumptionsLen?: number;
      };
      // W-3/W-4 (R16-W §1). Present only when this questionnaire was
      // reached via FORM_SUBMITTED (the form path's own questions, if
      // any) — carried so a form-path STEP_BACK can return to the form
      // filled in, and so the summary can still show the "Not sure"
      // assumptions once the graph reaches confirmation. Absent on the
      // description/LLM path, which never sets them.
      plainAnswers?: PlainAnswers;
      answerState?: FormAnswerState;
      lastRead?: LastRead;
      assumptions?: Assumption[];
      // F-7 (DR7-07). Node ids flagged uncertain, threaded forward through every
      // transition (never re-derived). Read by the confirmation summary and
      // the recorded "Not sure" list. Since R18-E nothing on the one remaining
      // route sets it, so it is empty wherever it appears.
      uncertainNodeIds?: string[];
    }
  | {
      step: 'contradiction_review';
      description: string;
      graph: DataFlowGraph;
      questions: IntakeQuestion[];
      answers: QuestionAnswer[];
      contradictions: Contradiction[];
      resolutionNotes: string[];
      // B-10c: see the questionnaire variant's comment.
      explainedContradictions?: string[];
      corrections: GraphCorrection[];
      useCaseId: string;
      originalVerdictId?: string;
      // R16-D2 §5: see graph_extraction's own comment.
      originalGraph?: DataFlowGraph;
      // W-3/W-4: see the questionnaire variant's comment above.
      plainAnswers?: PlainAnswers;
      answerState?: FormAnswerState;
      lastRead?: LastRead;
      assumptions?: Assumption[];
      // F-7: see the questionnaire variant's comment above.
      uncertainNodeIds?: string[];
    }
  | {
      step: 'confirmation';
      description: string;
      graph: DataFlowGraph;
      graphVersion: number;
      corrections: GraphCorrection[];
      answers: QuestionAnswer[];
      // UC-5 (2026-08-15): carried so the attestation can persist them.
      // This shape used to drop the notes, so the explanations a submitter
      // was REQUIRED to type before proceeding evaporated before the write.
      resolutionNotes: string[];
      useCaseId: string;
      originalVerdictId?: string;
      // R16-D2 §5: see graph_extraction's own comment.
      originalGraph?: DataFlowGraph;
      // W-3/W-4: see the questionnaire variant's comment above. This is
      // what IntakeFlow now reads directly for UnderstoodSummary's
      // assumptions list — replacing the `formAssumptions` useState the
      // B+C chunk used, which a refresh (the draft only ever persisted
      // IntakeState) silently lost.
      plainAnswers?: PlainAnswers;
      answerState?: FormAnswerState;
      lastRead?: LastRead;
      assumptions?: Assumption[];
      // F-7: see the questionnaire variant's comment above — this is what
      // IntakeFlow now reads directly for UnderstoodSummary's "uncertain"
      // list, replacing the component `useState` of the same name.
      uncertainNodeIds?: string[];
      // CR8-03 (P3 — once a case has a confirmed attestation, no navigation can
      // start a new case id for it). REQUIRED, so a transition that builds a
      // confirmation and forgets it fails to compile. Since R18-E the only
      // route is the form, whose retry carries the case id and refuses Back on
      // its own, so every transition sets this false; kept (not in the §27.10
      // table) so saved confirmations and their readers keep their shape.
      afterFailedEvaluation: boolean;
    }
  | {
      step: 'evaluation_pending';
      graph: DataFlowGraph;
      useCaseId: string;
      originalVerdictId?: string;
      // R16-D2 §5: see graph_extraction's own comment — carried here so a
      // genuine evaluation failure during a form correction can still hand
      // it back to the form (EVALUATION_FAILED, below).
      originalGraph?: DataFlowGraph;
      // Review 004 finding 2: carried so a failed evaluation can restore the
      // description on the form it returns to.
      description?: string;
      // F-2 (DR7-04). Carried from the confirmation state so EVALUATION_FAILED
      // can hand them straight back: the form (graph_extraction) needs both to
      // reopen filled in.
      plainAnswers?: PlainAnswers;
      answerState?: FormAnswerState;
      lastRead?: LastRead;
      assumptions?: Assumption[];
      // CR7-02: carried from the confirmation state, as it was.
      uncertainNodeIds?: string[];
    }
  | { step: 'verdict'; verdictId: string };

export type IntakeAction =
  | { type: 'DESCRIPTION_CHANGED'; description: string }
  // R18-A (§27.3): the first Next press listed these items.
  | { type: 'NUDGE_SHOWN'; nudgeFor: ChecklistItemId[] }
  // R18-A (§27.6): Question 2 on the form is the editor of the description —
  // the one description string. Valid only on the form step.
  | { type: 'DESCRIPTION_EDITED'; description: string }
  // explore-005 D-002: the only action valid from EVERY step. The resumed-
  // draft banner's "Start over instead" previously dispatched
  // DESCRIPTION_CHANGED, which the guard below discards from any step but
  // description_entry — so the escape hatch hid itself and changed nothing.
  | { type: 'RESTART' }
  // FN-006: one step backwards. Bounded at the confirmation attestation —
  // see the reducer case for why it stops there rather than everywhere.
  | { type: 'STEP_BACK' }
  // R18-C2: `reading` - the caller has a valid model setting and a text the model has not
  // read, and will start the read from the handler; the route goes through the reading step.
  // `lastRead` - why nothing is being read (no model), recorded beside the form.
  | { type: 'SUBMIT_DESCRIPTION'; reading?: boolean; lastRead?: LastRead }
  | { type: 'NO_DUPLICATE_FOUND'; method: 'form'; reading?: boolean; lastRead?: LastRead }
  // R18-C2 (§27.1): the read ended; the caller has already written the merged answers to the
  // form draft, so the form mounts with them. Carries lastRead and the merged answerState.
  | { type: 'PREFILL_DONE'; answerState: FormAnswerState; lastRead: LastRead }
  // R18-C2: "Read my description again" - a fresh form back to the reading step.
  | { type: 'READ_AGAIN' }
  // W-3 (R16-W §1, D-69). Valid only from graph_extraction (the form).
  // The caller computes `questions`/`contradictions` from the graph in
  // hand (never from stale state) and this reducer only picks which of
  // the three destinations they lead to — pure, no audit write here (the
  // one write for a fresh submission stays IntakeFlow's use_case_created,
  // written before this dispatches).
  | {
      type: 'FORM_SUBMITTED';
      graph: DataFlowGraph;
      useCaseId: string;
      description: string;
      // R18-A (§27.6): the form's one answer store. The reducer derives the
      // `plainAnswers` cache from it (toPlainAnswers) and nothing else sets it.
      answerState: FormAnswerState;
      assumptions: Assumption[];
      questions: IntakeQuestion[];
      contradictions: Contradiction[];
      // R16-D2 §5 (D-82). Empty on a fresh submission; on a correction,
      // the caller's `formCorrections(originalGraph, graph, …)` diff —
      // computed in IntakeFlow.tsx's handleFormSubmitted, which has both
      // graphs in scope (the one on `state.originalGraph`, and this one).
      // Threaded onto the SAME `corrections` field every other path already
      // uses, so `runConfirmAndEvaluate`'s existing per-correction write
      // loop needs no change to also write these.
      corrections: GraphCorrection[];
    }
  // R6-QN-1 (ADR-IF-R6-3): an answer that differs from the graph IS a
  // correction — carried with the answer so the reducer applies both
  // atomically, and the engine finally sees what the user answered.
  // R16-E §3 (D-102). `assumption`: a "Not sure" answer carries D2's
  // Assumption shape straight through — accumulated into
  // `state.assumptions` (created on first use; every other step already
  // carries this field optionally, so the shape was always there). `
  // insertQuestions`: the decision-type-other / vendor / model follow-up
  // questions, inserted into `state.questions` right after the one just
  // answered — e.g. picking "Something else" for what it helps decide, or
  // "Not on this list" for the supplier.
  | {
      type: 'ANSWER_SUBMITTED';
      answer: QuestionAnswer;
      correction?: GraphCorrection;
      updatedGraph?: DataFlowGraph;
      assumption?: Assumption;
      insertQuestions?: IntakeQuestion[];
    }
  // v0.7.1: take back the most recent answer (and its write-back), once.
  | { type: 'ANSWER_UNDONE' }
  | { type: 'CONTRADICTIONS_DETECTED'; contradictions: Contradiction[] }
  | { type: 'CONTRADICTION_RESOLVED'; explanation: string }
  // UC-6 (intake-flow.md §9): always an explicit human action, even with
  // zero questions.
  | { type: 'PROCEED_TO_CONFIRMATION' }
  | { type: 'CONFIRMED' }
  // A legitimate engine/policy failure (e.g. no-track-match) during
  // evaluation must not leave the UI stuck on "Evaluating..." forever —
  // returns to confirmation so the submitter sees the error and can
  // retry or go back. (Fix for the pre-existing gap flagged in P5-C01's
  // handover.)
  | { type: 'EVALUATION_FAILED' }
  | { type: 'VERDICT_READY' }
  // R16-D2 §5 (D-82, DR7-17). "Correct your answers" on the verdict:
  // re-enters at the GUIDED FORM itself, filled in with what was last confirmed, carrying the id of the verdict
  // being corrected and the graph it was produced from (so the eventual
  // resubmission's formCorrections() diff is against the real original).
  | {
      type: 'CORRECT_VERDICT_WITH_FORM';
      originalGraph: DataFlowGraph;
      useCaseId: string;
      originalVerdictId: string;
      description: string;
      // R18-A: as FORM_SUBMITTED — the cache is derived, not passed.
      answerState: FormAnswerState;
      lastRead?: LastRead;
      assumptions: Assumption[];
    }
  // R18-D2 (§27.10). "Correct this check" on the register: the case's description and its answers, restored from
  // its saved record (answersFromRecord), reopen on the FORM as a correction. The register keeps no graph, so
  // `originalGraph` is the one the caller rebuilt from the same restored answers; `useCaseId` and
  // `originalVerdictId` make it the same correction CORRECT_VERDICT_WITH_FORM makes (Back refused, verdict_corrected).
  // Allowed from any step but evaluation_pending, because the caller is the register, not the verdict screen.
  | {
      type: 'OPEN_CORRECTION_FROM_RECORD';
      originalGraph: DataFlowGraph;
      useCaseId: string;
      originalVerdictId: string;
      description: string;
      answerState: FormAnswerState;
      assumptions: Assumption[];
    }
  // R16-C (§3): "Change an answer" on the UnderstoodSummary. Deliberately
  // its OWN action rather than reusing STEP_BACK — STEP_BACK's existing
  // reducer case and canStepBack's UI gate stay exactly as they are
  // (confirmation has no "← Back" control, on purpose: IntakeFlow.back.test.tsx
  // asserts that). This is a navigation-only transition, same destination
  // shape as STEP_BACK's questionnaire case, never a write to the audit
  // trail — the one write stays the Confirm button and its in-flight guard.
  | { type: 'CHANGE_ANSWER' };

// F-6 (DR7-13). The "questions -> contradiction review -> confirmation"
// priority, pinned once. Used by FORM_SUBMITTED (below) and by IntakeFlow's
// own exit from the questions.
export function nextReviewStep(
  questions: IntakeQuestion[],
  contradictions: Contradiction[],
): 'questionnaire' | 'contradiction_review' | 'confirmation' {
  if (questions.length > 0) return 'questionnaire';
  if (contradictions.length > 0) return 'contradiction_review';
  return 'confirmation';
}

/** R16-D2 §5 (v2.1). Whether a step back, "Change an answer" or an
 *  evaluation failure returns to the guided form. It does, EXCEPT in a
 *  correction whose form answers and original graph are not both in hand: an
 *  empty form in correction mode would rebuild the case from blank answers and,
 *  with no original graph to diff against, record "no answers changed" - a
 *  false record on the append-only trail. Both ways of opening a correction
 *  (CORRECT_VERDICT_WITH_FORM, OPEN_CORRECTION_FROM_RECORD) carry both, so this
 *  holds for every state this build can make; it guards a damaged one. */
function returnsToForm(state: {
  plainAnswers?: PlainAnswers;
  originalVerdictId?: string;
  originalGraph?: DataFlowGraph;
}): boolean {
  if (!state.originalVerdictId) return true;
  return state.plainAnswers !== undefined && state.originalGraph !== undefined;
}

/** The submitted description, carried forward wherever the current step still
 *  has it. `verdict` does not, so it reads as empty there - recorded here
 *  rather than hidden behind a cast. */
function carriedDescription(state: IntakeState): string {
  return 'description' in state && typeof state.description === 'string' ? state.description : '';
}

/** B-10c. Identity of a contradiction for "already explained": the field it
 *  is about plus its first statement. Stable across re-detection because
 *  detectContradictions is deterministic over the same description + graph. */
export function contradictionKey(c: Contradiction): string {
  return `${c.field ?? ''}|${c.statement1}`;
}

/** Where a correction's (node, field) lives on the graph being evaluated:
 *  `{found:true, value}` or `{found:false}` (never guessed). */
export type ValueResolver = (nodeId: string, field: string) => { found: true; value: unknown } | { found: false };

/** Resolver for planCorrectionWrites. Without an original graph: by node id (`graph` is
 *  the graph itself). Form path (`originalGraph` given): buildGraphFromForm
 *  mints fresh ids every submission and formCorrections names the ORIGINAL
 *  graph's ids, so they are mapped by role — the original processing node id to
 *  processing_nodes[0], the original output node id to output_nodes[0], the
 *  sentinel `inputs|data_classes` to the sorted distinct input data classes.
 *
 *  Assumption (M-3): the form builds exactly ONE processing node and ONE output
 *  node (form-corrections.ts matches by the same rule). A multi-node form would
 *  resolve nothing for the extra nodes — safe (nothing is written), but it would
 *  drop their reverse corrections. */
export function graphValueResolver(graph: DataFlowGraph, originalGraph?: DataFlowGraph): ValueResolver {
  const asRec = (n: unknown) => n as Record<string, unknown> | undefined;
  return (nodeId, field) => {
    if (nodeId === 'graph') {
      if (!(field in graph)) return { found: false };
      const v = (graph as unknown as Record<string, unknown>)[field];
      // Sorted, as formCorrections stores jurisdictions, so a synthesised
      // correction and a form-diffed one read the same.
      return { found: true, value: Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...v].sort() : v };
    }
    let node: Record<string, unknown> | undefined;
    if (originalGraph) {
      if (nodeId === 'inputs' && field === 'data_classes') {
        return { found: true, value: [...new Set(graph.input_nodes.map((n) => n.data_class))].sort() };
      }
      if (originalGraph.processing_nodes[0]?.id === nodeId) node = asRec(graph.processing_nodes[0]);
      else if (originalGraph.output_nodes[0]?.id === nodeId) node = asRec(graph.output_nodes[0]);
    } else {
      node = asRec([...graph.input_nodes, ...graph.processing_nodes, ...graph.output_nodes].find((n) => n.id === nodeId));
    }
    return node ? { found: true, value: node[field] } : { found: false };
  };
}

/** CR7-21/22, FX7-1 review passes 1-2 (M-3, M-4, I-A, M-B). Decides what a
 *  confirm writes to the trail for its corrections, and how many corrections
 *  the trail then holds for this attempt. Pure: the caller reads the events
 *  inside the case lock.
 *
 *  The aim: for every (node, field) the trail's NET value — the last
 *  `corrected_value` written since the last result — equals the value on the
 *  graph being evaluated. The window is the events since the last
 *  verdict_produced/verdict_corrected.
 *   - A pending correction is skipped only when the LATEST value written for its
 *     (node, field) already equals its `corrected_value` (a retry re-mints ids
 *     for the same change). A->B, A->C, A->B writes the third: the form always
 *     diffs against the ORIGINAL graph, so "A->B" is new information once C is
 *     the latest.
 *   - With `ctx` (a resolver for the graph being evaluated), a (node, field) the window has
 *     corrected whose latest value differs from the graph — and that nothing
 *     pending covers, e.g. a resubmit with the field back at its original value,
 *     where the form finds nothing to correct — gets one correction from the
 *     latest trail value to the graph value, with the same `correction_source`.
 *   - Values compare as sets for lists (jurisdictions), `?? null` for absent.
 *
 *  `sinceLastResult` = the graph_corrected events in the window plus those about
 *  to be written: what graph_confirmed/verdict_corrected should call its
 *  `corrections_count`, so the number always follows from the same plan. */
export function planCorrectionWrites(
  corrections: GraphCorrection[],
  events: AuditEvent[],
  ctx?: {
    resolve: ValueResolver;
    version: number;
    newId: () => string;
    now: () => string;
    by: string;
  },
): { toWrite: GraphCorrection[]; sinceLastResult: number } {
  let lastDecided = -1;
  events.forEach((e, i) => {
    if (e.payload.type === 'verdict_produced' || e.payload.type === 'verdict_corrected') lastDecided = i;
  });
  const written: GraphCorrection[] = [];
  for (const e of events.slice(lastDecided + 1)) {
    if (e.payload.type === 'graph_corrected') written.push(e.payload.correction);
  }
  const norm = (v: unknown): string => {
    const x = v ?? null;
    return JSON.stringify(Array.isArray(x) ? [...x].map((i) => JSON.stringify(i)).sort() : x);
  };
  const key = (c: { node_id: string; field: string }) => `${c.node_id}|${c.field}`;
  const latest = new Map<string, GraphCorrection>();
  for (const w of written) latest.set(key(w), w);

  // CR8-06 (P1 — for every (node, field) the latest graph_corrected value on
  // the trail since the last result equals the evaluated graph's value, after
  // ANY sequence of edits, retries and reversals). The pending batch is walked
  // IN ORDER against a RUNNING map seeded from the trail: a correction is
  // skipped only if it equals the latest value written so far for its field —
  // by the trail OR by an earlier entry of this same batch. Comparing every
  // entry against the trail alone skipped the second of [B->C, C->B] over a
  // trail ending at B (C->B looked "already there"), leaving the trail at C
  // while the graph said B.
  const running = new Map(latest);
  const toWrite: GraphCorrection[] = [];
  for (const c of corrections) {
    const last = running.get(key(c));
    if (last && norm(last.corrected_value) === norm(c.corrected_value)) continue;
    toWrite.push(c);
    running.set(key(c), c);
  }

  if (ctx) {
    const covered = new Set(corrections.map(key));
    for (const [k, last] of latest) {
      if (covered.has(k)) continue;
      // I-1 (review pass 3): a (node, field) that cannot be found on the graph
      // writes NOTHING. A `null` for "not found" would be a false value on an
      // append-only trail.
      const found = ctx.resolve(last.node_id, last.field);
      if (!found.found) continue;
      if (norm(found.value) === norm(last.corrected_value)) continue;
      toWrite.push({
        correction_id: ctx.newId(),
        graph_version_before: last.graph_version_after,
        graph_version_after: ctx.version,
        node_id: last.node_id,
        field: last.field,
        original_value: last.corrected_value ?? null,
        corrected_value: found.value ?? null,
        corrected_by: ctx.by,
        corrected_at: ctx.now(),
        ...(last.correction_source ? { correction_source: last.correction_source } : {}),
      });
    }
  }
  return { toWrite, sinceLastResult: written.length + toWrite.length };
}

export function intakeReducer(state: IntakeState, action: IntakeAction): IntakeState {
  switch (action.type) {
    case 'DESCRIPTION_CHANGED':
      if (state.step !== 'description_entry') return state;
      // The nudge and the duplicate decision are kept: they are compared with
      // the text at the next press, not wiped by typing (§27.3, §27.1).
      return { ...state, description: action.description };

    case 'NUDGE_SHOWN':
      if (state.step !== 'description_entry') return state;
      return { ...state, nudgeFor: action.nudgeFor };

    case 'DESCRIPTION_EDITED':
      if (state.step !== 'graph_extraction') return state;
      return { ...state, description: action.description };

    case 'RESTART':
      // Deliberately unguarded — see the action comment. Abandoning an
      // in-flight intake is a UI reset only; nothing here touches the
      // append-only audit trail, which is never written from the reducer.
      return { step: 'description_entry', description: '' };

    // FN-006. Forward-only intake meant a typo in the description cost the
    // whole session: the only escape was RESTART, which blanks everything.
    //
    // Where it STOPS is the design, not an omission:
    //  - `confirmation` is an attestation (UC-6). Stepping back across it
    //    would let a submitter un-attest something they have already signed,
    //    so the boundary holds there.
    //  - `evaluation_pending` and `verdict` are past that boundary. A verdict
    //    is corrected through CORRECT_VERDICT_WITH_FORM (VD-3), which is an audited
    //    path — not by walking backwards out of it.
    //  - `contradiction_review` already has its own exit
    //    (CONTRADICTION_RESOLVED) and is left alone.
    //
    // Answers are preserved wherever the target step's shape can hold them.
    case 'STEP_BACK':
      switch (state.step) {
        case 'duplicate_check':
          return {
            step: 'description_entry',
            description: state.description,
            ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
            ...(state.lastRead ? { lastRead: state.lastRead } : {}),
          };
        // R18-C2 (§27.1). Back from the reading step: the read is released by the caller; the
        // description comes back with the decision already made, the nudge and what was last read.
        case 'prefill_reading':
          return {
            step: 'description_entry',
            description: state.description,
            ...(state.decidedFor !== undefined ? { decidedFor: state.decidedFor } : {}),
            ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
            ...(state.lastRead ? { lastRead: state.lastRead } : {}),
          };
        // R18-A (§27.1). Back from the form to the description, for a FRESH case
        // only. A form that carries a case id (a retry after a failed evaluation,
        // a trip back from the questions), a correction, or an after-failure
        // re-entry has an attested or minted case behind it: going back would
        // route the next Continue into a second case. Its only exits stay
        // completing it or RESTART.
        case 'graph_extraction':
          if (
            state.useCaseId !== undefined ||
            state.originalVerdictId !== undefined ||
            state.afterFailedEvaluation === true
          ) {
            return state;
          }
          return {
            step: 'description_entry',
            description: state.description,
            ...(state.decidedFor !== undefined ? { decidedFor: state.decidedFor } : {}),
            ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
            ...(state.lastRead ? { lastRead: state.lastRead } : {}),
          };
        case 'questionnaire':
          // W-3 (R16-W §1, D-69): the questions step back into the form
          // itself, filled in (W-4). Same rule CHANGE_ANSWER uses from
          // confirmation, below. A correction stays a correction on the way
          // back (R16-D2 §5): dropping originalVerdictId/originalGraph here
          // would reopen the "orphaned correction" dead end.
          if (!returnsToForm(state)) return state;
          return {
            step: 'graph_extraction',
            description: carriedDescription(state),
            method: 'form',
            useCaseId: state.useCaseId,
            plainAnswers: state.plainAnswers,
            answerState: state.answerState,
            ...(state.lastRead ? { lastRead: state.lastRead } : {}),
            assumptions: state.assumptions,
            originalVerdictId: state.originalVerdictId,
            originalGraph: state.originalGraph,
          };
        default:
          return state;
      }

    case 'SUBMIT_DESCRIPTION':
      if (state.step !== 'description_entry') return state;
      // R18-A (§27.1): the similar-cases screen was already passed for exactly
      // this text (a Back from the form), so go straight to the form — no second
      // duplicate check and no second duplicate_dismissed on the trail. A changed
      // text runs the check again.
      if (state.decidedFor !== undefined && state.decidedFor === textFingerprint(state.description)) {
        const lastRead = action.lastRead ?? state.lastRead;
        if (action.reading) {
          return {
            step: 'prefill_reading',
            description: state.description,
            decidedFor: state.decidedFor,
            ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
            ...(lastRead ? { lastRead } : {}),
          };
        }
        return {
          step: 'graph_extraction',
          description: state.description,
          method: 'form',
          decidedFor: state.decidedFor,
          ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
          ...(lastRead ? { lastRead } : {}),
        };
      }
      return {
        step: 'duplicate_check',
        description: state.description,
        ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
      };

    case 'NO_DUPLICATE_FOUND': {
      if (state.step !== 'duplicate_check') return state;
      const lastRead = action.lastRead ?? state.lastRead;
      // R18-C2: the form route reads first when the caller asked for it.
      if (action.reading) {
        return {
          step: 'prefill_reading',
          description: state.description,
          decidedFor: textFingerprint(state.description),
          ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
          ...(lastRead ? { lastRead } : {}),
        };
      }
      return {
        step: 'graph_extraction',
        description: state.description,
        method: 'form',
        decidedFor: textFingerprint(state.description),
        ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
        ...(lastRead ? { lastRead } : {}),
      };
    }

    // R18-C2 (§27.5, §27.6): the read ended. The caller merged the pre-fill into the form draft
    // (mergePrefill) BEFORE this dispatch, so the form mounts with it; the reducer carries the same
    // merged state and the new lastRead for a Back that finds the draft gone.
    case 'PREFILL_DONE':
      if (state.step !== 'prefill_reading') return state;
      return {
        step: 'graph_extraction',
        description: state.description,
        method: 'form',
        ...(state.decidedFor !== undefined ? { decidedFor: state.decidedFor } : {}),
        ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
        answerState: action.answerState,
        lastRead: action.lastRead,
      };

    // R18-C2: "Read my description again". Only a FRESH form (the reading step's Back returns to the
    // description, which a case that already carries an id must not do - the same refusal as STEP_BACK).
    case 'READ_AGAIN':
      if (
        state.step !== 'graph_extraction' ||
        state.useCaseId !== undefined ||
        state.originalVerdictId !== undefined ||
        state.afterFailedEvaluation === true
      ) {
        return state;
      }
      return {
        step: 'prefill_reading',
        description: state.description,
        ...(state.decidedFor !== undefined ? { decidedFor: state.decidedFor } : {}),
        ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
        ...(state.answerState ? { answerState: state.answerState } : {}),
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
      };

    case 'FORM_SUBMITTED': {
      // W-3 (R16-W §1, D-69): valid only from the form (graph_extraction).
      if (state.step !== 'graph_extraction') return state;
      const carried = {
        description: action.description,
        graph: action.graph,
        // CR8-03 (P3), defence in depth: a form step that already carries a case
        // id (a retry, a correction) keeps it; the action's id is only for a
        // fresh submission.
        useCaseId: state.useCaseId ?? action.useCaseId,
        // R18-A (§27.6): the only place the PlainAnswers cache is made — from the
        // form's one answer store and THE description (Question 2).
        plainAnswers: toPlainAnswers(action.answerState, action.description),
        answerState: action.answerState,
        // R18-C2 (§27.6): what the model last read travels beside the answers.
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
        assumptions: action.assumptions,
        // R16-D2 §5: carried from THIS state (the correction's start), not
        // from the action — a correction stays the same correction across
        // however many times the form is resubmitted before Confirm.
        originalVerdictId: state.originalVerdictId,
        originalGraph: state.originalGraph,
      };
      // F-6 (DR7-13): the ONE routing rule (nextReviewStep) —
      // generated questions first; failing that, a contradiction stops at
      // its own review; failing that, confirmation.
      switch (nextReviewStep(action.questions, action.contradictions)) {
        case 'questionnaire':
          return {
            step: 'questionnaire',
            ...carried,
            questions: action.questions,
            answers: [],
            resolutionNotes: [],
            // R16-D2 §5: the caller's formCorrections() diff (empty on a
            // fresh submission) — the SAME field the description path's
            // node-level corrections already use, so runConfirmAndEvaluate
            // writes them with no change of its own.
            corrections: action.corrections,
            // B-10 (rewritten, FX-2 review I-3): nothing carried. A submission-
            // time contradiction is re-derived from the CURRENT graph when the
            // questions end (IntakeFlow), never replayed from a stale copy.
          };
        case 'contradiction_review':
          return {
            step: 'contradiction_review',
            ...carried,
            questions: action.questions,
            answers: [],
            contradictions: action.contradictions,
            resolutionNotes: [],
            corrections: action.corrections,
          };
        case 'confirmation':
          return {
            step: 'confirmation',
            ...carried,
            graphVersion: action.graph.version,
            corrections: action.corrections,
            answers: [],
            resolutionNotes: [],
            // CR8-03 (P3): the form path never reaches a Back-able review
            // screen (CHANGE_ANSWER/EVALUATION_FAILED return it to the form),
            // so the guard has nothing to guard here.
            afterFailedEvaluation: false,
          };
      }
    }

    case 'ANSWER_SUBMITTED': {
      if (state.step !== 'questionnaire') return state;
      // v0.7.1 double-submit guard: a question already answered is refused
      // at the reducer, so a double-click cannot record twice and skip the
      // next question (same layering as the R5/R6 gates).
      if (state.answers.some((a) => a.questionId === action.answer.questionId)) return state;
      // R16-E §3 (D-102): a follow-up question (decision_type_other, a
      // supplier/model not on the firm's list) is inserted right after the
      // one just answered — found by id, never by index, so this stays
      // correct regardless of where in the list the current question sits.
      const currentIndex = state.questions.findIndex((q) => q.id === action.answer.questionId);
      const answeredQuestion = currentIndex !== -1 ? state.questions[currentIndex] : undefined;
      const questions =
        action.insertQuestions && action.insertQuestions.length > 0 && currentIndex !== -1
          ? [
              ...state.questions.slice(0, currentIndex + 1),
              ...action.insertQuestions,
              ...state.questions.slice(currentIndex + 1),
            ]
          : state.questions;
      // CR7-02 (3). One assumption per question: a "Not sure" re-answer
      // REPLACES the existing one (same questionId) in place, and a definite
      // answer to a question that had one REMOVES it — otherwise Change an
      // answer -> answer again duplicates the line or leaves a stale
      // "assumed" claim the person has since contradicted (BC-005). The two
      // follow-up questions write onto the field of the question that asked
      // them (vendor_name -> vendor, declared_model_id_name ->
      // declared_model_id), so they clear that field's assumption.
      const answeredField =
        answeredQuestion?.field === 'vendor_name'
          ? 'vendor'
          : answeredQuestion?.field === 'declared_model_id_name'
            ? 'declared_model_id'
            : answeredQuestion?.field;
      let assumptions = state.assumptions;
      if (action.assumption) {
        const incoming = action.assumption;
        const existing = state.assumptions ?? [];
        assumptions = existing.some((a) => a.questionId === incoming.questionId)
          ? existing.map((a) => (a.questionId === incoming.questionId ? incoming : a))
          : [...existing, incoming];
      } else if (state.assumptions && answeredField) {
        assumptions = state.assumptions.filter((a) => a.questionId !== `field:${answeredField}`);
      }
      // ADR-IF-R6-3: when the answer differs from the graph, the caller
      // sends the correction and the updated graph with it — applied here
      // so the attested, evaluated graph is the one the user answered.
      return {
        ...state,
        questions,
        answers: [...state.answers, action.answer],
        undo: {
          graph: state.graph,
          correctionsLen: state.corrections.length,
          questions: state.questions,
          // CR7-02 (4): the array itself (see the type's comment).
          assumptions: state.assumptions ?? [],
        },
        ...(action.updatedGraph ? { graph: action.updatedGraph } : {}),
        ...(action.correction ? { corrections: [...state.corrections, action.correction] } : {}),
        ...(assumptions ? { assumptions } : {}),
      };
    }

    case 'ANSWER_UNDONE': {
      if (state.step !== 'questionnaire' || !state.undo || state.answers.length === 0) return state;
      const { undo, ...rest } = state;
      return {
        ...rest,
        answers: state.answers.slice(0, -1),
        graph: undo.graph,
        corrections: state.corrections.slice(0, undo.correctionsLen),
        // CR6-04 (Critical, BC-002): defensive fallback — a snapshot from
        // before 9348882 has no `questions` at all (`undefined`), which
        // QuestionnaireStep then indexes (`questions[answeredCount]`) and
        // crashes on. Falling back to the CURRENT questions is the honest
        // "nothing to undo for this part" behaviour, never a crash.
        questions: undo.questions ?? state.questions,
        // CR7-02 (4): restored from the snapshot's array. A snapshot an older
        // build wrote has only `assumptionsLen` — sliced as before.
        ...(undo.assumptions !== undefined
          ? { assumptions: undo.assumptions }
          : state.assumptions
            ? { assumptions: state.assumptions.slice(0, undo.assumptionsLen ?? state.assumptions.length) }
            : {}),
      };
    }

    case 'CONTRADICTIONS_DETECTED':
      if (state.step !== 'questionnaire') return state;
      return {
        step: 'contradiction_review',
        description: carriedDescription(state),
        graph: state.graph,
        questions: state.questions,
        answers: state.answers,
        contradictions: action.contradictions,
        resolutionNotes: state.resolutionNotes,
        ...(state.explainedContradictions ? { explainedContradictions: state.explainedContradictions } : {}),
        corrections: state.corrections,
        useCaseId: state.useCaseId,
        originalVerdictId: state.originalVerdictId,
        // R16-D2 §5: threaded forward alongside originalVerdictId.
        originalGraph: state.originalGraph,
        // W-4: carried so a form-path contradiction review still has them
        // once it returns to the questionnaire and on to confirmation.
        plainAnswers: state.plainAnswers,
        answerState: state.answerState,
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
        assumptions: state.assumptions,
        // F-7: threaded forward, never re-derived.
        uncertainNodeIds: state.uncertainNodeIds,
      };

    case 'CONTRADICTION_RESOLVED':
      // BC-P4C03-03 defense in depth: reject an empty/whitespace-only
      // explanation at the reducer layer too, not just the UI's
      // disabled-button check.
      if (state.step !== 'contradiction_review' || !action.explanation.trim()) return state;
      return {
        step: 'questionnaire',
        description: carriedDescription(state),
        graph: state.graph,
        questions: state.questions,
        answers: state.answers,
        resolutionNotes: [...state.resolutionNotes, action.explanation.trim()],
        // B-10c: what was just explained is remembered by identity.
        explainedContradictions: [
          ...(state.explainedContradictions ?? []),
          ...state.contradictions.map(contradictionKey),
        ],
        corrections: state.corrections,
        useCaseId: state.useCaseId,
        originalVerdictId: state.originalVerdictId,
        // R16-D2 §5: threaded forward alongside originalVerdictId.
        originalGraph: state.originalGraph,
        // W-4: see CONTRADICTIONS_DETECTED's comment above.
        plainAnswers: state.plainAnswers,
        answerState: state.answerState,
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
        assumptions: state.assumptions,
        // F-7: threaded forward, never re-derived.
        uncertainNodeIds: state.uncertainNodeIds,
      };

    case 'PROCEED_TO_CONFIRMATION':
      if (state.step !== 'questionnaire') return state;
      return {
        step: 'confirmation',
        description: carriedDescription(state),
        graph: state.graph,
        graphVersion: state.graph.version,
        corrections: state.corrections,
        answers: state.answers,
        resolutionNotes: state.resolutionNotes,
        useCaseId: state.useCaseId,
        originalVerdictId: state.originalVerdictId,
        // R16-D2 §5: threaded forward alongside originalVerdictId.
        originalGraph: state.originalGraph,
        // W-4: the one place a form-path intake reaches confirmation
        // without a question or a contradiction ever firing — still has
        // to carry these, same as FORM_SUBMITTED's own confirmation exit.
        plainAnswers: state.plainAnswers,
        answerState: state.answerState,
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
        assumptions: state.assumptions,
        // F-7: threaded forward, never re-derived.
        uncertainNodeIds: state.uncertainNodeIds,
        // CR8-03 (P3): see the confirmation type. The one route never sets it.
        afterFailedEvaluation: false,
      };

    case 'CHANGE_ANSWER':
      if (state.step !== 'confirmation') return state;
      // Returns to the guided form itself, filled in (W-4: plainAnswers/
      // assumptions/useCaseId carried so StructuredForm reopens with its
      // answers and a resubmission reuses the same use case - see "One use
      // case, one creation event" §1).
      //
      // R16-D2 §5 (v2.1): originalVerdictId/originalGraph are carried too -
      // before this fix, "Change an answer" during a correction lost both, so
      // the eventual re-confirm ran as a FRESH confirm and the F-1
      // precondition refused it as "already has a result": safe (nothing
      // written) but a dead end.
      if (!returnsToForm(state)) return state;
      return {
        step: 'graph_extraction',
        description: state.description,
        method: 'form',
        useCaseId: state.useCaseId,
        plainAnswers: state.plainAnswers,
        answerState: state.answerState,
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
        assumptions: state.assumptions,
        originalVerdictId: state.originalVerdictId,
        originalGraph: state.originalGraph,
      };

    case 'CONFIRMED':
      if (state.step !== 'confirmation') return state;
      return {
        step: 'evaluation_pending',
        graph: state.graph,
        useCaseId: state.useCaseId,
        originalVerdictId: state.originalVerdictId,
        // R16-D2 §5: threaded forward alongside originalVerdictId, for the
        // identical reason — EVALUATION_FAILED hands it straight back too.
        originalGraph: state.originalGraph,
        description: state.description,
        // F-2 (DR7-04): carried so EVALUATION_FAILED can hand a form-path
        // graph straight back to the filled-in form.
        plainAnswers: state.plainAnswers,
        answerState: state.answerState,
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
        assumptions: state.assumptions,
        // CR7-02: so EVALUATION_FAILED can hand it back.
        uncertainNodeIds: state.uncertainNodeIds,
      };

    case 'VERDICT_READY':
      if (state.step !== 'evaluation_pending') return state;
      return { step: 'verdict', verdictId: state.useCaseId };

    case 'EVALUATION_FAILED': {
      // Back to the form, not stuck on "Evaluating..." forever.
      if (state.step !== 'evaluation_pending') return state;
      // F-2 (DR7-04). Back to the FORM itself - the same filled-in shape
      // FORM_SUBMITTED/CHANGE_ANSWER/the form-path STEP_BACK already produce.
      // `useCaseId` is reused (the case already has a graph_confirmed
      // attestation on the trail); the next Confirm passes the F-1
      // precondition and writes a new one - a deliberate second attestation.
      //
      // A correction that has lost its answers or its original graph (a
      // damaged state; both ways of opening a correction carry them) lands on
      // a fresh form with the description only: never an empty form in
      // correction mode, which would record "no answers changed".
      if (!returnsToForm(state)) {
        return { step: 'graph_extraction', description: carriedDescription(state), method: 'form' };
      }
      return {
        step: 'graph_extraction',
        description: carriedDescription(state),
        method: 'form',
        useCaseId: state.useCaseId,
        plainAnswers: state.plainAnswers,
        answerState: state.answerState,
        ...(state.lastRead ? { lastRead: state.lastRead } : {}),
        assumptions: state.assumptions,
        // R16-D2 §5 (v2.1): a genuine evaluation failure during a form
        // correction must not drop the correction context either.
        originalVerdictId: state.originalVerdictId,
        originalGraph: state.originalGraph,
      };
    }

    // R16-D2 §5 (D-82). "Correct your answers" on the verdict, in the same session.
    case 'CORRECT_VERDICT_WITH_FORM':
      if (state.step !== 'verdict') return state;
      return {
        step: 'graph_extraction',
        description: action.description,
        method: 'form',
        useCaseId: action.useCaseId,
        plainAnswers: toPlainAnswers(action.answerState, action.description),
        answerState: action.answerState,
        ...(action.lastRead ? { lastRead: action.lastRead } : {}),
        assumptions: action.assumptions,
        originalVerdictId: action.originalVerdictId,
        originalGraph: action.originalGraph,
      };

    // R18-D2 (§27.10). See the action's comment. `lastRead` is seeded with the opened description's own
    // fingerprint and the outcome 'not-read': the text counts as already dealt with, so nothing asks a model
    // about it again, and the outcome claims nothing about a read this session (the record does not say what text
    // was read). A correction has no Back, so no read can be started from here in any case.
    case 'OPEN_CORRECTION_FROM_RECORD':
      if (state.step === 'evaluation_pending') return state;
      return {
        step: 'graph_extraction',
        description: action.description,
        method: 'form',
        useCaseId: action.useCaseId,
        plainAnswers: toPlainAnswers(action.answerState, action.description),
        answerState: action.answerState,
        lastRead: { fingerprint: textFingerprint(action.description), outcome: 'not-read' },
        assumptions: action.assumptions,
        originalVerdictId: action.originalVerdictId,
        originalGraph: action.originalGraph,
      };

    default:
      return state;
  }
}
