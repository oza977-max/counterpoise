import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { textFingerprint } from '../engine/form-answer-state';
import { intakeReducer, planCorrectionWrites, graphValueResolver } from './intake-state';
import type { IntakeState } from './intake-state';
import type { DataFlowGraph, GraphCorrection } from '../engine/types';
import type { Assumption } from './plain-copy';

function graph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    input_nodes: [],
    processing_nodes: [],
    output_nodes: [],
    edges: [],
    jurisdictions: [],
    intake_method: 'llm',
    extracted_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('intakeReducer', () => {
  it('description_entry → description_entry on DESCRIPTION_CHANGED', () => {
    const state: IntakeState = { step: 'description_entry', description: '' };
    const next = intakeReducer(state, { type: 'DESCRIPTION_CHANGED', description: 'a new AI tool' });
    expect(next).toEqual({ step: 'description_entry', description: 'a new AI tool' });
  });

  it('description_entry → duplicate_check on SUBMIT_DESCRIPTION', () => {
    const state: IntakeState = { step: 'description_entry', description: 'a new AI tool' };
    const next = intakeReducer(state, { type: 'SUBMIT_DESCRIPTION' });
    expect(next).toEqual({ step: 'duplicate_check', description: 'a new AI tool' });
  });

  it('duplicate_check → graph_extraction with method: form when no API key is configured', () => {
    const state: IntakeState = { step: 'duplicate_check', description: 'x' };
    const next = intakeReducer(state, { type: 'NO_DUPLICATE_FOUND', method: 'form' });
    expect(next).toEqual({ step: 'graph_extraction', description: 'x', method: 'form', decidedFor: textFingerprint('x') });
  });

  it('questionnaire → questionnaire on ANSWER_SUBMITTED, appending the answer', () => {
    const g = graph();
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'A tool that drafts client emails.',
      graph: g,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
    };
    const answer = { questionId: 'Q1', value: 'yes' };
    const next = intakeReducer(state, { type: 'ANSWER_SUBMITTED', answer });
    // v0.7.1: the answer also snapshots the pre-answer graph for one-level
    // undo. R16-E §3: the snapshot also carries `questions` (an answer can
    // insert a follow-up right after itself) and — CR7-02 (4) — the
    // assumptions array itself (it was `assumptionsLen`, which a replaced
    // assumption can no longer be undone by).
    expect(next).toEqual({
      ...state,
      answers: [answer],
      undo: { graph: g, correctionsLen: 0, questions: [], assumptions: [] },
    });
  });

  it('questionnaire → contradiction_review on CONTRADICTIONS_DETECTED, carrying corrections/useCaseId forward', () => {
    const g = graph();
    const answers = [{ questionId: 'Q1', value: 'yes' }];
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'A tool that drafts client emails.',
      graph: g,
      questions: [],
      answers,
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
    };
    const contradictions = [{ statement1: 'a', statement2: 'b', field: 'data_class' }];
    const next = intakeReducer(state, { type: 'CONTRADICTIONS_DETECTED', contradictions });
    expect(next).toEqual({ ...state, step: 'contradiction_review', contradictions });
  });

  it('contradiction_review → questionnaire on CONTRADICTION_RESOLVED, recording the explanation and (TC-CR6-B10c) which contradiction it explained', () => {
    const g = graph();
    const answers = [{ questionId: 'Q1', value: 'yes' }];
    const state: IntakeState = {
      step: 'contradiction_review',
      description: 'A tool that drafts client emails.',
      graph: g,
      questions: [],
      answers,
      contradictions: [{ statement1: 'a', statement2: 'b', field: 'data_class' }],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
    };
    const next = intakeReducer(state, { type: 'CONTRADICTION_RESOLVED', explanation: 'Confirmed both are correct.' });
    expect(next).toEqual({
      step: 'questionnaire',
      description: 'A tool that drafts client emails.',
      graph: g,
      questions: [],
      answers,
      resolutionNotes: ['Confirmed both are correct.'],
      explainedContradictions: ['data_class|a'],
      corrections: [],
      useCaseId: 'uc-1',
    });
  });

  it('CONTRADICTION_RESOLVED with an empty/whitespace-only explanation is rejected at the reducer layer (P4-C03 review finding: defense in depth)', () => {
    const g = graph();
    const state: IntakeState = {
      step: 'contradiction_review',
      description: 'A tool that drafts client emails.',
      graph: g,
      questions: [],
      answers: [],
      contradictions: [{ statement1: 'a', statement2: 'b', field: 'data_class' }],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
    };
    const next = intakeReducer(state, { type: 'CONTRADICTION_RESOLVED', explanation: '   ' });
    expect(next).toBe(state);
  });

  it('PROCEED_TO_CONFIRMATION carries resolutionNotes — an attestation must be able to persist them (UC-5, 2026-08-15)', () => {
    // Found live: the explanation a submitter is REQUIRED to give when their
    // description contradicts their answers was dropped by this transition,
    // so the audit write downstream silently had nothing to record.
    const g = graph();
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'x',
      graph: g,
      questions: [],
      answers: [],
      resolutionNotes: ['The description was aspirational; the form is right.'],
      corrections: [],
      useCaseId: 'uc-1',
    };
    const next = intakeReducer(state, { type: 'PROCEED_TO_CONFIRMATION' });
    expect('resolutionNotes' in next && next.resolutionNotes).toEqual([
      'The description was aspirational; the form is right.',
    ]);
  });

  it('questionnaire → confirmation on PROCEED_TO_CONFIRMATION (P4-C04: real state, no longer a pass-through)', () => {
    const g = graph({ version: 1 });
    const answers = [{ questionId: 'Q1', value: 'yes' }];
    const correction: GraphCorrection = {
      correction_id: 'c1',
      graph_version_before: 0,
      graph_version_after: 1,
      node_id: 'n1',
      field: 'data_class',
      original_value: 'Internal',
      corrected_value: 'Confidential',
      corrected_by: '1LoD',
      corrected_at: '2026-01-01T00:00:00.000Z',
    };
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'A tool that drafts client emails.',
      graph: g,
      questions: [],
      answers,
      resolutionNotes: [],
      corrections: [correction],
      useCaseId: 'uc-1',
    };
    const next = intakeReducer(state, { type: 'PROCEED_TO_CONFIRMATION' });
    expect(next).toEqual({
      step: 'confirmation',
      description: 'A tool that drafts client emails.',
      graph: g,
      graphVersion: 1,
      corrections: [correction],
      answers,
      resolutionNotes: [],
      originalVerdictId: undefined,
      useCaseId: 'uc-1',
      afterFailedEvaluation: false, // CR8-03: deliberate expectation change — every confirmation carries the flag
    });
  });

  it('confirmation → evaluation_pending on CONFIRMED, carrying useCaseId', () => {
    const g = graph({ version: 1 });
    const state: IntakeState = {
      step: 'confirmation',
      afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
      description: 'A tool that drafts client emails.',
      graph: g,
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-1',
    };
    const next = intakeReducer(state, { type: 'CONFIRMED' });
    // Review 004 finding 2: description rides along so a failed evaluation
    // can restore a working review screen.
    expect(next).toEqual({ step: 'evaluation_pending', graph: g, useCaseId: 'uc-1', originalVerdictId: undefined, description: 'A tool that drafts client emails.' });
  });

  it('does not skip confirmation from questionnaire anymore (PROCEED_TO_EVALUATION_PASSTHROUGH removed, BC-P4C04-01)', () => {
    const g = graph({ version: 1 });
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'A tool that drafts client emails.',
      graph: g,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
    };
    // @ts-expect-error PROCEED_TO_EVALUATION_PASSTHROUGH no longer exists in IntakeAction
    const next = intakeReducer(state, { type: 'PROCEED_TO_EVALUATION_PASSTHROUGH' });
    expect(next).toBe(state);
  });

  it('evaluation_pending → verdict on VERDICT_READY, using the carried useCaseId as verdictId', () => {
    const g = graph();
    const state: IntakeState = { step: 'evaluation_pending', graph: g, useCaseId: 'uc-1' };
    const next = intakeReducer(state, { type: 'VERDICT_READY' });
    expect(next).toEqual({ step: 'verdict', verdictId: 'uc-1' });
  });

  it('RESTART returns to a blank description entry from every step (explore-005 D-002)', () => {
    const g = graph({ version: 3 });
    const states: IntakeState[] = [
      { step: 'description_entry', description: 'x' },
      { step: 'duplicate_check', description: 'x' },
      { step: 'graph_extraction', description: 'x', method: 'form' },
      { step: 'evaluation_pending', graph: g, useCaseId: 'uc-1' },
      { step: 'verdict', verdictId: 'uc-1' },
    ];
    // The step-by-step guards are the point of this test: RESTART is the one
    // action deliberately valid from ALL of them, because the previous
    // escape hatch dispatched an action the reducer discarded from every
    // step but the first — so it silently did nothing.
    for (const state of states) {
      expect(intakeReducer(state, { type: 'RESTART' })).toEqual({ step: 'description_entry', description: '' });
    }
  });

  it('ignores an action that does not apply to the current state (exhaustive guard)', () => {
    const state: IntakeState = { step: 'description_entry', description: 'x' };
    const next = intakeReducer(state, { type: 'NO_DUPLICATE_FOUND', method: 'form' });
    expect(next).toBe(state);
  });
});

