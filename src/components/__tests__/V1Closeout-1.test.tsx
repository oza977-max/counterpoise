import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import App from '../../App';
import RegisterDetail from '../RegisterDetail';
import VerdictDisplay from '../VerdictDisplay';
import ContradictionReview from '../ContradictionReview';
import { addNode, getUseCases } from '../../store/register';
import { append, getAll } from '../../store/audit';
import { loadPolicy } from '../../store/policy';
import { setCurrentPolicyYaml } from '../../store/policy-source';
import { evaluate } from '../../engine/evaluate';
import { detectContradictions } from '../../engine/contradiction';
import type { RegisterNode } from '../../store/types';
import type { Verdict } from '../../types/verdict';
import type { DataFlowGraph, PolicyFile } from '../../engine/types';
import appetiteYaml from '../../../policy/appetite.yaml?raw';
import { fillText, SLOW_FLOW_MS, DUP_CHECK_WAIT, pressNext } from './fillText';

// gvm-test 007, close-out builder 1 — UI cases. Real components, real engine,
// real store on the suite's fake IndexedDB. The only mock is the external
// boundary: the Anthropic SDK (the model call that reads a description).

const FIVE_SENTENCES =
  "We want to deploy an AI assistant that reads client relationship management notes. It summarises each client's recent activity and generates a recommended action for the relationship manager. The model runs on our internal Azure OpenAI instance. Data stays within our private network. Output is displayed to the RM and requires their approval before any action is taken.";

const CREDIT =
  'We want to build a credit-scoring model that uses customer transaction history to predict default probability. Output feeds the lending decision system automatically.';

// Verbatim substrings of the descriptions above, so every field has a verified
// quote and the flow does not turn them into questions.
const CREDIT_GRAPH = {
  input_nodes: [
    { id: 'i1', label: 'transaction history', data_class: 'Client PII', data_zone: 'Zone B', basis_quotes: { data_class: 'customer transaction history', data_zone: 'transaction history' } },
  ],
  processing_nodes: [
    {
      id: 'p1',
      label: 'credit scoring model',
      model_type: 'traditional-ml',
      autonomy_level: 1,
      data_zone: 'Zone B',
      vendor: 'internal',
      replaces_prior_model: false,
      basis_quotes: {
        model_type: 'credit-scoring model',
        autonomy_level: 'automatically',
        data_zone: 'transaction history',
        vendor: 'credit-scoring model',
        replaces_prior_model: 'credit-scoring model',
      },
    },
  ],
  output_nodes: [
    {
      id: 'o1',
      label: 'lending decision',
      action_type: 'execute',
      exposure: 'internal-only',
      decision_bindingness: 'binding',
      output_reversibility: 'reversible',
      scale: 'limited',
      basis_quotes: {
        action_type: 'feeds the lending decision',
        exposure: 'lending decision',
        decision_bindingness: 'lending decision',
        output_reversibility: 'lending decision',
        scale: 'lending decision',
      },
    },
  ],
  edges: [
    { from: 'i1', to: 'p1' },
    { from: 'p1', to: 'o1' },
  ],
  jurisdictions: [],
};

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

function mockExtraction(graph: unknown) {
  mockCreate.mockResolvedValue({ content: [{ type: 'tool_use', name: 'extract_graph', input: graph }] });
}

async function describeAndReachGraph(user: ReturnType<typeof userEvent.setup>, text: string, expectLabel: RegExp) {
  render(<App />);
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), text);
  await pressNext(user);
  await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
  await screen.findAllByText(expectLabel);
}

