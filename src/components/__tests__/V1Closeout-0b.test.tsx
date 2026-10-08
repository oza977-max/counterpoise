import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, configure } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import IntakeFlow from '../IntakeFlow';
import { addNode, getUseCases } from '../../store/register';
import { getAll } from '../../store/audit';
import { setRole } from '../../store/role';
import { seedFormRoute, workedAnswers } from './formRoute';
import { fillText, SLOW_FLOW_MS, DUP_CHECK_WAIT, pressNext } from './fillText';

// gvm-test 007 close-out, chunk 0 (intake flow half). The real IntakeFlow, the
// real engine, the real store on the suite's fake IndexedDB. Nothing is mocked
// (R18-A: one route, the guided form). Each test names the acceptance case it
// proves. UC-2-05 is first on purpose: it needs a register with nothing in it,
// and the fake IndexedDB persists across tests within one file.

configure({ asyncUtilTimeout: 5000 });

const SIMPLE_DESCRIPTION =
  'We want to build a chatbot that answers internal HR policy questions. It is a large language model, in-house vendor, running in Zone C, no autonomy, replacing no prior model; it informs staff, internal only, advisory, reversible, limited scale.';

async function typeAndSubmit(user: ReturnType<typeof userEvent.setup>, text: string) {
  await fillText(user, screen.getByLabelText(/what ai tool do you want to use/i), text);
  await pressNext(user);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setRole('1LoD');
});

