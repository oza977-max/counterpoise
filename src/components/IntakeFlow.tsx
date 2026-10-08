import { useEffect, useCallback, useMemo, useReducer, useState, useRef } from 'react';
import { extractGraph } from '../llm/graph-extractor';
import { confirmSemanticDuplicate } from '../llm/duplicate-check';
import { getApiKey } from '../llm/client';
import { evaluate } from '../engine/evaluate';
import { normaliseAccessScope, sameAccessScopeSet } from '../engine/access-scope';
import { findPossibleDuplicates, matchCorpus } from '../engine/duplicate';
import { loadPolicy } from '../store/policy';
import { checkPolicyReferences } from '../store/policy-references';
import { getCurrentPolicyYaml } from '../store/policy-source';
import { getPackSources, loadPackSet } from '../store/pack-source';
import { selfAssessmentSeeded } from '../seeds/aigate-self-assessment';
import { addNode, addUseCaseModelLink, confirmationPrecondition, getUseCase, getUseCases, updateUseCaseVerdictSummary, updateLifecycleStage, findLatestVerdictEvent } from '../store/register';
import { withCaseLock } from '../store/db';
import { getRole } from '../store/role';
import { routeToWorkflow } from '../engine/workflow-router';
import type { DataFlowGraph, GraphCorrection, IntakeQuestion, PolicyFile } from '../engine/types';
import type { Verdict } from '../types/verdict';
import type { AuditEvent, LifecycleStage, UseCaseSummary } from '../store/types';
import { coerceAnswerValue, generateQuestions, questionsForGuessedFields } from '../engine/question-generator';
import { detectContradictions } from '../engine/contradiction';
import { plausibilityWarnings } from '../engine/plausibility';
import { findPrecedents } from '../engine/precedent';
import type { PrecedentCandidate } from '../engine/precedent';
import SimilarCases from './SimilarCases';
import type { EnrichedPrecedent } from './SimilarCases';
import { matchKnowledgeLens } from '../engine/knowledge-lens';
import { applyReattestExpiry, computeStaleSources } from '../engine/temporal';
import { loadKnowledgeLens } from '../store/knowledge-lens-loader';
import { getCurrentKnowledgeLensYaml } from '../store/knowledge-lens-source';
import KnowledgeLensPanel from './KnowledgeLensPanel';
import { append as appendAuditEvent, getAll as getAuditEvents } from '../store/audit';
import { generateReasoningTraceForVerdict } from '../llm/reasoning-trace';
import { findRuleDescription } from '../engine/find-rule-description';
import { intakeReducer, nextReviewStep, contradictionKey, planCorrectionWrites, graphValueResolver } from './intake-state';
import { saveDraft, loadDraft, loadDraftInfo, clearDraft, clearDraftIfCase, clearFormDraft } from './intake-draft';
import type { IntakeState } from './intake-state';
import StructuredForm from './StructuredForm';
import ChecklistPanel from './ChecklistPanel';
import NudgeNote, { appendExample } from './NudgeNote';
import RatingInstructionNotice from './RatingInstructionNotice';
import ModelStatus from './ModelStatus';
import { CHECKLIST_ITEM_IDS, mentionedItems } from '../engine/mentioned';
import type { MentionJurisdiction } from '../engine/mentioned';
import type { Assumption, PlainAnswers } from './plain-copy';
import type { ChecklistItemId, FormAnswerState } from '../engine/prefill-types';
import {
  extractionErrorMessage,
  EXTRACTION_ERROR_HELP,
  engineErrorMessage,
  POLICY_PROBLEM_MESSAGE,
  questionnaireCopyForField,
  vendorNotOnListValue,
  VENDOR_UNSURE_VALUE,
  VENDOR_UNSURE_ASSUMPTION,
  ratingInstructionWarning,
  R18_COPY,
} from './plain-copy';
import { findRatingInstructions } from '../engine/rating-instructions';
import { formCorrections } from './form-corrections';
import GraphView from './GraphView';
import StepTracker, { describeStep } from './StepTracker';
import QuestionnaireStep from './QuestionnaireStep';
import ContradictionReview from './ContradictionReview';
import ConfirmationStep from './ConfirmationStep';
import VerdictDisplay from './VerdictDisplay';
// Rule 4 (cross-cutting.md §7): presentation-only. No business logic inline
// — calls engine/store/llm functions. Real 9-state machine (intake-flow.md
// §3) as of P4-C04 — every state through confirmation/attestation is real.
// getRole() (P6-C01) replaces the hardcoded '1LoD' placeholder throughout.
const INITIAL_STATE: IntakeState = { step: 'description_entry', description: '' };

// F-1 (DR7-02, DR7-03). Exact wording from the R16-F contract — shown
// verbatim when `confirmationPrecondition` refuses a confirm or
// correction. Module scope: fixed copy, not derived from render state.
type ConfirmationRefusal = 'already-decided' | 'corrected-elsewhere' | 'check-failed';

const CONFIRMATION_REFUSAL_MESSAGE: Record<ConfirmationRefusal, string> = {
  // R16-F review pass 2: the record check itself can fail (a browser storage
  // read that errors). Nothing is written; unlike the two refusals above it
  // is likely to pass on a retry, so Confirm stays usable for this one.
  'check-failed':
    "We couldn't check this case's record just now, so nothing was saved. Try again in a moment.",
  // CR6-15 (Important). Previously claimed a cause ("probably confirmed in
  // another tab or window") this app has no way to actually verify — a
  // confirm that keeps running after the component unmounts (CR6-15, the
  // draft-clearing fix below) can reach this SAME refusal in the SAME tab,
  // on a later visit, with no other tab or window involved at all. Says
  // only what is known to be true.
  'already-decided': 'This case already has a result. Open it from the register to see it.',
  'corrected-elsewhere':
    "This result was corrected in another tab or window while you were working, so your correction wasn't saved. Open the case from the register to see the current result.",
};

// CR7-21/22 and the count of corrections on the trail: planCorrectionWrites
// (intake-state.ts, pure and unit-tested).

// GT7 L-1 (P12). Rating instructions are looked for on the DESCRIPTION path
// only — a graph a model read out of the typed description. The form path's
// "In a sentence or two" text is never read by a model, so it gets no warning.
// GB pass-1 C: called up to three times per render, so the (pure) result is
// remembered for the last description seen.
let lastRatingKey: string | undefined;
let lastRatingFound: string[] = [];
function ratingInstructionsFor(graph: { intake_method: string }, description: string | undefined): string[] {
  if (graph.intake_method !== 'llm' || !description) return [];
  if (description !== lastRatingKey) {
    lastRatingFound = findRatingInstructions(description);
    lastRatingKey = description;
  }
  return lastRatingFound;
}

