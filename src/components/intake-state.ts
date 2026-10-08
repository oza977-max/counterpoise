// Intake flow state machine (intake-flow.md §3). Kept separate from
// IntakeFlow.tsx so the reducer is independently unit-testable without
// React Testing Library (Dan Vanderkam: typed discriminated unions).
import type { Contradiction, DataFlowGraph, GraphCorrection, IntakeQuestion, QuestionAnswer } from '../engine/types';
import type { Assumption, PlainAnswers } from './plain-copy';
import type { AuditEvent } from '../store/types';
import type { ChecklistItemId, FormAnswerState } from '../engine/prefill-types';
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
    }
  | { step: 'duplicate_check'; description: string; nudgeFor?: ChecklistItemId[] }
  | {
      step: 'graph_extraction';
      description: string;
      // D-1 (Minor): this is intake-flow's OWN method name, not the
      // graph's — the engine's field (DataFlowGraph.intake_method,
      // engine/types.ts) is 'llm' | 'structured_form'. Two spellings for
      // the same concept; a test fixture once used the invalid value
      // 'form' here and nothing caught it. Kept distinct on purpose
      // (this one is a UI routing choice made before any graph exists),
      // but read the two together before changing either.
      method: 'llm' | 'form';
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
      step: 'graph_review';
      // Round 4 (charter 004 D-001, charter 005 O-001). The description was
      // dropped from graph_review onward, which cost two things: the submitter
      // never saw their own words again after typing them, and
      // detectContradictions ran against a separate useState that a restored
      // draft never repopulated — so a resumed session checked answers against
      // an empty string and quietly found nothing. Carrying it on the state
      // fixes both, because the draft envelope persists the state.
      description: string;
      graph: DataFlowGraph;
      graphVersion: number;
      corrections: GraphCorrection[];
      useCaseId: string;
      // Present only on a correction pass (P5-C01, verdict-audit.md §6) —
      // undefined on a fresh submission.
      originalVerdictId?: string;
      // R5-GR-2 (ADR-IF-R5-1). Node ids the human has not yet confirmed or
      // corrected. Populated ONLY when the graph came from the LLM path —
      // form-path values were typed by a human, and a correction pass or
      // evaluation-failure re-entry attests nothing new. Ephemeral review
      // state: never written to the audit trail; the graph_confirmed
      // attestation stays the recorded act.
      unconfirmedNodeIds?: string[];
      // R6 (ADR-IF-R6-1): intake artifacts travelling BESIDE the graph.
      // provenance[nodeId][field] = VERIFIED verbatim quote from the
      // description; guessedFields[nodeId] = decision-bearing fields with
      // no verified basis. Ephemeral review state, like unconfirmedNodeIds.
      provenance?: Record<string, Record<string, string>>;
      guessedFields?: Record<string, string[]>;
      // R7-JC (ADR-IF-R7-1): false on the LLM path until the human confirms
      // or edits the extracted jurisdictions — the field that selects which
      // regulatory PACKS evaluate must never stay model-asserted. Absent on
      // the form path (explicit answer, R3-JU) and re-entry paths.
      jurisdictionsConfirmed?: boolean;
      // R5-GX-1 (ADR-IF-R5-2). Jurisdiction strings the extractor returned
      // that the loaded policy does not recognise — removed from the graph
      // before the human sees it, surfaced so the removal is visible.
      ignoredJurisdictions?: string[];
      // M-2 (FX-2 review). Present only after a Back from the questionnaire:
      // the FROZEN uncertainNodeIds from the first QUESTIONS_GENERATED, so a
      // Back + Continue does not re-derive it from the since-trimmed
      // guessedFields.
      uncertainNodeIds?: string[];
      // F-2 (DR7-04). Set by EVALUATION_FAILED on a description-path graph
      // ONLY — this is a re-entry after a genuine engine/policy failure,
      // not a fresh submission, so it must not be walked out of the same
      // way a correction pass (originalVerdictId) cannot be: STEP_BACK
      // returns the state unchanged, and canStepBack (IntakeFlow.tsx) is
      // false here, exactly mirroring the correction-pass rule. Absent on
      // every other route into graph_review.
      afterFailedEvaluation?: boolean;
      // CR7-02 (BC-004). The "Not sure" assumptions this case has recorded so
      // far, carried onto the review screen by every way BACK into it that
      // keeps the answers behind them: CHANGE_ANSWER, EVALUATION_FAILED and
      // CORRECT_VERDICT. Deliberately NOT carried by STEP_BACK from the
      // questionnaire — those answers are re-asked (CR7-03), and an
      // assumption without its answer would be listed back as made.
      assumptions?: Assumption[];
      // CR7-02 (6). Set on CHANGE_ANSWER / EVALUATION_FAILED / CORRECT_VERDICT
      // (this screen is being revisited, not read for the first time): the
      // values on it were all stated or checked already, so GraphView must
      // not label every one "no basis" (a false claim about the description).
      reentry?: boolean;
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
      // defense in depth for anything that still does. CR6-03's own
      // `guessedFields` snapshot is newer still, optional for the
      // identical reason.
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
        guessedFields?: Record<string, string[]>;
      };
      // W-3/W-4 (R16-W §1). Present only when this questionnaire was
      // reached via FORM_SUBMITTED (the form path's own questions, if
      // any) — carried so a form-path STEP_BACK can return to the form
      // filled in, and so the summary can still show the "Not sure"
      // assumptions once the graph reaches confirmation. Absent on the
      // description/LLM path, which never sets them.
      plainAnswers?: PlainAnswers;
      answerState?: FormAnswerState;
      assumptions?: Assumption[];
      // F-7 (DR7-07). Node ids the LLM path flagged uncertain/guessed,
      // captured from graph_review's own `guessedFields` at the moment
      // QUESTIONS_GENERATED leaves that step — set once, here, then
      // threaded forward through every subsequent transition (never
      // re-derived, since graph_review's own guessedFields field does not
      // exist past that step). Replaces the `uncertainNodeIds` useState
      // IntakeFlow.tsx used to hold instead, which a refresh silently
      // dropped (the draft only ever persisted IntakeState). Absent/empty
      // on the form path, which never sets guessedFields.
      uncertainNodeIds?: string[];
      // CR6-03 (Critical). Carried from graph_review's own guessedFields/
      // provenance/unconfirmedNodeIds/jurisdictionsConfirmed at the SAME
      // moment QUESTIONS_GENERATED captures uncertainNodeIds above — and
      // restored on STEP_BACK, so Back does not turn off the R5-GR-2/
      // R7-JC review gate it left behind. Unlike uncertainNodeIds (frozen:
      // it records what the description did NOT say, which stays true
      // after the person answers), guessedFields here means "still to
      // ask" — ANSWER_SUBMITTED trims a field out of it the moment that
      // field is answered, so a later Back + Continue does not regenerate
      // a question for it. unconfirmedNodeIds/jurisdictionsConfirmed are
      // threaded through UNCHANGED (QUESTIONS_GENERATED's own guard never
      // lets a non-empty unconfirmedNodeIds or a false jurisdictionsConfirmed
      // reach here, so what's carried is always either undefined — no
      // gate, the form path and correction/evaluation-failure re-entries —
      // or the concrete "everything already checked" values).
      guessedFields?: Record<string, string[]>;
      provenance?: Record<string, Record<string, string>>;
      unconfirmedNodeIds?: string[];
      jurisdictionsConfirmed?: boolean;
      // M-2 (FX-2 review). Carried from graph_review at QUESTIONS_GENERATED
      // (and threaded through a contradiction round trip) so Back restores
      // the "We ignored X" notice instead of silently dropping it.
      ignoredJurisdictions?: string[];
      // CR7-03 (BC-004). What the review screen held at the moment the
      // questions were generated, so Back puts the person where they started
      // and every question — including a guessed supplier or model they
      // rejected with "Not on this list" — is asked again from those values.
      // Without these, Back kept the answered values on the graph and trimmed
      // the guessed list, so a rejected guess silently reached the result.
      // Set once at QUESTIONS_GENERATED and threaded through every step that
      // can lead back (ANSWER_SUBMITTED, ANSWER_UNDONE, CONTRADICTIONS_DETECTED,
      // CONTRADICTION_RESOLVED). Absent on a draft saved before this change:
      // STEP_BACK then falls back to the previous behaviour (CR7-28 covers the
      // old-draft hole).
      backGraph?: DataFlowGraph;
      backCorrections?: GraphCorrection[];
      askedGuessedFields?: Record<string, string[]>;
      // CR7-02 (6), carried so a Back from here to a REVISITED review screen
      // (Change an answer -> Continue -> Back) is still marked as revisited;
      // dropping it would bring back every "no basis" label.
      reentry?: boolean;
      // FX7-1 review pass 1 (I-2, I-3). The rest of what the review screen
      // held when the questions were generated, for the same reason as
      // backGraph: Back must put the person exactly where they were. The
      // assumptions of an EARLIER round stay (their strict values are on the
      // restored graph; dropping them would present those values as firmer than
      // they are), the ones given in this round are re-asked; and a review
      // re-entered after a failed evaluation stays one (Back from it is refused).
      backAssumptions?: Assumption[];
      backUncertainNodeIds?: string[];
      backAfterFailedEvaluation?: boolean;
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
      assumptions?: Assumption[];
      // F-7: see the questionnaire variant's comment above.
      uncertainNodeIds?: string[];
      ignoredJurisdictions?: string[];
      // CR6-03: see the questionnaire variant's comment above — threaded
      // through a contradiction-review round trip the same way
      // uncertainNodeIds already is, so a Back from the questionnaire
      // reached via CONTRADICTION_RESOLVED still restores the right gate.
      guessedFields?: Record<string, string[]>;
      provenance?: Record<string, Record<string, string>>;
      unconfirmedNodeIds?: string[];
      jurisdictionsConfirmed?: boolean;
      // CR7-03: see the questionnaire variant's comment.
      backGraph?: DataFlowGraph;
      backCorrections?: GraphCorrection[];
      askedGuessedFields?: Record<string, string[]>;
      reentry?: boolean;
      // FX7-1 review pass 1: see the questionnaire variant's comment.
      backAssumptions?: Assumption[];
      backUncertainNodeIds?: string[];
      backAfterFailedEvaluation?: boolean;
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
      assumptions?: Assumption[];
      // F-7: see the questionnaire variant's comment above — this is what
      // IntakeFlow now reads directly for UnderstoodSummary's "uncertain"
      // list, replacing the component `useState` of the same name.
      uncertainNodeIds?: string[];
      // CR8-03 (P3 — once a case has a confirmed attestation, no navigation can
      // start a new case id for it). REQUIRED, so a transition that builds a
      // confirmation and forgets it fails to compile. True when this case has
      // already been through a failed evaluation (graph_confirmed is on its
      // trail): CHANGE_ANSWER hands it back to the review screen, whose Back
      // is then refused (STEP_BACK) exactly as it was before the confirmation.
      // Source at PROCEED_TO_CONFIRMATION: the questionnaire's own
      // `backAfterFailedEvaluation` (the questionnaire has no
      // afterFailedEvaluation). A draft saved by a build before this fix has no
      // flag here and reads as false — accepted: the window is a confirmation
      // draft saved after a failure and restored by an older tab.
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
      // Review 004 finding 2: carried so a failed evaluation can restore a
      // WORKING review screen — description visible, jurisdictions editable.
      description?: string;
      // F-2 (DR7-04). Carried from the confirmation state so EVALUATION_FAILED
      // can hand them straight back: a form-path graph returns to the form
      // itself (graph_extraction), which needs both to reopen filled in; a
      // description-path graph returns to graph_review, which does not read
      // these directly but a later re-confirm still needs them threaded
      // onward exactly as any other confirmation re-entry does.
      plainAnswers?: PlainAnswers;
      answerState?: FormAnswerState;
      assumptions?: Assumption[];
      // CR7-02: carried from the confirmation state so EVALUATION_FAILED can
      // hand the frozen "what the description did not say" list back to the
      // review screen instead of dropping it.
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
  | { type: 'SUBMIT_DESCRIPTION' }
  | { type: 'NO_DUPLICATE_FOUND'; method: 'llm' | 'form' }
  // useCaseId generated once by the caller at graph extraction (P5-C01 —
  // moved earlier than P4-C04's questionnaire-entry generation so a
  // correction pass, which re-enters at graph_review, can reuse it
  // instead of generating a new one; BC-P5C01-01).
  | {
      type: 'GRAPH_EXTRACTED';
      graph: DataFlowGraph;
      useCaseId: string;
      ignoredJurisdictions?: string[];
      provenance?: Record<string, Record<string, string>>;
      guessedFields?: Record<string, string[]>;
    }
  // R16-E §5 (D-104, DR7-30/AB-1). "Answer the questions instead" — a
  // failed extraction's own second button. Valid only from the LLM path's
  // graph_extraction; `description` is already there and StructuredForm
  // already pre-fills from it (`initialDescription`), so this is a pure
  // method flip, not a new carrier of state.
  | { type: 'SWITCH_TO_FORM' }
  // W-3 (R16-W §1, D-69). Valid only from graph_extraction with
  // method: 'form' — GRAPH_EXTRACTED (above) stays the description path's
  // own action; the form path's screen-after-screen field-card review
  // (`graph_review`) is engine vocabulary principle 1 bans from a path
  // where the person picked every value themselves, so this skips it.
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
  | { type: 'CORRECTION_APPLIED'; correction: GraphCorrection; updatedGraph: DataFlowGraph }
  // R5-GR-2: the human states a model-proposed node is right as shown.
  | { type: 'NODE_CONFIRMED'; nodeId: string }
  // R7-JC: accept the extracted jurisdictions as shown…
  | { type: 'JURISDICTIONS_CONFIRMED' }
  // …or replace them (policy-scoped codes only, enforced by the caller's
  // UI); the edit is a recorded correction and confirms implicitly.
  | { type: 'JURISDICTIONS_SET'; updatedGraph: DataFlowGraph; correction: GraphCorrection }
  | { type: 'QUESTIONS_GENERATED'; questions: IntakeQuestion[] }
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
  // VD-3 (verdict-audit.md §6): re-enters graph_review reusing the
  // ORIGINAL useCaseId, carrying the id of the verdict being corrected.
  // CR7-02: `assumptions`/`uncertainNodeIds` — what the verdict being
  // corrected was confirmed on (IntakeFlow's `lastConfirmed`), so the
  // correction pass's own confirmation still lists the "Not sure" answers.
  | {
      type: 'CORRECT_VERDICT';
      graph: DataFlowGraph;
      useCaseId: string;
      originalVerdictId: string;
      assumptions?: Assumption[];
      uncertainNodeIds?: string[];
    }
  // R16-D2 §5 (D-82, DR7-17). The form-path counterpart to CORRECT_VERDICT
  // above: re-enters at the GUIDED FORM itself (graph_review is engine
  // vocabulary a form-built case has no business showing, principle 1),
  // filled in with what was last confirmed, carrying the id of the verdict
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
// priority used to be written twice: once here (FORM_SUBMITTED, below) and
// once in IntakeFlow.tsx's `handleProceedFromGraphReview` (the description
// path's own exit from graph_review). One pure function, used by both —
// behaviour unchanged, the priority pinned once.
export function nextReviewStep(
  questions: IntakeQuestion[],
  contradictions: Contradiction[],
): 'questionnaire' | 'contradiction_review' | 'confirmation' {
  if (questions.length > 0) return 'questionnaire';
  if (contradictions.length > 0) return 'contradiction_review';
  return 'confirmation';
}

