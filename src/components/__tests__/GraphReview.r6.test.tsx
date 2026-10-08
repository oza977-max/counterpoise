import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import GraphView from '../GraphView';
import { extractGraph } from '../../llm/graph-extractor';
import { questionsForGuessedFields } from '../../engine/question-generator';
import { intakeReducer } from '../intake-state';
import type { IntakeState } from '../intake-state';
import type { DataFlowGraph } from '../../engine/types';

// Round 6 — show your working (requirements-006, intake-flow.md §16).
// Provenance quotes verified deterministically; guessed fields resolve via
// questions; answers finally write back (ADR-IF-R6-3). Mock budget = 1
// (the SDK), as always.

const DESCRIPTION = 'Trains an open source model on internal credit risk data for risk analysts, replacing no prior model.';

// Quotes: data_class + data_zone genuine substrings; model_type FABRICATED
// (not in the description); vendor empty. So: i1 fully quoted; p1 has
// model_type + vendor guessed, autonomy_level + data_zone quoted.
const MOCK_INPUT = {
  input_nodes: [
    {
      id: 'i1',
      label: 'credit risk data',
      data_class: 'Client PII',
      data_zone: 'Zone C',
      basis_quotes: { data_class: 'credit risk data', data_zone: 'internal' },
    },
  ],
  processing_nodes: [
    {
      id: 'p1',
      label: 'training pipeline',
      model_type: 'llm',
      autonomy_level: 2,
      data_zone: 'Zone C',
      vendor: 'open source',
      replaces_prior_model: false,
      basis_quotes: {
        model_type: 'a chatbot with tools', // fabricated — not in DESCRIPTION
        autonomy_level: 'risk analysts',
        data_zone: 'internal',
        vendor: '',
        replaces_prior_model: 'replacing no prior model',
      },
    },
  ],
  output_nodes: [
    {
      id: 'o1',
      label: 'analyst answers',
      action_type: 'recommend',
      exposure: 'internal-only',
      decision_bindingness: 'advisory',
      output_reversibility: 'reversible',
      scale: 'limited',
      basis_quotes: {
        action_type: 'risk analysts',
        exposure: 'internal',
        decision_bindingness: 'for risk analysts',
        output_reversibility: 'credit risk data',
        scale: 'trains an open source model',
      },
    },
  ],
  edges: [
    { from: 'i1', to: 'p1' },
    { from: 'p1', to: 'o1' },
  ],
  jurisdictions: [],
};

const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'tool_use', name: 'extract_graph', input: MOCK_INPUT }],
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

describe('R6-PV — quote verification at the parse gate', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
  });

  it('TC-R6-PV-1-01: verified quotes come back as provenance; the graph itself carries no basis_quotes', async () => {
    const result = await extractGraph(DESCRIPTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.provenance.i1).toEqual({ data_class: 'credit risk data', data_zone: 'internal' });
    // ADR-IF-R6-1: quotes travel beside the graph, never on it.
    expect('basis_quotes' in result.value.graph.input_nodes[0]!).toBe(false);
  });

  it('TC-R6-PV-2-01: a fabricated quote demotes the field to guessed and is never kept', async () => {
    const result = await extractGraph(DESCRIPTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guessed.p1).toContain('model_type');
    expect(result.value.provenance.p1?.model_type).toBeUndefined();
  });

  it('TC-R6-PV-2-02: an empty quote demotes the field to guessed', async () => {
    const result = await extractGraph(DESCRIPTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.guessed.p1).toContain('vendor');
  });

  it('TC-R6-PV-2-03: matching is case- and whitespace-insensitive, and a fully quoted node has no guessed entry', async () => {
    const result = await extractGraph(DESCRIPTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "Trains an open source model" quote vs "Trains an open source model" in
    // the description — different case in the quote ('trains…') still passes.
    expect(result.value.guessed.o1).toBeUndefined();
    expect(result.value.guessed.i1).toBeUndefined();
  });
});

