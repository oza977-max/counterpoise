import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import RegisterDetail from '../RegisterDetail';
import * as registerModule from '../../store/register';
import { getUseCases } from '../../store/register';
import { pressNext, fillText, DUP_CHECK_WAIT } from './fillText';

// Review pass 2, M-1. The register says "No AI model is recorded for this use case" when a case has no
// uses_model edge. The link is written AFTER the use-case node (writing it first
// stranded a case whose verdict was already on the trail). If the link write
// fails the case is saved and flagged model_link_unrecorded, and the register
// then says nothing about models.
// Mock budget = 0; addUseCaseModelLink is SPIED, not replaced. The case is driven through the guided form.
const NO_MODEL_LINE = 'No AI model is recorded for this use case — your AI risk team may ask which one it uses.';
const BASE = 'The Alpha tool built in-house drafts text. A person checks each one. It replaces no earlier model.';
// The store persists across the tests of this file, so each test describes its own case.
let DESC = BASE;

type User = ReturnType<typeof userEvent.setup>;

async function reachConfirm(user: User) {
  render(<App />);
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), DESC);
  await pressNext(user);
  await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
  await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
  await fillText(user, screen.getByLabelText(/what do you want to call it/i), 'Alpha drafting tool');
  // An outside assistant on a personal account, with the model named: the one
  // form route that names a model (the uses_model link this file is about).
  await user.click(screen.getByRole('radio', { name: /an ai assistant or website run by an outside company/i }));
  await user.click(await screen.findByRole('radio', { name: /a free or personal account/i }));
  await fillText(user, await screen.findByLabelText(/model name, if you know it/i), 'qwen3:4b');
  await user.click(screen.getByRole('radio', { name: /reads, summarises, translates, writes or answers questions in words/i }));
  await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /somewhere else, or not sure/i }));
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
  await user.click(screen.getByRole('button', { name: /^continue$/i }));
  await screen.findByText(/here.s what we understood/i);
  return screen.findByRole('button', { name: /confirm and evaluate/i });
}

describe('IntakeFlow — a failed model-link write never strands a case (review pass 2, M-1)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    DESC = `${BASE} Case ${crypto.randomUUID().slice(0, 8)}.`;
    vi.restoreAllMocks();
  });

  it('TC-CR7-11h: the link write fails, the case IS saved (no dead end), flagged model_link_unrecorded, and the register never says no AI model is recorded', async () => {
    const user = userEvent.setup();
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
    const confirm = await reachConfirm(user);
    await user.click(confirm);
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 8000 });
    const row = (await getUseCases('all')).find((r) => r.description === DESC);
    expect(row).toBeDefined();
    const { edges } = await registerModule.getGraph(row!.use_case_id);
    expect(edges.some((e) => e.edge_type === 'uses_model')).toBe(true);
  }, 40000);
});