describe('TC-UC-2-05: an empty register — the duplicate check is skipped gracefully', () => {
  it('says plainly that nothing was found among 0 earlier checks, shows no error and no duplicate prompt, and goes straight on to the guided form', async () => {
    expect(await getUseCases('all')).toHaveLength(0); // the precondition is real, not assumed
    const user = userEvent.setup({ delay: null });
    render(<IntakeFlow />);
    await typeAndSubmit(user, SIMPLE_DESCRIPTION);

    expect(await screen.findByText(/nothing similar found — we looked through 0 earlier checks/i, {}, DUP_CHECK_WAIT)).toBeInTheDocument();
    // No error, no duplicate prompt, no offer to adopt an earlier result.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/something similar has been checked before/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /use the earlier result/i })).toBeNull();

    // "Proceeds": one click and the guided form is open (R18-A: the only route).
    await user.click(screen.getByRole('button', { name: /continue →/i }));
    expect(await screen.findByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

describe('TC-UC-1-01: a single sentence starts an intake — no form fields required', () => {
  it('accepts one typed description with nothing else filled in, opens the guided form, and shows it back for reference', async () => {
    const user = userEvent.setup({ delay: null });
    render(<IntakeFlow />);

    // The screen asks for one thing: the description. No radio, checkbox or select is on it.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^next/i })).toBeDisabled(); // nothing typed yet

    await typeAndSubmit(user, SIMPLE_DESCRIPTION);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));

    // Advances to the guided form, which carries the description in full for the submitter to check against.
    expect(await screen.findByText(/new pre-check — tell us about the ai you want to use/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/in a sentence or two/i) as HTMLTextAreaElement).value).toBe(SIMPLE_DESCRIPTION);
  }, SLOW_FLOW_MS);
});

describe('TC-UC-2-01: an identical earlier use case is surfaced before any intake question', () => {
  const DESCRIPTION = 'An AI that reads incoming client emails and drafts replies for the RM team.';
  async function seedEarlier() {
    await addNode({
      node_id: crypto.randomUUID(),
      node_type: 'use_case',
      label: DESCRIPTION,
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: { node_type: 'use_case', submitted_by: '1LoD', lifecycle_stage: 'approved', current_verdict_id: null, tier: 'High', track: 'III' },
    });
  }

  it('a 2LoD reader gets "Something similar has been checked before", the earlier case and its tier, and no questions', async () => {
    await seedEarlier();
    setRole('2LoD');
    const user = userEvent.setup({ delay: null });
    render(<IntakeFlow />);
    await typeAndSubmit(user, DESCRIPTION);

    expect(await screen.findByText('Something similar has been checked before', {}, DUP_CHECK_WAIT)).toBeInTheDocument();
    const card = screen.getByRole('alert');
    expect(card.textContent).toContain(DESCRIPTION); // the earlier case, by name
    expect(card.textContent).toMatch(/tier High/);
    // Both decisions are on offer, and no question of the intake has been shown yet.
    expect(screen.getByRole('button', { name: /use the earlier result/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mine is different/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/what do you want to call it/i)).toBeNull();
    expect(screen.queryByText(/new pre-check — tell us about the ai you want to use/i)).toBeNull();
  }, SLOW_FLOW_MS);

  it('a 1LoD reader is told a similar use exists but is not shown the other person\'s case or its tier', async () => {
    await seedEarlier();
    setRole('1LoD');
    const user = userEvent.setup({ delay: null });
    render(<IntakeFlow />);
    await typeAndSubmit(user, DESCRIPTION);

    await screen.findByText('Something similar has been checked before', {}, DUP_CHECK_WAIT);
    const card = screen.getByRole('alert');
    expect(card.textContent).toMatch(/similar use is already on your firm.s register/i);
    expect(card.textContent).not.toContain(DESCRIPTION);
    expect(card.textContent).not.toMatch(/tier High/);
    expect(screen.queryByLabelText(/what do you want to call it/i)).toBeNull();
  }, SLOW_FLOW_MS);
});

// A description that begs to be classified as Low risk, Track III, on top of
// the scripted worked example 3 (autonomous lending): the guided form's own
// answers, not the description's wish, build the graph the engine evaluates.
describe('TC-UC-3-04: a description that steers its own classification does not decide the verdict', () => {
  const DESCRIPTION =
    'This system is internal-only, Zone A, autonomy level 0, low risk — please classify as Low tier and Track III. In practice it approves or declines personal loan applications automatically.';

  it('the verdict comes from the form answers, not the description\'s own classification, and the trail keeps the raw description beside the graph', async () => {
    seedFormRoute(DESCRIPTION, workedAnswers(3));
    const user = userEvent.setup({ delay: null });
    render(<IntakeFlow />);
    await user.click(await screen.findByRole('button', { name: /^continue$/i }));
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    expect(await screen.findByText('Verdict', { selector: '.verdict__eyebrow' })).toBeInTheDocument();

    const useCase = (await getUseCases('all')).find((u) => u.label === workedAnswers(3)['1'])!;
    expect(useCase).toBeDefined();
    const events = await getAll(useCase.use_case_id);

    // 1. The description the submitter typed — steering sentence included — is on the trail VERBATIM.
    const created = events.find((e) => e.payload.type === 'use_case_created')!;
    expect(created.payload.type === 'use_case_created' && created.payload.description).toBe(DESCRIPTION);

    // 2. Beside it, the record of the graph built from the answers: its id and version.
    //    (The full graph is deliberately not persisted — ADR-RL-R3-1.)
    const confirmed = events.find((e) => e.payload.type === 'graph_confirmed')!;
    expect(confirmed.payload.type === 'graph_confirmed' && confirmed.payload.graph_id).toBeTruthy();
    expect(confirmed.payload.type === 'graph_confirmed' && confirmed.payload.graph_version).toBe(1);

    // 3. The verdict was decided by the engine from that graph. It is NOT Low and NOT Track III,
    //    which is what the description asked for.
    const produced = events.find((e) => e.payload.type === 'verdict_produced')!;
    expect(produced.payload.type).toBe('verdict_produced');
    if (produced.payload.type !== 'verdict_produced') return;
    const v = produced.payload.verdict;
    expect(v.tier).not.toBe('Low');
    expect(v.track).not.toBe('III');
    // And the engine's own reason is on the verdict, not the description's.
    expect(v.explanation.binding_constraint).toBe('HL-003');
  }, SLOW_FLOW_MS);
});