describe('V1 close-out 1 — intake screens', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
    mockCreate.mockReset();
  });

  it('TC-UC-1-02: the five-sentence description is accepted and goes on to graph extraction, which receives that exact text', async () => {
    mockExtraction(CREDIT_GRAPH);
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const box = await screen.findByRole('textbox', { name: /what ai tool do you want to use/i });
    await fillText(user, box, FIVE_SENTENCES);
    const next = screen.getByRole('button', { name: /^next/i });
    expect(next).toBeEnabled();
    expect(FIVE_SENTENCES.split(/(?<=\.)\s/)).toHaveLength(5);
    await user.click(next);
    // Accepted: on to the duplicate check, then the model reads the description.
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findAllByText(/credit scoring model/i);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockCreate.mock.calls[0]![0])).toContain('internal Azure OpenAI instance');
    expect(JSON.stringify(mockCreate.mock.calls[0]![0])).toContain('requires their approval before any action is taken');
  }, SLOW_FLOW_MS);

  it('TC-UC-3-01: the extracted graph is shown — input, AI and output cards with their class, autonomy and action type — before any questions appear', async () => {
    // The model is unsure about the AI node, so questions WILL follow — which
    // lets the test show the order: graph first, questions only after review.
    mockExtraction({
      ...CREDIT_GRAPH,
      processing_nodes: [{ ...CREDIT_GRAPH.processing_nodes[0]!, uncertain: true }],
    });
    const user = userEvent.setup({ delay: null });
    await describeAndReachGraph(user, CREDIT, /credit scoring model/i);

    // The graph, in the screen's own plain words (R16-E).
    const view = within(screen.getByLabelText('What goes in, what happens, what comes out'));
    expect(view.getByText('transaction history')).toBeInTheDocument(); // input node
    expect(view.getByText('credit scoring model')).toBeInTheDocument(); // processing node
    expect(view.getByText('lending decision')).toBeInTheDocument(); // output node
    // Data class labelled on the input card.
    expect(view.getByText(/^Information about people/)).toBeInTheDocument();
    // Autonomy level shown on the AI card.
    expect(view.getByText(/^A person checks or approves each thing before it happens/)).toBeInTheDocument();
    // Action type shown on the output card.
    expect(view.getByText(/^It carries out actions/)).toBeInTheDocument();
    // And the model was asked exactly once to read the description.
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // No intake questions yet: the submitter has not reviewed the graph.
    expect(screen.queryByRole('region', { name: /targeted questions/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/question 1 of \d+/i)).not.toBeInTheDocument();

    // Only after the submitter checks every card and continues do they arrive.
    for (;;) {
      const confirms = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i });
      if (confirms.length === 0) break;
      await user.click(confirms[0]!);
    }
    const jurisdictions = screen.queryByRole('button', { name: /^(these are right|none of these — continue)$/i });
    if (jurisdictions) await user.click(jurisdictions);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    expect(await screen.findByRole('region', { name: /targeted questions/i })).toBeInTheDocument();
    expect(await screen.findByText(/question 1 of \d+/i)).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-UC-7-03: correcting the autonomy level shows the corrected value on the graph straight away, before anything is confirmed', async () => {
    mockExtraction(CREDIT_GRAPH);
    const user = userEvent.setup({ delay: null });
    await describeAndReachGraph(user, CREDIT, /credit scoring model/i);

    const before = within(screen.getByLabelText('What goes in, what happens, what comes out'));
    expect(before.getByText(/^A person checks or approves each thing before it happens/)).toBeInTheDocument();

    // Edit the AI card (the second card), set autonomy to the "acts by itself" level (3).
    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[1]!);
    const select = await screen.findByLabelText('credit scoring model — how much it does without a person');
    await user.selectOptions(select, '3');

    // Displayed graph updates immediately: the new meaning shows, the old is gone.
    await waitFor(() => expect(select).toHaveValue('3'));
    await user.click(screen.getByRole('button', { name: /^done$/i }));
    const after = within(screen.getByLabelText('What goes in, what happens, what comes out'));
    expect(after.getByText(/^It acts by itself within limits someone set, with no routine review/)).toBeInTheDocument();
    expect(after.queryByText(/^A person checks or approves each thing before it happens/)).not.toBeInTheDocument();
    // Still on the review screen — the corrected value is visible BEFORE confirming.
    expect(screen.queryByRole('button', { name: /confirm and evaluate/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('an adopted classification shows on the new register record as "Classification adopted from <earlier case>", with no verdict of its own [TC-UC-2-02]', async () => {
    const label = 'Adoption status probe assistant';
    const existing: RegisterNode = {
      node_id: crypto.randomUUID(),
      node_type: 'use_case',
      label,
      created_at: '2026-07-29T00:00:00.000Z',
      metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'approved', current_verdict_id: null, tier: 'High', track: 'II' },
    };
    await addNode(existing);
    // No model key: the duplicate check is the deterministic one, as in the
    // sibling adoption test (IntakeFlow.resume.test.tsx).
    localStorage.removeItem('aigate:api-key');
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), label);
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /use the earlier result/i }));
    expect(screen.queryByText(/new pre-check — tell us about the ai you want to use/i)).not.toBeInTheDocument();

    const adopted = await waitFor(async () => {
      const rows = await getUseCases('all');
      const hit = await Promise.all(
        rows.map(async (r) => ({ r, ev: (await getAll(r.use_case_id)).find((e) => e.payload.type === 'classification_adopted') })),
      );
      const found = hit.find((h) => h.ev !== undefined);
      expect(found).toBeDefined();
      return found!.r;
    });

    // The new record's own page, as the reviewer sees it.
    render(<RegisterDetail useCaseId={adopted.use_case_id} role="2LoD" onBack={vi.fn()} />);
    const timeline = (await screen.findByRole('heading', { name: /audit trail/i })).parentElement!;
    expect(within(timeline).getByText(new RegExp(`Classification adopted from ${label}`))).toBeInTheDocument();
    expect(within(timeline).getByText(/No evaluation was run for this record/)).toBeInTheDocument();
    expect(adopted.current_verdict_status).toBeNull();
  }, SLOW_FLOW_MS);
});

