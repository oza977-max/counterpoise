import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import * as evaluateModule from '../../engine/evaluate';
import { addNode } from '../../store/register';
import { getAll, getAllForExport } from '../../store/audit';
import { fillText, pressNext, SLOW_FLOW_MS, DUP_CHECK_WAIT } from './fillText';
import { answerExampleOne, describeToForm, waitForSeeding } from './r18aFlow';
import { R18_COPY } from '../plain-copy';
import { codePointLength } from '../../engine/mentioned';

// R18-A: Back from the form (specs/intake-flow.md 27.1) and the 8,001-character
// text kept whole. No mocks of our own code; the one spy makes a single
// evaluation fail the way a gap in the firm's rules would (fault injection).

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const box = () => screen.getByLabelText(/what ai tool do you want to use/i);
const backButtons = () => screen.queryAllByRole('button', { name: /back/i });

async function seedExistingUseCase(label: string) {
  const node = {
    node_id: crypto.randomUUID(),
    node_type: 'use_case' as const,
    label,
    created_at: '2026-07-29T00:00:00.000Z',
    metadata: {
      node_type: 'use_case' as const,
      submitted_by: '1LoD',
      lifecycle_stage: 'approved' as const,
      current_verdict_id: null,
      tier: 'High',
      track: 'II',
    },
  };
  await addNode(node);
  return node;
}

describe('Back from the form (TC-R18-GI-8-07)', () => {
  it('TC-R18-GI-8-07: Back returns to the description unchanged with Next enabled; Next again shows the form with the same typed answers and no second similar-cases screen', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const text = 'Rewind probe tool for ticket volumes';
    await describeToForm(user, text);
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Ticket tool');
    await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));

    await user.click(screen.getAllByRole('button', { name: /back/i })[0]!);
    expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toHaveValue(text);
    expect(screen.getByRole('button', { name: /^next/i })).toBeEnabled();

    await pressNext(user);
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    // the similar-checks screen did not come back
    expect(screen.queryByText(/looking through earlier checks/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^continue →$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Ticket tool');
    expect(screen.getByRole('radio', { name: /something a team in your firm built for this job/i })).toBeChecked();
    expect(screen.getByLabelText(/in a sentence or two/i)).toHaveValue(text);
  }, SLOW_FLOW_MS);

  it('R18-A: a text edited on the form (question 2) is the text on the description screen after Back', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToForm(user, 'First wording of the tool.');
    await user.type(screen.getByLabelText(/in a sentence or two/i), ' And a second sentence.');
    await user.click(screen.getAllByRole('button', { name: /back/i })[0]!);
    expect(await screen.findByLabelText(/what ai tool do you want to use/i)).toHaveValue(
      'First wording of the tool. And a second sentence.',
    );
  });
});

