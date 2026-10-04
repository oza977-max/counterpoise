import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GraphView from '../GraphView';
import IntakeFlow from '../IntakeFlow';
import { intakeReducer } from '../intake-state';
import type { IntakeState } from '../intake-state';
import type { DataFlowGraph } from '../../engine/types';

// Round 5 — the graph review that explains itself (requirements-005,
// intake-flow.md §15). GR-1/3/5 are asserted directly against GraphView;
// GR-2 and GX-1 need the flow (reducer + IntakeFlow), mocking only the
// external SDK boundary (TDD-2 mock budget = 1, as WalkingSkeleton).

function makeGraph(overrides: Partial<DataFlowGraph> = {}): DataFlowGraph {
  return {
    id: 'g1',
    version: 1,
    intake_method: 'llm',
    extracted_at: '2026-01-01T00:00:00.000Z',
    input_nodes: [{ id: 'i1', label: 'credit risk data', data_class: 'Client PII', data_zone: 'Zone C' }],
    processing_nodes: [
      {
        id: 'p1',
        label: 'training pipeline',
        model_type: 'llm',
        autonomy_level: 2,
        data_zone: 'Zone C',
        vendor: 'open source',
        replaces_prior_model: false,
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
      },
    ],
    edges: [
      { from: 'i1', to: 'p1' },
      { from: 'p1', to: 'o1' },
    ],
    jurisdictions: [],
    ...overrides,
  };
}

describe('R5-GR-1 — every decision-bearing field explains itself', () => {
  it('TC-R5-GR-1-01: meanings render by default; consequences reveal in one click (criterion amended by R9-SC-2)', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    const { container } = render(<GraphView graph={makeGraph()} />);
    // The meaning, not (only) the enum: Zone C's plain-English reading
    // (R16-E §4: QUESTIONNAIRE_COPY's own words, not field-copy.ts's).
    expect(screen.getAllByText(/your firm.s own systems/i).length).toBeGreaterThan(0);
    // R9-SC-2: consequences are one interaction away, per card.
    // (R16-E review pass 4 reworded the line in plain words.)
    expect(screen.queryByText(/lines your firm never crosses depend on this/i)).toBeNull();
    for (const b of screen.getAllByRole('button', { name: /why these values matter/i })) await user.click(b);
    expect(screen.getAllByText(/lines your firm never crosses depend on this/i).length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.graph-node__consequence').length).toBeGreaterThanOrEqual(12);
  });

  it('TC-R5-GR-1-02: a changed value shows the changed meaning', () => {
    const zoneA = makeGraph();
    zoneA.input_nodes[0]!.data_zone = 'Zone A';
    const { container } = render(<GraphView graph={zoneA} />);
    // Scoped to the changed (input) card — the fixture's processing node
    // is still Zone C, which legitimately shows the unchanged meaning on
    // its OWN card; this checks the INPUT card specifically changed.
    const inputCard = container.querySelector('.graph-node')!;
    expect(within(inputCard as HTMLElement).getByText(/an outside website or service/i)).toBeInTheDocument();
    expect(within(inputCard as HTMLElement).queryByText(/your firm.s own systems/i)).toBeNull();
  });

  it('TC-R15-C5-05 / TC-R5-GR-1-03: absent optional fields say "not stated" rather than defaulting', () => {
    render(<GraphView graph={makeGraph()} />);
    // decision_type and hitl are absent on the fixture output node.
    // decision_type + hitl (output node) and, since v1.4,
    // system_access_scope + multi_instance_coordination (processing node) —
    // all four optional, all four honestly "not stated" when unanswered.
    expect(screen.getAllByText('not stated').length).toBe(4);
  });
});

describe('R5-GR-3 — uncertainty is loud (GraphView)', () => {
  it('TC-R5-GR-3-01: an uncertain node renders the warning and its own confirm action [TC-UC-3-02]', () => {
    const g = makeGraph();
    g.processing_nodes[0]!.uncertain = true;
    const { container } = render(
      <GraphView graph={g} editable unconfirmedNodeIds={['i1', 'p1', 'o1']} onConfirmNode={vi.fn()} />,
    );
    const card = container.querySelector('[data-uncertain="true"]')!;
    expect(within(card as HTMLElement).getByRole('alert')).toHaveTextContent(/not confident/i);
    // The uncertain card's confirm is its own, worded as a check.
    expect(within(card as HTMLElement).getByRole('button', { name: /i.ve checked this — it.s right/i })).toBeInTheDocument();
    // Three cards, three separate confirm actions — nothing en bloc.
    expect(screen.getAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i })).toHaveLength(3);
  });
});

describe('R5-GR-5 — one-use-case hygiene hint', () => {
  it('TC-R5-GR-5-01: two processing nodes show the hint; one does not', () => {
    const two = makeGraph();
    two.processing_nodes = [
      two.processing_nodes[0]!,
      { ...two.processing_nodes[0]!, id: 'p2', label: 'nlp to sql' },
    ];
    const first = render(<GraphView graph={two} editable />);
    expect(screen.getByText(/submit them separately/i)).toBeInTheDocument();
    first.unmount();

    render(<GraphView graph={makeGraph()} editable />);
    expect(screen.queryByText(/submit them separately/i)).toBeNull();
  });
});