// Round 4 — charter 005 O-001. The description is now carried on the state
// rather than held in a component useState, because the draft envelope
// persists the state and did not persist the useState. A resumed questionnaire
// was running detectContradictions against an empty string, finding nothing,
// and saying so — degrading quietly instead of failing.
describe('intakeReducer — the description survives to the steps that need it (O-001)', () => {
  it('carries the description from the form through to confirmation', () => {
    const g = graph({ version: 1, intake_method: 'structured_form' });
    const typed = 'A tool that drafts client emails from CRM notes';

    let state: IntakeState = { step: 'graph_extraction', description: typed, method: 'form' };
    state = intakeReducer(state, {
      type: 'FORM_SUBMITTED',
      graph: g,
      useCaseId: 'uc-1',
      description: typed,
      answerState: {},
      assumptions: [],
      questions: [{ id: 'Q1', field: 'autonomy_level', triggered_by: [], answer_type: 'text' }],
      contradictions: [],
      corrections: [],
    });
    expect(state.step).toBe('questionnaire');
    // The questionnaire is the step that reads it - this is the one that was
    // silently checking answers against ''.
    expect('description' in state && state.description).toBe(typed);

    state = intakeReducer(state, { type: 'PROCEED_TO_CONFIRMATION' });
    expect('description' in state && state.description).toBe(typed);
  });
});

// FN-006 — user-reported after the v0.1.0 tag: "after describing, if I go to
// the next step it doesn't go back, there is no back option." The action union
// carried forward transitions plus RESTART and nothing else, so the only
// escape from a typo in the description was to destroy the whole session.
//
// The boundary that matters: confirmation is an attestation (UC-6), and
// stepping back across it would let a submitter un-attest. STEP_BACK stops
// there by design, and the tests below pin that.
describe('intakeReducer — STEP_BACK (FN-006)', () => {
  const typed = 'A model that scores retail credit applications';

  it('duplicate_check → description_entry, keeping what was typed', () => {
    const state: IntakeState = { step: 'duplicate_check', description: typed };
    const next = intakeReducer(state, { type: 'STEP_BACK' });
    // Keeping the description IS the fix. Returning to a blank box would be
    // RESTART, which already exists and is not what was asked for.
    expect(next).toEqual({ step: 'description_entry', description: typed });
  });

  it('does not step back out of confirmation — the attestation boundary holds', () => {
    const state: IntakeState = {
      step: 'confirmation',
      afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
      description: typed,
      graph: graph(),
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-1',
    };
    expect(intakeReducer(state, { type: 'STEP_BACK' })).toBe(state);
  });

  it('does not step back from description_entry, evaluation_pending or verdict', () => {
    const entry: IntakeState = { step: 'description_entry', description: typed };
    expect(intakeReducer(entry, { type: 'STEP_BACK' })).toBe(entry);

    const pending: IntakeState = { step: 'evaluation_pending', graph: graph(), useCaseId: 'uc-1' };
    expect(intakeReducer(pending, { type: 'STEP_BACK' })).toBe(pending);

    const done: IntakeState = { step: 'verdict', verdictId: 'uc-1' };
    expect(intakeReducer(done, { type: 'STEP_BACK' })).toBe(done);
  });

  it('a correction pass keeps its originalVerdictId when it steps back (VD-3)', () => {
    // Stepping back must not silently turn a correction into a new submission -
    // that would orphan the verdict being corrected.
    const original = graph({ intake_method: 'structured_form' });
    const state: IntakeState = {
      step: 'questionnaire',
      description: typed,
      graph: graph({ intake_method: 'structured_form' }),
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      plainAnswers: { '1': 'Tool' },
      originalVerdictId: 'v-original',
      originalGraph: original,
    };
    const back = intakeReducer(state, { type: 'STEP_BACK' });
    expect(back).toMatchObject({ step: 'graph_extraction', originalVerdictId: 'v-original', originalGraph: original });
  });
});

describe('intakeReducer — EVALUATION_FAILED returns to the form (F-2, DR7-04)', () => {
  it('TC-R16-F-53: a failed evaluation returns to the form (graph_extraction), filled in, with the case id reused', () => {
    const g = graph({ intake_method: 'structured_form' });
    const state: IntakeState = {
      step: 'evaluation_pending',
      graph: g,
      useCaseId: 'uc-1',
      description: 'A form-built tool.',
      plainAnswers: { '1': 'Tool name', '2': 'A form-built tool.' },
      assumptions: [{ questionId: '9', question: 'q?', shortLabel: 'q?', assumption: 'a', fields: ['output_reversibility'] }],
    };
    expect(intakeReducer(state, { type: 'EVALUATION_FAILED' })).toEqual({
      step: 'graph_extraction',
      description: 'A form-built tool.',
      method: 'form',
      useCaseId: 'uc-1',
      plainAnswers: { '1': 'Tool name', '2': 'A form-built tool.' },
      assumptions: [{ questionId: '9', question: 'q?', shortLabel: 'q?', assumption: 'a', fields: ['output_reversibility'] }],
    });
  });

  // R16-D2 §5 (v2.1). Before this fix, a form-path EVALUATION_FAILED during
  // a CORRECTION dropped originalVerdictId/originalGraph — the re-confirm
  // then ran as a fresh confirm and the F-1 precondition refused it as
  // "already has a result" (safe, but a dead end).
  it('TC-R16-D2-52: a form-path EVALUATION_FAILED during a CORRECTION carries originalVerdictId and originalGraph back to the form', () => {
    const g = graph({ intake_method: 'structured_form' });
    const original = graph({ intake_method: 'structured_form', version: 1 });
    const state: IntakeState = {
      step: 'evaluation_pending',
      graph: g,
      useCaseId: 'uc-1',
      originalVerdictId: 'v-being-corrected',
      originalGraph: original,
      description: 'A form-built tool.',
      plainAnswers: { '1': 'Tool name' },
      assumptions: [],
    };
    const next = intakeReducer(state, { type: 'EVALUATION_FAILED' });
    expect(next).toMatchObject({
      step: 'graph_extraction',
      method: 'form',
      originalVerdictId: 'v-being-corrected',
      originalGraph: original,
    });
  });

  it('CONFIRMED carries plainAnswers/assumptions forward onto evaluation_pending, so EVALUATION_FAILED can hand them to the form', () => {
    const g = graph({ intake_method: 'structured_form' });
    const state: IntakeState = {
      step: 'confirmation',
      afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
      description: 'x',
      graph: g,
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-1',
      plainAnswers: { '1': 'carried' },
      assumptions: [],
    };
    const pending = intakeReducer(state, { type: 'CONFIRMED' });
    expect(pending).toMatchObject({ step: 'evaluation_pending', plainAnswers: { '1': 'carried' } });
  });
});

