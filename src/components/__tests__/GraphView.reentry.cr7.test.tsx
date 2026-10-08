import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../../App';
import { intakeReducer, type IntakeState } from '../intake-state';
import type { DataFlowGraph } from '../../engine/types';

// TC-CR7-02g-3 (end to end). A case that went "Change an answer" from the
// confirmation screen back to the review screen must not have every value
// labelled "Not in your description" — the reducer sets `reentry`, and
// IntakeFlow must hand it to GraphView. The state below is what the real
// reducer produced (BC-003), restored the way a reload restores it.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: vi.fn() };
  },
}));

const DRAFT_KEY = 'aigate:intake-draft';

function llmGraph(): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    intake_method: 'llm',
    extracted_at: '2026-01-01T00:00:00.000Z',
    input_nodes: [{ id: 'i1', label: 'client notes', data_class: 'Client PII', data_zone: 'Zone C' }],
    processing_nodes: [
      { id: 'p1', label: 'drafting model', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone C', vendor: 'internal', replaces_prior_model: false },
    ],
    output_nodes: [
      { id: 'o1', label: 'draft email', action_type: 'draft', exposure: 'internal-only', decision_bindingness: 'advisory', output_reversibility: 'reversible', scale: 'limited' },
    ],
    edges: [],
    jurisdictions: [],
  } as DataFlowGraph;
}

describe('IntakeFlow — a revisited review screen carries no "no basis" badge (CR7-02 (6))', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function restoreAfter(state: IntakeState) {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 4, state }));
    return render(<App />);
  }

  it('TC-CR7-02g-3: Change an answer (real reducer) -> restored review screen shows no "Not in your description" badge', async () => {
    const confirmation: IntakeState = {
      step: 'confirmation',
      afterFailedEvaluation: false, // CR8-03: required on every confirmation (type-only fixture change)
      description: 'A tool that drafts client emails',
      graph: llmGraph(),
      graphVersion: 1,
      corrections: [],
      answers: [],
      resolutionNotes: [],
      useCaseId: 'uc-reentry',
    };
    const back = intakeReducer(confirmation, { type: 'CHANGE_ANSWER' });
    expect(back.step).toBe('graph_review');
    expect((back as { reentry?: boolean }).reentry).toBe(true);
    const { container } = restoreAfter(back);
    await screen.findAllByText(/drafting model/);
    expect(container.querySelector('.graph-node__badge--no-basis')).toBeNull();
    expect(container.querySelector('.graph-node__badge--unrecorded')).toBeNull();
    expect(container.textContent).not.toMatch(/Not in your description/);
  });

  it('TC-CR7-02g-3b: the same graph on a first review (no reentry) still shows the badge', async () => {
    const first: IntakeState = {
      step: 'graph_review',
      description: 'A tool that drafts client emails',
      graph: llmGraph(),
      graphVersion: 1,
      corrections: [],
      useCaseId: 'uc-first',
      unconfirmedNodeIds: ['i1', 'p1', 'o1'],
      provenance: {},
      guessedFields: {},
      jurisdictionsConfirmed: false,
    };
    const { container } = restoreAfter(first);
    await screen.findAllByText(/drafting model/);
    expect(container.querySelector('.graph-node__badge--no-basis')).not.toBeNull();
  });
});
