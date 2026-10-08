import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDraft,
  loadDraft,
  clearDraft,
  updateFormDraft,
  loadFormDraft,
  clearFormDraft,
  probeLegacyFormDraft,
  clearDraftIfCase,
  loadDraftInfo,
} from './intake-draft';
import type { IntakeState } from './intake-state';

// explore-001 D-002 (Important) and D-003 (Minor): in-flight intake was lost
// on refresh, browser Back, or in-app navigation, with no warning.
describe('intake draft persistence (D-002 / D-003)', () => {
  beforeEach(() => clearDraft());

  it('round-trips a mid-flow state so a refresh does not lose the work', () => {
    const state = {
      step: 'graph_review',
      description: 'd',
      graph: { id: 'g1', version: 1, input_nodes: [], processing_nodes: [], output_nodes: [],
               edges: [], jurisdictions: [], intake_method: 'structured_form',
               extracted_at: '2026-01-01T00:00:00.000Z' },
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-1',
    } as unknown as IntakeState;

    saveDraft(state);
    const restored = loadDraft();
    expect(restored).not.toBeNull();
    expect(restored!.step).toBe('graph_review');
    expect(JSON.stringify(restored)).toBe(JSON.stringify(state));
  });

  it('does not persist an empty description — restoring a blank form is not saved work', () => {
    saveDraft({ step: 'description_entry', description: '   ' } as IntakeState);
    expect(loadDraft()).toBeNull();
  });

  it('persists a description the user has actually typed', () => {
    saveDraft({ step: 'description_entry', description: 'a real description' } as IntakeState);
    expect(loadDraft()?.step).toBe('description_entry');
  });

  it('clearDraft removes it', () => {
    saveDraft({ step: 'description_entry', description: 'x' } as IntakeState);
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('a stale or corrupt shape never puts the reducer in an unreachable state: it opens the form with nothing carried (R18-NF-5)', () => {
    sessionStorage.setItem('aigate:intake-draft', '{"nonsense":true}');
    expect(loadDraft()).toEqual({ step: 'graph_extraction', description: '', method: 'form' });
    expect(loadDraftInfo()?.earlierVersionNotice).toBe(true);
    sessionStorage.setItem('aigate:intake-draft', 'not json at all');
    expect(loadDraft()).toEqual({ step: 'graph_extraction', description: '', method: 'form' });
  });
});

// The first pass at D-002/D-003 persisted only IntakeState, which restored
// the STEP but not the eleven guided-form answers — because those live in
// StructuredForm's local state. Found by verifying in the browser rather
// than trusting the first fix.
describe('guided-form draft (the half the first fix missed)', () => {
  beforeEach(() => clearFormDraft());

  it('round-trips the answers a user has already given', () => {
    const answerState = {
      '1': { value: 'Persistence check', source: { kind: 'typed' as const } },
      '5': { value: ['everyday', 'client-pii'], source: { kind: 'typed' as const } },
    };
    updateFormDraft({ answerState });
    expect(loadFormDraft()).toEqual({ version: 4, answerState, lastRead: { fingerprint: '', outcome: 'not-read' } });
  });

  it('is cleared on submit so the next pre-check starts clean', () => {
    updateFormDraft({ answerState: { '1': { value: 'x', source: { kind: 'typed' } } } });
    clearFormDraft();
    expect(loadFormDraft()).toBeNull();
  });

  it('survives corrupt storage without breaking intake', () => {
    sessionStorage.setItem('aigate:intake-form-draft:v4', 'not json');
    expect(loadFormDraft()).toBeNull();
  });
});

// R16-B (D-41). The plain-language form's PlainAnswers shape has nothing in
// common with the old field-by-field StructuredFormValues shape it
// replaces — a stray old-shape value (e.g. a raw DataClass string under a
// key the new form reads as an option KEY) must never be silently read back
// as though it were a real answer. The key is versioned so an old draft is
// never even attempted; it is instead probed, cleared, and reported once so
// the submitter is told plainly rather than finding a half-populated form.
describe('legacy form-draft migration (R16-B, D-41)', () => {
  const LEGACY_KEY = 'aigate:intake-form-draft';
  const NEW_KEY = 'aigate:intake-form-draft:v4';

  beforeEach(() => {
    sessionStorage.removeItem(LEGACY_KEY);
    clearFormDraft();
  });

  it('TC-R16-B-07: a draft under the old key is detected, cleared, and reported once', () => {
    sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ useCaseName: 'Old form draft' }));
    expect(probeLegacyFormDraft()).toBe(true);
    expect(sessionStorage.getItem(LEGACY_KEY)).toBeNull();
    // Calling it again finds nothing left to report — it is truly gone, not
    // merely hidden.
    expect(probeLegacyFormDraft()).toBe(false);
  });

  it('no old draft present -> reports false and touches nothing', () => {
    expect(probeLegacyFormDraft()).toBe(false);
    expect(sessionStorage.getItem(NEW_KEY)).toBeNull();
  });

  it('updateFormDraft/loadFormDraft round-trip through the NEW versioned key only', () => {
    const answerState = { '1': { value: 'Test tool', source: { kind: 'typed' as const } } };
    updateFormDraft({ answerState });
    expect(sessionStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(sessionStorage.getItem(NEW_KEY)).not.toBeNull();
    expect(loadFormDraft()?.answerState).toEqual(answerState);
  });

  it('a legacy draft is never read back as a new-shape answer object', () => {
    sessionStorage.setItem(LEGACY_KEY, JSON.stringify({ useCaseName: 'Old form draft', inputDataClass: 'Client PII' }));
    // loadFormDraft only ever reads the NEW key — the legacy key is a
    // probe-and-clear concern handled separately by probeLegacyFormDraft.
    expect(loadFormDraft()).toBeNull();
  });
});

