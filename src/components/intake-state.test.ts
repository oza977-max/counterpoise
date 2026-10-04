import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
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

  it('duplicate_check → graph_extraction on NO_DUPLICATE_FOUND, carrying the chosen method', () => {
    const state: IntakeState = { step: 'duplicate_check', description: 'x' };
    const next = intakeReducer(state, { type: 'NO_DUPLICATE_FOUND', method: 'llm' });
    expect(next).toEqual({ step: 'graph_extraction', description: 'x', method: 'llm' });
  });

  it('duplicate_check → graph_extraction with method: form when no API key is configured', () => {
    const state: IntakeState = { step: 'duplicate_check', description: 'x' };
    const next = intakeReducer(state, { type: 'NO_DUPLICATE_FOUND', method: 'form' });
    expect(next).toEqual({ step: 'graph_extraction', description: 'x', method: 'form' });
  });

  it('graph_extraction → graph_review on GRAPH_EXTRACTED, carrying the graph version and setting useCaseId (P5-C01: moved earlier)', () => {
    const state: IntakeState = { step: 'graph_extraction', description: 'x', method: 'llm' };
    const g = graph({ version: 1 });
    const next = intakeReducer(state, { type: 'GRAPH_EXTRACTED', graph: g, useCaseId: 'uc-1' });
    // Round 4: the description is carried forward from the source step
    // (charter 004 D-001 / charter 005 O-001) — asserted as the carry, not as
    // a literal, so a reducer that hardcoded a value would fail.
    // R5-GR-2: the LLM path arrives with every node unconfirmed (empty here
    // because the fixture graph has no nodes — the KEY's presence is what
    // marks the gated path).
    // R7-JC: the LLM path also arrives with jurisdictions unconfirmed.
    expect(next).toEqual({ step: 'graph_review', description: 'x', graph: g, graphVersion: 1, corrections: [], useCaseId: 'uc-1', unconfirmedNodeIds: [], jurisdictionsConfirmed: false });
  });

  it('graph_review → graph_review on CORRECTION_APPLIED, appending the correction and bumping graphVersion [TC-UC-7-02] [TC-UC-7-03]', () => {
    const g0 = graph({ version: 1 });
    const state: IntakeState = { step: 'graph_review', description: 'A tool that drafts client emails.', graph: g0, graphVersion: 1, corrections: [], useCaseId: 'uc-1' };
    const g1 = graph({ version: 2 });
    const correction: GraphCorrection = {
      correction_id: 'c1',
      graph_version_before: 1,
      graph_version_after: 2,
      node_id: 'n1',
      field: 'data_class',
      original_value: 'Internal',
      corrected_value: 'Confidential',
      corrected_by: '1LoD',
      corrected_at: '2026-01-01T00:00:00.000Z',
    };
    const next = intakeReducer(state, { type: 'CORRECTION_APPLIED', correction, updatedGraph: g1 });
    expect(next).toEqual({ step: 'graph_review', description: 'A tool that drafts client emails.', graph: g1, graphVersion: 2, corrections: [correction], useCaseId: 'uc-1' });
  });

  it('graph_review → questionnaire on QUESTIONS_GENERATED, carrying corrections/useCaseId forward (no longer generates useCaseId itself, P5-C01)', () => {
    const g = graph({ version: 1 });
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
      step: 'graph_review',
      description: 'A tool that drafts client emails.',
      graph: g,
      graphVersion: 1,
      corrections: [correction],
      useCaseId: 'uc-1',
    };
    const questions = [
      { id: 'Q1', field: 'autonomy_level', triggered_by: ['INV-1'], answer_type: 'text' as const },
    ];
    const next = intakeReducer(state, { type: 'QUESTIONS_GENERATED', questions });
    expect(next).toEqual({
      step: 'questionnaire',
      description: 'A tool that drafts client emails.',
      graph: g,
      questions,
      answers: [],
      resolutionNotes: [],
      corrections: [correction],
      useCaseId: 'uc-1',
      originalVerdictId: undefined,
      // F-7 (DR7-07): captured from graph_review's own guessedFields —
      // empty here since the fixture above never sets any.
      uncertainNodeIds: [],
      // CR7-03: the pre-questionnaire values Back returns to.
      backGraph: g,
      backCorrections: [correction],
    });
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

  it('verdict → graph_review on CORRECT_VERDICT, reusing the original useCaseId and recording originalVerdictId (BC-P5C01-01)', () => {
    const g = graph({ version: 1 });
    const state: IntakeState = { step: 'verdict', verdictId: 'uc-1' };
    const next = intakeReducer(state, {
      type: 'CORRECT_VERDICT',
      graph: g,
      useCaseId: 'uc-1', // same useCaseId as the original submission — not a new one
      originalVerdictId: 'verdict-abc',
    });
    expect(next).toEqual({
      step: 'graph_review',
      description: '',
      graph: g,
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
      originalVerdictId: 'verdict-abc',
      // CR8-08: deliberate expectation change — the countries are already
      // checked on a correction pass, so the panel renders.
      jurisdictionsConfirmed: true,
      // CR7-02 (6): a revisited screen, not a first reading.
      reentry: true,
    });
  });

  it('originalVerdictId set by CORRECT_VERDICT survives through questionnaire and confirmation (BC-P4C04-03 pattern, extended to P5-C01)', () => {
    const g = graph({ version: 1 });
    const afterCorrect = intakeReducer(
      { step: 'verdict', verdictId: 'uc-1' },
      { type: 'CORRECT_VERDICT', graph: g, useCaseId: 'uc-1', originalVerdictId: 'verdict-abc' },
    );
    const afterQuestions = intakeReducer(afterCorrect, { type: 'QUESTIONS_GENERATED', questions: [] });
    const afterConfirmation = intakeReducer(afterQuestions, { type: 'PROCEED_TO_CONFIRMATION' });
    // The chain starts at `verdict`, which carries no description, so '' is
    // carried through — the correction-pass gap recorded in
    // carriedDescription(). Asserted rather than left implicit.
    expect(afterConfirmation).toMatchObject({ step: 'confirmation', description: '', originalVerdictId: 'verdict-abc', useCaseId: 'uc-1' });
  });

  it('evaluation_pending → graph_review on EVALUATION_FAILED, not stuck forever (fix for the P5-C01-flagged uncaught-error gap)', () => {
    const g = graph({ version: 1 });
    const state: IntakeState = { step: 'evaluation_pending', graph: g, useCaseId: 'uc-1', originalVerdictId: 'verdict-abc' };
    const next = intakeReducer(state, { type: 'EVALUATION_FAILED' });
    expect(next).toEqual({
      step: 'graph_review',
      description: '',
      graph: g,
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
      originalVerdictId: 'verdict-abc',
      // CR7-02 (6): a revisited screen, not a first reading.
      reentry: true,
      // Review 004 finding 2: the jurisdictions panel must render (and stay
      // editable) after a failed evaluation — the failure most likely to
      // land here is jurisdiction/track-driven.
      jurisdictionsConfirmed: true,
      // F-2 (DR7-04): a description-path re-entry after a genuine failure —
      // STEP_BACK must not walk out of it (mirrors the correction-pass
      // rule); see the dedicated describe block below for the form-path
      // branch and the STEP_BACK refusal.
      afterFailedEvaluation: true,
    });
  });

  it('RESTART returns to a blank description entry from every step (explore-005 D-002)', () => {
    const g = graph({ version: 3 });
    const states: IntakeState[] = [
      { step: 'description_entry', description: 'x' },
      { step: 'duplicate_check', description: 'x' },
      { step: 'graph_extraction', description: 'x', method: 'form' },
      { step: 'graph_review', description: 'A tool that drafts client emails.', graph: g, graphVersion: 3, corrections: [], useCaseId: 'uc-1' },
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
    const next = intakeReducer(state, { type: 'NO_DUPLICATE_FOUND', method: 'llm' });
    expect(next).toBe(state);
  });
});