export default function IntakeFlow({ newPrecheckNonce = 0 }: { newPrecheckNonce?: number } = {}) {
  // explore-001 D-002/D-003: restore any in-flight draft so a refresh,
  // browser Back, or a trip to the Register mid-intake no longer discards
  // the description, the guided-form answers and the extracted graph.
  // Lazy init so the read happens once, before first paint.
  const restoredDraft = useRef<boolean>(
    (() => {
      const d = loadDraft();
      return d !== null && d.step !== 'evaluation_pending';
    })(),
  );
  // CR6-15c (M-4). A draft saved at 'evaluation_pending' means the person
  // left (or the tab closed) while the result was being worked out. The work
  // does not resume on return, so restoring that step would show "Evaluating…"
  // forever. Not restored at all: the intake starts empty (the saveDraft
  // effect below clears the stale draft) and a plain notice says only what is
  // known — the check was interrupted, and anything that finished is on the
  // register. No cause is claimed. Chosen over "don't persist that step"
  // because that would leave the previous 'confirmation' draft behind, which
  // restores into the false "already has a result" refusal (CR6-15).
  const interruptedEvaluation = useRef<boolean>(loadDraft()?.step === 'evaluation_pending');
  const [showInterrupted, setShowInterrupted] = useState(interruptedEvaluation.current);
  const [state, dispatch] = useReducer(intakeReducer, INITIAL_STATE, (initial) => {
    const draft = loadDraft();
    return draft && draft.step !== 'evaluation_pending' ? draft : initial;
  });
  // Restoring silently would drop the user somewhere they did not navigate
  // to, with no explanation — the same class of surprise NF-2 exists to
  // prevent. Say what happened and offer a way out.
  const [showResumed, setShowResumed] = useState(restoredDraft.current);
  // CR7-28. True when the restored draft is NOT what was saved: a questions
  // draft from before CR6 (description path) came back as the review screen
  // (intake-draft.ts). Said plainly — the person was part-way through the
  // questions and is now at the review screen again.
  const [showMigrated, setShowMigrated] = useState(() => loadDraftInfo()?.migratedFromOldBuild === true);
  // R18-NF-5. True when the restored draft was saved by an earlier version (or
  // could not be used) and came back as the form with the description kept and no
  // answers (intake-draft.ts). Computed once at load, never stored, so it shows
  // once; cleared as soon as the person leaves the form.
  const [showEarlierVersion, setShowEarlierVersion] = useState(
    () => loadDraftInfo()?.earlierVersionNotice === true,
  );

  // CR6-02 (Critical). One "attempt" is one run through intake, from a
  // fresh description to Start Over. Bumped by handleStartOver, by
  // handleStepBack (CR7-34: Back abandons whatever check or decision was in
  // flight) and by handleSubmitDescription (a new description is a new
  // attempt) — the places earlier work is explicitly abandoned. Every async handler
  // below that can dispatch/setState after an await — and the duplicate-
  // check effect — captures this value when it STARTS, and before any
  // such call, checks the token is still the one it captured; if Start
  // Over bumped it meanwhile, the result is simply dropped (no dispatch,
  // no setState), same as if the call had never returned. This is what
  // lets handleStartOver below safely release the in-flight refs instead
  // of waiting for abandoned work to finish on its own first.
  const attemptToken = useRef(0);

  // Set once the classification has been adopted (declared up here because
  // canStepBack, below, reads it).
  const [adoptedFrom, setAdoptedFrom] = useState<string | null>(null);
  // FX-2 pass 2 (I-1): true while the duplicate screen's own decision is
  // writing ("Use the earlier result": register node + two audit events;
  // "Mine is different": duplicate_dismissed). Same ruling as confirmPending
  // above: while set, Back (both controls), "Start over instead" and both gate
  // buttons are disabled, because a write already started cannot be recalled
  // and a second one would be a duplicate record in an append-only trail.
  const [decisionPending, setDecisionPending] = useState(false);
  // FX-2 pass 3: a failed adopt/dismiss write used to be an unhandled
  // rejection — the buttons came back and nothing said why.
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // "+ New pre-check" while a flow is FINISHED starts a fresh one (known
  // issue since v0.3.2). Only the verdict step resets: an in-progress
  // draft is the user's work, and the resumed-draft banner already offers
  // its own explicit Start over.
  const lastNonce = useRef(newPrecheckNonce);
  useEffect(() => {
    if (newPrecheckNonce === lastNonce.current) return;
    lastNonce.current = newPrecheckNonce;
    // A finished adoption is finished too (FX-2 pass 2, I-2).
    if (state.step === 'verdict' || adoptedFrom) handleStartOver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newPrecheckNonce]);

  function handleStartOver() {
    // Final review M-1: a failed-save message belongs to the case it was
    // about — never carried onto the next one.
    setDecisionError(null);
    // CR7-24: the previous screen's gate error line belongs to that screen.
    setReviewGateError(null);
    setShowMigrated(false);
    // CR6-02 (Critical). Bumped FIRST: any async handler/effect from the
    // abandoned attempt that resumes after this point (its own await
    // having been in flight when Start Over was clicked) will see its own
    // captured token no longer match and drop its result.
    attemptToken.current += 1;
    clearDraft();
    // explore-005 D-002: the guided form keeps its answers under a SECOND
    // key, so clearing the reducer draft alone left the abandoned answers to
    // reappear on the next visit to the form step.
    clearFormDraft();
    setShowResumed(false);
    setShowInterrupted(false);
    // The confirm guard is deliberately left set after a SUCCESSFUL
    // confirm (that flow never returns to its confirmation step). A fresh
    // intake must release it, or the next case's "Confirm and evaluate"
    // silently does nothing until a page reload — "+ New pre-check" lands
    // here without remounting this component. Found by the R16-W
    // walkthrough's second submission in one tab.
    confirmInFlight.current = false;
    // CR6-02 (Critical). handleStartOver used to release ONLY the guard
    // above — dupCheckInFlight/confirmNewInFlight/retryExtractionInFlight/
    // adoptInFlight stayed set until their OWN pending call's `finally`
    // ran, so Start Over while any of them was still in flight left the
    // IDENTICAL handler on the NEW case reading a guard that was never
    // reset and silently doing nothing. Released together here.
    dupCheckInFlight.current = false;
    confirmNewInFlight.current = false;
    retryExtractionInFlight.current = false;
    adoptInFlight.current = false;
    setDecisionPending(false);
    formSubmitInFlight.current = false;
    // Exactly as handleStepBack already does, and for the identical reason
    // its own comment gives: clearing only duplicateCheckDone re-arms the
    // duplicate-check effect's early return with dupCheckInFlight still
    // true, which would sit the NEXT case on "Looking through earlier
    // checks…" forever.
    setDuplicateCheckDone(false);
    setDuplicateMatch(null);
    // CR6-14 (Important): an extraction error belongs to the attempt that
    // set it — it must not still be showing when a fresh case's own
    // (pending) extraction has not even had a chance to succeed or fail.
    setExtractionError(null);
    // I-4 (FX-2 review): the adopted-result screen and a failed-evaluation
    // message also belong to the abandoned case.
    setAdoptedFrom(null);
    setEvaluationError(null);
    // F-1: a fresh intake must not carry a stale refusal into the new
    // case's own confirmation step.
    setConfirmationRefusal(null);
    // RESTART, not DESCRIPTION_CHANGED — the latter is discarded by the
    // reducer from every step but description_entry, so the banner hid
    // itself and the screen never moved.
    dispatch({ type: 'RESTART' });
  }

  // FN-006. The steps a submitter can walk back out of. Everything after
  // `questionnaire` is past the confirmation attestation, which is one-way by
  // design — see the STEP_BACK case in intake-state.ts.
  const canStepBack =
    // FX-2 pass 2 (I-2): an adopted result is a finished case, not an open step.
    !adoptedFrom &&
    (state.step === 'duplicate_check' ||
      state.step === 'graph_review' ||
      state.step === 'questionnaire' ||
      // R18-A (§27.1): the form of a FRESH case. A form that carries a case id,
      // a correction or an after-failure flag has no Back (the reducer refuses it too).
      (state.step === 'graph_extraction' &&
        state.method === 'form' &&
        state.useCaseId === undefined &&
        state.originalVerdictId === undefined &&
        state.afterFailedEvaluation !== true)) &&
    // No Back on a correction pass's ENTRY step — the reducer refuses it
    // (see STEP_BACK), and a control that does nothing is the false-affordance
    // defect FN-006 existed to kill. Deeper correction steps (questionnaire →
    // graph_review) still step back normally: that stays inside the audited
    // correction, originalVerdictId intact.
    //
    // F-2 (DR7-04): a re-entry after a genuine evaluation failure
    // (afterFailedEvaluation) gets the identical treatment, for the
    // identical reason — the reducer refuses it too (see STEP_BACK).
    !(state.step === 'graph_review' && (state.originalVerdictId || state.afterFailedEvaluation));

  function handleStepBack() {
    // Final review M-1: a failed-save message belongs to the case it was
    // about — never carried onto the next one.
    setDecisionError(null);
    // Stepping back to the description means the duplicate check has to run
    // again on the way forward — the description it checked may change.
    //
    // BOTH of these must be cleared, and the ref is the one that bites.
    // `dupCheckInFlight` is a StrictMode double-invoke guard that is set once
    // and never reset for the life of the mount. Clearing only the
    // `duplicateCheckDone` flag would leave the effect's early return armed,
    // so re-entering the step would sit on "Checking the existing inventory…"
    // forever with no way forward: explore-005's D-001, reintroduced by its
    // own fix. Verified against src/components/IntakeFlow.tsx:161-205.
    //
    // CR6-02f (FX-2 review I-5): Back also abandons whatever check or
    // decision was in flight — bump the token so its late result is dropped
    // (a stale match card must never appear on the changed description, and
    // "Mine is different" must never write duplicate_dismissed against the
    // OLD candidate). Because the abandoned calls' `finally` blocks now
    // release their guard only when the token still matches (CR6-02g), Back
    // releases the guards itself, exactly as handleStartOver does.
    //
    // FX-2 pass 2 (I-1): Back does NOT release confirmNewInFlight/adoptInFlight.
    // Back is disabled while either decision write is pending (decisionPending),
    // so those guards are never legitimately held here; releasing them is what
    // let Back -> Next -> "Use the earlier result" start a second adoption
    // while the first landed invisibly.
    attemptToken.current += 1;
    retryExtractionInFlight.current = false;
    // CR7-24: the screen being left may have shown a gate error ("N cards
    // still need checking"); it must not greet the next screen.
    setReviewGateError(null);
    setAdoptedFrom(null);
    setDuplicateCheckDone(false);
    dupCheckInFlight.current = false;
    setDuplicateMatch(null);
    dispatch({ type: 'STEP_BACK' });
  }

  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [verdictAuditEvents, setVerdictAuditEvents] = useState<AuditEvent[]>([]);
  const [lastGraph, setLastGraph] = useState<DataFlowGraph | null>(null);
  // R16-D2 §3 (D-96, DR7-15). The reducer's `verdict` state is bare (just
  // `verdictId`) — so the "No" screen's assumptions and the correction
  // flow's "what were we last confirmed on" both need a carrier outside
  // the reducer, set alongside `lastGraph` at the same two write sites
  // (a fresh confirm and a correction) in runConfirmAndEvaluate. Lasts for
  // the life of the page, same as lastGraph: a reload clears the intake
  // draft at the verdict step (see the saveDraft/clearDraft effect below),
  // and the register path (RegisterDetail) supplies the same facts from
  // the audit trail instead.
  const [lastConfirmed, setLastConfirmed] = useState<{
    assumptions: Assumption[];
    plainAnswers?: PlainAnswers;
    // R18-A: the form's own answer state, handed back to the form on a correction.
    answerState?: FormAnswerState;
    // CR7-02: so a correction from the result can hand the frozen uncertain
    // list back to the review screen along with the assumptions.
    uncertainNodeIds?: string[];
  } | null>(null);
  // V1.2-C (UC-2/RG-2 leak fix, design-gap C1): the match is stored with
  // both tier and label, but the LABEL is only ever rendered for 2LoD —
  // 1LoD gets the redacted card (tier + "contact AI Risk").
  // UC-2 (round 4): carries the id as well as the display fields, because both
  // decisions — dismiss and adopt — have to name WHICH use case they were
  // about when they write it to the trail.
  const [duplicateMatch, setDuplicateMatch] = useState<{
    id: string;
    tier: string | null;
    track: string | null;
    label: string;
  } | null>(null);
  const [duplicateCheckDone, setDuplicateCheckDone] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  // Set once the classification has been adopted — the flow ends here rather
  // than continuing to intake questions (TC-UC-2-02).
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [registerRows, setRegisterRows] = useState<UseCaseSummary[]>([]);
  const [savedStage, setSavedStage] = useState<LifecycleStage | null>(null);
  const [submittedDescription, setSubmittedDescription] = useState('');
  // R5-GR-2: the proceed-gate refusal message. State, not derived, so it
  // appears only after an attempted Proceed rather than scolding upfront.
  const [reviewGateError, setReviewGateError] = useState<string | null>(null);
  // F-1 (DR7-02, DR7-03). Set when `confirmationPrecondition` (store/
  // register.ts) refuses a confirm or correction — the case already has a
  // result, or was corrected, somewhere this tab did not see. Shown as a
  // role="alert" on the confirmation step; Confirm stays disabled once
  // this is set, since retrying would read the identical, still-stale
  // precondition and refuse again for the same reason.
  const [confirmationRefusal, setConfirmationRefusal] = useState<ConfirmationRefusal | null>(null);
  // R16-F review pass 4: true from the Confirm press until the case lock and
  // the record check have answered. F-1 put those two awaits BEFORE the step
  // leaves 'confirmation'; while they run, "Change an answer" and "Start over"
  // must not be usable, or a superseded attempt could still record the OLD
  // answers. A ref (confirmInFlight) stops a second press; this state drives
  // the screen — disabled controls and a "Confirming…" status.
  const [confirmPending, setConfirmPending] = useState(false);
  // R16-F review pass 3: 'check-failed' describes one failed attempt. Once
  // the person leaves the confirmation step (e.g. "Change an answer") it no
  // longer describes anything, and showing it again on their return would be
  // a false claim — so it is cleared. The two permanent refusals stay: the
  // case still has a result, or was still corrected elsewhere.
  useEffect(() => {
    // R16-F review pass 5: pending lasts through 'evaluation_pending' too —
    // the case lock is held until the evaluation and its writes finish, and
    // "Start over instead" must not let a second case begin while the first
    // is still running (its late result could replace the second case's
    // verdict on screen).
    if (state.step === 'confirmation' || state.step === 'evaluation_pending') return;
    if (confirmationRefusal === 'check-failed') setConfirmationRefusal(null);
    setConfirmPending(false);
  }, [state.step, confirmationRefusal]);
  // R16-W W-4 (§1, D-70): derived from the reducer state rather than its
  // own useState — the B+C chunk's `formAssumptions` useState was silently
  // lost on refresh, because the intake draft only ever persists
  // IntakeState. Reading it off `state.assumptions` means the draft's
  // existing persistence covers it for free, and a fresh run naturally has
  // none (RESTART/NO_DUPLICATE_FOUND land on a state shape with no
  // `assumptions` field at all) — no explicit reset needed.
  const formAssumptions: Assumption[] = 'assumptions' in state ? state.assumptions ?? [] : [];
  // R16-W W-4: StructuredForm's own `initialAnswers` prop — present only on
  // a resubmission (CHANGE_ANSWER or the form-path STEP_BACK set it).
  const formInitialAnswers: PlainAnswers | undefined = 'plainAnswers' in state ? state.plainAnswers : undefined;
  const formInitialAnswerState: FormAnswerState | undefined = 'answerState' in state ? state.answerState : undefined;
  // F-7 (DR7-07). Was a useState, captured while on graph_review and
  // frozen there — a refresh on confirmation lost it (the draft only ever
  // persisted IntakeState, same bug class W-4 already fixed for
  // plainAnswers/assumptions). Now read directly off the reducer state,
  // which carries it forward from QUESTIONS_GENERATED onward
  // (intake-state.ts) — the draft's existing persistence covers it for
  // free. Naturally [] for every form-path run, since the form never sets
  // guessedFields.
  const uncertainNodeIds: string[] = 'uncertainNodeIds' in state ? state.uncertainNodeIds ?? [] : [];
  // R8-SC: similar decided cases, enriched with each match's controls read
  // from its own audit trail (3 reads max — the ranked top three only).
  const [precedents, setPrecedents] = useState<EnrichedPrecedent[]>([]);
  // P7-C03: reads getCurrentPolicyYaml() (a saved-policy override, or the
  // bundled starter YAML) instead of a static import. App.tsx unmounts and
  // remounts IntakeFlow every time the user navigates away and back
  // (existing view-switching behavior), so this useMemo naturally re-reads
  // the current policy on each visit without extra prop-threading.
  //
  // Acknowledged tradeoff (review finding, pass 1): a policy saved via
  // PolicyEditor while the user is already sitting on this screen won't
  // be picked up until they navigate away and back — the memo only
  // re-reads on remount, not on every render. This is a narrow, low-risk
  // gap in the single-view nav model (App.tsx renders exactly one of
  // IntakeFlow/RegisterView/PolicyEditor at a time, so reaching
  // PolicyEditor's Save button already requires leaving this screen
  // first); not worth a cross-component subscription mechanism for V1.
  const policyResult = useMemo(() => loadPolicy(getCurrentPolicyYaml()), []);
  // R16-B: StructuredForm now takes the whole PolicyFile (it reads
  // platforms/vendors/jurisdictions/approved_models itself). An invalid
  // policy is already a best-effort-only condition elsewhere in this file
  // (handleProceedFromGraphReview throws rather than render a usable
  // screen); this minimal stand-in just keeps the form's own render from
  // crashing on a missing object — every dynamic option list it drives
  // reads as empty, same degraded behaviour the old per-field props had.
  const EMPTY_POLICY_FALLBACK: PolicyFile = {
    version: '0',
    policy_id: 'INVALID',
    firm_name: '[FIRM]',
    translation_attestation: { attested_by: '', role: '', date: '', raf_version_checked: '' },
    hard_lines: [],
    tracks: [],
    tiers: [],
    invariants: [],
    controls: [],
    kri_thresholds: {},
    jurisdictions: [],
    roles: {},
    tier_workflow: { Critical: 'self-service', High: 'self-service', Medium: 'self-service', Low: 'self-service' },
    safety_margin: 0,
  };
  // V2-A: jurisdiction packs — bundled files, parsed once. Invalid packs
  // are dropped by the loader (whole-pack rejection, CF-5/RA-7) and shown
  // on the Appetite screen; evaluation proceeds with the valid ones.
  // GT7 D-1b (CF-5): a pack that fails to load refuses evaluation here too —
  // both gates below (checkPolicyGate, the Confirm throw) check packLoadErrors.
  const packSet = useMemo(() => loadPackSet(getPackSources()), []);
  const loadedPacks = packSet.packs;
  const packLoadErrors = packSet.messages;
  // R11-KL-1: parsed once, entirely separate from policy/packs — this is
  // advisory-only and never touched by evaluate().
  const knowledgeLensResult = useMemo(() => loadKnowledgeLens(getCurrentKnowledgeLensYaml()), []);
  const knowledgeLensEntries = useMemo(
    () => (knowledgeLensResult.valid ? knowledgeLensResult.entries : []),
    [knowledgeLensResult],
  );
  // R12-ST-3: the file's own curation header, threaded through as a prop so
  // KnowledgeLensPanel can render "curated by … · review owner …" and an
  // age warning — absent on a legacy/invalid file, which the panel treats
  // the same as "no meta to show".
  const knowledgeLensMeta = knowledgeLensResult.valid ? knowledgeLensResult.meta : undefined;
  // R11-KL-2: the rule ids THIS verdict actually relied on, read from its
  // own explanation — same derivation RegisterDetail.tsx's
  // `challengeableRules` uses, so "covered" means the same thing in both
  // places.
  const verdictRuleIds = useMemo(() => {
    if (!verdict) return [];
    const ids = new Set<string>();
    const ex = verdict.explanation;
    if (ex) {
      if (ex.tier_rationale?.rule_id) ids.add(ex.tier_rationale.rule_id);
      if (ex.track_rationale?.rule_id) ids.add(ex.track_rationale.rule_id);
      for (const t of ex.tripped_invariants) ids.add(t.id);
      for (const r of ex.regulatory_chain ?? []) ids.add(r.rule_id);
    }
    if (verdict.binding_constraint) ids.add(verdict.binding_constraint);
    return [...ids];
  }, [verdict]);
  const knowledgeLensMatches = useMemo(() => {
    if (!verdict || !lastGraph) return [];
    return matchKnowledgeLens(lastGraph, knowledgeLensEntries, verdictRuleIds);
  }, [verdict, lastGraph, knowledgeLensEntries, verdictRuleIds]);

  // explore-005 D-001: the effect below cannot run until the register has
  // actually loaded, or a restored session would resolve the check against
  // an empty array and report "checked 0 register entries" — a wrong answer
  // rendered as a confident one.
  const [registerLoaded, setRegisterLoaded] = useState(false);

  const refreshRegister = useCallback(async () => {
    // O-002: wait for the self-assessment seeding before reading, so the
    // count reported to the user is one the product has actually established.
    // CR7-17: a seed that FAILS must not leave the duplicate check waiting on
    // `registerLoaded` forever — the register is read regardless, and what the
    // check then reports is what is actually there.
    try {
      await selfAssessmentSeeded();
    } catch (err) {
      console.error('Counterpoise: the built-in example case could not be added; reading the register without it:', err);
    }
    const rows = await getUseCases('all');
    setRegisterRows(rows);
    setRegisterLoaded(true);
  }, []);

  useEffect(() => {
    void refreshRegister();
  }, [refreshRegister]);

  // R18-GI-1/-2 (specs/intake-flow.md §27.2-27.3). The checklist's rule needs
  // the policy's jurisdiction codes (a code like "UK" counts only as a capital-
  // letter code); an unusable policy simply has none.
  const mentionJurisdictions = useMemo<MentionJurisdiction[]>(
    () => (policyResult.valid ? policyResult.policy.jurisdictions.map((j) => ({ code: j.code, name: j.name })) : []),
    [policyResult],
  );
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  // The items the description leaves unmentioned, as sorted ids — what the first
  // Next press lists (nudgeFor) and what the second is compared with.
  const unmentionedNow: ChecklistItemId[] = useMemo(() => {
    if (state.step !== 'description_entry') return [];
    const mentioned = mentionedItems(state.description, mentionJurisdictions);
    return CHECKLIST_ITEM_IDS.filter((id) => !mentioned.has(id)).sort();
  }, [state, mentionJurisdictions]);

  function handleSubmitDescription() {
    // Final review M-1: a failed-save message belongs to the case it was
    // about — never carried onto the next one.
    setDecisionError(null);
    if (state.step !== 'description_entry') return;
    // Blank (empty or only Unicode whitespace) cannot continue; one character can.
    if (state.description.trim() === '') return;
    // The nudge (§27.3): the first press lists what is unmentioned and stays; the
    // second proceeds only if the unmentioned set is still the one listed. With
    // everything mentioned there is nothing to list.
    if (unmentionedNow.length > 0) {
      const listed = state.nudgeFor;
      const same = listed !== undefined && listed.length === unmentionedNow.length && listed.every((id, i) => id === unmentionedNow[i]);
      if (!same) {
        dispatch({ type: 'NUDGE_SHOWN', nudgeFor: unmentionedNow });
        return;
      }
    }
    // CR6-02f: entering a new duplicate check is a new attempt — anything
    // still running for an earlier description is dropped when it lands.
    attemptToken.current += 1;
    setAdoptedFrom(null);
    setShowInterrupted(false);
    setSubmittedDescription(state.description);
    setDuplicateMatch(null);
    setDuplicateCheckDone(false);
    dispatch({ type: 'SUBMIT_DESCRIPTION' });
  }

  // explore-005 D-001 (Critical). The check used to run inside
  // handleSubmitDescription, so its result existed only for a session that
  // had passed through that click. A restored draft re-enters
  // 'duplicate_check' directly (the lazy reducer init above), never calls
  // the handler, and so sat on the loading placeholder forever — with the
  // only button out of the step rendered in the other arm of that same
  // ternary, leaving no control on screen at all.
  //
  // The fix is not to persist the result. The check is DERIVED from the
  // description and the register, both of which the restored session has,
  // so it is derived on entry to the step however the step was entered.
  // Nothing here writes to the audit trail, so a re-run is free.
  const dupCheckInFlight = useRef(false);

  useEffect(() => {
    if (state.step !== 'duplicate_check' || duplicateCheckDone || !registerLoaded) return;
    // Synchronous, for the same reason as confirmInFlight below: StrictMode
    // double-invokes mount effects within a single mount, and a state
    // update lands too late to prevent the second call — which would mean
    // two confirmSemanticDuplicate() calls per restore.
    if (dupCheckInFlight.current) return;
    dupCheckInFlight.current = true;
    // CR6-02 (Critical). Captured before the first await — if Start Over
    // bumps the token while this check is still running (abandoning it),
    // its eventual result must not surface against whatever case is on
    // screen by then (TC-CR6-02b: an abandoned check's match reappearing
    // on an unrelated new case).
    const myAttempt = attemptToken.current;

    const description = state.description;
    void (async () => {
      try {
        const candidates = findPossibleDuplicates(
          description,
          // matchCorpus, not bare label — the register's names are three
          // words long and an identical re-typed description scored zero
          // against them (2026-08-15).
          registerRows.map((r) => ({ id: r.use_case_id, label: matchCorpus(r) })),
        );
        const topCandidate = registerRows.find((r) => r.use_case_id === candidates[0]?.id);
        if (topCandidate) {
          const confirmed = getApiKey() ? await confirmSemanticDuplicate(description, topCandidate.label) : true;
          if (confirmed && attemptToken.current === myAttempt) {
            setDuplicateMatch({
              id: topCandidate.use_case_id,
              tier: topCandidate.tier,
              track: topCandidate.track,
              label: topCandidate.label,
            });
          }
        }
      } finally {
        // V2-B (user feedback): the duplicate check is a REAL GATE — the
        // flow stops here and shows the result (match card, or an explicit
        // "checked N entries, none similar"), and only proceeds on the
        // user's "This is a new use case" confirmation. Previously it
        // auto-proceeded past a green tick, making the inventory check
        // invisible (the V1.2-C documented deviation, now user-rejected).
        //
        // In `finally` so an LLM failure still renders the gate rather than
        // reinstating the hang this defect is about. The ref reset is
        // UNCONDITIONAL (StrictMode double-invoke protection for THIS
        // mount, unrelated to staleness); only the visible result
        // (setDuplicateCheckDone) is gated on the attempt token — do NOT
        // add a `cancelled` cleanup flag here instead (CR6-02): this
        // effect has none, and a cleanup that gated the `finally` would
        // hang the step on "Looking through earlier checks…" on every
        // first entry under StrictMode, which relies on the synchronous
        // dupCheckInFlight ref alone to stop the second mount's call.
        //
        // CR6-02g (FX-2 review M-1): ONLY a call that is still the current
        // attempt releases the ref and shows its result. An abandoned call
        // (Start Over / Back already reset the ref themselves) must not free
        // the guard a NEWER check is holding. Under StrictMode the second
        // mount returns at the ref check, the one real call keeps the same
        // token, and so still releases normally (TC-CR6-02d).
        if (attemptToken.current === myAttempt) {
          dupCheckInFlight.current = false;
          setDuplicateCheckDone(true);
        }
      }
    })();
  }, [state, duplicateCheckDone, registerLoaded, registerRows]);

  // Code review round 3, Panel E. This handler gained an audit write in round 4
  // and did not gain the guard its siblings already had, fourteen lines away.
  // `state.step` is read from the render closure, so a second click before
  // re-render passes the same check and writes a second event into a trail
  // that cannot be corrected. Synchronous ref, because a state update lands
  // too late — the same lesson as P7-C01's seed guard and the 2LoD actions
  // (verified: src/components/RegisterDetail.tsx:76).
  const confirmNewInFlight = useRef(false);
  // code-review-004 F17: fresh ref — must reset independently of the others.
  const retryExtractionInFlight = useRef(false);
  // R16-W W-3/W-4 (§1): guards the form's own Continue click. Since R16-F
  // F-3 that click writes nothing (use_case_created moved to Confirm) and the
  // reducer ignores a second FORM_SUBMITTED once the step has moved on, so
  // this is belt-and-braces now — kept so the handler cannot re-enter if an
  // await is ever added back.
  const formSubmitInFlight = useRef(false);

  // CR7-28 (M-1): the migration notice belongs to the review screen it
  // explains; once the person leaves it, it must not come back on return.
  useEffect(() => {
    if (state.step !== 'graph_review') setShowMigrated(false);
    if (state.step !== 'graph_extraction') setShowEarlierVersion(false);
  }, [state.step]);

  // CR7-01 (BC-004: a restored draft). A draft saved while the description was
  // being read — `graph_extraction` on the LLM path — restores to "Reading your
  // description…" with nothing running and no control on screen: the extractor
  // is called only from handleConfirmNewUseCase and handleRetryExtraction, and
  // a reload kills the call that was in flight. So: once, on mount, and ONLY
  // when this state came back from a saved draft, start the extraction again
  // through the retry handler (which has its own synchronous in-flight guard,
  // so StrictMode's double-invoked effect still makes exactly one call, and
  // which shows the Try again panel if the key or local model has since gone).
  // Known and accepted: if the component is REMOUNTED while that extraction is
  // still in flight (a trip to the Register and back), the new mount starts a
  // second call; the first one's result is orphaned and discarded by the
  // attempt token / unmounted state, never dispatched into the new mount.
  // It must NOT fire on the ordinary path: there handleConfirmNewUseCase
  // dispatches NO_DUPLICATE_FOUND and then calls extractGraph itself.
  useEffect(() => {
    if (!restoredDraft.current) return;
    if (state.step !== 'graph_extraction' || state.method !== 'llm') return;
    void handleRetryExtraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirmNewUseCase() {
    if (state.step !== 'duplicate_check') return;
    // GB pass-2 M2: dismissing a match writes duplicate_dismissed to the
    // append-only trail. While a rulebook is broken the person cannot get a
    // verdict anyway, so nothing is written (same gate as evaluation/adoption).
    // Checked before the in-flight flag so a refusal leaves the button usable.
    if (duplicateMatch) {
      const gateError = checkPolicyGate();
      if (gateError) {
        setDecisionError(gateError);
        return;
      }
    }
    if (confirmNewInFlight.current) return;
    confirmNewInFlight.current = true;
    setDecisionPending(true);
    setDecisionError(null);
    // CR6-02 (Critical): captured before any await — every dispatch/
    // setState below checks it is still current before firing, so Start
    // Over abandoning THIS call (e.g. while the audit write or the
    // extraction below is still pending) never lets its late result land
    // on whatever case is on screen by the time it resolves.
    const myAttempt = attemptToken.current;
    try {

    // UC-2 / TC-UC-2-03. Dismissing a surfaced match is a decision about the
    // inventory, and it was invisible: nothing recorded that a near-match had
    // been reviewed and set aside, so nobody could afterwards distinguish a
    // genuinely new use case from a duplicate waved through. Written against
    // the CANDIDATE's trail, because that is the record a later reader is
    // looking at when they ask why there are two of these.
    // GB pass-2 M2: behind the same policy/pack gate (checked at the top of this function).
    if (duplicateMatch) {
      const candidate = duplicateMatch;
      // Final review M-1: only THIS single append can fail as "your choice
      // could not be saved" — so only it is caught as that (nothing was
      // recorded, and the choice can simply be made again).
      try {
        await appendAuditEvent({
          event_id: crypto.randomUUID(),
          use_case_id: candidate.id,
          event_type: 'duplicate_dismissed',
          occurred_at: new Date().toISOString(),
          actor: getRole(),
          payload: {
            type: 'duplicate_dismissed',
            candidate_use_case_id: candidate.id,
            candidate_label: candidate.label,
          },
        });
      } catch {
        if (attemptToken.current === myAttempt) {
          setDecisionError('Your choice could not be saved. Please try again.');
        }
        return;
      }
    }
    // The dismissal write is done; the extraction below is covered by the
    // ordinary Start over/Retry handling, which must stay usable. An
    // abandoned attempt leaves the lock alone — Start over already cleared
    // it, and it may now belong to the new case's own write (TC-CR6-02j).
    if (attemptToken.current !== myAttempt) return;
    setDecisionPending(false);

    // R18-A (specs/intake-flow.md §27.1, R18-GI-10): ONE route. Passing the
    // similar-cases screen always opens the guided form — the description is
    // never read to fill the form, whatever key or local model may be set (the
    // similar-cases check above can still send it to Anthropic when
    // aigate:api-key is stored). The retired model route below this return is unreachable; R18-E
    // deletes it.
    dispatch({ type: 'NO_DUPLICATE_FOUND', method: 'form' });
    // Typed `boolean` (not `true`) so the compiler keeps checking the retired code
    // below instead of treating it as dead.
    const modelRouteRetired: boolean = true;
    if (modelRouteRetired) return;

    // CR6-14 (Important): clears any error left by an earlier, abandoned
    // case's own extraction before this one even starts — otherwise this
    // fresh (pending) extraction briefly reads as the PREVIOUS case's
    // failure, which it has not had a chance to be.
    setExtractionError(null);
    const extraction = await extractGraph(state.description);
    if (attemptToken.current !== myAttempt) return;
    if (!extraction.ok) {
      setExtractionError(extractionErrorMessage(extraction.error.kind));
      return;
    }
    {
      const parted = partitionJurisdictions(extraction.value.graph);
      dispatch({
        type: 'GRAPH_EXTRACTED',
        graph: parted.graph,
        useCaseId: crypto.randomUUID(),
        ignoredJurisdictions: parted.ignored,
        provenance: extraction.value.provenance,
        guessedFields: extraction.value.guessed,
      });
    }
    } finally {
      // CR6-02g / TC-CR6-02j: release the guard AND the decision lock only
      // if they are still this attempt's — after Start over they may belong
      // to the new case's own in-flight write.
      if (attemptToken.current === myAttempt) {
        setDecisionPending(false);
        confirmNewInFlight.current = false;
      }
    }
  }

  // UC-2 / TC-UC-2-02. The other half of the duplicate decision. Adopting
  // creates a record whose classification came from somewhere else — so it
  // carries the source's tier and track, and deliberately NO verdict of its
  // own, because nothing was evaluated for it. The sign-off page already
  // states that plainly (register-lifecycle.md §15.2: "no verdict is
  // recorded"), which is the honest reading: a reviewer must see that this
  // classification was inherited, not derived.
  const adoptInFlight = useRef(false);

  async function handleAdoptClassification() {
    if (state.step !== 'duplicate_check' || !duplicateMatch) return;
    // GB pass-1 I1: adopting writes a register record and verdict-bearing
    // audit events, so it sits behind the same gate as evaluation — a broken
    // rules file or pack means nothing is written. Checked before the
    // in-flight flag is set, so a refusal leaves the button usable.
    const gateError = checkPolicyGate();
    if (gateError) {
      setDecisionError(gateError);
      return;
    }
    // The audit trail is append-only; a double-click cannot be cleaned up
    // afterwards (same guard as the 2LoD actions, RegisterDetail.tsx:76).
    if (adoptInFlight.current) return;
    adoptInFlight.current = true;
    setDecisionPending(true);
    setDecisionError(null);
    // CR6-02 (Critical): see handleConfirmNewUseCase's identical comment —
    // the writes below complete honestly regardless (the register node, if
    // created, is real), but the one visible result (setAdoptedFrom) must
    // not surface for an attempt Start Over has since abandoned.
    const myAttempt = attemptToken.current;

    try {
      const source = duplicateMatch;
      const useCaseId = crypto.randomUUID();
      const now = new Date().toISOString();

      await addNode({
        node_id: useCaseId,
        node_type: 'use_case',
        label: state.description.slice(0, 80),
        created_at: now,
        metadata: {
          node_type: 'use_case',
          description: state.description,
          submitted_by: getRole(),
          lifecycle_stage: 'pre_checked',
          current_verdict_id: null,
          tier: source.tier,
          track: source.track,
        },
      });

      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'use_case_created',
        occurred_at: now,
        actor: getRole(),
        payload: { type: 'use_case_created', description: state.description, intake_method: 'structured_form' },
      });

      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'classification_adopted',
        occurred_at: now,
        actor: getRole(),
        payload: {
          type: 'classification_adopted',
          adopted_from_use_case_id: source.id,
          adopted_from_label: source.label,
          tier: source.tier,
          track: source.track,
        },
      });

      // FX-2 pass 2 (I-2): the case is on the register now. The saved draft
      // still says duplicate_check, which would offer "Use the earlier result"
      // again on a return/refresh and write a SECOND record. Cleared directly
      // (mirrors CR6-15's clear after a verdict) rather than via a new reducer
      // step: nothing on the adopted screen changes reducer state, so the
      // draft effect cannot re-save it, and no reducer/draft-shape change is
      // needed.
      // CR7-16: only if the saved draft is still this adoption's own (this
      // handler keeps running after a screen change, and the person may have
      // started a different case since).
      clearDraftIfCase(useCaseId, { duplicateCheckDescription: state.description });
      if (attemptToken.current === myAttempt) {
        setAdoptedFrom(source.label);
        setShowResumed(false);
      }
    } catch {
      // Three separate writes: if the first landed and a later one failed, a
      // record may already be on the register — so say "check first", never
      // "nothing was saved".
      if (attemptToken.current === myAttempt) {
        setDecisionError(
          'Using the earlier result could not be saved. Check the register before trying again — part of it may already be there.',
        );
      }
    } finally {
      if (attemptToken.current === myAttempt) setDecisionPending(false);
      // CR6-02g: an abandoned adoption finishing late must not free the
      // guard the NEW case's adopt holds (a second click would then write a
      // second set of audit events).
      if (attemptToken.current === myAttempt) adoptInFlight.current = false;
    }
  }

  // R5-GX-1 (ADR-IF-R5-2). The extractor is schema-bound for every
  // classified field EXCEPT jurisdictions (free strings by design — the
  // known set is policy-scoped, not canonical). The live model returned
  // "Internal" as a jurisdiction on its second real run; unrecognised
  // values are removed here, before the human sees the graph, and surfaced
  // on the review screen so the removal is never a silent edit.
  function partitionJurisdictions(graph: DataFlowGraph): { graph: DataFlowGraph; ignored: string[] } {
    if (!policyResult.valid) return { graph, ignored: [] };
    const known = new Set(policyResult.policy.jurisdictions.map((j) => j.code));
    // Sweep-001: models sometimes emit empty-string jurisdictions. Nothing
    // was claimed, so nothing is reported — dropped silently, unlike real
    // unrecognised values which stay visible.
    const claimed = graph.jurisdictions.filter((j) => j.trim() !== '');
    const ignored = claimed.filter((j) => !known.has(j));
    if (ignored.length === 0 && claimed.length === graph.jurisdictions.length) return { graph, ignored };
    return { graph: { ...graph, jurisdictions: claimed.filter((j) => known.has(j)) }, ignored };
  }

  // Code review round 3, Panel C. The only exit from a failed extraction.
  // code-review-004 F17: guarded like every sibling handler — this was the
  // one async handler without an in-flight ref, so a fast double-click
  // fired two concurrent extractGraph() calls racing to dispatch, each with
  // its own fresh useCaseId; last-to-resolve silently won.
  async function handleRetryExtraction() {
    if (state.step !== 'graph_extraction') return;
    if (retryExtractionInFlight.current) return;
    retryExtractionInFlight.current = true;
    // CR6-02 (Critical): see handleConfirmNewUseCase's identical comment.
    const myAttempt = attemptToken.current;
    try {
      setExtractionError(null);
      const extraction = await extractGraph(state.description);
      if (attemptToken.current !== myAttempt) return;
      if (!extraction.ok) {
        setExtractionError(extractionErrorMessage(extraction.error.kind));
        return;
      }
      const parted = partitionJurisdictions(extraction.value.graph);
      dispatch({
        type: 'GRAPH_EXTRACTED',
        graph: parted.graph,
        useCaseId: crypto.randomUUID(),
        ignoredJurisdictions: parted.ignored,
        provenance: extraction.value.provenance,
        guessedFields: extraction.value.guessed,
      });
    } finally {
      if (attemptToken.current === myAttempt) retryExtractionInFlight.current = false;
    }
  }

  // R16-E §5 (D-104, DR7-30/AB-1). The extraction error's own second
  // button: switches to the guided form without losing what was typed —
  // `SWITCH_TO_FORM` is a pure method flip, and StructuredForm's own
  // `initialDescription` prop already pre-fills question 2 from it.
  function handleAnswerQuestionsInstead() {
    setExtractionError(null);
    dispatch({ type: 'SWITCH_TO_FORM' });
  }

  function handleCorrectNode(nodeId: string, field: string, correctedValue: unknown) {
    if (state.step !== 'graph_review') return;
    const graph = state.graph;
    const allNodes = [...graph.input_nodes, ...graph.processing_nodes, ...graph.output_nodes];
    const node = allNodes.find((n) => n.id === nodeId) as Record<string, unknown> | undefined;
    if (!node) return;
    const originalValue = node[field];

    // §4 (DR7-11): defence in depth — validated again through the SAME
    // single checker GraphView's own tick-all editor already calls (a
    // refusal here should be unreachable through that editor, but this
    // function is `onCorrect`, a prop any caller can invoke), and
    // compared by SET CONTENT rather than reference so re-saving the
    // identical set of ticked kinds is not recorded as a correction.
    if (field === 'system_access_scope') {
      const result = normaliseAccessScope(correctedValue);
      if (!result.ok) return;
      correctedValue = result.value;
      if (sameAccessScopeSet(originalValue, correctedValue)) return;
    }

    const updatedGraph = {
      ...graph,
      version: graph.version + 1,
      input_nodes: graph.input_nodes.map((n) => (n.id === nodeId ? { ...n, [field]: correctedValue } : n)),
      processing_nodes: graph.processing_nodes.map((n) =>
        n.id === nodeId ? { ...n, [field]: correctedValue } : n,
      ),
      output_nodes: graph.output_nodes.map((n) => (n.id === nodeId ? { ...n, [field]: correctedValue } : n)),
    };

    const correction: GraphCorrection = {
      correction_id: crypto.randomUUID(),
      graph_version_before: graph.version,
      graph_version_after: updatedGraph.version,
      node_id: nodeId,
      field,
      // CR7-30: an absent value is recorded as null — `undefined` is dropped
      // by the trail's serialisation and read back as the word "undefined".
      original_value: originalValue ?? null,
      corrected_value: correctedValue ?? null,
      corrected_by: getRole(),
      corrected_at: new Date().toISOString(),
      // R16-D2 §5 (CB-4): this is GraphView's own per-field editor.
      correction_source: 'review',
    };

    dispatch({ type: 'CORRECTION_APPLIED', correction, updatedGraph });
  }

  // F-6 (DR7-13). The policy-gate check — a reference error (e.g. a
  // covers_reviews id that doesn't resolve) is an expected-to-happen-
  // during-editing condition (R16-A1 §1.4, CF-5) and comes back as a
  // reader-facing message. Was written out, nearly identically, in both
  // handleProceedFromGraphReview and handleFormSubmitted; now one
  // function, used by both.
  // CR6-17 (Important). A malformed policy used to THROW here instead of
  // returning a message — an uncaught exception inside a React event
  // handler is not caught by anything (error boundaries only catch
  // render-time errors), so both callers' click just produced no visible
  // result at all. Returns the same shape as the reference-error case
  // below instead, so both failure kinds reach the identical
  // setReviewGateError/render path.
  function checkPolicyGate(): string | undefined {
    // CR7-37: the detail goes to the console for whoever edits the file; the
    // person gets one plain sentence (POLICY_PROBLEM_MESSAGE).
    if (!policyResult.valid) {
      console.error(
        'Counterpoise: the firm policy is invalid:',
        policyResult.errors.map((e) => `${e.field}: ${e.reason}`).join('; '),
      );
      return POLICY_PROBLEM_MESSAGE;
    }
    if (packLoadErrors.length > 0) {
      console.error('Counterpoise: a regulatory rules pack failed to load:', packLoadErrors.join(' | '));
      return POLICY_PROBLEM_MESSAGE;
    }
    const referenceCheck = checkPolicyReferences(policyResult.policy, loadedPacks);
    if (referenceCheck.errors.length > 0) {
      console.error('Counterpoise: the firm policy has a broken reference:', referenceCheck.errors.join(' '));
      return POLICY_PROBLEM_MESSAGE;
    }
    return undefined;
  }

  function handleProceedFromGraphReview() {
    if (state.step !== 'graph_review') return;
    // R5-GR-2. Refuse with a message, not a silently disabled button — the
    // reducer refuses too (QUESTIONS_GENERATED guard), this is the layer
    // that explains. Counts, not names: the unconfirmed cards are already
    // visually marked.
    if (state.unconfirmedNodeIds && state.unconfirmedNodeIds.length > 0) {
      const n = state.unconfirmedNodeIds.length;
      setReviewGateError(
        `${n} card${n === 1 ? '' : 's'} still need checking. We read these from your description — nothing is decided until a person has checked or corrected each one.`,
      );
      return;
    }
    // R7-JC-2: jurisdictions select which REGULATIONS evaluate — they are
    // never left model-asserted.
    if (state.jurisdictionsConfirmed === false) {
      setReviewGateError(
        'Check the countries before continuing — they decide which countries’ rules apply.',
      );
      return;
    }
    const gateError = checkPolicyGate();
    if (gateError) {
      setReviewGateError(gateError);
      return;
    }
    // checkPolicyGate() above already returns a message when
    // !policyResult.valid, so the early return just took it — reaching
    // here always means policyResult.valid is true. Restated so TS
    // narrows policyResult.policy below (it cannot see that invariant
    // across the function-call boundary).
    if (!policyResult.valid) return;
    setReviewGateError(null);
    // R6-QN-1: guessed-field questions ride with the budget-driven ones,
    // deduplicated by id (a field can be both uncertain-budgeted and
    // guessed; one question is enough).
    const budgeted = generateQuestions(state.graph, policyResult.policy, []);
    const forGuessed = questionsForGuessedFields(state.guessedFields ?? {}, state.graph);
    const seenIds = new Set(budgeted.map((q) => q.id));
    const questions = [...budgeted, ...forGuessed.filter((q) => !seenIds.has(q.id))];
    dispatch({ type: 'QUESTIONS_GENERATED', questions });
    // UC-6 requires an explicit human confirmation click even with zero
    // questions (P4-C04) — no more silent auto-evaluation.
    //
    // F-6 (DR7-13): the ONE routing rule, shared with the FORM_SUBMITTED
    // reducer case (intake-state.ts) — questions present (the dispatch
    // above handles that) first; failing that, a contradiction stops at
    // its own review; failing that, confirmation.
    if (questions.length === 0) {
      // UC-5, found by user-walking the product (2026-08-15): detection ran
      // only inside handleAnswerSubmitted, so the guided form — which marks
      // nothing uncertain and therefore generates zero questions — skipped
      // the questionnaire AND the contradiction check with it. "No client
      // data at all" in the description plus Client PII in the form reached
      // attestation unchallenged. The check must gate the SKIP, not just the
      // answers. Both dispatches below are processed in order: the state is
      // `questionnaire` by the time CONTRADICTIONS_DETECTED lands, which is
      // the step the reducer requires.
      const contradictions = detectContradictions(
        'description' in state ? state.description : submittedDescription,
        [],
        state.graph,
      );
      if (nextReviewStep(questions, contradictions) === 'contradiction_review') {
        dispatch({ type: 'CONTRADICTIONS_DETECTED', contradictions });
        return;
      }
      dispatch({ type: 'PROCEED_TO_CONFIRMATION' });
    }
  }

  // R16-W W-3/W-4 (§1, D-69/D-70). The form's own Continue — replaces the
  // old GRAPH_EXTRACTED dispatch that routed every form submission through
  // graph_review, which is engine vocabulary a path where the person typed
  // every value themselves has no business showing (principle 1). Mirrors
  // handleProceedFromGraphReview's reference-check/questions/contradiction
  // logic exactly: a form-built graph clears the identical gates a
  // description-built one does — only the SCREEN it skips differs.
  //
  // Unlike confirmInFlight below, this guard DOES reset in `finally` on
  // every path, including success: a legitimate resubmission (Change an
  // answer, fill in again, Continue) must be able to re-enter this handler
  // a second time for the SAME mounted IntakeFlow, where confirmInFlight's
  // sibling pattern never needs to (that flow leaves confirmation for good
  // on success; CORRECT_VERDICT is its own, explicit re-arm).
  // E-2 (Minor): this comment used to describe a double-click race closed
  // by reading the ref "before the first call's `await appendAuditEvent`
  // has resolved" — stale since F-3 moved that write to Confirm; this
  // handler makes no audit write and, today, no await at all, so there is
  // no actual async gap for two clicks to race across. The ref is kept
  // belt-and-braces, so the handler still cannot re-enter if an await is
  // ever added back here.
  async function handleFormSubmitted(
    builtGraph: DataFlowGraph,
    assumptions: Assumption[],
    answerState: FormAnswerState,
    typedDescription: string,
  ) {
    if (state.step !== 'graph_extraction' || state.method !== 'form') return;
    if (formSubmitInFlight.current) return;
    formSubmitInFlight.current = true;
    // R16-D2 §5. A correction through the form rebuilds the graph from the
    // answers, which starts at version 1 — numbered one above the original
    // instead, so the correction records and the new verdict say "v1 → v2"
    // like a review-screen correction does, never "v1 → v1".
    const graph: DataFlowGraph = state.originalGraph
      ? { ...builtGraph, version: state.originalGraph.version + 1 }
      : builtGraph;
    try {
      // F-3 (DR7-05): no creation write happens on the form at all any
      // more (it moved to Confirm, inside the F-1 case lock — see
      // runConfirmAndEvaluate) — so this gate check no longer needs to
      // run "before the creation write" for that reason; it still runs
      // first because a reference error must stop the submission before
      // anything else does.
      const gateError = checkPolicyGate();
      if (gateError) {
        setReviewGateError(gateError);
        return;
      }
      // checkPolicyGate() above already returns a message when
      // !policyResult.valid — restated so TS narrows policyResult.policy
      // below (see the identical comment in handleProceedFromGraphReview).
      if (!policyResult.valid) return;
      setReviewGateError(null);

      // W-1 (R16-W §1, D-67): question 2 starts with the first screen's
      // words, and whatever the person leaves there is THE description
      // from here on — the trail, the contradiction check, the register
      // node and the memo all read it. The first screen's text is only the
      // fallback for an empty answer (question 2 is required, so this is
      // defensive).
      const answeredDescription = typedDescription.trim();
      const description = answeredDescription || state.description;
      setSubmittedDescription(description);

      // "One use case, one creation event" (§1, W-4): a resubmission
      // already minted a useCaseId on the FIRST submission — carried on
      // graph_extraction's own state by CHANGE_ANSWER/the form-path
      // STEP_BACK. Reused here; F-3 (DR7-05) moved the use_case_created
      // WRITE itself to Confirm (runConfirmAndEvaluate, inside the F-1
      // case lock), written at most once per case by construction there
      // — this handler no longer writes anything, so there is nothing
      // left here to strand if "Start over" happens before Confirm.
      const useCaseId = state.useCaseId ?? crypto.randomUUID();

      // Computed from the graph IN HAND, never from stale state (§1).
      const questions = generateQuestions(graph, policyResult.policy, []);
      const contradictions = detectContradictions(description, [], graph);
      // R16-D2 §5 (D-82, DR7-22). `state.originalGraph` is present only on
      // a correction of a form-built verdict (CORRECT_VERDICT_WITH_FORM,
      // carried forward since). Diffed here, not inside intake-state.ts —
      // this handler is where both graphs (the original, and this fresh
      // one) are actually in hand; the result rides the same `corrections`
      // field every other path already threads through to
      // runConfirmAndEvaluate's existing per-correction write loop.
      const corrections = state.originalGraph
        ? formCorrections(state.originalGraph, graph, { by: getRole(), at: new Date().toISOString(), newId: () => crypto.randomUUID() })
        : [];
      dispatch({
        type: 'FORM_SUBMITTED',
        graph,
        useCaseId,
        description,
        answerState,
        assumptions,
        questions,
        contradictions,
        corrections,
      });
      // CR7-13: the saved form answers are cleared HERE — after the policy
      // check above has accepted them and FORM_SUBMITTED is dispatched — not
      // inside the form before that check could refuse them. (Start over,
      // ErrorBoundary and the verdict still clear it as before.)
      clearFormDraft();
    } finally {
      formSubmitInFlight.current = false;
    }
  }

  // explore-001 D-001 (Critical). The step check below is necessary but NOT
  // sufficient: dispatch() is asynchronous, so two synchronous clicks both
  // read the same render's closure, both observe step === 'confirmation',
  // and both write to the append-only audit trail. Those duplicate events
  // cannot be removed afterwards, by design.
  //
  // A ref is the fix rather than state because it updates synchronously —
  // the second click sees the flag before React has re-rendered. Same
  // pattern as RegisterDetail's 2LoD action guard and the seed function's
  // in-flight promise (code review C-5).
  const confirmInFlight = useRef(false);

  useEffect(() => {
    // The draft is UI convenience only — never the audit trail, which is
    // written exclusively through appendAuditEvent.
    if (state.step === 'verdict') clearDraft();
    else saveDraft(state);
  }, [state]);

  // R8-SC-1/-3: precedents = decided register entries ranked by the pure
  // engine helper; controls enriched from each match's own trail.
  //
  // R16-W W-3 (§1): also computed on `confirmation` when the graph came
  // from the guided form — that path no longer passes through
  // `graph_review` on the way to confirmation (FORM_SUBMITTED skips it),
  // so if a form-path submitter is ever to see similar decided cases
  // before attesting, this is the only step left to compute them on.
  useEffect(() => {
    const isGraphReview = state.step === 'graph_review';
    const isFormConfirmation = state.step === 'confirmation' && state.graph.intake_method === 'structured_form';
    if (!isGraphReview && !isFormConfirmation) {
      setPrecedents([]);
      return;
    }
    const currentGraph = state.graph;
    const currentDescription = state.description;
    const currentUseCaseId = state.useCaseId;
    let cancelled = false;
    void (async () => {
      const rows = await getUseCases('all');
      const candidates: PrecedentCandidate[] = rows
        .filter((r) => r.current_verdict_status !== null)
        .map((r) => ({
          id: r.use_case_id,
          label: r.label,
          description: r.description,
          status: r.current_verdict_status!,
          tier: r.tier,
          track: r.track,
          decided_at: r.last_evaluated_at,
          policy_version: r.policy_version_at_evaluation,
        }));
      const subjectLabel = currentGraph.input_nodes[0]?.label ?? '';
      const matches = findPrecedents(
        { label: subjectLabel, description: currentDescription },
        candidates,
        currentUseCaseId,
      );
      const enriched: EnrichedPrecedent[] = [];
      for (const m of matches) {
        const events = await getAuditEvents(m.id);
        const payload = findLatestVerdictEvent(events);
        const verdict = payload ? (payload.type === 'verdict_produced' ? payload.verdict : payload.new_verdict) : null;
        enriched.push({ ...m, controls: verdict?.controls ?? [] });
      }
      if (!cancelled) setPrecedents(enriched);
    })();
    return () => {
      cancelled = true;
    };
    // Delta review 005 finding 1: a correction updates the graph while the
    // step stays graph_review (or, now, confirmation) — the version in the
    // dep re-runs the search so the precedent list always reflects the
    // graph on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step, state.step === 'graph_review' || state.step === 'confirmation' ? state.graphVersion : -1]);

  async function handleConfirmAndEvaluate(reviewerNote?: string) {
    if (state.step !== 'confirmation') return;
    if (confirmInFlight.current) return;
    confirmInFlight.current = true;
    setConfirmPending(true);

    const { graph, corrections, useCaseId, originalVerdictId, originalGraph } = state;
    // The confirmation step's state shape does not carry resolutionNotes —
    // they live on questionnaire/contradiction_review. By CONFIRMED time the
    // reducer has already folded them forward? It has NOT: confirmation's
    // shape drops them. Read from the questionnaire leg via the narrowing the
    // union allows; [] when the shape lacks them.
    const resolutions: string[] =
      'resolutionNotes' in state && Array.isArray(state.resolutionNotes) ? state.resolutionNotes : [];
    // R6-CX-1: the contexts typed on question answers, persisted with the
    // attestation. Same evaporation risk the resolutionNotes fix closed —
    // read them out BEFORE the CONFIRMED dispatch drops the shape.
    const answerContexts: string[] =
      'answers' in state ? state.answers.map((a) => a.context).filter((c): c is string => Boolean(c)) : [];
    const typedDescription = 'description' in state ? state.description : undefined;
    // R16-D2 §3 (D-96). Read out BEFORE the CONFIRMED dispatch, the same
    // way resolutions/answerContexts above already are — confirmation's
    // own assumptions/plainAnswers, for the "No" screen (via lastConfirmed,
    // set in runConfirmAndEvaluate) and for graph_confirmed's new optional
    // `assumptions` field.
    const confirmedAssumptions: Assumption[] = 'assumptions' in state && state.assumptions ? state.assumptions : [];
    const confirmedPlainAnswers: PlainAnswers | undefined = 'plainAnswers' in state ? state.plainAnswers : undefined;
    const confirmedAnswerState: FormAnswerState | undefined = 'answerState' in state ? state.answerState : undefined;
    // CR7-02: the frozen "what the description did not say" list, kept beside
    // the assumptions so a correction from the result can hand both back.
    const confirmedUncertainNodeIds: string[] = 'uncertainNodeIds' in state && state.uncertainNodeIds ? state.uncertainNodeIds : [];

    // F-1 (DR7-02, DR7-03). The whole confirm-and-evaluate sequence —
    // including the precondition read below and the CONFIRMED dispatch —
    // runs inside the per-case lock, so a second tab's (or a retried)
    // confirm/correction on the SAME case is ordered after this one
    // finishes. The precondition is read FIRST, before any write and
    // before CONFIRMED is even dispatched: that is what turns "ordered"
    // into "a repeat is refused" rather than merely delayed.
    // R16-F review pass 2: everything in here that can fail BEFORE the
    // evaluation (the record check, the lock itself) used to escape as an
    // unhandled rejection — confirmInFlight stayed set, so Confirm went dead
    // with no message. The evaluation's own failures are still handled by the
    // inner catch below (EVALUATION_FAILED); this outer one covers the rest.
    try {
      await withCaseLock(useCaseId, async () => {
        const precondition = await confirmationPrecondition(useCaseId, originalVerdictId);
        if (precondition !== 'ok') {
          // Write nothing. Stay on `confirmation` — no CONFIRMED dispatch,
          // so no EVALUATION_FAILED either (this is not an engine/policy
          // failure). Confirm disables itself from here on
          // (confirmationRefusal, read where ConfirmationStep is rendered
          // below); the only way forward for a stale draft is the register.
          setConfirmationRefusal(precondition);
          confirmInFlight.current = false;
          setConfirmPending(false);
          return;
        }
        setConfirmationRefusal(null);
        dispatch({ type: 'CONFIRMED' });
        setEvaluationError(null);

        try {
          await runConfirmAndEvaluate(
            graph,
            corrections,
            useCaseId,
            originalVerdictId,
            reviewerNote,
            resolutions,
            typedDescription,
            answerContexts,
            confirmedAssumptions,
            confirmedPlainAnswers,
            confirmedUncertainNodeIds,
            originalGraph,
            confirmedAnswerState,
          );
        } catch (err) {
          // A legitimate engine/policy failure (e.g. no-track-match) must not
          // leave the UI stuck on "Evaluating..." forever with no message
          // (P5-C01 review-flagged gap, fixed here).
          setEvaluationError(err instanceof Error ? err.message : String(err));
          dispatch({ type: 'EVALUATION_FAILED' });
          // Released only on failure: a genuine engine error returns the user to
          // graph_review and they must be able to retry. On success the flow
          // leaves the confirmation step entirely, so the guard stays set.
          confirmInFlight.current = false;
          setConfirmPending(false);
        }
      });
    } catch (err) {
      // Kept for whoever diagnoses a real storage failure; the person sees
      // the plain message instead (R16-F review pass 3).
      console.error('Counterpoise: the record check before Confirm failed:', err);
      setConfirmationRefusal('check-failed');
      confirmInFlight.current = false;
      setConfirmPending(false);
    }
  }

  async function runConfirmAndEvaluate(
    graph: DataFlowGraph,
    corrections: GraphCorrection[],
    useCaseId: string,
    originalVerdictId: string | undefined,
    reviewerNote?: string,
    contradictionResolutions: string[] = [],
    typedDescription?: string,
    answerContexts: string[] = [],
    confirmedAssumptions: Assumption[] = [],
    confirmedPlainAnswers?: PlainAnswers,
    confirmedUncertainNodeIds: string[] = [],
    originalGraph?: DataFlowGraph,
    confirmedAnswerState?: FormAnswerState,
  ) {
    // Policy checks come FIRST, before any write (R16-F review pass 1). They
    // used to run after use_case_created/graph_confirmed (or graph_corrected)
    // were already on the trail, and a reference error then returned
    // silently: the screen sat on "Evaluating…" with no message and the trail
    // kept an attestation with no verdict. Now an invalid or broken policy
    // throws before anything is written, and the caller's existing catch
    // shows the message and returns to the answers (EVALUATION_FAILED).
    // R16-A1 (§1.4, CF-5): the same reference-error gate as the first
    // evaluation gates (checkPolicyGate), repeated here because a restored
    // draft can reach Confirm after the policy was edited.
    // CR7-37: one plain sentence for the person (see POLICY_PROBLEM_MESSAGE);
    // the detail is for whoever edits the file, so it goes to the console.
    if (!policyResult.valid) {
      console.error(
        'Counterpoise: the firm policy is invalid:',
        policyResult.errors.map((e) => `${e.field}: ${e.reason}`).join('; '),
      );
      throw new Error(POLICY_PROBLEM_MESSAGE);
    }
    if (packLoadErrors.length > 0) {
      console.error('Counterpoise: a regulatory rules pack failed to load:', packLoadErrors.join(' | '));
      throw new Error(POLICY_PROBLEM_MESSAGE);
    }
    const confirmReferenceCheck = checkPolicyReferences(policyResult.policy, loadedPacks);
    if (confirmReferenceCheck.errors.length > 0) {
      console.error('Counterpoise: the firm policy has a broken reference:', confirmReferenceCheck.errors.join(' '));
      throw new Error(POLICY_PROBLEM_MESSAGE);
    }

    // VD-3 (verdict-audit.md §6): a correction pass writes
    // graph_corrected/verdict_corrected instead of
    // graph_confirmed/verdict_produced — the original verdict_produced
    // event is never modified (append-only, per-event UUIDs).
    const isCorrection = Boolean(originalVerdictId);

    // CR7-21/22. Read once, inside the case lock: which of this confirm's
    // corrections are NOT already on the trail since the last result (see
    // correctionsNotOnTrail). They are written BEFORE evaluate(), not after —
    // CONFIRMED drops `corrections` from the state and EVALUATION_FAILED
    // returns `corrections: []`, so a failed evaluation would lose them for
    // good if they waited for a result.
    const existingEvents = await getAuditEvents(useCaseId);
    const plan = planCorrectionWrites(corrections, existingEvents, {
      resolve: graphValueResolver(graph, originalGraph),
      version: graph.version,
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      by: getRole(),
    });
    const correctionsToWrite = plan.toWrite;
    // M-4: what the trail holds for THIS attempt (written now, or already there
    // from a failed attempt before it) — never `corrections.length`, which a
    // retry after a failed evaluation resets to zero while the events remain.
    const correctionsOnTrail = plan.sinceLastResult;
    const writeCorrections = async () => {
      // BC-P5C01-02: one graph_corrected event per individual
      // GraphCorrection, matching the spec's singular payload shape.
      for (const correction of correctionsToWrite) {
        await appendAuditEvent({
          event_id: crypto.randomUUID(),
          use_case_id: useCaseId,
          event_type: 'graph_corrected',
          occurred_at: new Date().toISOString(),
          actor: getRole(),
          payload: { type: 'graph_corrected', correction },
        });
      }
    };

    if (isCorrection) {
      await writeCorrections();
    } else {
      // F-3 (DR7-05): the creation record, written HERE — at Confirm,
      // inside the F-1 case lock — once per case. Both early writes this
      // used to have (the form's first Continue; the description path
      // never actually had one, despite what an earlier review pass
      // claimed — see the R16-F handover) are gone: "Start over" before
      // Confirm now strands nothing, and the recorded description can
      // never differ from the one finally confirmed, because they are
      // the same read. `getAuditEvents` rather than a second
      // precondition check: confirmationPrecondition (F-1) already
      // proved no verdict/register node exists for this case, but an
      // EVALUATION RETRY after a genuine failure (no verdict yet) still
      // passes that same precondition and must reach here WITHOUT a
      // second use_case_created — only a second, deliberate
      // graph_confirmed (below), recorded honestly as a second
      // attestation.
      if (!existingEvents.some((e) => e.event_type === 'use_case_created')) {
        await appendAuditEvent({
          event_id: crypto.randomUUID(),
          use_case_id: useCaseId,
          event_type: 'use_case_created',
          occurred_at: new Date().toISOString(),
          actor: getRole(),
          payload: {
            type: 'use_case_created',
            description: typedDescription ?? '',
            intake_method: graph.intake_method,
          },
        });
      }
      // CR7-22 (BC-005). A fresh confirm wrote only a COUNT
      // (`corrections_count`) while the confirmation screen says "corrections
      // are preserved in the audit trail": the corrections themselves are
      // written here, one graph_corrected each, so the trail backs the
      // sentence (and the sign-off page can show them).
      await writeCorrections();
      // UC-6 (intake-flow.md §9): graph_confirmed written BEFORE evaluate()
      // runs, verdict_produced written before the UI transitions to verdict
      // (BC-P4C04-02: sequential, not Promise.all). Order on the trail:
      // use_case_created -> graph_confirmed -> verdict_produced.
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'graph_confirmed',
        occurred_at: new Date().toISOString(),
        actor: getRole(),
        payload: {
          type: 'graph_confirmed',
          graph_id: graph.id,
          graph_version: graph.version,
          corrections_count: correctionsOnTrail,
          // Spread-if-present, not `submitter_note: reviewerNote` — the audit
          // trail is append-only and permanent, and a record carrying
          // `submitter_note: undefined` serialises as a field somebody could
          // later mistake for a deliberately blank note.
          ...(reviewerNote ? { submitter_note: reviewerNote } : {}),
          ...(contradictionResolutions.length > 0 ? { contradiction_resolutions: contradictionResolutions } : {}),
          ...(answerContexts.length > 0 ? { answer_contexts: answerContexts } : {}),
          // GB pass-1 M2: a failed-evaluation retry writes a SECOND
          // graph_confirmed, which also carries this field — harmless and
          // intended (each confirmation record states what the description
          // said). The review/confirmation warnings show on every pass.
          // GT7 L-1 (P12): the description path only — the form's sentence is
          // never read by a model. Written here, on the first confirmation; a
          // correction pass (the isCorrection branch above) does not re-flag,
          // by design: the first record already carries it. Spread-if-present.
          ...(ratingInstructionsFor(graph, typedDescription).length > 0
            ? { rating_instructions: ratingInstructionsFor(graph, typedDescription) }
            : {}),
          // R16-D2 §4 (D-81, DR7-16): the "Not sure" answers this
          // confirmation was based on — written only when non-empty, same
          // spread-if-present discipline as the three fields above.
          ...(confirmedAssumptions.length > 0 ? { assumptions: confirmedAssumptions } : {}),
        },
      });
    }

    // R12-ST-1 (ADR-EE-R12-1): pure pre-transform, run BEFORE evaluate() so
    // an expired family entry is simply unapproved by the time evaluate()
    // sees the policy — "today" is read here at the component layer, never
    // inside engine code.
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const attestablePolicy = applyReattestExpiry(policyResult.policy, today);

    // §6.1: the engine evaluates the corrected graph as a fresh call —
    // there is no "partial re-evaluation".
    const evalResult = evaluate(graph, attestablePolicy, loadedPacks);
    if (!evalResult.ok) {
      // CR6-12 (Minor): was `Evaluation failed: ${evalResult.error.kind}` —
      // the raw internal enum string, shown to the person verbatim, inside
      // a sentence that then told them to review their own answers. Every
      // one of these kinds is the firm's own rules/policy/packs; never
      // something a different answer would have avoided.
      throw new Error(engineErrorMessage(evalResult.error.kind));
    }
    const result = evalResult.value;

    // R12-ST-1: computed alongside evaluate(), never inside it — rides on
    // the Verdict wrapper, keeping TC-PE-1-01's byte-identical guarantee
    // true by construction.
    const staleSources = computeStaleSources(loadedPacks, today);

    const fullVerdict: Verdict = {
      ...result,
      id: crypto.randomUUID(),
      use_case_id: useCaseId,
      living_status: 'approved',
      living_status_updated_at: now,
      attested_by: getRole(),
      attested_at: now,
      graph_version: graph.version,
      corrections: [],
      ...(staleSources.length > 0 ? { stale_sources: staleSources } : {}),
    };
    setVerdict(fullVerdict);
    setLastGraph(graph);
    // R16-D2 §3 (D-96). Set beside lastGraph, for the identical reason: the
    // "No" screen's contributing-assumption check and a later "Correct"
    // click both need what THIS confirmation was based on, which the bare
    // `verdict` reducer state does not carry.
    setLastConfirmed({
      assumptions: confirmedAssumptions,
      plainAnswers: confirmedPlainAnswers,
      answerState: confirmedAnswerState,
      uncertainNodeIds: confirmedUncertainNodeIds,
    });

    // R16-D2 §4b (D-97, W-7). The processing node's platform/vendor at
    // evaluation — carried beside the verdict (like
    // knowledge_lens_matched_entry_ids below) so the register, which does
    // not persist the graph, can still tell whether a scoped "already
    // verified" safeguard applies to THIS case. Spread-if-present on the
    // write below: absent when the node has neither, same discipline as
    // submitter_note.
    const processingNode = graph.processing_nodes[0];
    const evidenceScope: { platform?: string; vendor?: string } | undefined =
      processingNode?.platform !== undefined || processingNode?.vendor !== undefined
        ? {
            ...(processingNode?.platform !== undefined ? { platform: processingNode.platform } : {}),
            ...(processingNode?.vendor !== undefined ? { vendor: processingNode.vendor } : {}),
          }
        : undefined;

    // VD-8 (verdict-audit.md §7) — best-effort: a trace failure (no key,
    // network error) must not block verdict storage (BC-P5C02-01).
    // reasoning_trace: undefined is a valid, spec-mandated outcome.
    const controlLibrary = policyResult.valid ? policyResult.policy.controls : [];
    const bindingDescription =
      findRuleDescription(policyResult.valid ? policyResult.policy : undefined, fullVerdict.binding_constraint) ?? '';
    const traceResult = await generateReasoningTraceForVerdict(fullVerdict, controlLibrary, bindingDescription);
    const reasoningTrace = traceResult.ok ? traceResult.value : undefined;

    // R11-KL-2/ADR-EE-R11-1: a SECOND, independent call, computed AFTER
    // evaluate() has already returned — never fed into it, never read by
    // it. Riding beside the verdict on the audit event (never inside
    // Verdict/EvaluationResult) is what keeps R11-NF-1 true.
    const verdictRuleIdsForLens = (() => {
      const ids = new Set<string>();
      const ex = fullVerdict.explanation;
      if (ex) {
        if (ex.tier_rationale?.rule_id) ids.add(ex.tier_rationale.rule_id);
        if (ex.track_rationale?.rule_id) ids.add(ex.track_rationale.rule_id);
        for (const t of ex.tripped_invariants) ids.add(t.id);
        for (const r of ex.regulatory_chain ?? []) ids.add(r.rule_id);
      }
      if (fullVerdict.binding_constraint) ids.add(fullVerdict.binding_constraint);
      return [...ids];
    })();
    const knowledgeLensMatchedEntryIds = matchKnowledgeLens(graph, knowledgeLensEntries, verdictRuleIdsForLens).map(
      (m) => m.entry.id,
    );

    if (isCorrection) {
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'verdict_corrected',
        occurred_at: now,
        actor: 'system',
        payload: {
          type: 'verdict_corrected',
          original_verdict_id: originalVerdictId!,
          new_verdict: fullVerdict,
          reasoning_trace: reasoningTrace,
          knowledge_lens_matched_entry_ids: knowledgeLensMatchedEntryIds,
          // R16-D2 §8 (F2C-6): how many graph_corrected events this pass
          // wrote — a zero-correction resubmission writes none, and
          // eventDetail (RegisterDetail.tsx) reads this to render it as a
          // re-check rather than implying something changed.
          corrections_count: correctionsOnTrail,
          // F-4 (DR7-12, DR7-16): same spread-if-present discipline as
          // graph_confirmed below — a correction keeps what the person
          // typed, instead of dropping it the way only writing it on a
          // fresh confirm used to.
          ...(reviewerNote ? { submitter_note: reviewerNote } : {}),
          ...(contradictionResolutions.length > 0 ? { contradiction_resolutions: contradictionResolutions } : {}),
          ...(answerContexts.length > 0 ? { answer_contexts: answerContexts } : {}),
          // R16-D2 §4 (D-81): same field as graph_confirmed's, on whichever
          // event recorded THIS correction's own confirmation.
          ...(confirmedAssumptions.length > 0 ? { assumptions: confirmedAssumptions } : {}),
          // R16-D2 §4b (D-97): see the computation above.
          ...(evidenceScope ? { evidence_scope: evidenceScope } : {}),
        },
      });
    } else {
      await appendAuditEvent({
        event_id: crypto.randomUUID(),
        use_case_id: useCaseId,
        event_type: 'verdict_produced',
        occurred_at: now,
        actor: 'system',
        payload: {
          type: 'verdict_produced',
          verdict: fullVerdict,
          reasoning_trace: reasoningTrace,
          knowledge_lens_matched_entry_ids: knowledgeLensMatchedEntryIds,
          // R16-D2 §4b (D-97): see the computation above.
          ...(evidenceScope ? { evidence_scope: evidenceScope } : {}),
        },
      });
    }

    // P6-C02 (register-lifecycle.md §7): route the verdict's tier to a
    // real governance stage instead of a hardcoded 'idea'.
    const routedWorkflow = policyResult.valid ? routeToWorkflow(result.tier, policyResult.policy) : undefined;
    setSavedStage(routedWorkflow?.lifecycle_stage ?? null);

    if (isCorrection) {
      // register_nodes uses db.add() in addNode() — a correction reuses
      // the existing useCaseId, so calling addNode() again would throw a
      // duplicate-key ConstraintError. Update the existing node instead.
      await updateUseCaseVerdictSummary(useCaseId, {
        tier: result.tier,
        track: result.track,
        currentVerdictId: fullVerdict.id,
      });
      // §6: "Pre-checked → Pre-checked (correction + re-evaluation)" — a
      // real, audited lifecycle_stage_changed transition, but only when
      // the routed stage actually changes (a same-stage re-evaluation
      // must not emit a no-op audit event).
      if (routedWorkflow) {
        const existing = await getUseCase(useCaseId);
        if (existing && existing.lifecycle_stage !== routedWorkflow.lifecycle_stage) {
          await updateLifecycleStage(useCaseId, routedWorkflow.lifecycle_stage, getRole());
        }
      }
    } else {
      // The register node doesn't exist until this first confirm+verdict
      // cycle (established since P4-C01/P5-C01) — the unobservable
      // Idea/Exploring states are skipped; the node is created directly
      // at its routed stage (build/prompts/P6-C02.md deviation #4).
      await addNode({
        node_id: useCaseId,
        node_type: 'use_case',
        // D-004 (charter 004): this took the INPUT node's label, which the
        // guided form builds as "<use case name> — input"
        // (build-graph-from-form.ts:51). Every form-submitted use case
        // therefore sat in the register, and on the 2LoD sign-off page, under
        // the name of the data feeding it. The register lists AI systems, so
        // the processing node — the system itself — is the right name; the
        // form sets that label to the use case name exactly
        // (build-graph-from-form.ts:59). Input remains the fallback for a
        // graph with no processing node, which the engine would reject
        // anyway.
        label: graph.processing_nodes[0]?.label ?? graph.input_nodes[0]?.label ?? 'AI use case',
        created_at: now,
        metadata: {
          node_type: 'use_case',
          description: typedDescription,
          submitted_by: getRole(),
          lifecycle_stage: routedWorkflow?.lifecycle_stage ?? 'idea',
          current_verdict_id: fullVerdict.id,
          tier: result.tier,
          track: result.track,
        },
      });
      // R11-MG-3 / ADR-RL-R11-1 (register-lifecycle.md section 16): the dormant
      // ai_model/uses_model schema, consumed at the same write that already
      // produces the use_case node. Only on first confirmation, not on a
      // correction re-evaluation: a correction reuses useCaseId and would
      // otherwise write a second uses_model edge for the same use case.
      // Pass 2 M-1: written AFTER the node, never before. The verdict is already
      // on the trail, so a failure here must not strand the case (Confirm would
      // refuse it as already decided). If the link cannot be written the case is
      // saved and flagged `model_link_unrecorded`, and the register then says
      // nothing about whether a model was named.
      const declaredModelNode = graph.processing_nodes.find((n) => n.declared_model_id);
      if (declaredModelNode && policyResult.valid) {
        try {
          // CR7-41: the snapshot judges acceptance on the same expiry-applied
          // policy evaluate() saw, so a family past its reattest_by is not filed
          // as accepted while the verdict owes its review.
          await addUseCaseModelLink(useCaseId, declaredModelNode, attestablePolicy);
        } catch (err) {
          console.error('Counterpoise: the model link for this case could not be written:', err);
          // A second failure must not break a confirm whose case is already saved:
          // log it and carry on. Residual (accepted): with neither the edge nor
          // the flag written, the register may later say "No AI model is recorded".
          try {
            await updateUseCaseVerdictSummary(useCaseId, { modelLinkUnrecorded: true });
          } catch (flagErr) {
            console.error('Counterpoise: the case could not be flagged model_link_unrecorded:', flagErr);
          }
        }
      }
    }
    await refreshRegister();
    setVerdictAuditEvents(await getAuditEvents(useCaseId));
    // CR6-15 (Important). The result IS recorded as of this line — clear
    // the saved draft directly, right here, rather than relying only on
    // the effect keyed on `state.step === 'verdict'` below. That effect
    // never fires for a component that has unmounted (the user navigated
    // away mid-confirm, a deliberate CR6-15 scenario: this function keeps
    // running in the background regardless), so the draft used to stay
    // frozen wherever it last was — typically still `confirmation` — and a
    // later visit restored that stale screen for a case that, in truth,
    // already has a result. This call is a plain sessionStorage write, not
    // React state, so it has an effect whether or not anything is still
    // mounted to react to it.
    //
    // CR7-16: only if the saved draft is still THIS case's. This function keeps
    // running after the person has left; by the time it lands they may have
    // started a different case, whose draft an unconditional clear would wipe.
    clearDraftIfCase(useCaseId);
    dispatch({ type: 'VERDICT_READY' });
  }

  function handleCorrectVerdict() {
    if (state.step !== 'verdict' || !verdict || !lastGraph) return;
    // Re-entering the flow for a correction pass means confirmation will be
    // reached again, so the D-001 guard must be released. Missing this made
    // the correction path silently un-confirmable — caught by the P5-C01
    // test, which is why that test earns its keep.
    confirmInFlight.current = false;
    // R16-D2 §5 (D-82, DR7-17). A form-built verdict whose confirmation
    // answers are still in hand re-enters at the FORM itself — graph_review
    // is engine vocabulary principle 1 bans from a path the person typed
    // every value through themselves. Falls back to today's CORRECT_VERDICT
    // (graph_review) when either is missing — an older verdict predating
    // lastConfirmed, or a form-built graph last confirmed through the
    // review screen rather than the form.
    if (lastConfirmed?.plainAnswers && lastConfirmed.answerState && lastGraph.intake_method === 'structured_form') {
      dispatch({
        type: 'CORRECT_VERDICT_WITH_FORM',
        originalGraph: lastGraph,
        useCaseId: verdict.use_case_id,
        originalVerdictId: verdict.id,
        // DR7-17: the description from the confirmed state, not the first
        // screen's typed text — submittedDescription is set from question
        // 2's final text at every form confirm (handleFormSubmitted).
        description: submittedDescription,
        answerState: lastConfirmed.answerState,
        assumptions: lastConfirmed.assumptions,
      });
      return;
    }
    dispatch({
      type: 'CORRECT_VERDICT',
      graph: lastGraph,
      useCaseId: verdict.use_case_id,
      originalVerdictId: verdict.id,
      // CR7-02: what this verdict was confirmed on, so the correction pass's
      // own confirmation still lists the "Not sure" answers.
      assumptions: lastConfirmed?.assumptions,
      uncertainNodeIds: lastConfirmed?.uncertainNodeIds,
    });
  }

  // R16-E §2/§3 (D-101, D-102, DR7-28/29). Most answers still go straight
  // through "coerce -> correction", unchanged. A handful of fields route
  // through a follow-up question or a named, special choice instead:
  //  - decision_type "Something else" leaves decision_type unset and asks
  //    a free-text follow-up for decision_type_other (DR7-29);
  //  - vendor/declared_model_id "Not on this list"/"Not on the list" ask a
  //    free-text follow-up, resolved once typed or left blank (DR7-28);
  //  - vendor "I don't know" resolves immediately to its own value, with
  //    an assumption; declared_model_id "I don't know" clears the field —
  //    "none declared", an honest absence, never an assumption (D-27);
  //  - vendor_name/declared_model_id_name (the two follow-ups above) write
  //    onto a DIFFERENT real field than the question that asked them;
  //  - any other field's own "Not sure" resolves to QUESTIONNAIRE_COPY's
  //    stricter value and records the matching assumption.
  function handleAnswerSubmitted(questionId: string, value: unknown, context?: string, notSure?: boolean) {
    if (state.step !== 'questionnaire') return;
    // ADR-IF-R6-3. An answer that differs from the graph IS a correction:
    // before this, answers were recorded and contradiction-checked but the
    // engine evaluated the model's original best-guess values regardless —
    // the 10th computed-but-never-consumed instance. The correction goes
    // through the same shape as a graph-screen edit, so it is versioned and
    // written as graph_corrected at attestation.
    const question = state.questions.find((q) => q.id === questionId);
    let correction: GraphCorrection | undefined;
    let updatedGraph: DataFlowGraph | undefined;
    let assumption: Assumption | undefined;
    let insertQuestions: IntakeQuestion[] | undefined;
    if (question?.node_id && question.field) {
      let targetField = question.field;
      let skipCorrection = false;

      if (question.field === 'decision_type' && value === 'other') {
        value = undefined;
        insertQuestions = [
          { id: `${question.id}-other`, field: 'decision_type_other', node_id: question.node_id, triggered_by: [], answer_type: 'text' },
        ];
      } else if (question.field === 'vendor' && value === 'not-on-list') {
        skipCorrection = true;
        insertQuestions = [
          { id: `${question.id}-name`, field: 'vendor_name', node_id: question.node_id, triggered_by: [], answer_type: 'text' },
        ];
      } else if (question.field === 'vendor' && value === 'dont-know') {
        value = VENDOR_UNSURE_VALUE;
        const copy = questionnaireCopyForField('vendor');
        assumption = {
          questionId: 'field:vendor',
          question: copy.question,
          shortLabel: copy.shortLabel,
          assumption: VENDOR_UNSURE_ASSUMPTION,
          fields: ['vendor'],
        };
      } else if (question.field === 'declared_model_id' && value === 'not-on-list') {
        skipCorrection = true;
        insertQuestions = [
          {
            id: `${question.id}-name`,
            field: 'declared_model_id_name',
            node_id: question.node_id,
            triggered_by: [],
            answer_type: 'text',
          },
        ];
      } else if (question.field === 'declared_model_id' && value === 'dont-know') {
        // D-27: "none declared" — an honest absence, not an assumption.
        value = undefined;
      } else if (question.field === 'vendor_name') {
        targetField = 'vendor';
        value = vendorNotOnListValue(String(value ?? ''));
      } else if (question.field === 'declared_model_id_name') {
        targetField = 'declared_model_id';
        const typed = String(value ?? '').trim();
        value = typed || undefined;
      } else if (notSure) {
        const copy = questionnaireCopyForField(question.field);
        if (copy.notSure) {
          value = copy.notSure.value;
          assumption = {
            questionId: `field:${question.field}`,
            question: copy.question,
            shortLabel: copy.shortLabel,
            assumption: copy.notSure.assumption,
            fields: [question.field],
          };
        }
      }

      if (!skipCorrection) {
        const applyTo = (nodes: { id: string }[]) =>
          nodes.map((n) => (n.id === question.node_id ? { ...n, [targetField]: value } : n));
        const node = [...state.graph.input_nodes, ...state.graph.processing_nodes, ...state.graph.output_nodes].find(
          (n) => n.id === question.node_id,
        ) as Record<string, unknown> | undefined;
        const originalValue = node?.[targetField];
        // v0.7.1 validation gate: a value outside the field's legal set must
        // never reach the graph. Buttons produce legal values by
        // construction; this closes the free-text and future-regression
        // paths (the bug that let "internal team" land in autonomy_level).
        // Skipped only when the branches above already resolved to an
        // intentional, honest `undefined` (nothing to validate).
        if (value !== undefined) {
          const coerced = coerceAnswerValue(targetField, value);
          if (!coerced.ok) {
            setReviewGateError(`That answer was not recorded: ${coerced.reason}.`);
            return;
          }
          value = coerced.value;
        }
        setReviewGateError(null);
        // BC-3. system_access_scope is list-valued — a fresh array is
        // never reference-equal to the one already on the graph even
        // when it names the identical kinds (e.g. confirming the
        // extractor's own guessed set via the tick-all control), so this
        // field compares by CONTENT (R16-F's own `sameAccessScopeSet`,
        // the same helper handleCorrectNode already uses) rather than
        // the generic `!==` every other field uses.
        const changed =
          targetField === 'system_access_scope'
            ? !sameAccessScopeSet(originalValue, value)
            : originalValue !== value;
        if (node && changed) {
          updatedGraph = {
            ...state.graph,
            version: state.graph.version + 1,
            input_nodes: applyTo(state.graph.input_nodes) as typeof state.graph.input_nodes,
            processing_nodes: applyTo(state.graph.processing_nodes) as typeof state.graph.processing_nodes,
            output_nodes: applyTo(state.graph.output_nodes) as typeof state.graph.output_nodes,
          };
          correction = {
            correction_id: crypto.randomUUID(),
            graph_version_before: state.graph.version,
            graph_version_after: updatedGraph.version,
            node_id: question.node_id,
            field: targetField,
            // CR7-30: see handleCorrectNode.
            original_value: originalValue ?? null,
            corrected_value: value ?? null,
            corrected_at: new Date().toISOString(),
            corrected_by: getRole(),
            // R16-D2 §5 (CB-4): a questionnaire answer that write-backs onto
            // the graph.
            correction_source: 'question',
          };
        }
      }
    }
    const answer = { questionId, value, ...(context ? { context } : {}) };
    const nextAnswers = [...state.answers, answer];
    dispatch({ type: 'ANSWER_SUBMITTED', answer, correction, updatedGraph, assumption, insertQuestions });

    // O-001 (charter 005): this read `submittedDescription`, a useState written
    // only inside handleSubmitDescription. A restored draft never re-ran that,
    // so a resumed questionnaire checked answers against an EMPTY STRING and
    // quietly found no contradictions — degrading silently rather than
    // failing. The description now travels on the reducer state, which the
    // draft envelope persists.
    const contradictions = detectContradictions(
      'description' in state ? state.description : submittedDescription,
      nextAnswers,
      // R6: check against the graph as answered, not as extracted — an
      // answer that just fixed the contradiction must not re-flag it.
      updatedGraph ?? state.graph,
    );
    // B-10c: one the person has already explained is not raised again while
    // the graph still holds it; a different contradiction still is.
    const explained = new Set(state.step === 'questionnaire' ? (state.explainedContradictions ?? []) : []);
    const fresh = contradictions.filter((c) => !explained.has(contradictionKey(c)));
    if (fresh.length > 0) {
      dispatch({ type: 'CONTRADICTIONS_DETECTED', contradictions: fresh });
      return;
    }

    // R16-E §3: a follow-up question just inserted (decision_type_other, a
    // supplier/model name) means there is more to answer even if this was
    // the last of the ORIGINAL list.
    const totalQuestions = state.questions.length + (insertQuestions?.length ?? 0);
    if (nextAnswers.length >= totalQuestions) {
      // B-10 (rewritten, FX-2 review I-3). A contradiction found at form
      // submission is NOT replayed from a carried copy here: detectContradictions
      // reads only the description and the graph, so the live check just above
      // (on the graph AS ANSWERED) already shows it whenever it still holds,
      // and a carried copy could only fire after an answer had resolved it —
      // re-flagging what R6 says must not be re-flagged. Re-running that same
      // check at the end would be the identical call, so there is nothing
      // further to do: reaching this line means no contradiction holds now.
      dispatch({ type: 'PROCEED_TO_CONFIRMATION' });
    }
  }

  function handleContradictionResolved(explanation: string) {
    dispatch({ type: 'CONTRADICTION_RESOLVED', explanation });
    // Found by walking the product (2026-08-15): resolution returns to the
    // questionnaire, but when every question is already answered — always
    // true on the zero-questions path, and true whenever the contradiction
    // fired on the FINAL answer — nothing ever dispatched the next step. The
    // screen read "All questions answered." over no forward control: a dead
    // end. Both dispatches process in order, so the reducer is back on
    // `questionnaire` before PROCEED_TO_CONFIRMATION lands.
    if (state.step === 'contradiction_review' && state.answers.length >= state.questions.length) {
      dispatch({ type: 'PROCEED_TO_CONFIRMATION' });
    }
  }

  // §3 (DR7-10). One mechanism for every step change, here rather than
  // per screen: moves focus to the step container and announces the new
  // step through a single polite live region. Skipped on first load
  // (including a restored draft) — nothing has "changed" into yet, so
  // mounting must not steal focus from wherever the page naturally placed
  // it.
  const stepContainerRef = useRef<HTMLDivElement | null>(null);
  const previousStepRef = useRef<IntakeState['step'] | null>(null);
  const [stepAnnouncement, setStepAnnouncement] = useState('');
  useEffect(() => {
    if (previousStepRef.current === null) {
      previousStepRef.current = state.step;
      return;
    }
    if (previousStepRef.current === state.step) return;
    previousStepRef.current = state.step;
    // preventScroll: the container is typically already in view (it's
    // this same screen, re-rendered) — focus should not also jump the
    // page around.
    stepContainerRef.current?.focus({ preventScroll: true });
    // CR6-08 (Important). describeStep() maps BOTH evaluation_pending and
    // verdict onto the same visible tracker label ("Result", StepTracker.tsx)
    // — correct for the tracker, which the fix below deliberately leaves
    // alone, but it meant this announcement re-rendered the IDENTICAL text
    // on the transition INTO evaluation_pending and then again on the
    // transition FROM it to verdict. A live region that repeats the same
    // text is, to a screen reader, a region that said nothing changed —
    // the result arrived silently. Two distinct sentences here, one for
    // "still working on it" and one for "it's ready", are enough: neither
    // needs its own step number, since the step number is what describeStep
    // already gives every OTHER transition unchanged.
    setStepAnnouncement(
      state.step === 'evaluation_pending'
        ? 'Working out your result…'
        : state.step === 'verdict'
          ? 'Your result is ready.'
          : describeStep(state.step),
    );
  }, [state.step]);

  return (
    <div className="intake-flow">
      <div className="intake-flow__title-row">
        <h1>New pre-check</h1>
      </div>
      <p className="intake-flow__step-announcement" role="status" aria-live="polite">
        {stepAnnouncement}
      </p>
      {/* R16-W §4 (D-74): replaces "Describe the AI use case in plain
          language. The engine reads what it can, asks only what it must,
          and returns a defensible verdict." — engine vocabulary
          ("the engine", "verdict" as a process word) on the very first
          thing a newcomer reads. */}
      <p className="intake-flow__subtitle">
        Tell us about an AI tool you want to use. We&rsquo;ll check it against your firm&rsquo;s rules and
        tell you whether you can go ahead, and what needs doing first.
      </p>

      {showInterrupted && state.step === 'description_entry' && (
        <div className="intake-flow__resumed" role="status">
          Your last pre-check was still being worked out when you left, so it can&rsquo;t be picked up
          here. If it completed, it is on the register &mdash; it can take a moment to appear.
        </div>
      )}

      {/* TC-CR6-02k: a finished case (result shown, or an earlier result
          used) is not "unfinished" — the banner would overclaim. */}
      {showResumed && state.step !== 'description_entry' && state.step !== 'verdict' && !adoptedFrom && (
        <div className="intake-flow__resumed" role="status">
          <strong>Picked up where you left off.</strong> Your unfinished pre-check was restored — you were
          part-way through, and refreshing or navigating away no longer loses it.
          <button type="button" onClick={handleStartOver} disabled={confirmPending || decisionPending}>
            Start over instead
          </button>
        </div>
      )}

      {/* CR7-28: a questions draft saved before CR6 came back as the review
          screen. Says only what is true: what changed, and what to do. */}
      {showMigrated && state.step === 'graph_review' && (
        <div className="intake-flow__resumed" role="status">
          This was saved by an earlier version of this tool. The values from your earlier answers are
          on the cards below — please check each one.
        </div>
      )}

      <StepTracker current={state.step} onBack={canStepBack ? handleStepBack : undefined} backDisabled={decisionPending} />

      <div className="card" ref={stepContainerRef} tabIndex={-1}>
        {/* FN-006. Rendered once, above the step content, rather than per
            screen — a back control that moves around is a back control people
            stop looking for. Absent past `questionnaire` because confirmation
            is an attestation and one-way by design. */}
        {canStepBack && (
          <button type="button" className="step-back" onClick={handleStepBack} disabled={decisionPending}>
            ← Back
          </button>
        )}

        {state.step === 'description_entry' && (
          <div className="describe">
            <div className="describe__input">
              {/* R16-W §4 (D-74): label/placeholder/button/help all replaced —
                  "Describe your AI use case" / "Read & extract →" were the
                  tool's own internal-process words ("extract"), not the
                  submitter's question. */}
              <label htmlFor="description-input">What AI tool do you want to use, and what will it do for you?</label>
              <textarea
                id="description-input"
                ref={descriptionRef}
                value={state.description}
                onChange={(e) => dispatch({ type: 'DESCRIPTION_CHANGED', description: e.target.value })}
                placeholder='e.g. "Use ChatGPT to turn my client meeting notes into follow-up emails, which I check before sending."'
              />
              {/* GI-3-19: a description that dictates its own rating is warned
                  on this screen, before anything is read or decided. */}
              <RatingInstructionNotice description={state.description} />
              {/* The first Next lists what is unmentioned (only the items still
                  unmentioned now); Next is never disabled by it. */}
              <NudgeNote
                items={(state.nudgeFor ?? []).filter((id) => unmentionedNow.includes(id))}
                onAddExample={(sentence) => {
                  dispatch({ type: 'DESCRIPTION_CHANGED', description: appendExample(state.description, sentence) });
                  descriptionRef.current?.focus();
                }}
              />
              {/* R18-B (§27.8): where the description will go and which model reads it,
                  directly above Next. Shown from the stored setting only when it validates. */}
              <ModelStatus />
              <button type="button" onClick={handleSubmitDescription} disabled={!state.description.trim()}>
                Next →
              </button>
              {/* design-review round 4 (Panel G — Intake: Describe, Important):
                  the button never said what happens after clicking, or that
                  nothing is final yet. */}
              <p className="field-help">
                You can check and change everything before anything is decided — nothing here is final
                yet.
              </p>
            </div>
            <ChecklistPanel description={state.description} jurisdictions={mentionJurisdictions} />
          </div>
        )}

        {state.step === 'duplicate_check' && adoptedFrom && (
          <section aria-label="Classification adopted" className="dup-gate">
            {/* NF-11 (design-review round 4, Panel A): "UC-2" was the
                internal requirements-doc ID for this screen, rendered bare
                with no reader-facing purpose. Dropped, not glossed — there
                is nothing here a reader needs the code for.
                R16-W §4 (D-74): tag and both paragraphs replaced — "tier
                and track"/"verdict" were engine vocabulary on a screen a
                newcomer reaches with no questions of their own. */}
            <div className="questionnaire__tag">EARLIER RESULT USED</div>
            {/* CR7-10: the matching case may belong to someone else, and the
                duplicate check deliberately matches across all submitters. The
                case NAME is shown only to the 2LoD view — the same rule as the
                match card above. */}
            <p>
              {getRole() === '2LoD' ? (
                <>Earlier result used from {adoptedFrom}.</>
              ) : (
                <>An earlier result on your firm&rsquo;s register was used.</>
              )}{' '}
              This is on the register with the same risk level and review route, and no questions
              were asked.
            </p>
            <p className="dup-gate__clear">
              Nothing was checked for this record, so it has no result of its own — its sign-off
              page says so, and the record shows where it came from. If the two turn out to differ,
              start a fresh pre-check rather than editing this one.
            </p>
          </section>
        )}

        {state.step === 'duplicate_check' && !adoptedFrom && (
          <section aria-label="Duplicate check" className="dup-gate">
            {/* R16-W §4 (D-74): the no-match and match-found cases are
                treated as two distinct screens with their own copy — the
                match-found screen gets a plain-language TITLE instead of
                the "HAS THIS BEEN CHECKED BEFORE?" tag, which belongs to
                the no-match screen only. */}
            {duplicateCheckDone && duplicateMatch ? (
              <p className="duplicate-card__title">Something similar has been checked before</p>
            ) : (
              <>
                <div className="questionnaire__tag">HAS THIS BEEN CHECKED BEFORE?</div>
                {/* design-review round 4 (Panel G, Important): the screen
                    never said why this check runs. */}
                <p className="field-help">
                  We look for a similar tool your firm has already checked, so similar uses get the
                  same answer.
                </p>
              </>
            )}
            {/* CR6-08 / CR6-08c (M-3). ONE status region that persists from the
                in-progress line into the outcome: a live region announces
                changes to its content, so swapping the node itself for a
                plain <p> (as the "Nothing similar found" outcome did) was
                never announced. A found match keeps its own role="alert". */}
            <div role="status">
              {!duplicateCheckDone ? (
                <p>Looking through earlier checks…</p>
              ) : !duplicateMatch ? (
                <p className="dup-gate__clear">
                  Nothing similar found — we looked through {registerRows.length} earlier check
                  {registerRows.length === 1 ? '' : 's'}.
                </p>
              ) : null}
            </div>
            {duplicateCheckDone && (
              <>
                {duplicateMatch ? (
                  <div className="duplicate-card" role="alert">
                    {/* BC-V12C-02: the matched label stays redacted for 1LoD
                        — unchanged by this fix. design-review round 4
                        (Panel G — Intake: Duplicate check, Critical #1/#2):
                        what WAS wrong is that the non-2LoD copy said
                        "Contact AI Risk to adopt" while the button right
                        below adopted immediately, with no role check at all
                        — the words and the only clickable thing on the
                        screen disagreed. Fixed by describing what the button
                        actually does, for both roles, instead of claiming a
                        gate that doesn't exist. R16-W §4 (D-74): the 1LoD
                        text now drops the tier entirely (no tier claim on a
                        redacted card); the 2LoD text is unchanged. */}
                    {getRole() === '2LoD' ? (
                      <p>
                        Overlapping use case: <strong>{duplicateMatch.label}</strong>
                        {duplicateMatch.tier ? ` — tier ${duplicateMatch.tier}` : ''}.
                      </p>
                    ) : (
                      <p>A similar use is already on your firm&rsquo;s register. Your AI risk team can see its details.</p>
                    )}
                    <p className="dup-gate__clear">
                      Using the earlier result skips the questions: this goes onto the register with
                      the same risk level and review route as the earlier one, without a check of its
                      own. If the two turn out to differ, start a fresh pre-check rather than editing
                      this one.
                    </p>
                  </div>
                ) : null}
                <div className="dup-gate__actions">
                  {/* UC-2: both decisions, side by side. Only "new use case"
                      existed, so the requirement's other half — adopt — was
                      unreachable and the fit criterion unmet. Adopt appears
                      only when there IS a match to adopt from. R16-W §4
                      (D-74): both buttons renamed. */}
                  {duplicateMatch && (
                    <button type="button" onClick={() => void handleAdoptClassification()} disabled={decisionPending}>
                      Use the earlier result
                    </button>
                  )}
                  <button type="button" onClick={() => void handleConfirmNewUseCase()} disabled={decisionPending}>
                    {duplicateMatch ? 'Mine is different — continue →' : 'Continue →'}
                  </button>
                </div>
                {decisionError && (
                  <p className="intake-flow__gate-error" role="alert">
                    {decisionError}
                  </p>
                )}
              </>
            )}
          </section>
        )}

        {state.step === 'graph_extraction' && state.method === 'llm' && (
          <div>
            {/* Code review round 3, Panel C. A failed extraction left this
                screen reading "Extracting graph…" forever: no retry, no way
                back, and a reload restored the same stuck step. The error was
                shown under a label still claiming work was in progress. */}
            {extractionError ? (
              <>
                <p role="alert">{extractionError}</p>
                <p className="field-help">{EXTRACTION_ERROR_HELP}</p>
                <div className="dup-gate__actions">
                  <button type="button" onClick={() => void handleRetryExtraction()}>
                    Try again
                  </button>
                  <button type="button" onClick={handleAnswerQuestionsInstead}>
                    Answer the questions instead
                  </button>
                </div>
              </>
            ) : (
              /* design-review round 4 (Panel G — Intake: Graph review,
                 Critical): "graph" was the operative word in this loading
                 state, the screen title, and the ARIA region label — never
                 defined, right after a screen that promised plain language. */
              <p>Reading your description…</p>
            )}
          </div>
        )}

        {state.step === 'graph_extraction' && state.method === 'form' && (
          <>
            {/* R16-D2 §5 (D-82). Orients a submitter who reached the form
                via "Correct your answers" rather than a fresh pre-check —
                set only when state.originalVerdictId is present. */}
            {state.originalVerdictId && (
              <p className="intake-flow__correction-note" role="status">
                You&rsquo;re correcting your earlier answers. Change what was wrong, then continue —
                the result will be worked out again and both versions are kept.
              </p>
            )}
            {/* F-2 (DR7-04): a form-path EVALUATION_FAILED now re-enters
                HERE (not graph_review), carrying state.useCaseId so a
                resubmission reuses the same case — the error must render
                here too, or a form-path failure would silently drop the
                "why" the fix exists to preserve. */}
            {/* CR6-12 (Minor): dropped "Review your answers and try
                again." — evaluationError is, by construction, always
                about the firm's own rules/policy (engineErrorMessage,
                plain-copy.ts), never the person's answers, so the old
                suffix blamed the wrong party on every single occurrence. */}
            {evaluationError && <p role="alert">Evaluation could not complete: {evaluationError}</p>}
            {reviewGateError && (
              <p role="alert" className="intake-flow__gate-error">
                {reviewGateError}
              </p>
            )}
            {/* R18-GI-7-01: this route never sends the description to a model, so a
                form reached fresh from the description says, in one plain sentence,
                that nothing was filled in for the person. Not shown on a form that
                carries a case (a correction, a retry or a trip back from the
                questions): the sentence is about this arrival from the describe
                screen, and it would be a false claim of a read that never was
                attempted there. */}
            {state.decidedFor !== undefined && state.useCaseId === undefined && state.originalVerdictId === undefined && (
              <p role="status" className="plain-form__read-note">
                {R18_COPY.NO_MODEL_INTERIM_SENTENCE}
              </p>
            )}
            <StructuredForm
              policy={policyResult.valid ? policyResult.policy : EMPTY_POLICY_FALLBACK}
              description={state.description}
              onDescriptionChange={(description) => dispatch({ type: 'DESCRIPTION_EDITED', description })}
              initialAnswerState={formInitialAnswerState}
              initialAnswers={formInitialAnswers}
              earlierVersionNotice={showEarlierVersion}
              onSubmit={(graph, assumptions, answerState, description) =>
                void handleFormSubmitted(graph, assumptions, answerState, description)
              }
            />
          </>
        )}

        {state.step === 'graph_review' && (
          <section>
            {/* design-review round 4 (Panel G, Critical): was "Review
                extracted graph" — system-side vocabulary (what the LLM did)
                where the user's actual goal is "did the system understand
                my use case." R16-E §4 (D-103, DR7-33): reworded again —
                this screen corrects, the summary that follows confirms;
                the two now say so in as many words. */}
            <h2>Check what we read from your description</h2>
            <p className="field-help">
              Correct anything we got wrong. You&rsquo;ll see a summary to confirm before anything is
              decided.
            </p>
            {/* D-001 (charter 004): the description was captured, used for
                extraction, and never shown again — so the user was asked to
                confirm a graph against a description they could no longer
                see. Rendered as plain text; it is user input. */}
            {state.description && (
              <div className="intake-flow__submitted-description">
                <p className="intake-flow__submitted-label">What you wrote</p>
                <p>{state.description}</p>
              </div>
            )}
            {/* GT7 L-1 (P12): a description that dictates its own rating is flagged,
                never obeyed. A status region (not an alert — nothing is blocked) with a
                visible "Warning:" lead-in so it is not colour alone. Display only: the
                graph, the engine input and the verdict never see this list. */}
            {(() => {
              const found = ratingInstructionsFor(state.graph, state.description);
              return found.length > 0 ? (
                <p role="status" className="intake-flow__rating-warning">
                  <strong>Warning:</strong> {ratingInstructionWarning(found)}
                </p>
              ) : null;
            })()}
            {evaluationError && (
              <p role="alert">
                {/* CR8-14: prefix kept (tests and the form path's wrapper read the
                    same); the old "Check the details below and try again." suffix
                    is gone — the sentence is usually a gap in the firm's own
                    rules, not something in the person's details. */}
                Something went wrong working out the result:{' '}
                {/* No added full stop when the sentence already ends with one. */}
                {evaluationError.endsWith('.') ? evaluationError : `${evaluationError}.`}
              </p>
            )}
            {/* V1.1-C01: a real visual data-flow with a real per-field
                correction editor — replaces the flat list whose Edit
                button was a stub that appended " (corrected)" to labels. */}
            {/* R9-SC-1 (ADR-IF-R9-1): the user's remaining obligations,
                aggregated from existing state — the plan the gate error
                used to reveal only on failure. */}
            {(() => {
              const nodeLabel = (id: string) =>
                [...state.graph.input_nodes, ...state.graph.processing_nodes, ...state.graph.output_nodes].find(
                  (n) => n.id === id,
                )?.label ?? id;
              const items: Array<{ key: string; text: string; target: string }> = [];
              for (const [nodeId, fields] of Object.entries(state.guessedFields ?? {})) {
                if (fields.length > 0)
                  items.push({
                    key: `g-${nodeId}`,
                    text: `Fix ${fields.length} detail${fields.length === 1 ? '' : 's'} we couldn’t tell on “${nodeLabel(nodeId)}”`,
                    target: `card-${nodeId}`,
                  });
              }
              for (const nodeId of state.unconfirmedNodeIds ?? []) {
                items.push({ key: `c-${nodeId}`, text: `Check “${nodeLabel(nodeId)}”`, target: `card-${nodeId}` });
              }
              if (state.jurisdictionsConfirmed === false) {
                items.push({ key: 'jur', text: 'Check the countries', target: 'jurisdictions-panel' });
              }
              if (state.unconfirmedNodeIds === undefined && items.length === 0) return null;
              return (
                <div className="review-checklist" role="note">
                  {items.length === 0 ? (
                    <p className="review-checklist__done">
                      All checked — continue when you&rsquo;re ready.
                    </p>
                  ) : (
                    <>
                      <p className="review-checklist__title">
                        {items.length} thing{items.length === 1 ? '' : 's'} to check before you continue:
                      </p>
                      <ul>
                        {items.map((item) => (
                          <li key={item.key}>
                            <button
                              type="button"
                              className="review-checklist__item"
                              onClick={() => document.getElementById(item.target)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                            >
                              {item.text}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })()}
            <GraphView
              graph={state.graph}
              editable
              onCorrect={handleCorrectNode}
              unconfirmedNodeIds={state.unconfirmedNodeIds}
              onConfirmNode={(nodeId) => {
                setReviewGateError(null);
                dispatch({ type: 'NODE_CONFIRMED', nodeId });
              }}
              warnings={plausibilityWarnings(state.description, state.graph)}
              provenance={state.provenance}
              guessedFields={state.guessedFields}
              ignoredJurisdictions={state.ignoredJurisdictions}
              policy={policyResult.valid ? policyResult.policy : undefined}
              reentry={state.reentry}
            />
            {/* R7-JC (ADR-IF-R7-1): jurisdictions gate at review. Sweep-001
                found a hallucinated valid code ("US") that would silently
                activate a pack — so the model's reading is explicit, named,
                editable within the policy's declared set, and never accepted
                without a human act. */}
            {state.jurisdictionsConfirmed !== undefined && policyResult.valid && (
              <div className="jurisdictions-panel" id="jurisdictions-panel">
                <h3>Which countries does it involve?</h3>
                <p className="field-help">
                  {state.graph.jurisdictions.length > 0
                    ? 'We read these from your description. Check them — they decide which countries’ rules apply.'
                    : 'We couldn’t tell from your description which countries it involves. Tick the ones it does — if none of these, only your firm’s own rules apply.'}
                </p>
                {policyResult.policy.jurisdictions.map((j) => (
                  <label key={j.code} className="jurisdictions-panel__option">
                    <input
                      type="checkbox"
                      checked={state.graph.jurisdictions.includes(j.code)}
                      /* FX7-1 review pass 1 (I-1): never locked. A re-entered
                         review (Change an answer, a failed evaluation) shows
                         this panel already checked, and the person must still
                         be able to change a country; the edit goes through
                         JURISDICTIONS_SET with its correction, as on a first
                         reading. */
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...state.graph.jurisdictions, j.code]
                          : state.graph.jurisdictions.filter((c) => c !== j.code);
                        const updatedGraph = { ...state.graph, version: state.graph.version + 1, jurisdictions: next };
                        dispatch({
                          type: 'JURISDICTIONS_SET',
                          updatedGraph,
                          correction: {
                            correction_id: crypto.randomUUID(),
                            graph_version_before: state.graph.version,
                            graph_version_after: updatedGraph.version,
                            node_id: 'graph',
                            field: 'jurisdictions',
                            original_value: state.graph.jurisdictions,
                            corrected_value: next,
                            corrected_at: new Date().toISOString(),
                            corrected_by: getRole(),
                            // R16-D2 §5 (CB-4): part of the same graph_review
                            // screen as GraphView's per-field editor.
                            correction_source: 'review',
                          },
                        });
                        setReviewGateError(null);
                      }}
                    />{' '}
                    {j.name}
                  </label>
                ))}
                {!state.jurisdictionsConfirmed ? (
                  <button
                    type="button"
                    className="jurisdictions-panel__confirm"
                    onClick={() => {
                      dispatch({ type: 'JURISDICTIONS_CONFIRMED' });
                      setReviewGateError(null);
                    }}
                  >
                    {state.graph.jurisdictions.length > 0 ? 'These are right' : 'None of these — continue'}
                  </button>
                ) : (
                  <p className="graph-node__confirmed-note">Checked by you.</p>
                )}
              </div>
            )}
            {/* R9-SC-4/-5: informational content AFTER required actions,
                collapsed to its count (expand renders the full R8 panel). */}
            {precedents.length > 0 && (
              <details className="similar-cases-collapse">
                <summary>
                  {precedents.length} similar decided case{precedents.length === 1 ? '' : 's'} — show
                </summary>
                <SimilarCases matches={precedents} />
              </details>
            )}
            {reviewGateError && (
              <p role="alert" className="intake-flow__gate-error">
                {reviewGateError}
              </p>
            )}
            <button type="button" onClick={handleProceedFromGraphReview}>
              Continue
            </button>
          </section>
        )}

        {state.step === 'questionnaire' && (
          <>
          {reviewGateError && (
            <p role="alert" className="intake-flow__gate-error">
              {reviewGateError}
            </p>
          )}
          <QuestionnaireStep
            questions={state.questions}
            answeredCount={state.answers.length}
            lastAnswer={state.answers[state.answers.length - 1]}
            // C-3 (Minor): Undo is a single-level, one-use snapshot
            // (v0.7.1) — offered only while state.undo actually exists, so
            // the control disappears the moment it is consumed instead of
            // sitting there as a second press that does nothing (the
            // "Recorded" line can still be showing the PREVIOUS answer at
            // that point, which is why this checks state.undo directly
            // rather than deriving it from whether a Recorded line exists).
            onUndo={state.undo ? () => dispatch({ type: 'ANSWER_UNDONE' }) : undefined}
            onAnswer={handleAnswerSubmitted}
            policy={policyResult.valid ? policyResult.policy : undefined}
            graph={state.graph}
          />
          </>
        )}

        {state.step === 'contradiction_review' && (
          <ContradictionReview contradictions={state.contradictions} onResolve={handleContradictionResolved} />
        )}

        {state.step === 'confirmation' && (
          <>
            {/* F-1 (DR7-02, DR7-03): a confirm/correction the precondition
                refused — written nowhere, and Confirm disables itself from
                here, since retrying reads the identical, still-stale
                precondition. */}
            {confirmationRefusal && (
              <p role="alert" className="intake-flow__gate-error">
                {CONFIRMATION_REFUSAL_MESSAGE[confirmationRefusal]}
              </p>
            )}
            <ConfirmationStep
              graph={state.graph}
              corrections={state.corrections}
              policy={policyResult.valid ? policyResult.policy : undefined}
              assumptions={formAssumptions}
              uncertainNodeIds={uncertainNodeIds}
              precedents={precedents}
              // F-9 (DR7-09): the submitted description and the form's own
              // answers (undefined on the description path), so the summary
              // can run the plausibility cross-check and attribute the
              // destination zone to an explicit 3platformZone answer.
              description={state.description}
              plainAnswers={formInitialAnswers}
              ratingInstructionsFound={ratingInstructionsFor(state.graph, state.description).length > 0}
              onChangeAnswer={() => dispatch({ type: 'CHANGE_ANSWER' })}
              onConfirm={(note) => void handleConfirmAndEvaluate(note)}
              // A refusal that will repeat disables Confirm; a failed record
              // check (likely transient) leaves it usable.
              confirmDisabled={confirmationRefusal === 'already-decided' || confirmationRefusal === 'corrected-elsewhere'}
              pending={confirmPending}
            />
          </>
        )}
        {/* CR6-08 (Important): no live region at all previously. */}
        {state.step === 'evaluation_pending' && <p role="status">Evaluating…</p>}

        {state.step === 'verdict' && verdict && (
          <VerdictDisplay
            verdict={verdict}
            auditEvents={verdictAuditEvents}
            policy={policyResult.valid ? policyResult.policy : undefined}
            graph={lastGraph ?? undefined}
            registerStage={savedStage ?? undefined}
            onCorrect={handleCorrectVerdict}
            memoLabel={submittedDescription.slice(0, 80) || 'AI use case'}
            memoDescription={submittedDescription}
            knowledgeLensMatches={knowledgeLensMatches}
            // R16-D2 §2/§3 (D-95, D-96): the "No" screen's contributing-
            // assumption check needs this case's own assumptions and the
            // loaded packs (for a pack hard line's plain_reason/plain_change
            // and jurisdiction name) — lastConfirmed is set beside lastGraph
            // in runConfirmAndEvaluate, for both a fresh confirm and a
            // correction.
            assumptions={lastConfirmed?.assumptions}
            packs={loadedPacks}
          />
        )}
        {/* R16-W W-5 (§5, D-75): collapsed by default on the intake verdict
            screen — "Risk-knowledge awareness… curated by project
            maintainer (2LoD practitioner)…" was sitting unfolded on a
            newcomer's FIRST screen, outside the collapsed reviewer section
            (VD-9: everything beyond the nine first-screen items is
            collapsed). RegisterDetail (the reviewer's own page) renders
            this panel unchanged — unaffected by this wrap. */}
        {state.step === 'verdict' && verdict && knowledgeLensMatches.length > 0 && (
          <details className="intake-flow__knowledge-lens-collapse">
            <summary>What outside research says about this kind of AI use (for your AI risk team)</summary>
            <KnowledgeLensPanel
              matches={knowledgeLensMatches}
              meta={knowledgeLensMeta}
              // R13-UI-3: the intake verdict screen has no filing action
              // (that is a reviewer act on the register page), but if a
              // filing already exists on the trail it still shows as Filed.
              filedRiskDomains={verdictAuditEvents
                .filter((e) => e.payload.type === 'rule_dissent_filed')
                .map((e) => (e.payload.type === 'rule_dissent_filed' ? e.payload.rule_id : ''))
                .filter(Boolean)}
            />
          </details>
        )}
      </div>
    </div>
  );
}