// CR6-04 (Critical, BC-002: "persisted state carries a version and is
// migrated or refused on mismatch, never read as if current"). The MAIN
// intake draft (unlike the form draft above) was never versioned at all —
// ANSWER_UNDONE's `undo` snapshot gained `questions`/`assumptionsLen` at
// 9348882, and a draft saved by an older build has neither. Reading it back
// as current handed QuestionnaireStep an `undo.questions` of `undefined`,
// which it indexes (`questions[answeredCount]`) and crashes on.
//
// The fix wraps what's actually written in sessionStorage in a small
// {version, state} envelope. loadDraft() keeps returning a bare IntakeState
// (its public shape is unchanged — every existing bare-JSON fixture in the
// UI test suite, written before this fix existed, must keep restoring
// exactly as before); only an INCOMPATIBLE version has its one unsafe piece
// (the `undo` snapshot) dropped, never the whole draft — the rest of a
// user's in-progress work is real and is kept.
describe('intake draft versioning — an incompatible undo snapshot is dropped, not read as current (CR6-04, BC-002)', () => {
  const DRAFT_KEY = 'aigate:intake-draft';
  beforeEach(() => clearDraft());

  // R18-A: the CR6-04 case that pinned "a version-1 questionnaire draft keeps its
  // work and loses only its unsafe undo" (TC-CR6-04b) is superseded. An earlier-build
  // questionnaire draft no longer restores as a questionnaire at all: it lands on the
  // form with the description kept and no answers (TC-R18-NF-5-01, in
  // intake-draft.r18a.test.ts), so there is no unsafe undo to drop.
  it('a draft saved by the CURRENT build (with a real undo snapshot) round-trips its undo unchanged', () => {
    const state = {
      step: 'questionnaire',
      description: 'd',
      graph: { id: 'g1', version: 2, input_nodes: [], processing_nodes: [], output_nodes: [], edges: [], jurisdictions: [], intake_method: 'llm', extracted_at: '2026-01-01T00:00:00.000Z' },
      questions: [{ id: 'Q1', field: 'f', triggered_by: [], answer_type: 'text' }],
      answers: [{ questionId: 'Q1', value: 'x' }],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
      undo: { graph: { id: 'g0', version: 1, input_nodes: [], processing_nodes: [], output_nodes: [], edges: [], jurisdictions: [], intake_method: 'llm', extracted_at: '2026-01-01T00:00:00.000Z' }, correctionsLen: 0, questions: [], assumptionsLen: 0 },
    } as unknown as IntakeState;

    saveDraft(state);
    const restored = loadDraft();
    expect(restored).toEqual(state);
  });

  it('a non-questionnaire old-shape draft (no undo to drop in the first place) is completely unaffected', () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ step: 'duplicate_check', description: 'A tool that drafts client emails' }),
    );
    expect(loadDraft()).toEqual({ step: 'duplicate_check', description: 'A tool that drafts client emails' });
  });

  it('still refuses a stale or corrupt shape - the version envelope does not weaken the guard (it opens the form, nothing carried; R18-NF-5)', () => {
    sessionStorage.setItem(DRAFT_KEY, '{"nonsense":true}');
    expect(loadDraft()).toEqual({ step: 'graph_extraction', description: '', method: 'form' });
    sessionStorage.setItem(DRAFT_KEY, 'not json at all');
    expect(loadDraft()).toEqual({ step: 'graph_extraction', description: '', method: 'form' });
  });
});