// R16-F F-7 (DR7-07). uncertainNodeIds is threaded forward unchanged through
// every transition from the questions to the confirmation - never re-derived.
// A non-empty value proves the thread actually carries the real ids, not just
// an empty default. (R18-E: nothing on the one remaining route sets it any
// more, so the test starts from a questionnaire state that already holds it.)
describe('intakeReducer — uncertainNodeIds threads forward unchanged to confirmation (F-7, DR7-07)', () => {
  it('TC-R16-F-58: survives CONTRADICTIONS_DETECTED -> CONTRADICTION_RESOLVED -> PROCEED_TO_CONFIRMATION', () => {
    const g = graph();
    const questionnaire: IntakeState = {
      step: 'questionnaire',
      description: 'x',
      graph: g,
      questions: [{ id: 'Q1', field: 'vendor', triggered_by: [], answer_type: 'text' }],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      uncertainNodeIds: ['n1', 'n2'],
    };

    const contradictionReview = intakeReducer(questionnaire, {
      type: 'CONTRADICTIONS_DETECTED',
      contradictions: [{ field: 'f', description_says: 'a', graph_says: 'b' } as never],
    });
    expect(contradictionReview).toMatchObject({ uncertainNodeIds: ['n1', 'n2'] });
    if (contradictionReview.step !== 'contradiction_review') throw new Error('unreachable');

    const backToQuestionnaire = intakeReducer(contradictionReview, {
      type: 'CONTRADICTION_RESOLVED',
      explanation: 'Explained.',
    });
    expect(backToQuestionnaire).toMatchObject({ uncertainNodeIds: ['n1', 'n2'] });
    if (backToQuestionnaire.step !== 'questionnaire') throw new Error('unreachable');

    const confirmation = intakeReducer(backToQuestionnaire, { type: 'PROCEED_TO_CONFIRMATION' });
    expect(confirmation).toMatchObject({ step: 'confirmation', uncertainNodeIds: ['n1', 'n2'] });
  });
});

// R16-F F-6 (DR7-13). nextReviewStep is the ONE routing rule, used by the
// FORM_SUBMITTED case below - tested directly here so the priority is pinned
// once, not re-derived from FORM_SUBMITTED's own behaviour alone.
describe('nextReviewStep (F-6, DR7-13)', () => {
  it('TC-R16-F-55: questions present wins regardless of contradictions', async () => {
    const { nextReviewStep } = await import('./intake-state');
    const q = [{ id: 'Q1', field: 'f', triggered_by: [], answer_type: 'text' as const }];
    expect(nextReviewStep(q, [])).toBe('questionnaire');
    expect(nextReviewStep(q, [{ field: 'f', description_says: 'a', graph_says: 'b' } as never])).toBe('questionnaire');
  });

  it('TC-R16-F-56: no questions, a contradiction present -> contradiction_review', async () => {
    const { nextReviewStep } = await import('./intake-state');
    expect(nextReviewStep([], [{ field: 'f', description_says: 'a', graph_says: 'b' } as never])).toBe(
      'contradiction_review',
    );
  });

  it('TC-R16-F-57: neither present -> confirmation', async () => {
    const { nextReviewStep } = await import('./intake-state');
    expect(nextReviewStep([], [])).toBe('confirmation');
  });
});

// R16-W W-3/W-4 (§1, D-69/D-70). FORM_SUBMITTED is how the form hands its
// graph on: to the questions, the contradiction review or the confirmation.
describe('intakeReducer — FORM_SUBMITTED (R16-W W-3, D-69)', () => {
  const formState = (overrides: Partial<Extract<IntakeState, { step: 'graph_extraction' }>> = {}): IntakeState => ({
    step: 'graph_extraction',
    description: 'd',
    method: 'form',
    ...overrides,
  });
  // R18-A: the action carries the form's answer state; the reducer derives the
  // PlainAnswers cache from it and the description (Question 2).
  const answerState = { '1': { value: 'Test tool', source: { kind: 'typed' as const } } };
  const plainAnswers = { '1': 'Test tool', '2': 'd' };
  const assumptions = [{ questionId: '9' as const, question: 'Q?', shortLabel: 'Q?', assumption: 'a', fields: ['output_reversibility'] }];

  it('TC-R16-W-18: is refused from any step other than graph_extraction (the form)', () => {
    const entry: IntakeState = { step: 'description_entry', description: 'd' };
    const next = intakeReducer(entry, {
      type: 'FORM_SUBMITTED',
      graph: graph(),
      useCaseId: 'uc-1',
      description: 'd',
      answerState,
      assumptions,
      questions: [],
      contradictions: [],
      corrections: [],
    });
    expect(next).toBe(entry);
  });

  it('TC-R16-W-19: with questions present, goes to the questionnaire', () => {
    const g = graph({ intake_method: 'structured_form' });
    const questions = [
      { id: 'Q1', field: 'autonomy_level', triggered_by: ['INV-1'], answer_type: 'text' as const },
    ];
    const next = intakeReducer(formState(), {
      type: 'FORM_SUBMITTED',
      graph: g,
      useCaseId: 'uc-1',
      description: 'd',
      answerState,
      assumptions,
      questions,
      contradictions: [{ statement1: 'a', statement2: 'b', field: 'data_class' }],
      corrections: [],
    });
    expect(next).toEqual({
      step: 'questionnaire',
      description: 'd',
      graph: g,
      useCaseId: 'uc-1',
      plainAnswers,
      answerState,
      assumptions,
      questions,
      answers: [],
      resolutionNotes: [],
      corrections: [],
      // (B-10 rewritten, FX-2 review I-3: no carried submission-time contradiction.)
    });
  });

  it('TC-R16-W-20: with no questions but a contradiction, goes straight to contradiction_review (never through questionnaire)', () => {
    const g = graph({ intake_method: 'structured_form' });
    const contradictions = [{ statement1: 'a', statement2: 'b', field: 'data_class' }];
    const next = intakeReducer(formState(), {
      type: 'FORM_SUBMITTED',
      graph: g,
      useCaseId: 'uc-1',
      description: 'd',
      answerState,
      assumptions,
      questions: [],
      contradictions,
      corrections: [],
    });
    expect(next).toEqual({
      step: 'contradiction_review',
      description: 'd',
      graph: g,
      useCaseId: 'uc-1',
      plainAnswers,
      answerState,
      assumptions,
      questions: [],
      answers: [],
      contradictions,
      resolutionNotes: [],
      corrections: [],
    });
  });

  it('TC-R16-W-21: with neither questions nor contradictions, goes straight to confirmation', () => {
    const g = graph({ intake_method: 'structured_form', version: 3 });
    const next = intakeReducer(formState(), {
      type: 'FORM_SUBMITTED',
      graph: g,
      useCaseId: 'uc-1',
      description: 'd',
      answerState,
      assumptions,
      questions: [],
      contradictions: [],
      corrections: [],
    });
    expect(next).toEqual({
      step: 'confirmation',
      description: 'd',
      graph: g,
      graphVersion: 3,
      useCaseId: 'uc-1',
      plainAnswers,
      answerState,
      assumptions,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      afterFailedEvaluation: false, // CR8-03: deliberate expectation change — every confirmation carries the flag
    });
  });
});