describe('Next with an unchanged description does not write the duplicate decision twice (TC-R18-GI-8-14)', () => {
  it('TC-R18-GI-8-14: one duplicate_dismissed after Back and an unchanged Next; an edited text runs the check again', async () => {
    const existing = await seedExistingUseCase('Rewind duplicate probe assistant');
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const text = 'Rewind duplicate probe assistant';

    await fillText(user, box(), text);
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /mine is different/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    const dismissed = async () => (await getAll(existing.node_id)).filter((e) => e.payload.type === 'duplicate_dismissed');
    await waitFor(async () => expect(await dismissed()).toHaveLength(1));

    // Back, then Next with the description unchanged: straight to the form.
    await user.click(screen.getAllByRole('button', { name: /back/i })[0]!);
    await pressNext(user);
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    expect(screen.queryByRole('button', { name: /mine is different/i })).not.toBeInTheDocument();
    expect(await dismissed()).toHaveLength(1);

    // Back, edit one word, Next: the similar-cases screen again.
    await user.click(screen.getAllByRole('button', { name: /back/i })[0]!);
    await fillText(user, await screen.findByLabelText(/what ai tool do you want to use/i), ' helper');
    await pressNext(user);
    expect(await screen.findByRole('button', { name: /mine is different/i }, DUP_CHECK_WAIT)).toBeInTheDocument();
    expect(screen.queryByText(/new pre-check — tell us about the ai you want to use/i)).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);
});

describe('Back is refused for a correction and after a failed evaluation (TC-R18-GI-8-13)', () => {
  async function reachVerdict(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Back refusal probe');
    await answerExampleOne(user);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });
  }

  it('TC-R18-GI-8-13: the form opened by "Correct your answers" has no Back, and the trail still holds one use_case_created for the case', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToForm(user, 'Back refusal probe for a correction');
    await reachVerdict(user);

    await user.click(document.querySelector<HTMLButtonElement>('.verdict__first-correct')!);
    expect(await screen.findByText(/you.re correcting your earlier answers/i)).toBeInTheDocument();
    expect(backButtons()).toHaveLength(0);

    const created = (await getAllForExport()).filter(
      (e) => e.event_type === 'use_case_created' && (e.payload as { description?: string }).description === 'Back refusal probe for a correction',
    );
    expect(created).toHaveLength(1);
  }, SLOW_FLOW_MS);

  it('R18-A: the form after a failed evaluation has no Back either', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await describeToForm(user, 'Back refusal probe after a failure');
    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Failure probe');
    await answerExampleOne(user);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await waitForSeeding();
    // EBT exception (owner-accepted, code review 006/008): fault injection - makes ONE evaluation fail the way a gap in the firm's rules would; the real evaluate runs every other time
    vi.spyOn(evaluateModule, 'evaluate').mockReturnValueOnce({ ok: false, error: { kind: 'no-track-match' } } as never);
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    // the form is back, carrying its case, with the reason and no Back
    await screen.findByRole('alert');
    expect(screen.getByLabelText(/what do you want to call it/i)).toHaveValue('Failure probe');
    expect(backButtons()).toHaveLength(0);
  }, SLOW_FLOW_MS);
});

describe('the whole text is kept (TC-R18-GI-14-05)', () => {
  it('TC-R18-GI-14-05: an 8,001-code-point description is whole in the draft mid-way and in the record at the end', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    const text = ('A dashboard that summarises last month’s internal ticket volumes for the operations team. ' as string).repeat(100).slice(0, 8000) + '!';
    expect(codePointLength(text)).toBe(8001);

    const box = screen.getByLabelText(/what ai tool do you want to use/i);
    await user.click(box);
    await user.paste(text);
    await pressNext(user);
    await user.click(await screen.findByRole('button', { name: /continue →/i }, DUP_CHECK_WAIT));
    await screen.findByText(/new pre-check — tell us about the ai you want to use/i);
    // no model: the form is blank with the one sentence (and the too-long sentence does not apply)
    expect(screen.getByText(R18_COPY.NO_MODEL_INTERIM_SENTENCE)).toBeInTheDocument();

    // mid-way: the draft holds all of it
    const draft = JSON.parse(sessionStorage.getItem('aigate:intake-draft')!);
    expect(draft.state.description).toBe(text);
    expect(codePointLength(draft.state.description)).toBe(8001);

    await user.type(screen.getByLabelText(/what do you want to call it/i), 'Long text probe');
    await answerExampleOne(user);
    await user.click(screen.getByRole('button', { name: /^continue$/i }));
    await screen.findByText(/here.s what we understood/i);
    await user.click(await screen.findByRole('button', { name: /confirm and evaluate/i }));
    await screen.findByText('Verdict', { selector: '.verdict__eyebrow' }, { timeout: 5000 });

    // at the end: the record holds all of it
    const created = (await getAllForExport()).filter(
      (e) => e.event_type === 'use_case_created' && (e.payload as { description?: string }).description?.startsWith('A dashboard that summarises'),
    );
    expect(created).toHaveLength(1);
    const recorded = (created[0]!.payload as { description: string }).description;
    expect(recorded).toBe(text.trim());
    expect(within(document.body).queryByText(R18_COPY.TOO_LONG_SENTENCE)).not.toBeInTheDocument();
  }, 60000);
});