/** R16-D2 §5 (v2.1). Whether a step back, "Change an answer" or an
 *  evaluation failure returns to the guided form. A form-built graph does —
 *  EXCEPT in a correction whose form answers and original graph are not both
 *  in hand (a correction that came through the review screen,
 *  CORRECT_VERDICT): that goes back to the review screen instead. An empty
 *  form in correction mode would rebuild the case from blank answers and,
 *  with no original graph to diff against, record "no answers changed" — a
 *  false record on the append-only trail. */
function returnsToForm(state: {
  graph: DataFlowGraph;
  plainAnswers?: PlainAnswers;
  originalVerdictId?: string;
  originalGraph?: DataFlowGraph;
}): boolean {
  if (state.graph.intake_method !== 'structured_form') return false;
  if (!state.originalVerdictId) return true;
  return state.plainAnswers !== undefined && state.originalGraph !== undefined;
}

/** The submitted description, carried forward wherever the current step still
 *  has it. `evaluation_pending` and `verdict` do not, so a correction pass
 *  re-enters graph_review without it — pre-existing, out of scope for the
 *  D-001/O-001 fix, and recorded here rather than hidden behind a cast. */
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

/** Resolver for planCorrectionWrites. Description path: by node id (`graph` is
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

/** CR8-01 / CR9 OB-1 (P2, P7 — an assumption is listed back only while EVERY field it
 *  covers still holds the value it assumed). Called when the person edits `field` on the
 *  review screen (CORRECTION_APPLIED, JURISDICTIONS_SET): any assumption whose `fields`
 *  include the edited field is removed WHOLE. It is not narrowed — a sentence such as
 *  "we assumed it acts on its own" names the edited field in words, so keeping it with
 *  one field struck off would still list a claim the person has just overridden.
 *  - An assumption with absent/empty `fields` (a draft saved by an older build)
 *    cannot be matched to a field, so any edit drops it: the safe direction.
 *  - Accepted limit: a description-path assumption carries no node id, so an
 *    edit of that field on one node drops the assumption for any node. It is
 *    only over-removal when the field exists on more than one node; the
 *    honest direction (we list less, never a stale claim). A node id is NOT
 *    added to Assumption — the hand-off schema would strip it (BC-002).
 *  - `keepQuestionIds`: assumptions the edit cannot make untrue. The countries
 *    panel cannot express "somewhere else", so a countries edit keeps the
 *    CR7-23 question-11 assumption ("it reaches countries beyond the ones
 *    listed"): its disclosure stays true.
 *  - ANSWER_SUBMITTED removes only the exact `field:X` id of the question just
 *    answered; that is a different action and is deliberately left as it is.
 *  - The Undo snapshot is questionnaire-only, so Undo cannot resurrect an
 *    assumption this removes on the review screen. */