describe('intakeReducer — plainAnswers/assumptions carry through the form path (R16-W W-4, D-70)', () => {
  const g = graph({ intake_method: 'structured_form' });
  const plainAnswers = { '1': 'Test tool' };
  const assumptions = [{ questionId: '9' as const, question: 'Q?', shortLabel: 'Q?', assumption: 'a', fields: ['output_reversibility'] }];
  const questionnaireState = (): IntakeState => ({
    step: 'questionnaire',
    description: 'd',
    graph: g,
    questions: [],
    answers: [],
    resolutionNotes: [],
    corrections: [],
    useCaseId: 'uc-1',
    plainAnswers,
    assumptions,
  });

  it('TC-R16-W-22: STEP_BACK from the questionnaire returns to the form, filled in', () => {
    const next = intakeReducer(questionnaireState(), { type: 'STEP_BACK' });
    expect(next).toEqual({
      step: 'graph_extraction',
      description: 'd',
      method: 'form',
      useCaseId: 'uc-1',
      plainAnswers,
      assumptions,
    });
  });

  // R16-D2 §5 (judgment call beyond the contract's explicit v2.1 list:
  // CHANGE_ANSWER/EVALUATION_FAILED are named there, but STEP_BACK from
  // questionnaire is the SAME "orphaned correction" hazard reached by a
  // different control — fixed for the identical reason).
  it('TC-R16-D2-53: STEP_BACK from questionnaire during a CORRECTION carries originalVerdictId and originalGraph back to the form too', () => {
    const original = graph({ intake_method: 'structured_form', version: 1 });
    const correctionState: IntakeState = {
      step: 'questionnaire',
      description: 'd',
      graph: g,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      plainAnswers,
      assumptions,
      originalVerdictId: 'v-being-corrected',
      originalGraph: original,
    };
    const next = intakeReducer(correctionState, { type: 'STEP_BACK' });
    expect(next).toMatchObject({
      step: 'graph_extraction',
      method: 'form',
      originalVerdictId: 'v-being-corrected',
      originalGraph: original,
    });
  });

  it('TC-R16-W-24: CONTRADICTIONS_DETECTED carries plainAnswers/assumptions into contradiction_review', () => {
    const next = intakeReducer(questionnaireState(), {
      type: 'CONTRADICTIONS_DETECTED',
      contradictions: [{ statement1: 'a', statement2: 'b', field: 'data_class' }],
    });
    expect('plainAnswers' in next && next.plainAnswers).toEqual(plainAnswers);
    expect('assumptions' in next && next.assumptions).toEqual(assumptions);
  });

  it('TC-R16-W-25: CONTRADICTION_RESOLVED carries plainAnswers/assumptions back into questionnaire', () => {
    const contradictionState: IntakeState = {
      step: 'contradiction_review',
      description: 'd',
      graph: g,
      questions: [],
      answers: [],
      contradictions: [{ statement1: 'a', statement2: 'b', field: 'data_class' }],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      plainAnswers,
      assumptions,
    };
    const next = intakeReducer(contradictionState, { type: 'CONTRADICTION_RESOLVED', explanation: 'resolved' });
    expect('plainAnswers' in next && next.plainAnswers).toEqual(plainAnswers);
    expect('assumptions' in next && next.assumptions).toEqual(assumptions);
  });

  it('TC-R16-W-26: PROCEED_TO_CONFIRMATION carries plainAnswers/assumptions into confirmation', () => {
    const next = intakeReducer(questionnaireState(), { type: 'PROCEED_TO_CONFIRMATION' });
    expect('plainAnswers' in next && next.plainAnswers).toEqual(plainAnswers);
    expect('assumptions' in next && next.assumptions).toEqual(assumptions);
  });

  it('TC-R16-W-27: CHANGE_ANSWER from confirmation on a form-path graph carries plainAnswers/assumptions/useCaseId back to the form', () => {
    const confirmationState: IntakeState = {
      step: 'confirmation',
      afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
      description: 'd',
      graph: g,
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-1',
      plainAnswers,
      assumptions,
    };
    const next = intakeReducer(confirmationState, { type: 'CHANGE_ANSWER' });
    expect(next).toEqual({
      step: 'graph_extraction',
      description: 'd',
      method: 'form',
      useCaseId: 'uc-1',
      plainAnswers,
      assumptions,
    });
  });

  // R16-D2 §5 (v2.1's documented fix — see the handover's "Known, carried
  // forward" note for the dead end this closes).
  it('TC-R16-D2-54: CHANGE_ANSWER from confirmation during a CORRECTION carries originalVerdictId and originalGraph back to the form', () => {
    const original = graph({ intake_method: 'structured_form', version: 1 });
    const confirmationState: IntakeState = {
      step: 'confirmation',
      afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
      description: 'd',
      graph: g,
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-1',
      plainAnswers,
      assumptions,
      originalVerdictId: 'v-being-corrected',
      originalGraph: original,
    };
    const next = intakeReducer(confirmationState, { type: 'CHANGE_ANSWER' });
    expect(next).toMatchObject({
      step: 'graph_extraction',
      method: 'form',
      originalVerdictId: 'v-being-corrected',
      originalGraph: original,
    });
  });
});

// R16-D2 §5 (D-82, DR7-17). The form-path counterpart to CORRECT_VERDICT.
describe('intakeReducer — CORRECT_VERDICT_WITH_FORM (R16-D2 §5, D-82)', () => {
  it('TC-R16-D2-55: from the verdict step, enters graph_extraction(form) carrying originalVerdictId, originalGraph, and the last-confirmed plainAnswers/assumptions', () => {
    const original = graph({ intake_method: 'structured_form', version: 3 });
    const state: IntakeState = { step: 'verdict', verdictId: 'uc-1' };
    const assumption = { questionId: '9', question: 'q?', shortLabel: 'q?', assumption: 'a', fields: ['output_reversibility'] };
    const next = intakeReducer(state, {
      type: 'CORRECT_VERDICT_WITH_FORM',
      originalGraph: original,
      useCaseId: 'uc-1',
      originalVerdictId: 'v-1',
      description: 'The confirmed description.',
      answerState: { '1': { value: 'Tool', source: { kind: 'typed' } } },
      assumptions: [assumption],
    });
    expect(next).toEqual({
      step: 'graph_extraction',
      description: 'The confirmed description.',
      method: 'form',
      useCaseId: 'uc-1',
      // R18-A: the cache is derived from the answer state and the description.
      plainAnswers: { '1': 'Tool', '2': 'The confirmed description.' },
      answerState: { '1': { value: 'Tool', source: { kind: 'typed' } } },
      assumptions: [assumption],
      originalVerdictId: 'v-1',
      originalGraph: original,
    });
  });

  it('TC-R16-D2-56: is refused from any step other than verdict', () => {
    const state: IntakeState = { step: 'description_entry', description: 'd' };
    const next = intakeReducer(state, {
      type: 'CORRECT_VERDICT_WITH_FORM',
      originalGraph: graph(),
      useCaseId: 'uc-1',
      originalVerdictId: 'v-1',
      description: 'd',
      answerState: {},
      assumptions: [],
    });
    expect(next).toBe(state);
  });
});

