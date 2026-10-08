import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntakeFlow from '../IntakeFlow';
import { intakeReducer } from '../intake-state';
import type { IntakeState } from '../intake-state';
import type { DataFlowGraph } from '../../engine/types';
import { pressNext } from './fillText';

// Round 7 — jurisdictions are confirmed, never assumed (requirements-007,
// intake-flow.md §17, ADR-IF-R7-1). Motivated by sweep-001: the extractor
// hallucinated "US" — a VALID code that silently activates the US pack,
// the one kind of junk the R5 filter cannot catch.

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
  processing_nodes: [],
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
        scale: 'internal credit risk data',
      },
    },
  ],
  edges: [{ from: 'i1', to: 'o1' }],
  // The sweep-001 hallucination, verbatim: a VALID code nobody typed.
  jurisdictions: ['US'],
};

const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'tool_use', name: 'extract_graph', input: MOCK_INPUT }],
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

const DESCRIPTION = 'Answers risk analysts questions about internal credit risk data.';

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  render(<IntakeFlow />);
  await user.type(screen.getByLabelText(/what ai tool do you want to use/i), DESCRIPTION);
  await pressNext(user);
  await user.click(await screen.findByRole('button', { name: /continue →/i }));
  await screen.findByText(/check what we read from your description/i);
}

async function confirmAllCards(user: ReturnType<typeof userEvent.setup>) {
  for (;;) {
    // Card confirms ONLY — the jurisdiction confirm also ends "— confirm"
    // and clicking it here would defeat the gate this file tests.
    const buttons = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i });
    if (buttons.length === 0) return;
    await user.click(buttons[0]!);
  }
}

describe('R7-JC — jurisdiction confirmation on the LLM path', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
    mockCreate.mockClear();
  });

  it('TC-R7-JC-1-01: the hallucinated code renders named, by country name, framed as read from the description', async () => {
    const user = userEvent.setup();
    await reachReview(user);
    // §4 (D-103): options by country name only — no bare code beside it.
    expect(screen.getByText(/^united states$/i)).toBeInTheDocument();
    expect(screen.getByText(/we read these from your description/i)).toBeInTheDocument();
    expect((screen.getByRole('checkbox', { name: /united states/i }) as HTMLInputElement).checked).toBe(true);
  });

  it('TC-R7-JC-2-01: Proceed refuses until jurisdictions are confirmed; confirming opens it', async () => {
    const user = userEvent.setup();
    await reachReview(user);
    await confirmAllCards(user);

    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText(/check the countries before continuing/i)).toBeInTheDocument();
    expect(screen.getByText(/check what we read from your description/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^these are right$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.queryByText(/check what we read from your description/i)).toBeNull();
  });

  it('TC-R7-JC-3-01: unchecking the hallucinated code records a correction and confirms implicitly', async () => {
    const user = userEvent.setup();
    await reachReview(user);
    await confirmAllCards(user);

    await user.click(screen.getByRole('checkbox', { name: /united states/i }));
    // Edit = confirmation (ADR-IF-R5-1 rule carried over): Proceed opens.
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.queryByText(/check what we read from your description/i)).toBeNull();
  });
});

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
