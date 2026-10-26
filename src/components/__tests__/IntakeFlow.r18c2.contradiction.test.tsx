import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { SLOW_FLOW_MS } from './fillText';
import { waitForSeeding } from './r18aFlow';
import { continueButton, describeAndContinue, describeToReadForm, installModel, reply, tickFor, FORM_HEADING } from './r18c2Flow';

// R18-C2 (specs/intake-flow.md §27.4 "Contradiction check"; TC-R18-GI-6-01..04): the check runs on the
// description string and the graph built from the CONFIRMED answers, so a changed pre-fill and a typed
// answer are the same to it.

const DESC = 'A tool that summarises internal ticket volumes. It uses no client data at all.';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

/** Everything except the information question (5), by hand. */
async function fillRest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/what do you want to call it/i), 'Tool');
  await user.click(screen.getByRole('radio', { name: /something a team in your firm built for this job/i }));
  await user.click(screen.getByRole('radio', { name: /gives a score, ranking, flag, category or forecast/i }));
  await user.click(await screen.findByRole('radio', { name: /fixed, written-down rules/i }));
  await user.click(screen.getByRole('radio', { name: /finds or summarises for people to read/i }));
  await user.click(screen.getByRole('radio', { name: /^only me or my own team$/i }));
  await user.click(screen.getByRole('radio', { name: /none of these — it.s for day-to-day work/i }));
  await user.click(screen.getAllByRole('radio', { name: /^yes$/i })[0]!);
  await user.click(screen.getByRole('radio', { name: /just me, or a small trial/i }));
  await user.click(screen.getByRole('checkbox', { name: /united kingdom/i }));
  await user.click(screen.getByRole('radio', { name: /^no$/i }));
}

const EXPLAIN_LABEL = /which is right, and why\?/i;
const SUMMARY = /here.s what we understood/i;