// v0.7.1 — the questionnaire's two new reducer guarantees.
describe('intakeReducer — v0.7.1 questionnaire guards', () => {
  const base = (): Extract<IntakeState, { step: 'questionnaire' }> => ({
    step: 'questionnaire',
    description: 'd',
    graph: graph(),
    questions: [],
    answers: [],
    resolutionNotes: [],
    corrections: [],
    useCaseId: 'uc-1',
  });

  it('TC-R71-05: a duplicate questionId is refused — a double-click cannot record twice', () => {
    const answered = intakeReducer(base(), { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q1', value: 'a' } });
    const again = intakeReducer(answered, { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q1', value: 'b' } });
    expect(again).toBe(answered);
  });

  it('TC-R71-06: ANSWER_UNDONE restores the pre-answer graph and corrections, once', () => {
    const g2 = graph({ version: 2 });
    const answered = intakeReducer(base(), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q1', value: 'Zone C' },
      updatedGraph: g2,
      correction: {
        correction_id: 'c1', graph_version_before: 1, graph_version_after: 2,
        node_id: 'n1', field: 'data_zone', original_value: 'Zone A', corrected_value: 'Zone C',
        corrected_at: '2026-01-01T00:00:00.000Z', corrected_by: '1LoD',
      },
    });
    expect(answered.step === 'questionnaire' && answered.graph.version).toBe(2);
    const undone = intakeReducer(answered, { type: 'ANSWER_UNDONE' });
    expect(undone.step === 'questionnaire' && undone.graph.version).toBe(1);
    expect(undone.step === 'questionnaire' && undone.answers).toHaveLength(0);
    expect(undone.step === 'questionnaire' && undone.corrections).toHaveLength(0);
    // Once: a second undo with no snapshot changes nothing.
    expect(intakeReducer(undone, { type: 'ANSWER_UNDONE' })).toBe(undone);
  });
});

// Found verifying R16-D2: the contract's "never to an empty form" guard. A
// correction that has lost its form answers or its original graph must never
// go back to an EMPTY form in correction mode: resubmitting it would rebuild
// the case from blank answers and, with no original graph to diff against,
// record "no answers changed". Since R18-E (the card review is gone) both ways
// of opening a correction carry both, so this guards a damaged state: Change an
// answer and Back are refused, and a failed evaluation lands on a fresh form.
describe('R16-D2 §5 (v2.1): a correction without its form answers never returns to an empty form', () => {
  const formBuilt = graph({ intake_method: 'structured_form', version: 2 });

  it('TC-R16-D2-59: "Change an answer" in a correction that lost its form answers is refused - never an empty form in correction mode', () => {
    const state: IntakeState = {
      step: 'confirmation',
      afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
      description: 'A form-built tool.',
      graph: formBuilt,
      graphVersion: 2,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-1',
      originalVerdictId: 'v-being-corrected',
    };
    expect(intakeReducer(state, { type: 'CHANGE_ANSWER' })).toBe(state);
  });

  it('TC-R16-D2-60: an evaluation failure in a correction that lost its form answers lands on a fresh form, not an empty one in correction mode', () => {
    const state: IntakeState = {
      step: 'evaluation_pending',
      graph: formBuilt,
      useCaseId: 'uc-1',
      originalVerdictId: 'v-being-corrected',
      description: 'A form-built tool.',
    };
    const next = intakeReducer(state, { type: 'EVALUATION_FAILED' });
    expect(next).toEqual({ step: 'graph_extraction', description: 'A form-built tool.', method: 'form' });
    expect('originalVerdictId' in next).toBe(false);
  });

  it('TC-R16-D2-61: Back from the questions in a correction that lost its form answers is refused', () => {
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'A form-built tool.',
      graph: formBuilt,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      originalVerdictId: 'v-being-corrected',
    };
    expect(intakeReducer(state, { type: 'STEP_BACK' })).toBe(state);
  });

  it('a fresh form-built case (no correction) still returns to the form, as before', () => {
    const state: IntakeState = {
      step: 'confirmation',
      afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
      description: 'A form-built tool.',
      graph: formBuilt,
      graphVersion: 2,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-1',
      plainAnswers: { '1': 'Tool name' },
      assumptions: [],
    };
    expect(intakeReducer(state, { type: 'CHANGE_ANSWER' })).toMatchObject({ step: 'graph_extraction', method: 'form' });
  });
});

// R16-E §3 (D-102). ANSWER_SUBMITTED gains `insertQuestions` (a follow-up
// question inserted right after the one just answered — decision_type
// "other", a supplier/model not on the firm's list) and `assumption` (a
// "Not sure" answer, accumulated into state.assumptions). ANSWER_UNDONE
// reverses both, once.
describe('intakeReducer — ANSWER_SUBMITTED insertQuestions/assumption (R16-E §3, D-102)', () => {
  const base = (): Extract<IntakeState, { step: 'questionnaire' }> => ({
    step: 'questionnaire',
    description: 'd',
    graph: graph(),
    questions: [{ id: 'Q1', field: 'decision_type', triggered_by: [], answer_type: 'select' }],
    answers: [],
    resolutionNotes: [],
    corrections: [],
    useCaseId: 'uc-1',
  });

  it('TC-R16-E-21: insertQuestions splices the follow-up right after the answered question', () => {
    const followUp = { id: 'Q1-other', field: 'decision_type_other', triggered_by: [], answer_type: 'text' as const };
    const next = intakeReducer(base(), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q1', value: 'other' },
      insertQuestions: [followUp],
    });
    expect(next.step).toBe('questionnaire');
    if (next.step !== 'questionnaire') return;
    expect(next.questions.map((q) => q.id)).toEqual(['Q1', 'Q1-other']);
  });

  it('TC-R16-E-22: a "Not sure" assumption is accumulated into state.assumptions, created on first use', () => {
    const assumption = {
      questionId: 'field:output_reversibility',
      question: 'Can the mistake be caught?',
      shortLabel: 'whether a mistake can be put right',
      assumption: 'it can’t be undone — the strictest case',
      fields: ['output_reversibility'],
    };
    const next = intakeReducer(base(), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q1', value: 'irreversible' },
      assumption,
    });
    expect(next.step).toBe('questionnaire');
    if (next.step !== 'questionnaire') return;
    expect(next.assumptions).toEqual([assumption]);
  });

  it('TC-R16-E-23: a second "Not sure" answer appends to the existing assumptions list', () => {
    const first = intakeReducer(base(), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q1', value: 'irreversible' },
      assumption: { questionId: 'field:a', question: 'q', shortLabel: 's', assumption: 'x', fields: ['a'] },
    });
    if (first.step !== 'questionnaire') throw new Error('unreachable');
    const withSecondQuestion = {
      ...first,
      questions: [...first.questions, { id: 'Q2', field: 'b', triggered_by: [], answer_type: 'boolean' as const }],
    };
    const next = intakeReducer(
      withSecondQuestion,
      {
        type: 'ANSWER_SUBMITTED',
        answer: { questionId: 'Q2', value: true },
        assumption: { questionId: 'field:b', question: 'q2', shortLabel: 's2', assumption: 'y', fields: ['b'] },
      },
    );
    expect(next.step).toBe('questionnaire');
    if (next.step !== 'questionnaire') return;
    expect(next.assumptions?.map((a) => a.fields[0])).toEqual(['a', 'b']);
  });

  it('TC-R16-E-24: ANSWER_UNDONE removes the inserted follow-up and the recorded assumption together', () => {
    const followUp = { id: 'Q1-other', field: 'decision_type_other', triggered_by: [], answer_type: 'text' as const };
    const answered = intakeReducer(base(), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q1', value: 'other' },
      insertQuestions: [followUp],
      assumption: { questionId: 'field:decision_type', question: 'q', shortLabel: 's', assumption: 'x', fields: ['decision_type'] },
    });
    const undone = intakeReducer(answered, { type: 'ANSWER_UNDONE' });
    expect(undone.step).toBe('questionnaire');
    if (undone.step !== 'questionnaire') return;
    expect(undone.questions.map((q) => q.id)).toEqual(['Q1']);
    expect(undone.assumptions ?? []).toEqual([]);
  });

  it('TC-R16-E-25: no insertQuestions/assumption leaves the reducer\'s existing, unchanged behaviour exactly as before', () => {
    const next = intakeReducer(base(), { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q1', value: 'operational' } });
    expect(next).toEqual({
      ...base(),
      answers: [{ questionId: 'Q1', value: 'operational' }],
      undo: { graph: graph(), correctionsLen: 0, questions: base().questions, assumptions: [] },
    });
  });
});

// CR6-02's "Start over" fix relies on handleStartOver (IntakeFlow.tsx)
// resetting state that lives outside the reducer entirely (the in-flight
// refs, the duplicate-check trio, the attempt token) — nothing here for the
// reducer itself to pin; covered by IntakeFlow.cr6-fx2.test.tsx instead.

