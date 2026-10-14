import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../App';
import { detectContradictions } from '../../engine/contradiction';
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

  it('TC-R18-GI-6-04: the check is the same on a second run and the same for a typed and a pre-filled-then-confirmed answer', () => {
    // The check is a pure function of (description, graph); the form builds the same graph from the
    // same confirmed values whatever their source, so equality of the call result is the property.
    const sentences = [
      'It uses no client data at all.',
      'No client data. Then more text after it.',
      'Text first, then: does not process personal data',
      'NO CLIENT DATA',
      'It reads client names. Elsewhere: no client data is used.',
      'The tool is fully manual. Nothing else.',
      'Without client data it works; none of these apply.',
    ];
    const graph = (cls: string, autonomy: number) =>
      ({
        input_nodes: [{ id: 'i', label: 'x', data_class: cls, data_zone: 'Zone C' }],
        processing_nodes: [{ id: 'p', label: 'x', model_type: 'llm', autonomy_level: autonomy, data_zone: 'Zone C', vendor: 'v', replaces_prior_model: false }],
        output_nodes: [],
        edges: [],
      }) as never;
    for (const d of sentences) {
      for (const g of [graph('Client PII', 0), graph('Internal', 0), graph('Internal', 3)]) {
        const first = detectContradictions(d, [], g);
        expect(detectContradictions(d, [], g)).toEqual(first);
        // a changed pre-fill and a typed answer arrive as the same graph, so the same result
        expect(detectContradictions(d, [], structuredClone(g))).toEqual(first);
      }
    }
  });
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