describe('the contradiction check on the form route (R18-GI-6)', () => {
  it('TC-R18-GI-6-01: "no client data" plus a typed "information about people" stops at the explanation step', async () => {
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await waitForSeeding();
    await describeAndContinue(user, DESC);
    await screen.findByText(FORM_HEADING);
    await fillRest(user);
    await user.click(screen.getByRole('checkbox', { name: /information about people/i }));
    await user.click(continueButton());
    expect(await screen.findByLabelText(EXPLAIN_LABEL)).toBeInTheDocument();
    expect(screen.queryByText(SUMMARY)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm and evaluate/i })).not.toBeInTheDocument();
    expect(screen.getByText(/your description says no personal information is involved/i)).toBeInTheDocument();
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-6-02: the same stop when the answer was a pre-fill the person changed; the stop has no skip', async () => {
    installModel({
      kind: 'honours-format',
      reply: reply([{ question: '5', values: [{ option: 'everyday', quote: 'internal ticket volumes' }] }]),
    });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await waitForSeeding();
    await describeToReadForm(user, DESC);
    expect(screen.getByText(/from your description/i)).toBeInTheDocument();
    await fillRest(user);
    // the change away from the pre-fill is itself the confirmation
    await user.click(screen.getByRole('checkbox', { name: /everyday work information/i }));
    await user.click(screen.getByRole('checkbox', { name: /information about people/i }));
    await user.click(continueButton());
    expect(await screen.findByLabelText(EXPLAIN_LABEL)).toBeInTheDocument();
    expect(screen.getByText(/your description says no personal information is involved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirm and evaluate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip/i })).not.toBeInTheDocument();
    // answering it is the only way on
    await user.type(screen.getByLabelText(EXPLAIN_LABEL), 'The summaries are about staff.');
    await user.click(within(screen.getByRole('region', { name: /contradiction review/i })).getByRole('button', { name: /^continue$/i }));
    await screen.findByText(SUMMARY);
  }, SLOW_FLOW_MS);

  it('TC-R18-GI-6-03: a confirmed "everyday work information" gives no stop', async () => {
    installModel({
      kind: 'honours-format',
      reply: reply([{ question: '5', values: [{ option: 'everyday', quote: 'internal ticket volumes' }] }]),
    });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await waitForSeeding();
    await describeToReadForm(user, DESC);
    await fillRest(user);
    await user.click(tickFor(/what information/));
    await user.click(continueButton());
    await screen.findByText(SUMMARY);
    expect(screen.queryByLabelText(EXPLAIN_LABEL)).not.toBeInTheDocument();
  }, SLOW_FLOW_MS);

  // TC-R18-GI-6-04 (review pass 1, M1): the same final answers must give the same stops whether they were
  // typed, pre-filled and ticked, or changed and changed back. Each route is a full walk through the screens;
  // what is compared is what the person sees at the end of it.
  type Route = 'typed' | 'prefilled-and-ticked' | 'changed-and-changed-back';
  async function stopSeenFor(option: 'people' | 'everyday', route: Route) {
    localStorage.clear();
    sessionStorage.clear();
    const user = userEvent.setup({ delay: null });
    const view = render(<App />);
    await waitForSeeding();
    if (route === 'typed') {
      await describeAndContinue(user, DESC);
      await screen.findByText(FORM_HEADING);
    } else {
      installModel({ kind: 'honours-format', reply: reply([{ question: '5', values: [{ option, quote: 'internal ticket volumes' }] }]) });
      await describeToReadForm(user, DESC);
      expect(screen.getByText(/from your description/i)).toBeInTheDocument();
    }
    await fillRest(user);
    const box = () => screen.getByRole('checkbox', { name: option === 'people' ? /information about people/i : /everyday work information/i });
    if (route === 'typed') await user.click(box());
    else if (route === 'prefilled-and-ticked') await user.click(tickFor(/what information/));
    else {
      await user.click(box()); // off: a change
      expect(screen.getByText(/changed by you/i)).toBeInTheDocument();
      await user.click(box()); // back on: the original again, and it counts as confirmed
      expect(screen.queryByText(/changed by you/i)).not.toBeInTheDocument();
      expect(screen.getByText(/confirmed by you — suggested by the AI model .+ from your description/i)).toBeInTheDocument();
    }
    await user.click(continueButton());
    await waitFor(() => expect(screen.queryByLabelText(EXPLAIN_LABEL) ?? screen.queryByText(SUMMARY)).not.toBeNull());
    const stopped = screen.queryByLabelText(EXPLAIN_LABEL) !== null;
    const message = stopped ? screen.getByText(/your description says no personal information is involved/i).textContent : '';
    const seen = { stopped, message, summary: screen.queryByText(SUMMARY) !== null };
    view.unmount();
    vi.unstubAllGlobals();
    return seen;
  }

  it('TC-R18-GI-6-04r1a: typed, pre-filled-and-ticked and changed-and-changed-back "information about people" give the same stop', async () => {
    const routes: Route[] = ['typed', 'prefilled-and-ticked', 'changed-and-changed-back'];
    const seen = [];
    for (const r of routes) seen.push(await stopSeenFor('people', r));
    expect(seen[0]).toMatchObject({ stopped: true, summary: false });
    expect(seen[0]!.message).toMatch(/personal information/i);
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
  }, 3 * SLOW_FLOW_MS);

  it('TC-R18-GI-6-04r1b: typed, pre-filled-and-ticked and changed-and-changed-back "everyday work information" all give no stop', async () => {
    const routes: Route[] = ['typed', 'prefilled-and-ticked', 'changed-and-changed-back'];
    const seen = [];
    for (const r of routes) seen.push(await stopSeenFor('everyday', r));
    expect(seen[0]).toEqual({ stopped: false, message: '', summary: true });
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
  }, 3 * SLOW_FLOW_MS);

  it('a pre-filled "information about people" confirmed by its tick stops exactly as a typed one does (TC-R18-GI-6-04)', async () => {
    installModel({
      kind: 'honours-format',
      reply: reply([{ question: '5', values: [{ option: 'people', quote: 'internal ticket volumes' }] }]),
    });
    const user = userEvent.setup({ delay: null });
    render(<App />);
    await waitForSeeding();
    await describeToReadForm(user, DESC);
    await fillRest(user);
    await user.click(tickFor(/what information/));
    await user.click(continueButton());
    expect(await screen.findByLabelText(EXPLAIN_LABEL)).toBeInTheDocument();
    expect(screen.getByText(/your description says no personal information is involved/i)).toBeInTheDocument();
  }, SLOW_FLOW_MS);
});