// CR6-04 (Critical, BC-002). ANSWER_UNDONE read undo.questions and
// undo.assumptionsLen unconditionally; a snapshot from before 9348882 (shape
// then: { graph, correctionsLen }) has neither, and QuestionnaireStep indexes
// questions[answeredCount] — undefined questions crashes it. Defensive
// fallbacks here are the second of two layers (the first drops the whole
// snapshot on an incompatible draft version, intake-draft.test.ts); this one
// guards ANY malformed undo that still reaches the reducer.
describe('intakeReducer — ANSWER_UNDONE defensive fallbacks for an undo snapshot missing newer fields (CR6-04, BC-002)', () => {
  it('TC-CR6-04a: a pre-9348882-shaped undo ({ graph, correctionsLen } only) does not crash — falls back to the current questions/assumptions rather than undefined', () => {
    const g1 = graph({ version: 1 });
    const state: Extract<IntakeState, { step: 'questionnaire' }> = {
      step: 'questionnaire',
      description: 'd',
      graph: graph({ version: 2 }),
      questions: [{ id: 'Q1', field: 'f', triggered_by: [], answer_type: 'text' }],
      answers: [{ questionId: 'Q1', value: 'x' }],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      assumptions: [{ questionId: 'f', question: 'q', shortLabel: 's', assumption: 'a', fields: ['f'] }],
      // The old shape, exactly as it predates 9348882 — no `questions`, no
      // `assumptionsLen`, cast past the current (stricter) undo type on
      // purpose: this is what an ACTUAL old draft hands the reducer.
      undo: { graph: g1, correctionsLen: 0 } as unknown as { graph: typeof g1; correctionsLen: number; questions: typeof state.questions; assumptionsLen: number },
    };
    const undone = intakeReducer(state, { type: 'ANSWER_UNDONE' });
    expect(undone.step).toBe('questionnaire');
    if (undone.step !== 'questionnaire') return;
    // No crash, and nothing false is claimed: the current questions/
    // assumptions are kept rather than being blanked to undefined.
    expect(undone.questions).toEqual(state.questions);
    expect(undone.assumptions).toEqual(state.assumptions);
    expect(undone.graph).toBe(g1);
    expect(undone.answers).toHaveLength(0);
  });

  it('a current-shaped undo is restored exactly as before (no regression from the fallback)', () => {
    const g1 = graph({ version: 1 });
    const originalQuestions = [{ id: 'Q1', field: 'f', triggered_by: [], answer_type: 'text' as const }];
    const state: Extract<IntakeState, { step: 'questionnaire' }> = {
      step: 'questionnaire',
      description: 'd',
      graph: graph({ version: 2 }),
      questions: [...originalQuestions, { id: 'Q1-other', field: 'f2', triggered_by: [], answer_type: 'text' }],
      answers: [{ questionId: 'Q1', value: 'x' }],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      assumptions: [
        { questionId: 'f', question: 'q', shortLabel: 's', assumption: 'a', fields: ['f'] },
        { questionId: 'f2', question: 'q2', shortLabel: 's2', assumption: 'a2', fields: ['f2'] },
      ],
      undo: { graph: g1, correctionsLen: 0, questions: originalQuestions, assumptionsLen: 0 },
    };
    const undone = intakeReducer(state, { type: 'ANSWER_UNDONE' });
    expect(undone.step).toBe('questionnaire');
    if (undone.step !== 'questionnaire') return;
    expect(undone.questions).toEqual(originalQuestions);
    expect(undone.assumptions).toEqual([]);
  });
});

// C-3 (Minor). Undo is a single-level, one-use snapshot — once consumed it
// must not keep offering itself. That is a UI concern (whether IntakeFlow
// passes an onUndo handler to QuestionnaireStep at all), covered by
// IntakeFlow.cr6-fx2.test.tsx; the reducer side (a second ANSWER_UNDONE with
// no snapshot is a no-op) is already pinned above by TC-R71-06.

// B-10 (Minor), REWRITTEN by the FX-2 review (I-3). The first B-10 fix carried
// the submission-time contradictions onto the questionnaire state and
// re-raised them when the questions ended. detectContradictions reads only
// the description and the graph — never the answers — and the live check
// after each answer already catches a still-present contradiction, so the
// carried copy could only ever fire when an answer had ALREADY resolved the
// conflict, re-flagging a stale contradiction (breaking R6: "an answer that
// just fixed the contradiction must not re-flag it"). The carried field is
// gone; IntakeFlow re-runs detectContradictions on the CURRENT graph when the
// questions end instead (see IntakeFlow.cr6-fx2.test.tsx TC-CR6-B10).
// What stays pinned here: F-6 routing is unchanged and nothing stale is carried.
describe('intakeReducer — FORM_SUBMITTED with questions AND contradictions (B-10, rewritten)', () => {
  it('TC-CR6-B10: routes to the questionnaire (F-6 unchanged) and carries NO stale submission-time contradiction onto it', () => {
    const g = graph({ intake_method: 'structured_form' });
    const contradictions = [{ statement1: 'no client data', statement2: 'Client PII', field: 'data_class' }];
    const questions = [{ id: 'Q1', field: 'autonomy_level', triggered_by: ['INV-1'], answer_type: 'text' as const }];
    const state: IntakeState = { step: 'graph_extraction', description: 'd', method: 'form' };
    const next = intakeReducer(state, {
      type: 'FORM_SUBMITTED',
      graph: g,
      useCaseId: 'uc-1',
      description: 'd',
      answerState: {},
      assumptions: [],
      questions,
      contradictions,
      corrections: [],
    });
    // F-6 unchanged: questions present wins, same as TC-R16-W-19.
    expect(next.step).toBe('questionnaire');
    expect(JSON.stringify(next)).not.toContain('no client data');
    expect('submissionContradictions' in next).toBe(false);
  });
});

describe('intakeReducer — ANSWER_SUBMITTED keeps one assumption per question; Undo restores the previous list (CR7-02 (3)/(4))', () => {
  const NOT_SURE: Assumption = {
    questionId: 'field:output_reversibility',
    question: 'Can the mistake be put right?',
    shortLabel: 'whether a mistake can be put right',
    assumption: 'it can’t be undone — the strictest case.',
    fields: ['output_reversibility'],
  };
  const OTHER: Assumption = { ...NOT_SURE, questionId: 'field:scale', fields: ['scale'], assumption: 'wide' };
  const base = (assumptions?: Assumption[]): IntakeState => ({
    step: 'questionnaire',
    description: 'd',
    graph: graph(),
    questions: [
      { id: 'Q-rev', field: 'output_reversibility', node_id: 'o1', triggered_by: [], answer_type: 'select' },
      { id: 'Q-scale', field: 'scale', node_id: 'o1', triggered_by: [], answer_type: 'select' },
    ],
    answers: [],
    resolutionNotes: [],
    corrections: [],
    useCaseId: 'uc-1',
    ...(assumptions ? { assumptions } : {}),
  });

  it('TC-CR7-02e-1: "Not sure" again for a question that already has an assumption leaves exactly one', () => {
    const next = intakeReducer(base([NOT_SURE]), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q-rev', value: 'irreversible' },
      assumption: NOT_SURE,
    });
    expect(next.step === 'questionnaire' && next.assumptions).toEqual([NOT_SURE]);
  });

  it('TC-CR7-02e-2: a definite answer for a question that had an assumption removes it (and leaves the others)', () => {
    const next = intakeReducer(base([NOT_SURE, OTHER]), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q-rev', value: 'reversible' },
    });
    expect(next.step === 'questionnaire' && next.assumptions).toEqual([OTHER]);
  });

  it('TC-CR7-02f-1: Undo after a replaced assumption restores the previous array', () => {
    const answered = intakeReducer(base([NOT_SURE, OTHER]), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q-rev', value: 'reversible' },
    });
    const undone = intakeReducer(answered, { type: 'ANSWER_UNDONE' });
    expect(undone.step === 'questionnaire' && undone.assumptions).toEqual([NOT_SURE, OTHER]);
  });

  it('TC-CR7-02f-2: Undo of a first "Not sure" removes it again', () => {
    const answered = intakeReducer(base(), {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q-rev', value: 'irreversible' },
      assumption: NOT_SURE,
    });
    expect(answered.step === 'questionnaire' && answered.assumptions).toEqual([NOT_SURE]);
    const undone = intakeReducer(answered, { type: 'ANSWER_UNDONE' });
    expect(undone.step === 'questionnaire' && (undone.assumptions ?? [])).toEqual([]);
  });
});