describe('R6-PV-3/-4 — provenance on the review screen (GraphView)', () => {
  function makeGraph(): DataFlowGraph {
    return {
      id: 'g1',
      version: 1,
      intake_method: 'llm',
      extracted_at: '2026-01-01T00:00:00.000Z',
      input_nodes: [{ id: 'i1', label: 'credit risk data', data_class: 'Client PII', data_zone: 'Zone C' }],
      processing_nodes: [],
      output_nodes: [],
      edges: [],
      jurisdictions: [],
    };
  }

  it('TC-R15-C5-04 / TC-R6-PV-3-01: a quoted field shows its basis; a guessed field says the model guessed', () => {
    render(
      <GraphView
        graph={makeGraph()}
        editable
        unconfirmedNodeIds={[]}
        onConfirmNode={vi.fn()}
        provenance={{ i1: { data_class: 'credit risk data' } }}
        guessedFields={{ i1: ['data_zone'] }}
      />,
    );
    expect(screen.getByText(/from your description: “credit risk data”/i)).toBeInTheDocument();
    // R9-SC-3: the per-field marker is a quiet badge; the card banner is
    // the alarm. Both renderings still appear (R6 fit criterion holds).
    // R16-E §4 (F1B-1): reworded off "guessed".
    expect(screen.getByText(/not in your description — check this, or it becomes a question/i)).toBeInTheDocument();
  });

  it('TC-R6-PV-4-01: a card with a guessed field renders no plain confirm action', () => {
    render(
      <GraphView
        graph={makeGraph()}
        editable
        unconfirmedNodeIds={[]}
        onConfirmNode={vi.fn()}
        guessedFields={{ i1: ['data_zone'] }}
      />,
    );
    expect(screen.queryByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i })).toBeNull();
  });
});

describe('R6-QN-1 — guessed fields become questions, and answers write back', () => {
  function makeGraph(): DataFlowGraph {
    return {
      id: 'g1',
      version: 1,
      intake_method: 'llm',
      extracted_at: '2026-01-01T00:00:00.000Z',
      input_nodes: [{ id: 'i1', label: 'credit risk data', data_class: 'Client PII', data_zone: 'Zone A' }],
      processing_nodes: [],
      output_nodes: [],
      edges: [],
      jurisdictions: [],
    };
  }

  it('TC-R6-QN-1-01: a guessed data_zone produces a data_zone question with canonical options; quoted fields produce none', () => {
    const qs = questionsForGuessedFields({ i1: ['data_zone'] }, makeGraph());
    expect(qs).toHaveLength(1);
    expect(qs[0]!.field).toBe('data_zone');
    expect(qs[0]!.node_id).toBe('i1');
    expect(qs[0]!.options).toContain('Zone C');
    expect(qs[0]!.triggered_by).toContain('R6-PV-2:guessed');
  });

  it('TC-R6-QN-1-02 (ADR-IF-R6-3): an answer differing from the graph applies as a correction on the questionnaire state', () => {
    const graph = makeGraph();
    const state: IntakeState = {
      step: 'questionnaire',
      description: 'd',
      graph,
      questions: [],
      answers: [],
      resolutionNotes: [],
      corrections: [],
      useCaseId: 'uc-1',
    };
    const updated = { ...graph, version: 2, input_nodes: [{ ...graph.input_nodes[0]!, data_zone: 'Zone C' as const }] };
    const next = intakeReducer(state, {
      type: 'ANSWER_SUBMITTED',
      answer: { questionId: 'Q-data_zone-i1', value: 'Zone C' },
      correction: {
        correction_id: 'c1',
        graph_version_before: 1,
        graph_version_after: 2,
        node_id: 'i1',
        field: 'data_zone',
        original_value: 'Zone A',
        corrected_value: 'Zone C',
        corrected_at: '2026-01-01T00:00:00.000Z',
        corrected_by: '1LoD',
      },
      updatedGraph: updated,
    });
    expect(next.step).toBe('questionnaire');
    if (next.step !== 'questionnaire') return;
    // The engine will now see what the user answered — the defect this
    // round discovered and closed.
    expect(next.graph.input_nodes[0]!.data_zone).toBe('Zone C');
    expect(next.corrections).toHaveLength(1);
  });
});

// Honesty review 004 finding 1: "Confirmed by you." must be earned.
describe('R6 — the confirmed note is never unearned', () => {
  it('a card with guessed fields shows no "Confirmed by you." before any human act', () => {
    render(
      <GraphView
        graph={{
          id: 'g9', version: 1, intake_method: 'llm', extracted_at: '2026-01-01T00:00:00.000Z',
          input_nodes: [{ id: 'i9', label: 'x', data_class: 'Internal', data_zone: 'Zone C' }],
          processing_nodes: [], output_nodes: [], edges: [], jurisdictions: [],
        }}
        editable
        unconfirmedNodeIds={[]}
        onConfirmNode={vi.fn()}
        guessedFields={{ i9: ['data_zone'] }}
      />,
    );
    expect(screen.queryByText(/confirmed by you/i)).toBeNull();
  });
});