describe('R5-GR-2 — the confirm gate (reducer)', () => {
  const reviewState = (unconfirmed: string[]): IntakeState => ({
    step: 'graph_review',
    description: 'd',
    graph: makeGraph(),
    graphVersion: 1,
    corrections: [],
    useCaseId: 'uc-1',
    unconfirmedNodeIds: unconfirmed,
  });

  it('TC-R5-GR-2-04: QUESTIONS_GENERATED is refused while any node is unconfirmed (defense in depth)', () => {
    const state = reviewState(['p1']);
    const next = intakeReducer(state, { type: 'QUESTIONS_GENERATED', questions: [] });
    expect(next).toBe(state);
  });

  it('TC-R5-GR-2-05: NODE_CONFIRMED removes exactly that node', () => {
    const next = intakeReducer(reviewState(['i1', 'p1']), { type: 'NODE_CONFIRMED', nodeId: 'p1' });
    expect(next.step === 'graph_review' && next.unconfirmedNodeIds).toEqual(['i1']);
  });

  it('TC-R5-GR-2-06: a correction confirms the corrected node implicitly', () => {
    const g2 = makeGraph({ version: 2 });
    const next = intakeReducer(reviewState(['i1', 'p1']), {
      type: 'CORRECTION_APPLIED',
      correction: {
        correction_id: 'c1',
        graph_version_before: 1,
        graph_version_after: 2,
        node_id: 'p1',
        field: 'data_zone',
        original_value: 'Zone A',
        corrected_value: 'Zone C',
        corrected_at: '2026-01-01T00:00:00.000Z',
        corrected_by: '1LoD',
      },
      updatedGraph: g2,
    });
    expect(next.step === 'graph_review' && next.unconfirmedNodeIds).toEqual(['i1']);
  });

  it('TC-R5-GR-2-03: the form path carries no unconfirmed set — no gate, no chrome', () => {
    const state: IntakeState = { step: 'graph_extraction', description: 'd', method: 'form' };
    const next = intakeReducer(state, { type: 'GRAPH_EXTRACTED', graph: makeGraph({ intake_method: 'structured_form' }), useCaseId: 'uc-2' });
    expect(next.step).toBe('graph_review');
    expect((next as { unconfirmedNodeIds?: string[] }).unconfirmedNodeIds).toBeUndefined();
  });
});

// ——— Flow-level: gate message and jurisdiction hygiene, SDK mocked ———

const MOCK_GRAPH_INPUT = {
  input_nodes: [{ id: 'i1', label: 'credit risk data', data_class: 'Client PII', data_zone: 'Zone C', basis_quotes: { data_class: 'client PII', data_zone: 'Zone C' } }],
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
        model_type: 'large language model',
        autonomy_level: 'supervised autonomy',
        data_zone: 'Zone C',
        vendor: 'open source',
        replaces_prior_model: 'replaces no prior model',
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
        action_type: 'recommends',
        exposure: 'internal-only',
        decision_bindingness: 'advisory',
        output_reversibility: 'reversible',
        scale: 'limited scale',
      },
    },
  ],
  edges: [
    { from: 'i1', to: 'p1' },
    { from: 'p1', to: 'o1' },
  ],
  // R5-GX-1: one junk value (the live model returned "Internal"), one real.
  jurisdictions: ['Internal', 'UK'],
};

const mockCreate = vi.fn().mockResolvedValue({
  content: [{ type: 'tool_use', name: 'extract_graph', input: MOCK_GRAPH_INPUT }],
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

async function reachGraphReview(user: ReturnType<typeof userEvent.setup>) {
  render(<IntakeFlow />);
  await user.type(
    screen.getByLabelText(/what ai tool do you want to use/i),
    // BC-003: long enough that every quote in MOCK_GRAPH_INPUT.basis_quotes is
    // a verbatim substring of what is typed here.
    'Trains an open source model on internal credit risk data containing client PII. It is a large language model with supervised autonomy, running in Zone C, and it recommends advisory, reversible, internal-only answers at limited scale; it replaces no prior model.',
  );
  await user.click(screen.getByRole('button', { name: /^next/i }));
  await user.click(await screen.findByRole('button', { name: /continue →/i }));
  await screen.findByText(/check what we read from your description/i);
}

describe('R5-GR-2 / R5-GX-1 — flow level', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
    mockCreate.mockClear();
  });

  it('TC-R5-GR-2-01: Proceed is refused with a plain-English message until every card is confirmed', async () => {
    const user = userEvent.setup();
    await reachGraphReview(user);

    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText(/3 cards still need checking/i)).toBeInTheDocument();
    expect(screen.getByText(/check what we read from your description/i)).toBeInTheDocument();

    // Confirm all three; the gate opens.
    for (;;) {
      const buttons = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i });
      if (buttons.length === 0) break;
      await user.click(buttons[0]!);
    }
    // §4 (D-103): the jurisdiction confirm button no longer shares a
    // "— confirm" suffix with the node confirm buttons above (R16-F's own
    // behaviour let one generic selector catch both by accident) — it
    // needs its own explicit click now.
    await user.click(screen.getByRole('button', { name: /^these are right$/i }));
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(screen.queryByText(/check what we read from your description/i)).toBeNull();
  });

  it('TC-R5-GR-2-02: the review screen states that values are proposed, not scored', async () => {
    const user = userEvent.setup();
    await reachGraphReview(user);
    expect(screen.getByText(/nothing is\s+decided until you.ve checked or corrected each one/i)).toBeInTheDocument();
  });

  it('TC-R5-GX-1-01: an unrecognised jurisdiction is dropped from the graph and surfaced by name', async () => {
    const user = userEvent.setup();
    await reachGraphReview(user);
    const notice = screen.getByText(/we ignored/i);
    expect(notice).toHaveTextContent('“Internal”');
    // The recognised one was NOT dropped — the notice names only the junk.
    expect(notice.textContent).not.toContain('“UK”');
  });
});