describe('planCorrectionWrites — which corrections are already on the trail, and how many are on it for this attempt (M-3, M-4)', () => {
  const corr = (id: string, from: unknown, to: unknown): GraphCorrection => ({
    correction_id: id, graph_version_before: 1, graph_version_after: 2, node_id: 'n1', field: 'scale',
    original_value: from, corrected_value: to, corrected_by: '1LoD', corrected_at: '2026-01-01T00:00:00.000Z', correction_source: 'form',
  });
  const ev = (c: GraphCorrection) => ({ event_type: 'graph_corrected', payload: { type: 'graph_corrected', correction: c } }) as never;
  const verdict = () => ({ event_type: 'verdict_produced', payload: { type: 'verdict_produced' } }) as never;

  it('TC-CR7-21c-1: A->B (failed), B->A, then A->B again: the third is NOT treated as already there', () => {
    const events = [ev(corr('1', 'A', 'B')), ev(corr('2', 'B', 'A'))];
    const plan = planCorrectionWrites([corr('3', 'A', 'B')], events);
    expect(plan.toWrite.map((c) => c.correction_id)).toEqual(['3']);
  });

  it('TC-CR7-21c-2: the same change retried with a fresh id IS skipped when nothing reversed it', () => {
    const plan = planCorrectionWrites([corr('9', 'A', 'B')], [ev(corr('1', 'A', 'B'))]);
    expect(plan.toWrite).toEqual([]);
  });

  const graphWith = (scale: unknown): DataFlowGraph =>
    graph({ output_nodes: [{ id: 'n1', scale } as never], version: 5 });
  const ctx = (scale: unknown) => ({ resolve: graphValueResolver(graphWith(scale)), version: 5, newId: () => 'synth', now: () => '2026-02-02T00:00:00.000Z', by: '1LoD' });

  it('TC-CR7-21e-1: A->B, A->C, then A->B again: the third is written (the trail would otherwise end at C while the graph says B)', () => {
    const events = [ev(corr('1', 'A', 'B')), ev(corr('2', 'A', 'C'))];
    const plan = planCorrectionWrites([corr('3', 'A', 'B')], events, ctx('B'));
    expect(plan.toWrite.map((c) => c.correction_id)).toEqual(['3']);
  });

  it('TC-CR7-21e-2: a pending correction equal to the latest written value for its field is skipped', () => {
    const events = [ev(corr('1', 'A', 'C')), ev(corr('2', 'A', 'B'))];
    expect(planCorrectionWrites([corr('3', 'A', 'B')], events, ctx('B')).toWrite).toEqual([]);
  });

  it('TC-CR7-21f-2: A->B was written, the field is back at A and nothing is pending: one B->A correction is written, same source, and the count includes it', () => {
    const plan = planCorrectionWrites([], [ev(corr('1', 'A', 'B'))], ctx('A'));
    expect(plan.toWrite).toHaveLength(1);
    expect(plan.toWrite[0]).toMatchObject({ node_id: 'n1', field: 'scale', original_value: 'B', corrected_value: 'A', correction_source: 'form', graph_version_after: 5, corrected_at: '2026-02-02T00:00:00.000Z' });
    expect(plan.sinceLastResult).toBe(2);
  });

  it('TC-CR7-21f-3: when the trail already ends at the graph value nothing is synthesised', () => {
    expect(planCorrectionWrites([], [ev(corr('1', 'A', 'B'))], ctx('B')).toWrite).toEqual([]);
  });

  it('TC-CR7-21i-1: a node the resolver cannot find writes NOTHING for that key — never a null on the trail', () => {
    const unresolved = { resolve: () => ({ found: false as const }), version: 5, newId: () => 'synth', now: () => 'x', by: '1LoD' };
    const plan = planCorrectionWrites([], [ev(corr('1', 'A', 'B'))], unresolved);
    expect(plan.toWrite).toEqual([]);
    expect(plan.sinceLastResult).toBe(1);
  });

  it('TC-CR7-21i-2: the form path resolver maps the ORIGINAL ids by role, and the inputs sentinel to the sorted distinct data classes', () => {
    const original = graph({ intake_method: 'structured_form', processing_nodes: [{ id: 'old-p', label: 'Old' } as never], output_nodes: [{ id: 'old-o', scale: 'x' } as never] });
    const current = graph({
      intake_method: 'structured_form',
      processing_nodes: [{ id: 'new-p', label: 'Name' } as never],
      output_nodes: [{ id: 'new-o', scale: 'wide' } as never],
      input_nodes: [{ id: 'i1', data_class: 'PII' } as never, { id: 'i2', data_class: 'Internal' } as never, { id: 'i3', data_class: 'PII' } as never],
      jurisdictions: ['UK'],
    });
    const r = graphValueResolver(current, original);
    expect(r('old-p', 'label')).toEqual({ found: true, value: 'Name' });
    expect(r('old-o', 'scale')).toEqual({ found: true, value: 'wide' });
    expect(r('inputs', 'data_classes')).toEqual({ found: true, value: ['Internal', 'PII'] });
    expect(r('graph', 'jurisdictions')).toEqual({ found: true, value: ['UK'] });
    expect(r('some-other-id', 'label')).toEqual({ found: false });
  });

  it('TC-CR7-21i-3 (M-1): the resolver returns list values sorted, so a synthesised correction is stored the way formCorrections stores them', () => {
    const r = graphValueResolver(graph({ jurisdictions: ['UK', 'EU'] }));
    expect(r('graph', 'jurisdictions')).toEqual({ found: true, value: ['EU', 'UK'] });
  });

  it('TC-CR7-21g (M-B): list values compare as sets — a different order is the same correction', () => {
    const events = [ev(corr('1', [], ['UK', 'EU']))];
    expect(planCorrectionWrites([corr('2', [], ['EU', 'UK'])], events).toWrite).toEqual([]);
  });

  it('TC-CR7-21d-2: sinceLastResult counts the events in the window plus the ones about to be written, and ignores those before the last result', () => {
    const events = [ev(corr('0', 'X', 'Y')), verdict(), ev(corr('1', 'A', 'B'))];
    expect(planCorrectionWrites([], events).sinceLastResult).toBe(1);
    expect(planCorrectionWrites([corr('2', 'C', 'D')], events).sinceLastResult).toBe(2);
    expect(planCorrectionWrites([corr('9', 'A', 'B')], events).sinceLastResult).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// FX8-1 — CR8-03 (P3): once a case has a confirmed attestation, no navigation
// can start a new case id for it. R18-E: the one route is the form, whose retry
// carries the case id and refuses Back on its own (the card-review guard this
// used to test went with the card review).
// ---------------------------------------------------------------------------
describe('intakeReducer — the Back guard survives the confirmation (CR8-03, P3)', () => {
  const confirmationFirstTime = (): IntakeState => ({
    step: 'confirmation',
    description: 'd',
    graph: graph({ intake_method: 'structured_form' }),
    graphVersion: 1,
    corrections: [],
    answers: [],
    resolutionNotes: [],
    useCaseId: 'uc-1',
    afterFailedEvaluation: false,
  });
  const failedForm = (): IntakeState =>
    intakeReducer(intakeReducer(confirmationFirstTime(), { type: 'CONFIRMED' }), { type: 'EVALUATION_FAILED' });

  it('TC-CR8-03a (reducer): CONFIRMED -> EVALUATION_FAILED -> the form keeps the case id and refuses Back -> FORM_SUBMITTED -> CHANGE_ANSWER -> the form again, Back still refused', () => {
    let s = failedForm();
    expect(s).toMatchObject({ step: 'graph_extraction', method: 'form', useCaseId: 'uc-1' });
    expect(intakeReducer(s, { type: 'STEP_BACK' })).toBe(s);
    s = intakeReducer(s, {
      type: 'FORM_SUBMITTED',
      graph: graph({ intake_method: 'structured_form' }),
      useCaseId: 'uc-NEW', // a form that already carries a case id keeps it
      description: 'd',
      answerState: {},
      assumptions: [],
      questions: [],
      contradictions: [],
      corrections: [],
    });
    expect(s).toMatchObject({ step: 'confirmation', useCaseId: 'uc-1' });
    s = intakeReducer(s, { type: 'CHANGE_ANSWER' });
    expect(s).toMatchObject({ step: 'graph_extraction', useCaseId: 'uc-1' });
    expect(intakeReducer(s, { type: 'STEP_BACK' })).toBe(s);
  });

  it('TC-CR8-03d (reducer, P3 over the whole step x action table): from a state after a confirmed attestation — with and without form answers carried — no sequence of actions (RESTART excluded: Start over is a deliberate exit) reaches duplicate_check or carries a different useCaseId', () => {
    const Qs = [{ id: 'Q1', field: 'scale', node_id: 'n1', triggered_by: [], answer_type: 'text' as const }];
    const formStart = (): IntakeState => ({
      step: 'confirmation',
      description: 'd',
      graph: graph({ intake_method: 'structured_form' }),
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-1',
      plainAnswers: { '1': 'Test tool' },
      assumptions: [],
      afterFailedEvaluation: false,
    });
    // `NEW` stands for a brand-new case id a caller could hand to an action that
    // mints a case. The reducer must never let it replace the attested one.
    const NEW = 'uc-NEW';
    const explore = (g: DataFlowGraph, start: IntakeState) => {
      const actions: Array<Parameters<typeof intakeReducer>[1]> = [
        { type: 'STEP_BACK' },
        { type: 'SUBMIT_DESCRIPTION' },
        { type: 'DESCRIPTION_CHANGED', description: 'other' },
        { type: 'NO_DUPLICATE_FOUND', method: 'form' },
        {
          type: 'FORM_SUBMITTED',
          graph: graph({ intake_method: 'structured_form' }),
          useCaseId: NEW,
          description: 'd',
          answerState: { '1': { value: 'Test tool', source: { kind: 'typed' } } },
          assumptions: [],
          questions: [],
          contradictions: [],
          corrections: [],
        },
        {
          type: 'FORM_SUBMITTED',
          graph: graph({ intake_method: 'structured_form' }),
          useCaseId: NEW,
          description: 'd',
          answerState: { '1': { value: 'Test tool', source: { kind: 'typed' } } },
          assumptions: [],
          questions: Qs,
          contradictions: [],
          corrections: [],
        },
        { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q1', value: 'x' } },
        { type: 'ANSWER_UNDONE' },
        { type: 'CONTRADICTIONS_DETECTED', contradictions: [{ statement1: 'a', statement2: 'b', field: 'scale' } as never] },
        { type: 'CONTRADICTION_RESOLVED', explanation: 'because' },
        { type: 'PROCEED_TO_CONFIRMATION' },
        { type: 'CHANGE_ANSWER' },
        { type: 'CONFIRMED' },
        { type: 'EVALUATION_FAILED' },
        { type: 'VERDICT_READY' },
        // The caller of a correction passes the case being corrected (the
        // original id); these cannot mint a new one by themselves.
        {
          type: 'CORRECT_VERDICT_WITH_FORM',
          originalGraph: g,
          useCaseId: 'uc-1',
          originalVerdictId: 'v1',
          description: 'd',
          answerState: { '1': { value: 'Test tool', source: { kind: 'typed' } } },
          assumptions: [],
        },
        {
          type: 'OPEN_CORRECTION_FROM_RECORD',
          originalGraph: g,
          useCaseId: 'uc-1',
          originalVerdictId: 'v1',
          description: 'd',
          answerState: { '1': { value: 'Test tool', source: { kind: 'typed' } } },
          assumptions: [],
        },
        // R18-A: the two new actions are inert once a case is attested.
        { type: 'NUDGE_SHOWN', nudgeFor: ['countries'] },
        { type: 'DESCRIPTION_EDITED', description: 'edited after the attestation' },
      ];
      const attested = intakeReducer(start, { type: 'CONFIRMED' }); // evaluation_pending: attested
      const seen = new Set<string>([JSON.stringify(attested)]);
      let frontier: IntakeState[] = [attested];
      for (let depth = 0; depth < 7; depth++) {
        const next: IntakeState[] = [];
        for (const s of frontier) {
          for (const a of actions) {
            const n = intakeReducer(s, a);
            expect(n.step, `${s.step} + ${a.type} reached duplicate_check`).not.toBe('duplicate_check');
            const id = n.step === 'verdict' ? n.verdictId : 'useCaseId' in n ? n.useCaseId : undefined;
            if (id !== undefined) expect(id, `${s.step} + ${a.type} changed the case id`).toBe('uc-1');
            const k = JSON.stringify(n);
            if (!seen.has(k)) {
              seen.add(k);
              next.push(n);
            }
          }
        }
        frontier = next;
      }
      return seen.size;
    };
    expect(explore(graph({ intake_method: 'structured_form' }), confirmationFirstTime())).toBeGreaterThan(10);
    expect(explore(graph({ intake_method: 'structured_form' }), formStart())).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// FX8-1 — CR8-06 (P1): for every (node, field), the latest graph_corrected
// value on the trail since the last result equals the evaluated graph's value,
// after ANY sequence of edits, retries and reversals.
// ---------------------------------------------------------------------------
describe('planCorrectionWrites — P1: the trail ends at the graph value after any edits, retries and reversals (CR8-06)', () => {
  const corr = (id: string, from: unknown, to: unknown): GraphCorrection => ({
    correction_id: id, graph_version_before: 1, graph_version_after: 2, node_id: 'n1', field: 'scale',
    original_value: from, corrected_value: to, corrected_by: '1LoD', corrected_at: '2026-01-01T00:00:00.000Z', correction_source: 'form',
  });
  const ev = (c: GraphCorrection) => ({ event_type: 'graph_corrected', payload: { type: 'graph_corrected', correction: c } }) as never;

  it('TC-CR8-06a: a trail holding A->B and a batch [B->C, C->B]: BOTH are written, the net is B, and the count is 3', () => {
    const plan = planCorrectionWrites([corr('2', 'B', 'C'), corr('3', 'C', 'B')], [ev(corr('1', 'A', 'B'))]);
    expect(plan.toWrite.map((c) => c.correction_id)).toEqual(['2', '3']);
    expect(plan.sinceLastResult).toBe(3);
    expect(plan.toWrite[plan.toWrite.length - 1]!.corrected_value).toBe('B');
  });

  it('TC-CR8-06b: a plain form-path retry re-minting [A->B] over a trail whose latest is B is still skipped', () => {
    const plan = planCorrectionWrites([corr('9', 'A', 'B')], [ev(corr('1', 'A', 'B'))]);
    expect(plan.toWrite).toEqual([]);
    expect(plan.sinceLastResult).toBe(1);
  });

  it('TC-CR8-06c (property): random sequences of edits, retries and reversals on one field always leave the net trail value equal to the graph value (P1)', () => {
    const values = ['A', 'B', 'C', 'D'];
    const original = 'A';
    const op = fc.oneof(
      fc.record({ kind: fc.constant('edit' as const), value: fc.constantFrom(...values) }),
      fc.record({ kind: fc.constant('retry' as const) }),
      fc.record({ kind: fc.constant('reverse' as const) }),
    );
    fc.assert(
      fc.property(fc.array(op, { minLength: 1, maxLength: 14 }), (ops) => {
        let graphValue: string = original;
        let nextId = 0;
        const trail: GraphCorrection[] = [];
        // The form diffs the graph against the ORIGINAL: one correction when
        // the value differs, none when it is back where it started. A retry
        // re-mints that same correction with a fresh id.
        const pending = (): GraphCorrection[] => (graphValue === original ? [] : [corr(`p${nextId++}`, original, graphValue)]);
        const run = () => {
          const ctx = {
            resolve: () => ({ found: true as const, value: graphValue }),
            version: 5,
            newId: () => `s${nextId++}`,
            now: () => '2026-02-02T00:00:00.000Z',
            by: '1LoD',
          };
          const plan = planCorrectionWrites(pending(), trail.map(ev), ctx);
          trail.push(...plan.toWrite);
          const net = trail.length > 0 ? (trail[trail.length - 1]!.corrected_value as string) : original;
          expect(net).toBe(graphValue);
          expect(plan.sinceLastResult).toBe(trail.length);
        };
        for (const o of ops) {
          if (o.kind === 'edit') graphValue = o.value;
          else if (o.kind === 'reverse') graphValue = original;
          run(); // every kind submits; a 'retry' changes nothing before it
        }
      }),
      { seed: 20261004, numRuns: 300 },
    );
  });
});