// ---------------------------------------------------------------------------
// FX7-1 (CR7-fixes.md)
// ---------------------------------------------------------------------------
describe('clearDraftIfCase — an abandoned confirm or adopt cannot wipe a newer case\'s draft (CR7-16)', () => {
  beforeEach(() => clearDraft());
  const reviewDraft = (useCaseId?: string) =>
    ({
      step: 'graph_review',
      description: 'd',
      graph: { id: 'g1', version: 1, input_nodes: [], processing_nodes: [], output_nodes: [], edges: [], jurisdictions: [], intake_method: 'llm', extracted_at: '2026-01-01T00:00:00.000Z' },
      graphVersion: 1,
      corrections: [],
      ...(useCaseId ? { useCaseId } : {}),
    }) as unknown as IntakeState;

  it('TC-CR7-16-1: clears when the stored draft carries this useCaseId', () => {
    saveDraft(reviewDraft('uc-1'));
    clearDraftIfCase('uc-1');
    expect(loadDraft()).toBeNull();
  });

  it('TC-CR7-16-2: clears when there is no stored draft (nothing to protect)', () => {
    clearDraftIfCase('uc-1');
    expect(loadDraft()).toBeNull();
  });

  it('TC-CR7-16-3: leaves a draft with a different useCaseId', () => {
    saveDraft(reviewDraft('uc-other'));
    clearDraftIfCase('uc-1');
    expect(loadDraft()?.step).toBe('graph_review');
  });

  it('TC-CR7-16-4: leaves a draft with no useCaseId at all (a case just started)', () => {
    saveDraft({ step: 'description_entry', description: 'something new' } as IntakeState);
    clearDraftIfCase('uc-1');
    expect(loadDraft()?.step).toBe('description_entry');
  });

  it('TC-CR7-16-5: an adopt (which mints its id inside the handler) also clears the duplicate-check draft it came from, and only that one', () => {
    saveDraft({ step: 'duplicate_check', description: 'the adopted description' } as IntakeState);
    clearDraftIfCase('uc-adopted', { duplicateCheckDescription: 'the adopted description' });
    expect(loadDraft()).toBeNull();

    saveDraft({ step: 'duplicate_check', description: 'a different, newer description' } as IntakeState);
    clearDraftIfCase('uc-adopted', { duplicateCheckDescription: 'the adopted description' });
    expect(loadDraft()?.step).toBe('duplicate_check');
  });
});

describe('a draft saved by the current build is never migrated (CR7-28 retired by R18-NF-5)', () => {
  beforeEach(() => clearDraft());
  const node = (id: string) => ({ id, label: id });
  const oldGraph = {
    id: 'g1',
    version: 3,
    input_nodes: [node('i1')],
    processing_nodes: [node('p1')],
    output_nodes: [node('o1')],
    edges: [],
    jurisdictions: ['UK'],
    intake_method: 'llm',
    extracted_at: '2026-01-01T00:00:00.000Z',
  };
  const correction = { correction_id: 'c1', graph_version_before: 1, graph_version_after: 2, node_id: 'p1', field: 'vendor', original_value: 'a', corrected_value: 'b', corrected_by: '1LoD', corrected_at: '2026-01-01T00:00:00.000Z' };
  const oldQuestionnaire = (step: 'questionnaire' | 'contradiction_review') => ({
    step,
    description: 'A description the person typed.',
    graph: oldGraph,
    questions: [{ id: 'Q1', field: 'scale', node_id: 'o1', triggered_by: [], answer_type: 'single' }],
    answers: [{ questionId: 'Q1', value: 'limited' }],
    resolutionNotes: [],
    ...(step === 'contradiction_review' ? { contradictions: [] } : {}),
    corrections: [correction],
    useCaseId: 'uc-old',
    originalVerdictId: 'v-orig',
  });

  // R18-A: TC-CR7-28-4, -5, -6, -8 and TC-CR7-28b-1, -2 pinned the return of an
  // earlier-build description-path questions draft to the card review. That screen
  // is gone: such a draft (and every other earlier shape) now lands on the form with
  // the description kept and no answers - see TC-R18-NF-5-01 in
  // intake-draft.r18a.test.ts.

  it('TC-CR7-28-7: a draft saved by the current build (an envelope at the current version) is never migrated', () => {
    saveDraft(oldQuestionnaire('questionnaire') as unknown as IntakeState);
    expect(loadDraft()?.step).toBe('questionnaire');
    expect(loadDraftInfo()?.migratedFromOldBuild).toBe(false);
  });
});