function dropAssumptionsCovering(
  assumptions: Assumption[] | undefined,
  field: string,
  keepQuestionIds: readonly string[] = [],
): Assumption[] | undefined {
  if (!assumptions) return assumptions;
  return assumptions.filter((a) => {
    if (keepQuestionIds.includes(a.questionId)) return true;
    if (!a.fields || a.fields.length === 0) return false;
    return !a.fields.includes(field);
  });
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
      if (state.step !== 'graph_extraction' || state.method !== 'form') return state;
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
    //    is corrected through CORRECT_VERDICT (VD-3), which is an audited
    //    path — not by walking backwards out of it.
    //  - `contradiction_review` already has its own exit
    //    (CONTRADICTION_RESOLVED) and is left alone.
    //
    // Answers are preserved wherever the target step's shape can hold them.
    // Going back from the questionnaire to graph_review drops the answers
    // because graph_review carries none — and that is the right behaviour
    // rather than a limitation: if the graph changes, the questions are
    // regenerated from it, so keeping answers to superseded questions would
    // be worse than asking again.
    case 'STEP_BACK':
      switch (state.step) {
        case 'duplicate_check':
          return {
            step: 'description_entry',
            description: state.description,
            ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
          };
        // R18-A (§27.1). Back from the form to the description, for a FRESH case
        // only. A form that carries a case id (a retry after a failed evaluation,
        // a trip back from the questions), a correction, or an after-failure
        // re-entry has an attested or minted case behind it: going back would
        // route the next Continue into a second case. Its only exits stay
        // completing it or RESTART (the same rule as graph_review below).
        case 'graph_extraction':
          if (
            state.method !== 'form' ||
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
          };
        case 'graph_review':
          // A CORRECTION pass re-enters here as its first step (VD-3) with no
          // description — "back" would land in a duplicate check for an empty
          // string, and proceeding from there drops originalVerdictId,
          // silently turning a correction of a recorded verdict into a fresh
          // blank draft. Found live (2026-08-15). A correction's only exits
          // are completing it or RESTART.
          //
          // F-2 (DR7-04): a re-entry after a genuine evaluation failure
          // (afterFailedEvaluation) is refused for the identical reason —
          // the case already has a graph_confirmed attestation on the
          // trail, and "back" must not route the next Continue into
          // minting a second, orphaned case the way it used to.
          if (state.originalVerdictId || state.afterFailedEvaluation) return state;
          return { step: 'duplicate_check', description: carriedDescription(state) };
        case 'questionnaire':
          // W-3 (R16-W §1, D-69): a form-path graph steps back into the
          // form itself, filled in (W-4) — not the retired field-card
          // screen, which the form path no longer visits on the way
          // forward either (FORM_SUBMITTED skips straight past it). Same
          // intake_method branch CHANGE_ANSWER already uses from
          // confirmation, below.
          if (returnsToForm(state)) {
            return {
              step: 'graph_extraction',
              description: carriedDescription(state),
              method: 'form',
              useCaseId: state.useCaseId,
              plainAnswers: state.plainAnswers,
              answerState: state.answerState,
              assumptions: state.assumptions,
              // R16-D2 §5: a correction pass must stay a correction pass on
              // the way back into the form too — dropping these here would
              // reopen the identical "orphaned correction" dead end §5
              // closes for CHANGE_ANSWER/EVALUATION_FAILED, just reached via
              // Back from the questionnaire instead.
              originalVerdictId: state.originalVerdictId,
              originalGraph: state.originalGraph,
            };
          }
          // CR7-03 (BC-004). The graph, the corrections and the guessed list
          // come back from the snapshot taken when the questions were
          // generated — NOT from what the answers have since changed. Every
          // question is therefore asked again from the pre-questionnaire
          // values, including a guessed supplier or model the person rejected
          // ("Not on this list") and a "Not sure" answer. CR7-02 (2): this
          // return trip carries NO assumptions, because their answers are
          // re-asked — keeping one would list a "Not sure" the person has not
          // given this time. A questionnaire saved before the snapshot existed
          // has none (`backGraph` absent): it steps back as it did before.
          const backGraph = state.backGraph ?? state.graph;
          const hasSnapshot = state.backGraph !== undefined;
          return {
            step: 'graph_review',
            description: carriedDescription(state),
            graph: backGraph,
            graphVersion: backGraph.version,
            corrections: state.backCorrections ?? state.corrections,
            useCaseId: state.useCaseId,
            // A correction pass must stay a correction pass — dropping this
            // would orphan the verdict being corrected.
            originalVerdictId: state.originalVerdictId,
            // CR6-03 (Critical). Restored from questionnaire's own carried
            // copies (set once, at QUESTIONS_GENERATED) — never left
            // undefined here, which used to silently turn OFF the R5-GR-2/
            // R7-JC review gate on return. unconfirmedNodeIds/
            // jurisdictionsConfirmed are whatever QUESTIONS_GENERATED's
            // own guard already proved safe to carry: undefined (no gate —
            // the form path, a correction, an evaluation-failure re-entry)
            // or the concrete "everything already checked" values — never
            // the gate reappearing non-empty/false.
            guessedFields: state.askedGuessedFields ?? state.guessedFields,
            ...(state.reentry ? { reentry: true } : {}),
            // FX7-1 review pass 1 (I-2, I-3): back to what the review held. An
            // earlier round's assumptions return with their strict values; this
            // round's are re-asked. Without a snapshot (an older draft) none.
            ...(hasSnapshot && state.backAssumptions ? { assumptions: state.backAssumptions } : {}),
            ...(hasSnapshot && state.backAfterFailedEvaluation ? { afterFailedEvaluation: true } : {}),
            provenance: state.provenance,
            unconfirmedNodeIds: state.unconfirmedNodeIds,
            jurisdictionsConfirmed: state.jurisdictionsConfirmed,
            // M-2: the notice and the frozen record both survive the trip.
            ...(state.ignoredJurisdictions ? { ignoredJurisdictions: state.ignoredJurisdictions } : {}),
            // The frozen record (M-2, FX-2): what the first generation derived
            // from the guessed list; the snapshot only matters if it differs.
            ...((state.backUncertainNodeIds ?? state.uncertainNodeIds)
              ? { uncertainNodeIds: state.backUncertainNodeIds ?? state.uncertainNodeIds }
              : {}),
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
        return {
          step: 'graph_extraction',
          description: state.description,
          method: 'form',
          decidedFor: state.decidedFor,
          ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
        };
      }
      return {
        step: 'duplicate_check',
        description: state.description,
        ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
      };

    case 'NO_DUPLICATE_FOUND':
      if (state.step !== 'duplicate_check') return state;
      return {
        step: 'graph_extraction',
        description: state.description,
        method: action.method,
        decidedFor: textFingerprint(state.description),
        ...(state.nudgeFor ? { nudgeFor: state.nudgeFor } : {}),
      };

    case 'GRAPH_EXTRACTED':
      if (state.step !== 'graph_extraction') return state;
      // CR8-03 (P3), defence in depth: GRAPH_EXTRACTED is the description path's
      // exit and mints the case id; a form-method step (reached by a failed
      // evaluation, Change an answer or a correction, carrying the attested
      // case) must never take it. Narrowed to a step that already carries a case
      // id: a bare form step (no id yet) is the one existing, pinned shape
      // (TC-R5-GR-2-03) and holds no attested case to protect.
      if (state.method === 'form' && state.useCaseId !== undefined) return state;
      return {
        step: 'graph_review',
        description: carriedDescription(state),
        graph: action.graph,
        graphVersion: action.graph.version,
        corrections: [],
        useCaseId: action.useCaseId,
        // R5-GR-2: only machine-proposed values need human confirmation.
        // The form path's values were typed by a person — an extra confirm
        // pass there would be ceremony, and ceremony trains blind clicking.
        ...(state.method === 'llm'
          ? {
              // ADR-IF-R6-2: nodes with guessed fields are EXCLUDED — their
              // resolution path is a correction or the questionnaire, never
              // a one-click confirm of a value nobody stated.
              unconfirmedNodeIds: [
                ...action.graph.input_nodes,
                ...action.graph.processing_nodes,
                ...action.graph.output_nodes,
              ]
                .map((n) => n.id)
                .filter((id) => !(action.guessedFields && (action.guessedFields[id]?.length ?? 0) > 0)),
              ...(action.provenance ? { provenance: action.provenance } : {}),
              ...(action.guessedFields ? { guessedFields: action.guessedFields } : {}),
              jurisdictionsConfirmed: false,
            }
          : {}),
        ...(action.ignoredJurisdictions && action.ignoredJurisdictions.length > 0
          ? { ignoredJurisdictions: action.ignoredJurisdictions }
          : {}),
      };

    // R16-E §5. A pure method flip — `description` (and, on a correction,
    // `originalVerdictId`/`originalGraph`) are already on this state and
    // need no change; StructuredForm's own `initialDescription` prop picks
    // up the carried description unchanged.
    case 'SWITCH_TO_FORM':
      if (state.step !== 'graph_extraction' || state.method !== 'llm') return state;
      return { ...state, method: 'form' };

    case 'FORM_SUBMITTED': {
      // W-3 (R16-W §1, D-69): valid only from the form's own
      // graph_extraction — GRAPH_EXTRACTED (above) is the description
      // path's exit from this step, never this one's.
      if (state.step !== 'graph_extraction' || state.method !== 'form') return state;
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
        assumptions: action.assumptions,
        // R16-D2 §5: carried from THIS state (the correction's start), not
        // from the action — a correction stays the same correction across
        // however many times the form is resubmitted before Confirm.
        originalVerdictId: state.originalVerdictId,
        originalGraph: state.originalGraph,
      };
      // F-6 (DR7-13): the ONE routing rule, shared with
      // handleProceedFromGraphReview's dispatch choice (IntakeFlow.tsx) —
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

    case 'CORRECTION_APPLIED':
      if (state.step !== 'graph_review') return state;
      return {
        ...state,
        graph: action.updatedGraph,
        graphVersion: action.updatedGraph.version,
        corrections: [...state.corrections, action.correction],
        // CR8-01 (P2): the edited field no longer holds the assumed value.
        ...(state.assumptions ? { assumptions: dropAssumptionsCovering(state.assumptions, action.correction.field) } : {}),
        // R5-GR-2: a correction is stronger evidence of review than a
        // Confirm click — the human read the value closely enough to
        // change it. The corrected node needs no second confirmation.
        ...(state.unconfirmedNodeIds
          ? { unconfirmedNodeIds: state.unconfirmedNodeIds.filter((id) => id !== action.correction.node_id) }
          : {}),
        // R6: a corrected field is no longer guessed, and the model's quote
        // for it no longer describes the value on screen — both drop.
        ...(state.guessedFields
          ? {
              guessedFields: Object.fromEntries(
                Object.entries(state.guessedFields)
                  .map(([id, fields]) => [
                    id,
                    id === action.correction.node_id ? fields.filter((fld) => fld !== action.correction.field) : fields,
                  ])
                  .filter(([, fields]) => (fields as string[]).length > 0),
              ),
            }
          : {}),
        ...(state.provenance && state.provenance[action.correction.node_id]?.[action.correction.field]
          ? {
              provenance: {
                ...state.provenance,
                [action.correction.node_id]: Object.fromEntries(
                  Object.entries(state.provenance[action.correction.node_id]!).filter(
                    ([fld]) => fld !== action.correction.field,
                  ),
                ),
              },
            }
          : {}),
      };

    case 'JURISDICTIONS_CONFIRMED':
      if (state.step !== 'graph_review' || state.jurisdictionsConfirmed === undefined) return state;
      return { ...state, jurisdictionsConfirmed: true };

    case 'JURISDICTIONS_SET':
      if (state.step !== 'graph_review') return state;
      return {
        ...state,
        graph: action.updatedGraph,
        graphVersion: action.updatedGraph.version,
        corrections: [...state.corrections, action.correction],
        // CR8-01 (P2): the countries were just set by the person — the
        // CR7-23 "elsewhere, not sure" assumption about them no longer holds.
        ...(state.assumptions ? { assumptions: dropAssumptionsCovering(state.assumptions, 'jurisdictions', ['11']) } : {}),
        ...(state.jurisdictionsConfirmed !== undefined ? { jurisdictionsConfirmed: true } : {}),
      };

    case 'NODE_CONFIRMED':
      if (state.step !== 'graph_review' || !state.unconfirmedNodeIds) return state;
      return {
        ...state,
        unconfirmedNodeIds: state.unconfirmedNodeIds.filter((id) => id !== action.nodeId),
      };

    case 'QUESTIONS_GENERATED':
      if (state.step !== 'graph_review') return state;
      // R5-GR-2 defense in depth (same layering as CONTRADICTION_RESOLVED's
      // empty-explanation guard): the UI refuses with a message, and the
      // reducer refuses regardless of what the UI did.
      if (state.unconfirmedNodeIds && state.unconfirmedNodeIds.length > 0) return state;
      if (state.jurisdictionsConfirmed === false) return state;
      return {
        step: 'questionnaire',
        description: carriedDescription(state),
        graph: state.graph,
        questions: action.questions,
        answers: [],
        resolutionNotes: [],
        corrections: state.corrections,
        useCaseId: state.useCaseId,
        originalVerdictId: state.originalVerdictId,
        // F-7 (DR7-07): captured once, here, from graph_review's own
        // guessedFields — the only step this field exists on.
        // M-2: after a Back round trip graph_review carries the FIRST capture;
        // keep it rather than re-deriving from the trimmed guessedFields.
        uncertainNodeIds: state.uncertainNodeIds ?? Object.keys(state.guessedFields ?? {}),
        // CR6-03 (Critical). Carried forward so a later STEP_BACK can
        // restore them — see the questionnaire type's own comment. The
        // guard above already proved unconfirmedNodeIds/jurisdictionsConfirmed
        // are safe to carry as-is (never non-empty/false here).
        guessedFields: state.guessedFields,
        provenance: state.provenance,
        unconfirmedNodeIds: state.unconfirmedNodeIds,
        jurisdictionsConfirmed: state.jurisdictionsConfirmed,
        ...(state.ignoredJurisdictions ? { ignoredJurisdictions: state.ignoredJurisdictions } : {}),
        // CR7-02: a re-entered review (Change an answer, a failed evaluation,
        // a correction from the result) arrives holding the assumptions;
        // they travel on to the confirmation.
        ...(state.assumptions ? { assumptions: state.assumptions } : {}),
        ...(state.reentry ? { reentry: true } : {}),
        // CR7-03: the pre-questionnaire values Back returns to.
        backGraph: state.graph,
        backCorrections: state.corrections,
        askedGuessedFields: state.guessedFields,
        backAssumptions: state.assumptions,
        backUncertainNodeIds: state.uncertainNodeIds,
        ...(state.afterFailedEvaluation ? { backAfterFailedEvaluation: true } : {}),
      };

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
      // CR6-03 (Critical). A guessed field that has just been answered is
      // no longer "still to ask" — dropped from the carried guessedFields
      // (the same trim CORRECTION_APPLIED already does for graph_review's
      // own copy) so a later Back + Continue does not regenerate a
      // question for it. uncertainNodeIds (F-7, above) is a DIFFERENT,
      // frozen record of what the description did not say and is never
      // touched here — an answered guessed field still belongs in it.
      const guessedFields =
        state.guessedFields && answeredQuestion?.node_id && answeredQuestion.field
          ? Object.fromEntries(
              Object.entries(state.guessedFields)
                .map(([id, fields]) => [
                  id,
                  id === answeredQuestion.node_id ? fields.filter((fld) => fld !== answeredQuestion.field) : fields,
                ])
                .filter(([, fields]) => (fields as string[]).length > 0),
            )
          : state.guessedFields;
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
          // CR6-03: the PRE-answer guessedFields, so ANSWER_UNDONE can put
          // an undone guessed field back among those still to ask.
          guessedFields: state.guessedFields,
        },
        ...(action.updatedGraph ? { graph: action.updatedGraph } : {}),
        ...(action.correction ? { corrections: [...state.corrections, action.correction] } : {}),
        ...(assumptions ? { assumptions } : {}),
        ...(state.guessedFields ? { guessedFields } : {}),
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
        // CR6-03: restores the pre-answer guessedFields too, so an undone
        // guessed-field answer is askable again via Back + Continue — only
        // when the snapshot actually has one (an old-shaped undo has
        // neither `guessedFields` NOR a reason to think the current,
        // already-trimmed copy in `rest` is wrong, so it is left alone).
        ...(undo.guessedFields !== undefined ? { guessedFields: undo.guessedFields } : {}),
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
        assumptions: state.assumptions,
        // F-7: threaded forward, never re-derived.
        uncertainNodeIds: state.uncertainNodeIds,
        // CR6-03: threaded forward, same reasoning as uncertainNodeIds —
        // a Back reached via CONTRADICTION_RESOLVED must still restore the
        // right gate.
        guessedFields: state.guessedFields,
        provenance: state.provenance,
        unconfirmedNodeIds: state.unconfirmedNodeIds,
        jurisdictionsConfirmed: state.jurisdictionsConfirmed,
        ...(state.ignoredJurisdictions ? { ignoredJurisdictions: state.ignoredJurisdictions } : {}),
        // CR7-03: threaded forward, never re-derived.
        backGraph: state.backGraph,
        backCorrections: state.backCorrections,
        askedGuessedFields: state.askedGuessedFields,
        ...(state.reentry ? { reentry: true } : {}),
        backAssumptions: state.backAssumptions,
        backUncertainNodeIds: state.backUncertainNodeIds,
        ...(state.backAfterFailedEvaluation ? { backAfterFailedEvaluation: true } : {}),
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
        assumptions: state.assumptions,
        // F-7: threaded forward, never re-derived.
        uncertainNodeIds: state.uncertainNodeIds,
        // CR6-03: threaded forward — see CONTRADICTIONS_DETECTED's comment.
        guessedFields: state.guessedFields,
        provenance: state.provenance,
        unconfirmedNodeIds: state.unconfirmedNodeIds,
        jurisdictionsConfirmed: state.jurisdictionsConfirmed,
        ...(state.ignoredJurisdictions ? { ignoredJurisdictions: state.ignoredJurisdictions } : {}),
        // CR7-03: threaded forward, never re-derived.
        backGraph: state.backGraph,
        backCorrections: state.backCorrections,
        askedGuessedFields: state.askedGuessedFields,
        ...(state.reentry ? { reentry: true } : {}),
        backAssumptions: state.backAssumptions,
        backUncertainNodeIds: state.backUncertainNodeIds,
        ...(state.backAfterFailedEvaluation ? { backAfterFailedEvaluation: true } : {}),
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
        assumptions: state.assumptions,
        // F-7: threaded forward, never re-derived.
        uncertainNodeIds: state.uncertainNodeIds,
        // CR8-03 (P3): the Back guard a failed evaluation set on the review
        // screen travels through the questions to here. Never dropped.
        afterFailedEvaluation: state.backAfterFailedEvaluation === true,
      };

    case 'CHANGE_ANSWER':
      if (state.step !== 'confirmation') return state;
      // The form path returns to the guided form itself, filled in (W-4:
      // plainAnswers/assumptions/useCaseId carried so StructuredForm
      // reopens with its answers and a resubmission reuses the same use
      // case — see "One use case, one creation event" §1). The
      // description path returns to the existing correction flow
      // (GraphView, UC-7), unchanged.
      //
      // R16-D2 §5 (v2.1): originalVerdictId/originalGraph carried on the
      // FORM branch too — before this fix, "Change an answer" during a
      // correction of a form-built case lost both, so the eventual
      // re-confirm ran as a FRESH confirm and the F-1 precondition refused
      // it as "already has a result": safe (nothing written) but a dead
      // end. The graph_review branch below already carried
      // originalVerdictId (the "CORRECT_VERDICT fallback" case) — unchanged.
      return returnsToForm(state)
        ? {
            step: 'graph_extraction',
            description: state.description,
            method: 'form',
            useCaseId: state.useCaseId,
            plainAnswers: state.plainAnswers,
            answerState: state.answerState,
            assumptions: state.assumptions,
            originalVerdictId: state.originalVerdictId,
            originalGraph: state.originalGraph,
          }
        : {
            step: 'graph_review',
            description: carriedDescription(state),
            graph: state.graph,
            graphVersion: state.graph.version,
            corrections: state.corrections,
            useCaseId: state.useCaseId,
            originalVerdictId: state.originalVerdictId,
            // CR7-02 (BC-004). Everything the confirmation was based on
            // travels with the person: the "Not sure" assumptions, the frozen
            // uncertain list, and the countries gate as already passed (they
            // were checked before this confirmation; the panel must still
            // render, as it does after a failed evaluation). `reentry` tells
            // GraphView not to label every value "no basis".
            assumptions: state.assumptions,
            uncertainNodeIds: state.uncertainNodeIds,
            jurisdictionsConfirmed: true,
            reentry: true,
            // CR8-03 (P3): restored — see the confirmation type's comment. A
            // first-time confirmation (no failure) leaves it off, so Back from
            // here is still allowed: nothing is attested yet.
            ...(state.afterFailedEvaluation ? { afterFailedEvaluation: true } : {}),
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
        assumptions: state.assumptions,
        // CR7-02: so EVALUATION_FAILED can hand it back.
        uncertainNodeIds: state.uncertainNodeIds,
      };

    case 'VERDICT_READY':
      if (state.step !== 'evaluation_pending') return state;
      return { step: 'verdict', verdictId: state.useCaseId };

    case 'EVALUATION_FAILED': {
      // Back to the review point, not stuck on "Evaluating..." forever.
      if (state.step !== 'evaluation_pending') return state;
      // F-2 (DR7-04). A form-path graph returns to the FORM itself — the
      // same filled-in shape FORM_SUBMITTED/CHANGE_ANSWER/the form-path
      // STEP_BACK already produce — never the retired field-card screen,
      // which the form path has never visited on the way forward either
      // (W-3). `useCaseId` is reused (the case already has a
      // graph_confirmed attestation on the trail); the next Confirm
      // passes the F-1 precondition and writes a new one — a deliberate
      // second attestation.
      if (returnsToForm(state)) {
        return {
          step: 'graph_extraction',
          description: carriedDescription(state),
          method: 'form',
          useCaseId: state.useCaseId,
          plainAnswers: state.plainAnswers,
          answerState: state.answerState,
          assumptions: state.assumptions,
          // R16-D2 §5 (v2.1): see CHANGE_ANSWER's identical fix above — a
          // genuine evaluation failure during a form correction must not
          // drop the correction context either.
          originalVerdictId: state.originalVerdictId,
          originalGraph: state.originalGraph,
        };
      }
      return {
        step: 'graph_review',
        description: carriedDescription(state),
        graph: state.graph,
        graphVersion: state.graph.version,
        corrections: [],
        useCaseId: state.useCaseId,
        originalVerdictId: state.originalVerdictId,
        // Review 004 finding 2: the failure most likely to land here is
        // jurisdiction/track-driven — the panel to FIX it must render.
        // Confirmed=true (it was confirmed before evaluation; re-entry is
        // not a fresh attestation, the R5 rule). The panel stays editable: a
        // tick after this goes back through JURISDICTIONS_SET with its correction.
        jurisdictionsConfirmed: true,
        // F-2 (DR7-04): a re-entry after a genuine failure, not a fresh
        // submission — STEP_BACK must not walk out of it, mirroring the
        // correction-pass rule (see the STEP_BACK case above).
        afterFailedEvaluation: true,
        // CR7-02 (BC-004): the second Confirm after a failed evaluation must
        // still list the "Not sure" answers it is based on.
        assumptions: state.assumptions,
        uncertainNodeIds: state.uncertainNodeIds,
        reentry: true,
      };
    }

    case 'CORRECT_VERDICT':
      if (state.step !== 'verdict') return state;
      return {
        step: 'graph_review',
        description: carriedDescription(state),
        graph: action.graph,
        graphVersion: action.graph.version,
        corrections: [],
        useCaseId: action.useCaseId,
        originalVerdictId: action.originalVerdictId,
        // CR7-02 (BC-004): what the verdict being corrected was based on.
        ...(action.assumptions ? { assumptions: action.assumptions } : {}),
        ...(action.uncertainNodeIds ? { uncertainNodeIds: action.uncertainNodeIds } : {}),
        // CR8-08: the countries were confirmed before the verdict being
        // corrected (same reasoning as CHANGE_ANSWER / EVALUATION_FAILED): the
        // panel must still render, editable, without re-gating the person.
        jurisdictionsConfirmed: true,
        reentry: true,
      };

    // R16-D2 §5 (D-82). The form-path counterpart to CORRECT_VERDICT above.
    case 'CORRECT_VERDICT_WITH_FORM':
      if (state.step !== 'verdict') return state;
      return {
        step: 'graph_extraction',
        description: action.description,
        method: 'form',
        useCaseId: action.useCaseId,
        plainAnswers: toPlainAnswers(action.answerState, action.description),
        answerState: action.answerState,
        assumptions: action.assumptions,
        originalVerdictId: action.originalVerdictId,
        originalGraph: action.originalGraph,
      };

    default:
      return state;
  }
}
