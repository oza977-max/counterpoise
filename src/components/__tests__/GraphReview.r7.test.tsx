import { describe, it, expect } from 'vitest';
import { intakeReducer } from '../intake-state';
import type { IntakeState } from '../intake-state';
import type { DataFlowGraph } from '../../engine/types';

// Round 7 — jurisdictions are confirmed, never assumed (requirements-007,
// intake-flow.md §17, ADR-IF-R7-1). Motivated by sweep-001: the extractor
// hallucinated "US" — a VALID code that silently activates the US pack,
// the one kind of junk the R5 filter cannot catch.

describe('R7-JC — reducer contract', () => {
  const graph: DataFlowGraph = {
    id: 'g1', version: 1, intake_method: 'llm', extracted_at: '2026-01-01T00:00:00.000Z',
    input_nodes: [], processing_nodes: [], output_nodes: [], edges: [], jurisdictions: ['US'],
  };
  const review = (confirmed: boolean | undefined): IntakeState => ({
    step: 'graph_review',
    description: 'd',
    graph,
    graphVersion: 1,
    corrections: [],
    useCaseId: 'uc-1',
    ...(confirmed !== undefined ? { jurisdictionsConfirmed: confirmed } : {}),
  });

  it('TC-R7-JC-2-02: QUESTIONS_GENERATED is refused while unconfirmed (defense in depth)', () => {
    const state = review(false);
    expect(intakeReducer(state, { type: 'QUESTIONS_GENERATED', questions: [] })).toBe(state);
  });

  it('TC-R7-JC-2-03: the form path (no flag) is not gated', () => {
    const next = intakeReducer(review(undefined), { type: 'QUESTIONS_GENERATED', questions: [] });
    expect(next.step).toBe('questionnaire');
  });

  it('TC-R7-JC-3-02: JURISDICTIONS_SET replaces the list, appends the correction, bumps the version, confirms', () => {
    const updated = { ...graph, version: 2, jurisdictions: [] };
    const next = intakeReducer(review(false), {
      type: 'JURISDICTIONS_SET',
      updatedGraph: updated,
      correction: {
        correction_id: 'c1', graph_version_before: 1, graph_version_after: 2,
        node_id: 'graph', field: 'jurisdictions', original_value: ['US'], corrected_value: [],
        corrected_at: '2026-01-01T00:00:00.000Z', corrected_by: '1LoD',
      },
    });
    expect(next.step).toBe('graph_review');
    if (next.step !== 'graph_review') return;
    expect(next.graph.jurisdictions).toEqual([]);
    expect(next.corrections).toHaveLength(1);
    expect(next.jurisdictionsConfirmed).toBe(true);
  });
});