// Round 4 — charter 005 O-001. The description is now carried on the state
// rather than held in a component useState, because the draft envelope
// persists the state and did not persist the useState. A resumed questionnaire
// was running detectContradictions against an empty string, finding nothing,
// and saying so — degrading quietly instead of failing.
describe('intakeReducer — the description survives to the steps that need it (O-001)', () => {
  it('carries the description from extraction through to confirmation', () => {
    const g = graph({ version: 1 });
    const typed = 'A tool that drafts client emails from CRM notes';

    let state: IntakeState = { step: 'graph_extraction', description: typed, method: 'form' };
    state = intakeReducer(state, { type: 'GRAPH_EXTRACTED', graph: g, useCaseId: 'uc-1' });
    expect('description' in state && state.description).toBe(typed);

    state = intakeReducer(state, { type: 'QUESTIONS_GENERATED', questions: [] });
    // The questionnaire is the step that reads it — this is the one that was
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

  it('graph_review → duplicate_check, keeping what was typed', () => {
    const state: IntakeState = {
      step: 'graph_review',
      description: typed,
      graph: graph(),
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
    };
    const next = intakeReducer(state, { type: 'STEP_BACK' });
    expect(next).toEqual({ step: 'duplicate_check', description: typed });
  });

  it('questionnaire → graph_review, keeping the graph, its version and its corrections', () => {
    const correction: GraphCorrection = {
      correction_id: 'c1',
      graph_version_before: 1,
      graph_version_after: 2,
      node_id: 'n1',
      field: 'data_class',
      original_value: 'Internal',
      corrected_value: 'Client PII',
      corrected_by: '1LoD',
      corrected_at: '2026-01-01T00:00:00.000Z',
    };
    const g = graph({ version: 2 });
    const state: IntakeState = {
      step: 'questionnaire',
      description: typed,
      graph: g,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [correction],
      useCaseId: 'uc-1',
      originalVerdictId: 'v-1',
    };
    const next = intakeReducer(state, { type: 'STEP_BACK' });
    expect(next).toEqual({
      step: 'graph_review',
      description: typed,
      graph: g,
      graphVersion: 2,
      corrections: [correction],
      useCaseId: 'uc-1',
      originalVerdictId: 'v-1',
    });
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
    // Stepping back must not silently turn a correction into a new submission —
    // that would orphan the verdict being corrected.
    const state: IntakeState = {
      step: 'questionnaire',
      description: typed,
      graph: graph(),
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      originalVerdictId: 'v-original',
    };
    const back = intakeReducer(state, { type: 'STEP_BACK' });
    expect('originalVerdictId' in back && back.originalVerdictId).toBe('v-original');
  });
});

// Found by hostile-walking the correction path (2026-08-15): ← Back on a
// correction pass's graph_review stepped "back" to a duplicate check for an
// EMPTY description — a step the correction never came through. Proceeding
// from there drops originalVerdictId, silently converting a correction of a
// recorded verdict into a fresh draft with a blank description. A correction
// is an audited path (VD-3); its only exits are completing it or RESTART.
describe('intakeReducer — a correction pass cannot step backwards out of itself', () => {
  it('STEP_BACK is a no-op on graph_review when correcting a verdict', () => {
    const state: IntakeState = {
      step: 'graph_review',
      description: '',
      graph: graph(),
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
      originalVerdictId: 'v-original',
    };
    expect(intakeReducer(state, { type: 'STEP_BACK' })).toBe(state);
  });

  it('a fresh submission still steps back from graph_review as before', () => {
    const state: IntakeState = {
      step: 'graph_review',
      description: 'a described thing',
      graph: graph(),
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
    };
    expect(intakeReducer(state, { type: 'STEP_BACK' })).toEqual({
      step: 'duplicate_check',
      description: 'a described thing',
    });
  });
});

// R16-F F-2 (DR7-04). A re-entry into graph_review after a genuine
// evaluation failure cannot be walked out of, for the identical reason a
// correction pass cannot (above): the case already has a graph_confirmed
// attestation on the trail, and "Back" must not route the next Continue
// into minting a second, orphaned case.
describe('intakeReducer — a re-entry after a failed evaluation cannot step backwards out of itself (F-2, DR7-04)', () => {
  it('TC-R16-F-52: STEP_BACK is a no-op on graph_review when afterFailedEvaluation is set', () => {
    const state: IntakeState = {
      step: 'graph_review',
      description: 'a described thing',
      graph: graph(),
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
      afterFailedEvaluation: true,
    };
    expect(intakeReducer(state, { type: 'STEP_BACK' })).toBe(state);
  });

  it('a fresh submission (afterFailedEvaluation absent) still steps back from graph_review as before', () => {
    const state: IntakeState = {
      step: 'graph_review',
      description: 'a described thing',
      graph: graph(),
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
    };
    expect(intakeReducer(state, { type: 'STEP_BACK' })).toEqual({
      step: 'duplicate_check',
      description: 'a described thing',
    });
  });
});

describe('intakeReducer — EVALUATION_FAILED routes by intake_method (F-2, DR7-04)', () => {
  it('TC-R16-F-53: a form-path graph (intake_method structured_form) returns to graph_extraction, filled in, with the case id reused', () => {
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

  it('TC-R16-F-54: a description-path graph (intake_method llm) still returns to graph_review, now with afterFailedEvaluation: true', () => {
    const g = graph({ intake_method: 'llm', version: 2 });
    const state: IntakeState = {
      step: 'evaluation_pending',
      graph: g,
      useCaseId: 'uc-1',
      originalVerdictId: 'v-abc',
      description: 'A described tool.',
    };
    expect(intakeReducer(state, { type: 'EVALUATION_FAILED' })).toEqual({
      step: 'graph_review',
      description: 'A described tool.',
      graph: g,
      graphVersion: 2,
      corrections: [],
      useCaseId: 'uc-1',
      originalVerdictId: 'v-abc',
      jurisdictionsConfirmed: true,
      afterFailedEvaluation: true,
      reentry: true, // CR7-02 (6)
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

// R16-F F-6 (DR7-13). nextReviewStep is the ONE routing rule, used by the
// FORM_SUBMITTED case below AND by IntakeFlow.tsx's
// handleProceedFromGraphReview — tested directly here so the priority is
// pinned once, not re-derived from FORM_SUBMITTED's own behaviour alone.
// R16-F F-7 (DR7-07). uncertainNodeIds is captured ONCE, at
// QUESTIONS_GENERATED, from graph_review's own guessedFields, then
// threaded forward unchanged through every later transition — never
// re-derived (graph_review's guessedFields field does not exist past that
// step). A non-empty value proves the thread actually carries the real
// ids, not just the empty-array default case the QUESTIONS_GENERATED test
// above already covers.
describe('intakeReducer — uncertainNodeIds threads forward unchanged from QUESTIONS_GENERATED to confirmation (F-7, DR7-07)', () => {
  it('TC-R16-F-58: survives QUESTIONS_GENERATED -> CONTRADICTIONS_DETECTED -> CONTRADICTION_RESOLVED -> PROCEED_TO_CONFIRMATION', () => {
    const g = graph();
    const reviewState: IntakeState = {
      step: 'graph_review',
      description: 'x',
      graph: g,
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
      guessedFields: { n1: ['vendor'], n2: ['label'] },
    };
    const questionnaire = intakeReducer(reviewState, {
      type: 'QUESTIONS_GENERATED',
      questions: [{ id: 'Q1', field: 'vendor', triggered_by: [], answer_type: 'text' }],
    });
    expect(questionnaire).toMatchObject({ step: 'questionnaire', uncertainNodeIds: ['n1', 'n2'] });
    if (questionnaire.step !== 'questionnaire') throw new Error('unreachable');

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

// R16-W W-3/W-4 (§1, D-69/D-70). FORM_SUBMITTED replaces GRAPH_EXTRACTED on
// the form path only — graph_review (the field-card screen) is engine
// vocabulary the form path has no business showing, since the person typed
// every value themselves.
describe('intakeReducer — FORM_SUBMITTED (R16-W W-3, D-69)', () => {
  const formState = (overrides: Partial<Extract<IntakeState, { step: 'graph_extraction' }>> = {}): IntakeState => ({
    step: 'graph_extraction',
    description: 'd',
    method: 'form',
    ...overrides,
  });
  const plainAnswers = { '1': 'Test tool' };
  const assumptions = [{ questionId: '9' as const, question: 'Q?', shortLabel: 'Q?', assumption: 'a', fields: ['output_reversibility'] }];

  it('TC-R16-W-18: is refused from any step other than graph_extraction(form)', () => {
    const llmState: IntakeState = { step: 'graph_extraction', description: 'd', method: 'llm' };
    const next = intakeReducer(llmState, {
      type: 'FORM_SUBMITTED',
      graph: graph(),
      useCaseId: 'uc-1',
      description: 'd',
      plainAnswers,
      assumptions,
      questions: [],
      contradictions: [],
      corrections: [],
    });
    expect(next).toBe(llmState);
  });

  it('TC-R16-W-19: with questions present, goes to questionnaire — never graph_review', () => {
    const g = graph({ intake_method: 'structured_form' });
    const questions = [
      { id: 'Q1', field: 'autonomy_level', triggered_by: ['INV-1'], answer_type: 'text' as const },
    ];
    const next = intakeReducer(formState(), {
      type: 'FORM_SUBMITTED',
      graph: g,
      useCaseId: 'uc-1',
      description: 'd',
      plainAnswers,
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
      plainAnswers,
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
      plainAnswers,
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

  it('TC-R16-W-22: STEP_BACK from questionnaire on a form-path graph returns to the form, filled in — not graph_review', () => {
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

  it('TC-R16-W-23: STEP_BACK from questionnaire on a description-path graph still returns to graph_review (unaffected)', () => {
    const llmGraph = graph({ intake_method: 'llm' });
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'd',
      graph: llmGraph,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
    };
    const next = intakeReducer(state, { type: 'STEP_BACK' });
    expect(next.step).toBe('graph_review');
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
      plainAnswers: { '1': 'Tool' },
      assumptions: [assumption],
    });
    expect(next).toEqual({
      step: 'graph_extraction',
      description: 'The confirmed description.',
      method: 'form',
      useCaseId: 'uc-1',
      plainAnswers: { '1': 'Tool' },
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
      plainAnswers: {},
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

// Found verifying R16-D2: the contract's "never to an empty form" guard was
// not built. A correction that came through the REVIEW screen (CORRECT_VERDICT
// — no form answers, no original graph) of a form-built case used to go back
// to an EMPTY form; resubmitting it would rebuild the case from blank answers
// and, with no original graph to diff against, record "no answers changed".
describe('R16-D2 §5 (v2.1): a correction without its form answers never returns to an empty form', () => {
  const formBuilt = graph({ intake_method: 'structured_form', version: 2 });

  it('TC-R16-D2-59: "Change an answer" in a review-screen correction of a form-built case returns to the review screen, keeping the correction', () => {
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
    expect(intakeReducer(state, { type: 'CHANGE_ANSWER' })).toMatchObject({
      step: 'graph_review',
      originalVerdictId: 'v-being-corrected',
      useCaseId: 'uc-1',
    });
  });

  it('TC-R16-D2-60: an evaluation failure in a review-screen correction of a form-built case returns to the review screen, keeping the correction', () => {
    const state: IntakeState = {
      step: 'evaluation_pending',
      graph: formBuilt,
      useCaseId: 'uc-1',
      originalVerdictId: 'v-being-corrected',
      description: 'A form-built tool.',
    };
    expect(intakeReducer(state, { type: 'EVALUATION_FAILED' })).toMatchObject({
      step: 'graph_review',
      originalVerdictId: 'v-being-corrected',
      afterFailedEvaluation: true,
    });
  });

  it('TC-R16-D2-61: Back from the questions in a review-screen correction of a form-built case returns to the review screen, keeping the correction', () => {
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
    expect(intakeReducer(state, { type: 'STEP_BACK' })).toMatchObject({
      step: 'graph_review',
      originalVerdictId: 'v-being-corrected',
    });
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

// CR6-03 (Critical). Back from the questionnaire used to rebuild graph_review
// with guessedFields/provenance/unconfirmedNodeIds/jurisdictionsConfirmed all
// dropped (undefined) — turning off the R5-GR-2/R7-JC gate on return and
// losing track of which guessed fields still needed asking. Fixed by
// carrying all four from graph_review onto questionnaire at
// QUESTIONS_GENERATED (never re-derived — graph_review's own copies are
// gone past that step, same discipline as F-7's uncertainNodeIds), and
// restoring them on STEP_BACK. Because QUESTIONS_GENERATED's own guard
// never lets a non-empty unconfirmedNodeIds or a false jurisdictionsConfirmed
// through, what's carried is always either undefined (no gate — form path,
// corrections, evaluation-failure re-entries) or the concrete "everything
// already checked" values ([] / true) — never the gate itself reappearing.
describe('intakeReducer — guessedFields/provenance/gate values survive Back from the questionnaire (CR6-03)', () => {
  const reviewState = (overrides: Partial<Extract<IntakeState, { step: 'graph_review' }>> = {}): IntakeState => ({
    step: 'graph_review',
    description: 'd',
    graph: graph(),
    graphVersion: 1,
    corrections: [],
    useCaseId: 'uc-1',
    unconfirmedNodeIds: [],
    jurisdictionsConfirmed: true,
    guessedFields: { n1: ['vendor', 'platform'] },
    provenance: { n1: { data_class: 'the client file' } },
    ...overrides,
  });

  it('TC-CR6-03a: QUESTIONS_GENERATED carries guessedFields/provenance/gate values onto the questionnaire, and STEP_BACK restores them on graph_review', () => {
    const questionnaire = intakeReducer(reviewState(), {
      type: 'QUESTIONS_GENERATED',
      questions: [{ id: 'Q1', field: 'vendor', node_id: 'n1', triggered_by: ['R6-PV-2:guessed'], answer_type: 'text' }],
    });
    expect(questionnaire).toMatchObject({
      step: 'questionnaire',
      guessedFields: { n1: ['vendor', 'platform'] },
      provenance: { n1: { data_class: 'the client file' } },
      unconfirmedNodeIds: [],
      jurisdictionsConfirmed: true,
    });

    const back = intakeReducer(questionnaire, { type: 'STEP_BACK' });
    expect(back).toMatchObject({
      step: 'graph_review',
      guessedFields: { n1: ['vendor', 'platform'] },
      provenance: { n1: { data_class: 'the client file' } },
      unconfirmedNodeIds: [],
      jurisdictionsConfirmed: true,
    });
  });

  it('TC-CR6-03e: Back carries ignoredJurisdictions, and a Back + Continue round trip keeps the FIRST uncertainNodeIds even though guessedFields has since been trimmed', () => {
    const q1 = { id: 'Q1', field: 'vendor', node_id: 'n1', triggered_by: ['R6-PV-2:guessed'], answer_type: 'text' as const };
    const first = intakeReducer(reviewState({ ignoredJurisdictions: ['Internal'] }), { type: 'QUESTIONS_GENERATED', questions: [q1] });
    expect(first).toMatchObject({ uncertainNodeIds: ['n1'], ignoredJurisdictions: ['Internal'] });

    // Answer the guessed field (trims guessedFields), go Back.
    const answered = intakeReducer(first, {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q1', value: 'Acme' },
    } as never);
    const back = intakeReducer(answered, { type: 'STEP_BACK' });
    expect(back).toMatchObject({ step: 'graph_review', ignoredJurisdictions: ['Internal'], uncertainNodeIds: ['n1'] });

    // Continue again: guessedFields is now trimmed to {n1:['platform']} or {},
    // yet the frozen record must stay what the FIRST generation captured.
    const again = intakeReducer(
      { ...(back as object), guessedFields: {} } as IntakeState,
      { type: 'QUESTIONS_GENERATED', questions: [] },
    );
    expect(again).toMatchObject({ step: 'questionnaire', uncertainNodeIds: ['n1'], ignoredJurisdictions: ['Internal'] });
  });

  it('TC-CR6-03b: the review screen after Back still shows its quotes and its checked state (provenance and unconfirmedNodeIds both survive the round trip)', () => {
    // A card already corrected (so it dropped out of unconfirmedNodeIds)
    // before Continue was ever pressed — the restored graph_review must
    // keep reporting it as checked, not re-show it as needing review.
    const questionnaire = intakeReducer(
      reviewState({ unconfirmedNodeIds: [], provenance: { n1: { data_zone: 'the internal network' } } }),
      { type: 'QUESTIONS_GENERATED', questions: [] },
    );
    const back = intakeReducer(questionnaire, { type: 'STEP_BACK' });
    expect(back).toMatchObject({
      step: 'graph_review',
      unconfirmedNodeIds: [],
      provenance: { n1: { data_zone: 'the internal network' } },
    });
  });

  // CR7-03 supersedes the second half of this test. It used to pin "Back
  // restores the TRIMMED list, so Back + Continue will not ask the answered
  // field again" — exactly the defect CR7-03 closes (a rejected supplier
  // guess, or a "Not sure", then silently survived a Back). The
  // questionnaire's own list is still trimmed as the field is answered; Back
  // now restores the list as it stood when the questions were generated, so
  // the answered field IS asked again.
  it('TC-CR6-03c: a guessed field that has been answered drops out of the questionnaire\'s own guessedFields; Back restores the full asked list (CR7-03)', () => {
    const questionnaire = intakeReducer(reviewState(), {
      type: 'QUESTIONS_GENERATED',
      questions: [
        { id: 'Q1', field: 'vendor', node_id: 'n1', triggered_by: ['R6-PV-2:guessed'], answer_type: 'text' },
        { id: 'Q2', field: 'platform', node_id: 'n1', triggered_by: ['R6-PV-2:guessed'], answer_type: 'text' },
      ],
    });
    const answered = intakeReducer(questionnaire, {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q1', value: 'acme' },
      correction: {
        correction_id: 'c1',
        graph_version_before: 1,
        graph_version_after: 1,
        node_id: 'n1',
        field: 'vendor',
        original_value: undefined,
        corrected_value: 'acme',
        corrected_at: '2026-01-01T00:00:00.000Z',
        corrected_by: '1LoD',
      },
    });
    expect(answered).toMatchObject({ step: 'questionnaire', guessedFields: { n1: ['platform'] } });

    const back = intakeReducer(answered, { type: 'STEP_BACK' });
    expect(back).toMatchObject({ step: 'graph_review', guessedFields: { n1: ['vendor', 'platform'] } });
  });

  it('TC-CR6-03d: a form-path (or gate-free correction) graph_review has no unconfirmedNodeIds/jurisdictionsConfirmed, and Back from its questionnaire keeps both undefined — "no gate" is unaffected (TC-R5-GR-2-03 stays green)', () => {
    // The actual shape a correction-pass or form-built graph_review has —
    // no unconfirmedNodeIds/jurisdictionsConfirmed at all.
    const ungatedReview: IntakeState = {
      step: 'graph_review',
      description: 'd',
      graph: graph({ intake_method: 'structured_form' }),
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
      originalVerdictId: 'v-1',
    };
    const questionnaire = intakeReducer(ungatedReview, { type: 'QUESTIONS_GENERATED', questions: [] });
    expect(questionnaire.step).toBe('questionnaire');
    expect((questionnaire as { unconfirmedNodeIds?: string[] }).unconfirmedNodeIds).toBeUndefined();
    expect((questionnaire as { jurisdictionsConfirmed?: boolean }).jurisdictionsConfirmed).toBeUndefined();

    const back = intakeReducer(questionnaire, { type: 'STEP_BACK' });
    expect(back.step).toBe('graph_review');
    expect((back as { unconfirmedNodeIds?: string[] }).unconfirmedNodeIds).toBeUndefined();
    expect((back as { jurisdictionsConfirmed?: boolean }).jurisdictionsConfirmed).toBeUndefined();
  });

  it('F-7 unaffected by CR6-03: uncertainNodeIds still names a node even after its one guessed field is answered and leaves guessedFields entirely', () => {
    // Overridden to a single guessed field for n1 (reviewState()'s default
    // has two) — answering it is then the LAST one for that node, so
    // guessedFields drops the node entirely (not just the field), making
    // the contrast with the still-present uncertainNodeIds unambiguous.
    const questionnaire = intakeReducer(reviewState({ guessedFields: { n1: ['vendor'] } }), {
      type: 'QUESTIONS_GENERATED',
      questions: [{ id: 'Q1', field: 'vendor', node_id: 'n1', triggered_by: ['R6-PV-2:guessed'], answer_type: 'text' }],
    });
    expect(questionnaire).toMatchObject({ uncertainNodeIds: ['n1'] });
    const answered = intakeReducer(questionnaire, { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q1', value: 'acme' } });
    expect(answered).toMatchObject({ uncertainNodeIds: ['n1'] });
    // {} , not absent — the same "a node with nothing left guessed just
    // drops out of the map" shape CORRECTION_APPLIED's identical trim
    // already produces; kept consistent rather than inventing a second
    // convention for "nothing guessed any more".
    expect((answered as { guessedFields?: Record<string, string[]> }).guessedFields).toEqual({});
  });
});

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
      plainAnswers: {},
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

// ---------------------------------------------------------------------------
// FX7-1 (CR7-fixes.md) — BC-004: every way BACK into an earlier step keeps the
// safety/honesty fields (the "Not sure" assumptions, the frozen uncertain
// list), or rebuilds the step fail-safe (re-asks).
// ---------------------------------------------------------------------------
describe('intakeReducer — re-entries into graph_review keep the "Not sure" assumptions (CR7-02, BC-004)', () => {
  const A1: Assumption = {
    questionId: 'field:output_reversibility',
    question: 'Can the mistake be put right?',
    shortLabel: 'whether a mistake can be put right',
    assumption: 'it can’t be undone — the strictest case.',
    fields: ['output_reversibility'],
  };
  const confirmation = (overrides: Partial<Extract<IntakeState, { step: 'confirmation' }>> = {}): IntakeState => ({
    step: 'confirmation',
    afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
    description: 'd',
    graph: graph(),
    graphVersion: 1,
    corrections: [],
    answers: [],
    resolutionNotes: [],
    useCaseId: 'uc-1',
    assumptions: [A1],
    uncertainNodeIds: ['o1'],
    ...overrides,
  });

  it('TC-CR7-02a-2 (reducer): CHANGE_ANSWER on the description path carries the assumptions and the frozen uncertain list, marks the countries as already checked, and flags the re-entry', () => {
    const next = intakeReducer(confirmation(), { type: 'CHANGE_ANSWER' });
    expect(next).toMatchObject({
      step: 'graph_review',
      assumptions: [A1],
      uncertainNodeIds: ['o1'],
      jurisdictionsConfirmed: true,
      reentry: true,
    });
  });

  it('TC-CR7-02b-2 (reducer): a failed evaluation hands the assumptions and uncertain list back to the review screen too', () => {
    const pending = intakeReducer(confirmation(), { type: 'CONFIRMED' });
    const next = intakeReducer(pending, { type: 'EVALUATION_FAILED' });
    expect(next).toMatchObject({
      step: 'graph_review',
      assumptions: [A1],
      uncertainNodeIds: ['o1'],
      jurisdictionsConfirmed: true,
      reentry: true,
      afterFailedEvaluation: true,
    });
  });

  it('TC-CR7-02d-2 (reducer): CORRECT_VERDICT carries what the last confirmation was based on', () => {
    const next = intakeReducer(
      { step: 'verdict', verdictId: 'v1' },
      {
        type: 'CORRECT_VERDICT',
        graph: graph(),
        useCaseId: 'uc-1',
        originalVerdictId: 'v1',
        assumptions: [A1],
        uncertainNodeIds: ['o1'],
      },
    );
    expect(next).toMatchObject({
      step: 'graph_review',
      originalVerdictId: 'v1',
      assumptions: [A1],
      uncertainNodeIds: ['o1'],
      reentry: true,
    });
  });

  it('QUESTIONS_GENERATED from a re-entered review keeps the assumptions on the questionnaire', () => {
    const review = intakeReducer(confirmation(), { type: 'CHANGE_ANSWER' });
    const next = intakeReducer(review, { type: 'QUESTIONS_GENERATED', questions: [] });
    expect(next).toMatchObject({ step: 'questionnaire', assumptions: [A1], uncertainNodeIds: ['o1'] });
  });

  it('TC-CR7-02-1 (2): STEP_BACK from the questionnaire carries NO assumptions — they are re-asked (CR7-03)', () => {
    const q: IntakeState = {
      step: 'questionnaire',
      description: 'd',
      graph: graph(),
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      assumptions: [A1],
    };
    const back = intakeReducer(q, { type: 'STEP_BACK' });
    expect(back.step).toBe('graph_review');
    expect('assumptions' in back ? back.assumptions : undefined).toBeUndefined();
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

describe('intakeReducer — Back from the questions restores the pre-questionnaire graph, corrections and guessed list (CR7-03, BC-004)', () => {
  const g1 = graph({ version: 1 });
  const g2 = graph({ version: 2 });
  const c0: GraphCorrection = {
    correction_id: 'c0', graph_version_before: 1, graph_version_after: 1, node_id: 'n9', field: 'scale',
    original_value: 'a', corrected_value: 'b', corrected_by: '1LoD', corrected_at: '2026-01-01T00:00:00.000Z',
  };
  const c1: GraphCorrection = { ...c0, correction_id: 'c1', graph_version_before: 1, graph_version_after: 2, node_id: 'p1', field: 'vendor' };
  const review: IntakeState = {
    step: 'graph_review',
    description: 'd',
    graph: g1,
    graphVersion: 1,
    corrections: [c0],
    useCaseId: 'uc-1',
    unconfirmedNodeIds: [],
    jurisdictionsConfirmed: true,
    guessedFields: { p1: ['vendor'] },
  };
  const Q = { id: 'Q-vendor', field: 'vendor', node_id: 'p1', triggered_by: [], answer_type: 'select' as const };

  it('TC-CR7-03-1 (reducer): QUESTIONS_GENERATED snapshots the graph, corrections and the untrimmed guessed list', () => {
    const q = intakeReducer(review, { type: 'QUESTIONS_GENERATED', questions: [Q] });
    expect(q).toMatchObject({
      step: 'questionnaire',
      backGraph: g1,
      backCorrections: [c0],
      askedGuessedFields: { p1: ['vendor'] },
    });
  });

  it('TC-CR7-03-2 (reducer): after an answer that trims the field and changes the graph, Back restores all three so the field is asked again', () => {
    let s = intakeReducer(review, { type: 'QUESTIONS_GENERATED', questions: [Q] });
    s = intakeReducer(s, {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q-vendor', value: 'dont-know' },
      correction: c1,
      updatedGraph: g2,
    });
    expect(s).toMatchObject({ graph: g2, corrections: [c0, c1] });
    expect(s.step === 'questionnaire' && s.guessedFields).toEqual({});
    const back = intakeReducer(s, { type: 'STEP_BACK' });
    expect(back).toMatchObject({ step: 'graph_review', graph: g1, corrections: [c0], guessedFields: { p1: ['vendor'] } });
  });

  it('TC-CR7-03-3 (reducer): the snapshot survives Undo, a contradiction round trip, and a second answer', () => {
    let s = intakeReducer(review, { type: 'QUESTIONS_GENERATED', questions: [Q, { ...Q, id: 'Q2', field: 'scale' }] });
    s = intakeReducer(s, { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q-vendor', value: 'dont-know' }, correction: c1, updatedGraph: g2 });
    s = intakeReducer(s, { type: 'ANSWER_UNDONE' });
    expect(s).toMatchObject({ backGraph: g1, backCorrections: [c0], askedGuessedFields: { p1: ['vendor'] } });
    s = intakeReducer(s, { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q-vendor', value: 'dont-know' }, correction: c1, updatedGraph: g2 });
    s = intakeReducer(s, { type: 'CONTRADICTIONS_DETECTED', contradictions: [{ statement1: 'a', statement2: 'b', field: 'scale' } as never] });
    expect(s).toMatchObject({ step: 'contradiction_review', backGraph: g1, backCorrections: [c0], askedGuessedFields: { p1: ['vendor'] } });
    s = intakeReducer(s, { type: 'CONTRADICTION_RESOLVED', explanation: 'explained' });
    expect(s).toMatchObject({ step: 'questionnaire', backGraph: g1, backCorrections: [c0], askedGuessedFields: { p1: ['vendor'] } });
    const back = intakeReducer(s, { type: 'STEP_BACK' });
    expect(back).toMatchObject({ step: 'graph_review', graph: g1, corrections: [c0], guessedFields: { p1: ['vendor'] } });
  });

  it('TC-CR7-03-4 (reducer): a questionnaire saved before this change (no snapshot) steps back exactly as it did before', () => {
    const old: IntakeState = {
      step: 'questionnaire',
      description: 'd',
      graph: g2,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [c0, c1],
      useCaseId: 'uc-1',
      guessedFields: {},
    };
    const back = intakeReducer(old, { type: 'STEP_BACK' });
    expect(back).toMatchObject({ step: 'graph_review', graph: g2, corrections: [c0, c1], guessedFields: {} });
  });

  it('TC-CR7-02-2 (6) (reducer): a revisited review screen stays marked as revisited across a trip into the questions and Back (including a contradiction round trip)', () => {
    const revisited: IntakeState = { ...(review as Extract<IntakeState, { step: 'graph_review' }>), reentry: true };
    let s = intakeReducer(revisited, { type: 'QUESTIONS_GENERATED', questions: [Q] });
    expect(s).toMatchObject({ step: 'questionnaire', reentry: true });
    expect(intakeReducer(s, { type: 'STEP_BACK' })).toMatchObject({ step: 'graph_review', reentry: true });
    s = intakeReducer(s, { type: 'CONTRADICTIONS_DETECTED', contradictions: [{ statement1: 'a', statement2: 'b', field: 'scale' } as never] });
    s = intakeReducer(s, { type: 'CONTRADICTION_RESOLVED', explanation: 'explained' });
    expect(intakeReducer(s, { type: 'STEP_BACK' })).toMatchObject({ step: 'graph_review', reentry: true });
  });

  it('TC-CR7-02-3 (6) (reducer): a first reading of the review screen is NOT marked as revisited, before or after a trip into the questions', () => {
    const s = intakeReducer(review, { type: 'QUESTIONS_GENERATED', questions: [Q] });
    expect('reentry' in s && s.reentry).toBeFalsy();
    const back = intakeReducer(s, { type: 'STEP_BACK' });
    expect('reentry' in back && back.reentry).toBeFalsy();
  });
});

// FX7-1 review pass 1 (I-2, I-3, M-3, M-4).
describe('intakeReducer — Back from the questions restores the assumptions and the failed-evaluation flag the review screen held (I-2, I-3)', () => {
  const A: Assumption = {
    questionId: 'field:output_reversibility',
    question: 'Can the mistake be put right?',
    shortLabel: 'whether a mistake can be put right',
    assumption: 'it can’t be undone — the strictest case.',
    fields: ['output_reversibility'],
  };
  const B: Assumption = { ...A, questionId: 'field:scale', fields: ['scale'], assumption: 'wide' };
  const Q = { id: 'Q-scale', field: 'scale', node_id: 'o1', triggered_by: [], answer_type: 'select' as const };
  const confirmation: IntakeState = {
    step: 'confirmation',
    afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
    description: 'd',
    graph: graph(),
    graphVersion: 1,
    corrections: [],
    answers: [],
    resolutionNotes: [],
    useCaseId: 'uc-1',
    assumptions: [A],
    uncertainNodeIds: ['o1'],
  };

  it('TC-CR7-02h-3 (reducer): Change an answer -> Continue (questions) -> a new "Not sure" -> Back: the earlier round\'s assumption is back, the new one is re-asked', () => {
    let s = intakeReducer(confirmation, { type: 'CHANGE_ANSWER' });
    s = intakeReducer(s, { type: 'QUESTIONS_GENERATED', questions: [Q] });
    expect(s).toMatchObject({ backAssumptions: [A] });
    s = intakeReducer(s, { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q-scale', value: 'wide' }, assumption: B });
    expect(s.step === 'questionnaire' && s.assumptions).toEqual([A, B]);
    const back = intakeReducer(s, { type: 'STEP_BACK' });
    expect(back).toMatchObject({ step: 'graph_review', assumptions: [A], uncertainNodeIds: ['o1'], reentry: true });
  });

  it('TC-CR7-02h-4 (reducer, CORRECT_VERDICT): the same round trip from a correction pass', () => {
    let s = intakeReducer(
      { step: 'verdict', verdictId: 'v1' },
      { type: 'CORRECT_VERDICT', graph: graph(), useCaseId: 'uc-1', originalVerdictId: 'v1', assumptions: [A], uncertainNodeIds: ['o1'] },
    );
    s = intakeReducer(s, { type: 'QUESTIONS_GENERATED', questions: [Q] });
    s = intakeReducer(s, { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q-scale', value: 'wide' }, assumption: B });
    s = intakeReducer(s, { type: 'CONTRADICTIONS_DETECTED', contradictions: [{ statement1: 'a', statement2: 'b', field: 'scale' } as never] });
    s = intakeReducer(s, { type: 'CONTRADICTION_RESOLVED', explanation: 'x' });
    expect(intakeReducer(s, { type: 'STEP_BACK' })).toMatchObject({ step: 'graph_review', assumptions: [A], originalVerdictId: 'v1' });
  });

  it('TC-CR7-03f-2 (reducer): a review re-entered after a failed evaluation is still "after a failed evaluation" after a trip into the questions and Back, and Back from it is refused', () => {
    let s = intakeReducer(confirmation, { type: 'CONFIRMED' });
    s = intakeReducer(s, { type: 'EVALUATION_FAILED' });
    expect(s).toMatchObject({ afterFailedEvaluation: true });
    s = intakeReducer(s, { type: 'QUESTIONS_GENERATED', questions: [Q] });
    s = intakeReducer(s, { type: 'CONTRADICTIONS_DETECTED', contradictions: [{ statement1: 'a', statement2: 'b', field: 'scale' } as never] });
    s = intakeReducer(s, { type: 'CONTRADICTION_RESOLVED', explanation: 'x' });
    const back = intakeReducer(s, { type: 'STEP_BACK' });
    expect(back).toMatchObject({ step: 'graph_review', afterFailedEvaluation: true });
    expect(intakeReducer(back, { type: 'STEP_BACK' })).toBe(back);
  });

  it('TC-CR7-03f-3 (reducer): a first reading is not marked as after a failed evaluation', () => {
    const review: IntakeState = { step: 'graph_review', description: 'd', graph: graph(), graphVersion: 1, corrections: [], useCaseId: 'uc-1' };
    const q = intakeReducer(review, { type: 'QUESTIONS_GENERATED', questions: [Q] });
    const back = intakeReducer(q, { type: 'STEP_BACK' });
    expect('afterFailedEvaluation' in back && back.afterFailedEvaluation).toBeFalsy();
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
// FX8-1 (CR8-fixes.md) — CR8-01 (P2): an assumption is listed back only while
// the graph still holds the value it assumed. BC-004 converse: every action
// that can make a carried assumption untrue must remove it whole.
// ---------------------------------------------------------------------------
describe('intakeReducer — a card edit removes the assumption it makes untrue (CR8-01, P2; whole, CR9 OB-1)', () => {
  const corrected = (node_id: string, field: string): GraphCorrection => ({
    correction_id: `c-${field}`,
    graph_version_before: 1,
    graph_version_after: 2,
    node_id,
    field,
    original_value: 'x',
    corrected_value: 'y',
    corrected_by: '1LoD',
    corrected_at: '2026-01-01T00:00:00.000Z',
  });
  const A_REV: Assumption = {
    questionId: 'field:output_reversibility',
    question: 'Can the mistake be put right?',
    shortLabel: 'whether a mistake can be put right',
    assumption: 'it can’t be undone — the strictest case.',
    fields: ['output_reversibility'],
  };
  const A_Q6: Assumption = {
    questionId: '6',
    question: 'What does it do with what it produces?',
    shortLabel: 'what it does with what it produces',
    assumption: 'it acts on its own.',
    fields: ['action_type', 'autonomy_level', 'decision_bindingness', 'hitl'],
  };
  const A_Q3: Assumption = {
    questionId: '3',
    question: 'Where does the AI come from?',
    shortLabel: 'where the AI comes from',
    assumption: 'an outside supplier, information leaves the firm.',
    fields: ['data_zone', 'vendor'],
  };
  const A_JUR: Assumption = {
    questionId: '11',
    question: 'Which countries?',
    shortLabel: 'which countries it reaches',
    assumption: 'it reaches countries beyond the ones listed.',
    fields: ['jurisdictions'],
  };
  const confirmation = (assumptions: Assumption[]): IntakeState => ({
    step: 'confirmation',
    afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
    description: 'd',
    graph: graph(),
    graphVersion: 1,
    corrections: [],
    answers: [],
    resolutionNotes: [],
    useCaseId: 'uc-1',
    assumptions,
  });
  /** review -> edit a card -> Continue -> (no questions) -> confirmation. */
  const editThenConfirm = (review: IntakeState, node: string, field: string): IntakeState => {
    let s = intakeReducer(review, { type: 'CORRECTION_APPLIED', correction: corrected(node, field), updatedGraph: graph({ version: 2 }) });
    s = intakeReducer(s, { type: 'QUESTIONS_GENERATED', questions: [] });
    return intakeReducer(s, { type: 'PROCEED_TO_CONFIRMATION' });
  };
  const listed = (s: IntakeState) => ('assumptions' in s ? s.assumptions ?? [] : []);
  const viaChangeAnswer = () => intakeReducer(confirmation([A_REV, A_Q6, A_Q3]), { type: 'CHANGE_ANSWER' });
  const viaFailedEvaluation = () =>
    intakeReducer(intakeReducer(confirmation([A_REV, A_Q6, A_Q3]), { type: 'CONFIRMED' }), { type: 'EVALUATION_FAILED' });
  const viaCorrectVerdict = () =>
    intakeReducer(
      { step: 'verdict', verdictId: 'v1' },
      { type: 'CORRECT_VERDICT', graph: graph(), useCaseId: 'uc-1', originalVerdictId: 'v1', assumptions: [A_REV, A_Q6, A_Q3] },
    );

  it('TC-CR8-01a: Change an answer -> edit the assumed field\'s card -> Confirm: that assumption is gone from what the confirmation carries (and so from graph_confirmed and the result)', () => {
    const out = editThenConfirm(viaChangeAnswer(), 'o1', 'output_reversibility');
    expect(out.step).toBe('confirmation');
    expect(listed(out).map((a) => a.questionId)).not.toContain('field:output_reversibility');
    expect(listed(out).map((a) => a.questionId)).toEqual(['6', '3']);
  });

  it('TC-CR8-01b: the same after a failed evaluation', () => {
    const out = editThenConfirm(viaFailedEvaluation(), 'o1', 'output_reversibility');
    expect(listed(out).map((a) => a.questionId)).toEqual(['6', '3']);
  });

  it('TC-CR8-01c: the same via a correction from the result (CORRECT_VERDICT)', () => {
    const out = editThenConfirm(viaCorrectVerdict(), 'o1', 'output_reversibility');
    expect(listed(out).map((a) => a.questionId)).toEqual(['6', '3']);
  });

  it('TC-CR8-01d: a countries edit KEEPS the CR7-23 "somewhere else" assumption (the panel cannot say "somewhere else", so the disclosure stays true) and leaves the others', () => {
    const review = intakeReducer(confirmation([A_JUR, A_REV]), { type: 'CHANGE_ANSWER' });
    const after = intakeReducer(review, {
      type: 'JURISDICTIONS_SET',
      correction: corrected('graph', 'jurisdictions'),
      updatedGraph: graph({ version: 2, jurisdictions: ['UK'] }),
    });
    expect(listed(after)).toEqual([A_JUR, A_REV]);
    // CR9 OB-1 (countries clause of TC-CR9-OB1): question 11 survives a countries edit even when other
    // assumptions are dropped whole around it.
    const other: Assumption = { ...A_JUR, questionId: 'x-other', fields: ['jurisdictions', 'scale'] };
    const withQ6 = intakeReducer(confirmation([A_JUR, other]), { type: 'CHANGE_ANSWER' });
    const after2 = intakeReducer(withQ6, {
      type: 'JURISDICTIONS_SET',
      correction: corrected('graph', 'jurisdictions'),
      updatedGraph: graph({ version: 2, jurisdictions: ['UK'] }),
    });
    expect(listed(after2).map((a) => a.questionId)).toEqual(['11']);
  });

  it('TC-CR8-01j: a different assumption that lists the jurisdictions field is dropped whole by a countries edit; only question 11 stays (CR9 OB-1)', () => {
    const other: Assumption = { ...A_JUR, questionId: 'x-other', fields: ['jurisdictions', 'scale'] };
    const review = intakeReducer(confirmation([other, A_JUR]), { type: 'CHANGE_ANSWER' });
    const after = intakeReducer(review, {
      type: 'JURISDICTIONS_SET',
      correction: corrected('graph', 'jurisdictions'),
      updatedGraph: graph({ version: 2, jurisdictions: ['UK'] }),
    });
    expect(listed(after).map((a) => [a.questionId, a.fields])).toEqual([['11', ['jurisdictions']]]);
  });

  it('TC-CR8-01e: an edit to a DIFFERENT field keeps the assumption, with its fields untouched', () => {
    const out = editThenConfirm(viaChangeAnswer(), 'p1', 'label');
    expect(listed(out)).toEqual([A_REV, A_Q6, A_Q3]);
  });

  // CR9 OB-1 (amended 01f / 01g / 01j): an edit to a field an assumption covers removes the WHOLE
  // assumption. Narrowing kept a sentence that still named the edited field ("we assumed autonomy ...").
  it('TC-CR8-01f: a Q6 assumption plus ONE autonomy edit drops the whole Q6 assumption (CR9 OB-1: no narrowing)', () => {
    const out = editThenConfirm(viaChangeAnswer(), 'p1', 'autonomy_level');
    expect(listed(out).map((a) => a.questionId)).toEqual(['field:output_reversibility', '3']);
  });

  it('TC-CR8-01g: a Q3 assumption plus a vendor edit drops the whole Q3 assumption (CR9 OB-1: no narrowing)', () => {
    const out = editThenConfirm(viaChangeAnswer(), 'p1', 'vendor');
    expect(listed(out).map((a) => a.questionId)).toEqual(['field:output_reversibility', '6']);
  });

  it('TC-CR9-OB1: a four-field Q6 assumption is gone after an autonomy edit; an unrelated edit leaves every assumption whole', () => {
    expect(A_Q6.fields).toHaveLength(4);
    expect(A_Q6.fields).toContain('autonomy_level');
    const edited = editThenConfirm(viaChangeAnswer(), 'p1', 'autonomy_level');
    expect(listed(edited).some((a) => a.questionId === '6')).toBe(false);
    const unrelated = editThenConfirm(viaChangeAnswer(), 'p1', 'label');
    expect(listed(unrelated)).toEqual([A_REV, A_Q6, A_Q3]);
  });

  it('TC-CR8-01h: an assumption from an older draft with no fields cannot be matched, so any card edit drops it', () => {
    const old = { questionId: 'x', question: 'q', shortLabel: 's', assumption: 'a' } as unknown as Assumption;
    const review = intakeReducer(confirmation([old, A_REV]), { type: 'CHANGE_ANSWER' });
    const out = editThenConfirm(review, 'p1', 'label');
    expect(listed(out).map((a) => a.questionId)).toEqual(['field:output_reversibility']);
  });
});

// ---------------------------------------------------------------------------
// FX8-1 — CR8-03 (P3): once a case has a confirmed attestation, no navigation
// can start a new case id for it. The guard (afterFailedEvaluation) used to be
// dropped by PROCEED_TO_CONFIRMATION and not restored by CHANGE_ANSWER.
// Test graphs are NON-form (intake_method 'llm'): a structured_form graph
// returns to the form instead (returnsToForm) and never reaches STEP_BACK.
// ---------------------------------------------------------------------------
describe('intakeReducer — the Back guard survives the confirmation (CR8-03, P3)', () => {
  const confirmationFirstTime = (): IntakeState => ({
    step: 'confirmation',
    description: 'd',
    graph: graph({ intake_method: 'llm' }),
    graphVersion: 1,
    corrections: [],
    answers: [],
    resolutionNotes: [],
    useCaseId: 'uc-1',
    afterFailedEvaluation: false,
  });
  const failedReview = (): IntakeState =>
    intakeReducer(intakeReducer(confirmationFirstTime(), { type: 'CONFIRMED' }), { type: 'EVALUATION_FAILED' });

  it('TC-CR8-03a (reducer): CONFIRMED -> EVALUATION_FAILED -> QUESTIONS_GENERATED(none) -> PROCEED_TO_CONFIRMATION -> CHANGE_ANSWER -> STEP_BACK is refused', () => {
    let s = failedReview();
    expect(s).toMatchObject({ step: 'graph_review', afterFailedEvaluation: true });
    s = intakeReducer(s, { type: 'QUESTIONS_GENERATED', questions: [] });
    s = intakeReducer(s, { type: 'PROCEED_TO_CONFIRMATION' });
    expect(s).toMatchObject({ step: 'confirmation', afterFailedEvaluation: true });
    s = intakeReducer(s, { type: 'CHANGE_ANSWER' });
    expect(s).toMatchObject({ step: 'graph_review', afterFailedEvaluation: true });
    expect(intakeReducer(s, { type: 'STEP_BACK' })).toBe(s);
  });

  it('TC-CR8-03c (reducer, converse): a first-time confirmation (no failure) -> CHANGE_ANSWER -> Back IS allowed (nothing is attested yet)', () => {
    let s = intakeReducer(confirmationFirstTime(), { type: 'CHANGE_ANSWER' });
    expect('afterFailedEvaluation' in s && s.afterFailedEvaluation).toBeFalsy();
    s = intakeReducer(s, { type: 'STEP_BACK' });
    expect(s.step).toBe('duplicate_check');
  });

  it('TC-CR8-03d (reducer, P3 over the whole step x action table): from a state after a confirmed attestation — on a description graph AND a form graph — no sequence of actions (RESTART excluded: Start over is a deliberate exit) reaches duplicate_check or carries a different useCaseId', () => {
    const corr = (id: string): GraphCorrection => ({
      correction_id: id, graph_version_before: 1, graph_version_after: 2, node_id: 'n1', field: 'scale',
      original_value: 'a', corrected_value: 'b', corrected_by: '1LoD', corrected_at: '2026-01-01T00:00:00.000Z',
    });
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
        { type: 'NO_DUPLICATE_FOUND', method: 'llm' },
        { type: 'NO_DUPLICATE_FOUND', method: 'form' },
        { type: 'SWITCH_TO_FORM' },
        { type: 'GRAPH_EXTRACTED', graph: graph({ intake_method: 'llm' }), useCaseId: NEW },
        {
          type: 'FORM_SUBMITTED',
          graph: graph({ intake_method: 'structured_form' }),
          useCaseId: NEW,
          description: 'd',
          plainAnswers: { '1': 'Test tool' },
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
          plainAnswers: { '1': 'Test tool' },
          assumptions: [],
          questions: Qs,
          contradictions: [],
          corrections: [],
        },
        { type: 'QUESTIONS_GENERATED', questions: [] },
        { type: 'QUESTIONS_GENERATED', questions: Qs },
        { type: 'ANSWER_SUBMITTED', answer: { questionId: 'Q1', value: 'x' } },
        { type: 'ANSWER_UNDONE' },
        { type: 'CONTRADICTIONS_DETECTED', contradictions: [{ statement1: 'a', statement2: 'b', field: 'scale' } as never] },
        { type: 'CONTRADICTION_RESOLVED', explanation: 'because' },
        { type: 'PROCEED_TO_CONFIRMATION' },
        { type: 'CHANGE_ANSWER' },
        { type: 'CONFIRMED' },
        { type: 'EVALUATION_FAILED' },
        { type: 'VERDICT_READY' },
        { type: 'CORRECTION_APPLIED', correction: corr('c1'), updatedGraph: g },
        { type: 'JURISDICTIONS_SET', correction: corr('c2'), updatedGraph: g },
        { type: 'NODE_CONFIRMED', nodeId: 'n1' },
        { type: 'JURISDICTIONS_CONFIRMED' },
        // The caller of a correction passes the case being corrected (the
        // original id); those two cannot mint a new one by themselves.
        { type: 'CORRECT_VERDICT', graph: g, useCaseId: 'uc-1', originalVerdictId: 'v1' },
        {
          type: 'CORRECT_VERDICT_WITH_FORM',
          originalGraph: g,
          useCaseId: 'uc-1',
          originalVerdictId: 'v1',
          description: 'd',
          plainAnswers: { '1': 'Test tool' },
          assumptions: [],
        },
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
    expect(explore(graph({ intake_method: 'llm' }), confirmationFirstTime())).toBeGreaterThan(20);
    expect(explore(graph({ intake_method: 'structured_form' }), formStart())).toBeGreaterThan(20);
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

describe('intakeReducer — correcting from the result keeps the countries panel (CR8-08)', () => {
  it('TC-CR8-08a (reducer): CORRECT_VERDICT lands on a review whose countries are already checked (so the panel renders), as CHANGE_ANSWER and a failed evaluation already do', () => {
    const next = intakeReducer(
      { step: 'verdict', verdictId: 'v1' },
      { type: 'CORRECT_VERDICT', graph: graph({ intake_method: 'llm' }), useCaseId: 'uc-1', originalVerdictId: 'v1' },
    );
    expect(next).toMatchObject({ step: 'graph_review', jurisdictionsConfirmed: true, originalVerdictId: 'v1' });
  });
});