describe('V1 close-out 1 — start-up and review screens', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('TC-CF-5-03: with the shipped policy and packs the app starts with no policy error and the intake is ready; a broken policy does show the error', async () => {
    const first = render(<App />);
    expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toBeEnabled();
    expect(screen.queryByText(/policy file invalid/i)).not.toBeInTheDocument();
    first.unmount();

    // Control, so the check above can fail: the same app over a policy with a
    // blank version shows the start-up error.
    setCurrentPolicyYaml(appetiteYaml.replace(/^version:.*$/m, 'version: ""'));
    try {
      render(<App />);
      expect(await screen.findByText(/policy file invalid/i)).toBeInTheDocument();
    } finally {
      setCurrentPolicyYaml(appetiteYaml);
    }
  });

  it('TC-UC-5-01: the contradiction screen shows both conflicting statements and Continue stays disabled until the person explains which is right', async () => {
    const user = userEvent.setup({ delay: null });
    const g: DataFlowGraph = {
      id: 'g1',
      version: 1,
      input_nodes: [{ id: 'i1', label: 'client relationship notes', data_class: 'Client PII', data_zone: 'Zone B' }],
      processing_nodes: [],
      output_nodes: [],
      edges: [],
      jurisdictions: [],
      intake_method: 'llm',
      extracted_at: '2026-01-01T00:00:00.000Z',
    };
    const contradictions = detectContradictions('Summarises documents. No client data used.', [], g);
    const onResolve = vi.fn();
    render(<ContradictionReview contradictions={contradictions} onResolve={onResolve} />);

    expect(screen.getByText('Your description says no personal information is involved.')).toBeInTheDocument();
    expect(screen.getByText('but your answers say it uses information about people.')).toBeInTheDocument();
    const cont = screen.getByRole('button', { name: /^continue$/i });
    expect(cont).toBeDisabled();
    await user.click(cont);
    expect(onResolve).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/which is right, and why\?/i), 'The notes are internal only.');
    expect(cont).toBeEnabled();
    await user.click(cont);
    expect(onResolve).toHaveBeenCalledWith('The notes are internal only.');
  });
});

