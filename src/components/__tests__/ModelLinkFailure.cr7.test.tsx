import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import RegisterDetail from '../RegisterDetail';
import * as registerModule from '../../store/register';
import { getUseCases } from '../../store/register';

// Review pass 2, M-1. The register says "No AI model is recorded for this use case" when a case has no
// uses_model edge. The link is written AFTER the use-case node (writing it first
// stranded a case whose verdict was already on the trail). If the link write
// fails the case is saved and flagged model_link_unrecorded, and the register
// then says nothing about models.
// Mock budget = 1 (the Anthropic SDK); addUseCaseModelLink is SPIED, not replaced.
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

const NO_MODEL_LINE = 'No AI model is recorded for this use case — your AI risk team may ask which one it uses.';
const BASE = 'The Alpha tool built in-house drafts text. A person checks each one. It replaces no earlier model.';
// The store persists across the tests of this file, so each test describes its own case.
let DESC = BASE;

function extraction() {
  return {
    content: [
      {
        type: 'tool_use',
        name: 'extract_graph',
        input: {
          input_nodes: [
            { id: 'i1', label: 'notes', data_class: 'Internal', data_zone: 'Zone B', basis_quotes: { data_class: 'drafts text', data_zone: 'built in-house' } },
          ],
          processing_nodes: [
            {
              id: 'p1', label: 'drafting tool', model_type: 'llm', autonomy_level: 1, data_zone: 'Zone B', vendor: 'internal',
              declared_model_id: 'qwen3:4b', replaces_prior_model: false,
              basis_quotes: {
                model_type: 'drafts text', autonomy_level: 'A person checks', data_zone: 'built in-house', vendor: 'built in-house',
                declared_model_id: 'Alpha', replaces_prior_model: 'replaces no earlier model',
              },
            },
          ],
          output_nodes: [
            {
              id: 'o1', label: 'drafts', action_type: 'draft', exposure: 'internal-only', decision_bindingness: 'non-binding',
              output_reversibility: 'reversible', scale: 'limited',
              basis_quotes: {
                action_type: 'drafts text', exposure: 'A person checks', decision_bindingness: 'A person checks',
                output_reversibility: 'A person checks', scale: 'A person checks',
              },
            },
          ],
          edges: [],
          jurisdictions: [],
        },
      },
    ],
  };
}

type User = ReturnType<typeof userEvent.setup>;

async function reachConfirm(user: User) {
  render(<App />);
  await user.type(screen.getByLabelText(/what ai tool do you want to use/i), DESC);
  await user.click(screen.getByRole('button', { name: /^next/i }));
  await user.click(await screen.findByRole('button', { name: /continue →/i }));
  await screen.findByText('Check what we read from your description');
  for (;;) {
    const b = screen.queryAllByRole('button', { name: /^(this is right|i.ve checked this — it.s right)$/i })[0];
    if (!b) break;
    await user.click(b);
  }
  const jur = screen.queryByRole('button', { name: /^(these are right|none of these — continue)$/i });
  if (jur) await user.click(jur);
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  for (let i = 0; i < 20; i++) {
    if (screen.queryByRole('button', { name: /confirm and evaluate/i })) break;
    const option = document.querySelector<HTMLButtonElement>('.questionnaire__options button');
    if (!option) break;
    await user.click(option);
  }
  return screen.findByRole('button', { name: /confirm and evaluate/i });
}

describe('IntakeFlow — a failed model-link write never strands a case (review pass 2, M-1)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('aigate:api-key', 'test-key');
    mockCreate.mockReset();
    DESC = `${BASE} Case ${crypto.randomUUID().slice(0, 8)}.`;
    vi.restoreAllMocks();
  });

  it('TC-CR7-11h: the link write fails, the case IS saved (no dead end), flagged model_link_unrecorded, and the register never says no AI model is recorded', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(extraction());
    const confirm = await reachConfirm(user);
    // Spied only now: App's own seeding of the built-in example case (which
    // uses the same function) has long finished by this point.
    // EBT exception (owner-accepted, code review 006/008): fault injection — a simulated storage failure the real store cannot be made to produce on demand
    const linkSpy = vi.spyOn(registerModule, 'addUseCaseModelLink').mockRejectedValue(new Error('link write failed'));
    await user.click(confirm);
    await waitFor(() => expect(linkSpy).toHaveBeenCalled(), { timeout: 5000 });
    // The result is shown: the failure of the side link does not strand the case.
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 8000 });
    const row = (await getUseCases('all')).find((r) => r.description === DESC);
    expect(row).toBeDefined();
    const { nodes, edges } = await registerModule.getGraph(row!.use_case_id);
    expect(edges.some((e) => e.edge_type === 'uses_model')).toBe(false);
    const meta = nodes.find((n) => n.node_id === row!.use_case_id)!.metadata as { model_link_unrecorded?: boolean };
    expect(meta.model_link_unrecorded).toBe(true);
    // The register path must say nothing about models for this case.
    linkSpy.mockRestore();
    const view = render(<RegisterDetail useCaseId={row!.use_case_id} role="2LoD" onBack={() => {}} />);
    await view.findByText(/← register/i);
    await new Promise((res) => setTimeout(res, 100));
    expect(view.container.textContent).not.toContain(NO_MODEL_LINE);
    expect(view.container.querySelector('.verdict__no-model-named')).toBeNull();
  }, 40000);

  it('TC-CR7-11j: the link write AND the flag write both reject — the verdict still shows and the case is saved', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(extraction());
    const confirm = await reachConfirm(user);
    // EBT exception (owner-accepted, code review 006/008): fault injection — a simulated storage failure the real store cannot be made to produce on demand
    const linkSpy = vi.spyOn(registerModule, 'addUseCaseModelLink').mockRejectedValue(new Error('link write failed'));
    // EBT exception (owner-accepted, code review 006/008): fault injection — a simulated storage failure the real store cannot be made to produce on demand
    const flagSpy = vi.spyOn(registerModule, 'updateUseCaseVerdictSummary').mockRejectedValue(new Error('flag write failed'));
    await user.click(confirm);
    await waitFor(() => expect(linkSpy).toHaveBeenCalled(), { timeout: 5000 });
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 8000 });
    expect(flagSpy).toHaveBeenCalled();
    flagSpy.mockRestore();
    const row = (await getUseCases('all')).find((r) => r.description === DESC);
    expect(row).toBeDefined();
  }, 40000);

  it('TC-CR7-11h-1: on success the link exists for the saved case (the order change loses nothing)', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValue(extraction());
    const confirm = await reachConfirm(user);
    await user.click(confirm);
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 8000 });
    const row = (await getUseCases('all')).find((r) => r.description === DESC);
    expect(row).toBeDefined();
    const { edges } = await registerModule.getGraph(row!.use_case_id);
    expect(edges.some((e) => e.edge_type === 'uses_model')).toBe(true);
  }, 40000);
});