describe('V1 close-out 1 — verdict and register screens', () => {
  const loaded = loadPolicy(readFileSync(resolve(__dirname, '../../../policy/appetite.yaml'), 'utf-8'));
  if (!loaded.valid) throw new Error('fixture policy invalid');
  const policy: PolicyFile = loaded.policy;

  const graph = (): DataFlowGraph => ({
    id: 'g-ui',
    version: 1,
    intake_method: 'structured_form',
    extracted_at: '2026-01-01T00:00:00.000Z',
    jurisdictions: [],
    input_nodes: [{ id: 'i1', label: 'transaction history', data_class: 'Client PII', data_zone: 'Zone B' }],
    processing_nodes: [
      { id: 'p1', label: 'credit model', model_type: 'ml', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal', replaces_prior_model: false },
    ],
    output_nodes: [
      { id: 'o1', label: 'lending decision', action_type: 'recommend', exposure: 'internal-shared', decision_bindingness: 'material', output_reversibility: 'reversible', scale: 'at_scale' },
    ],
    edges: [
      { from: 'i1', to: 'p1' },
      { from: 'p1', to: 'o1' },
    ],
  });

  function realVerdict(p: PolicyFile, useCaseId: string): Verdict {
    const r = evaluate(graph(), p, []);
    if (!r.ok) throw new Error('engine error');
    return {
      ...r.value,
      id: crypto.randomUUID(),
      use_case_id: useCaseId,
      living_status: 'approved',
      living_status_updated_at: '2026-01-02T00:00:00.000Z',
      attested_by: '1LoD',
      attested_at: '2026-01-02T00:00:00.000Z',
      graph_version: 1,
      corrections: [],
    };
  }

  it('a verdict whose library offers no alternatives says plainly the margin is 0%, below the policy target, and that the rulebook is the limit [TC-CS-1-02b]', () => {
    const oneEach: PolicyFile = {
      ...policy,
      safety_margin: 0.1,
      controls: policy.invariants.map((inv) => ({
        id: `CTRL-ONLY-${inv.id}`,
        name: `Only control for ${inv.id}`,
        description: 'test fixture',
        resolves: [inv.id],
        burden: 1,
        verification: 'test fixture',
      })),
    };
    const verdict = realVerdict(oneEach, 'uc-margin');
    expect(verdict.margin_achieved).toBe(0);
    const { container } = render(<VerdictDisplay verdict={verdict} auditEvents={[]} onCorrect={vi.fn()} policy={oneEach} />);
    const panel = container.textContent ?? '';
    expect(panel).toMatch(/margin of safety 0% \(policy target: at least 10%\)/);
    expect(panel).toMatch(/0% of the triggered rules have more than one control available/);
    expect(panel).toMatch(/— below target/);
    expect(panel).toMatch(/No rule here has an alternative control in the library/);
    // Never presented as met.
    expect(panel).not.toMatch(/margin of safety (?!0%)\d+%/);
  });

  it('TC-VD-4-01: the audit trail of three verdict records offers no delete, edit or modify control — each record is read-only with a time, an identity and its content', async () => {
    const id = crypto.randomUUID();
    await addNode({
      node_id: id,
      node_type: 'use_case',
      label: 'Audit read-only probe',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'pre_checked', current_verdict_id: null, tier: 'High', track: 'II' },
    } as RegisterNode);
    const actors = ['1LoD', '2LoD', 'system'];
    for (const [i, actor] of actors.entries()) {
      await append({
        event_id: crypto.randomUUID(),
        use_case_id: id,
        event_type: 'verdict_produced',
        occurred_at: `2026-01-0${i + 2}T10:00:00.000Z`,
        actor,
        payload: { type: 'verdict_produced', verdict: realVerdict(policy, id), knowledge_lens_matched_entry_ids: [] },
      });
    }
    render(<RegisterDetail useCaseId={id} role="2LoD" policy={policy} onBack={vi.fn()} />);
    const heading = await screen.findByRole('heading', { name: /audit trail/i });
    const timeline = heading.parentElement!;
    await waitFor(() => expect(timeline.querySelectorAll('.timeline__row').length).toBeGreaterThanOrEqual(3));
    const rows = Array.from(timeline.querySelectorAll('.timeline__row')).filter((r) => r.textContent?.includes('verdict_produced'));
    expect(rows).toHaveLength(3);

    // Every record carries its timestamp, identity and content...
    rows.forEach((row, i) => {
      expect(row.querySelector('.timeline__time')?.textContent?.length).toBeGreaterThan(0);
      expect(row.querySelector('.timeline__actor')?.textContent).toBe(actors[i]);
      expect(row.querySelector('.timeline__detail')?.textContent?.length).toBeGreaterThan(0);
    });
    // ...and no control at all to act on it: no button, link, field or
    // editable region anywhere in the trail.
    const t = within(timeline);
    expect(t.queryAllByRole('button')).toHaveLength(0);
    expect(t.queryAllByRole('link')).toHaveLength(0);
    expect(t.queryAllByRole('textbox')).toHaveLength(0);
    expect(timeline.querySelectorAll('input, select, textarea, button, a, [contenteditable]')).toHaveLength(0);
    expect(timeline.textContent).not.toMatch(/\b(delete|edit|modify|remove|hide)\b/i);
  });
});
